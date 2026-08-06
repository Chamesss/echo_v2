import net from "node:net";

/**
 * A TCP proxy that can break a connection the way a real network does.
 *
 * Half-open sockets — the failure this exists for — cannot be reproduced from
 * application code. Calling `ws.close()` sends a close frame, which is the
 * cooperative shutdown clients already handle. What breaks a client is the
 * uncooperative case: a NAT rebind, a cell handoff, a laptop sleeping. The TCP
 * connection stays established from both endpoints' point of view, nothing is
 * ever delivered again, and no event fires anywhere. Only something sitting at
 * the transport layer can stage that, which is what `freeze()` does.
 *
 * Tests point a client at `proxy.port` instead of the server's, then reach
 * through the proxy to disrupt the link.
 */
export class ChaosProxy {
  private server: net.Server | null = null;
  private readonly pairs = new Set<{ client: net.Socket; upstream: net.Socket }>();
  private frozen = false;
  private latencyMs = 0;

  // No `targetPort` field: `start` closes over the port it was given and every
  // upstream connect uses that local, so a stored copy was only ever a second
  // source of truth waiting to disagree with the first.
  private constructor(readonly port: number) {}

  /** Start a proxy in front of `targetPort` on an ephemeral port. */
  static async start(targetPort: number): Promise<ChaosProxy> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    const proxy = new ChaosProxy(port);
    proxy.server = server;

    server.on("connection", (client) => {
      // A network that delivers nothing also can't complete a handshake. Letting
      // a new connection through while frozen would strand the client in a state
      // no real outage produces — TCP established, but every frame it sends on
      // open (its subscriptions) silently swallowed, so it looks connected
      // forever while receiving nothing.
      if (proxy.frozen) {
        client.destroy();
        return;
      }

      const upstream = net.connect(targetPort, "127.0.0.1");
      const pair = { client, upstream };
      proxy.pairs.add(pair);

      // Manual pumping rather than pipe(): forwarding has to be suppressible
      // mid-stream without tearing the sockets down.
      client.on("data", (chunk) => proxy.forward(upstream, chunk));
      upstream.on("data", (chunk) => proxy.forward(client, chunk));

      const teardown = () => {
        proxy.pairs.delete(pair);
        client.destroy();
        upstream.destroy();
      };
      client.on("close", teardown);
      upstream.on("close", teardown);
      client.on("error", teardown);
      upstream.on("error", teardown);
    });

    return proxy;
  }

  private forward(to: net.Socket, chunk: Buffer): void {
    if (this.frozen) return; // swallowed: the link is up, nothing crosses it
    if (to.destroyed) return;
    if (this.latencyMs > 0) {
      setTimeout(() => {
        if (!to.destroyed) to.write(chunk);
      }, this.latencyMs);
      return;
    }
    to.write(chunk);
  }

  /**
   * Stop delivering bytes in both directions while leaving every socket open.
   *
   * This is the half-open simulation: both ends still believe they are
   * connected, so `readyState` stays OPEN and no close event ever fires. Without
   * an application-level heartbeat a client is stuck here permanently.
   */
  freeze(): void {
    this.frozen = true;
  }

  /** Resume normal forwarding. */
  resume(): void {
    this.frozen = false;
  }

  /** Inject one-way latency on every forwarded chunk. */
  delay(ms: number): void {
    this.latencyMs = ms;
  }

  /**
   * Destroy every live connection without a close handshake — an abrupt drop
   * (process killed, cable pulled), as distinct from a graceful close.
   */
  drop(): void {
    for (const pair of this.pairs) {
      pair.client.destroy();
      pair.upstream.destroy();
    }
    this.pairs.clear();
  }

  /** Live connection pairs — useful for asserting sockets were released. */
  get connectionCount(): number {
    return this.pairs.size;
  }

  async close(): Promise<void> {
    this.drop();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
