import { createServer } from "node:http";
import { env } from "./config/env.js";
import { app } from "./app.js";
import { attachRealtimeServer } from "./infrastructure/realtime/server.js";
import { backplane } from "./infrastructure/realtime/backplane.js";
import { pool } from "./infrastructure/database/pool.js";
import { logger } from "./shared/logger/logger.js";

/**
 * Process entrypoint.
 *
 * Wires the HTTP server, WebSocket server, and graceful-shutdown hooks
 * together. Importing this module starts the server — production runs via
 * `npm start`, dev via `npm run dev`. For tests, import `./app` directly to
 * get the Express app without binding to a port.
 */
const server = createServer(app);
const wss = attachRealtimeServer(server);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, `listening on http://localhost:${env.PORT}`);
  logger.info(`API Docs on http://localhost:${env.PORT}/api/docs`);
});

/**
 * Graceful shutdown: drain WebSocket clients, stop accepting new connections,
 * drain the pg pool, exit.
 *
 * Triggered by SIGINT (Ctrl+C in dev) and SIGTERM (orchestrator stop signal in
 * prod). Live WebSocket connections are closed first with a 1001 "going away"
 * frame so clients disconnect cleanly (and can decide whether to reconnect)
 * instead of seeing the socket vanish — and so `wss`/`server` aren't left
 * holding open sockets across a redeploy. Closing the pool then releases all
 * open Postgres connections back to the cluster so we don't leak slots.
 */
const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "shutting down");
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }
  wss.close();
  await backplane.close();
  server.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
