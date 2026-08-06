import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Boot an HTTP server with the realtime layer attached, on an ephemeral port.
 *
 * `attach` is passed in rather than imported: every caller pulls
 * `attachRealtimeServer` through `await import(...)` after mocking auth, and a
 * static import here would tie this helper to that ordering.
 *
 * Binds loopback explicitly — two of the four call sites used to listen on all
 * interfaces while still connecting to 127.0.0.1.
 */
export async function startRealtimeServer(
  attach: (server: Server) => unknown,
): Promise<{ server: Server; port: number }> {
  const server = createServer();
  attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

/** Close it, waiting for open connections to drain. */
export function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
