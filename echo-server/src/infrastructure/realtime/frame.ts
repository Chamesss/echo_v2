import type { RawData } from "ws";

/**
 * Decode a WebSocket payload to text.
 *
 * `RawData` is `Buffer | ArrayBuffer | Buffer[]` and only the first stringifies
 * usefully — a bare `.toString()` yields "[object ArrayBuffer]" or comma-joined
 * fragments, which then fails `JSON.parse` as a malformed frame.
 *
 * Not in `protocol.ts`: that file is type-imported by the frontend, and a `ws`
 * import would pull a server dependency into the SPA's typecheck.
 */
export function decodeFrame(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}
