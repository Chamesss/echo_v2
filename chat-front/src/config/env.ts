import { z } from 'zod';

/**
 * Frontend environment variables.
 *
 * Vite only exposes vars prefixed with `VITE_` to client code. Parsed at
 * import time so a missing/malformed value crashes the dev server immediately
 * instead of producing a vague runtime error inside a fetch call.
 */
const schema = z.object({
  // Absolute base URL of the API + WebSocket server. OPTIONAL: in production the
  // server serves the SPA, so they share an origin and this is left unset (we
  // fall back to the current origin — see `API_URL`). In dev the front and
  // server run on different ports, so `.env` sets it (e.g. http://localhost:4000).
  VITE_API_URL: z.string().url().optional(),
  // Cloudflare Turnstile site key. When present, the auth forms render a
  // Turnstile widget and attach its token to sign-in/sign-up/reset requests.
  // Optional: leave unset to disable CAPTCHA in dev (mirrors the server, which
  // only enforces it when TURNSTILE_SECRET_KEY is set).
  VITE_TURNSTILE_SITE_KEY: z.string().optional(),
});

export const env = schema.parse(import.meta.env);

/**
 * The resolved API/WebSocket base URL the whole app builds requests from.
 *
 * - Dev: `VITE_API_URL` points at the standalone server (cross-origin).
 * - Prod: unset → same-origin (Express serves this SPA), so we use the current
 *   origin. WebSocket URLs are derived from this via `http→ws` at the call site.
 */
export const API_URL: string =
  env.VITE_API_URL ?? (typeof window !== "undefined" ? window.location.origin : "");

/**
 * Runtime public config injected into index.html by the server (production,
 * single-origin) — see `serveSpa` in chat-server/src/app.ts. Lets deploy-time
 * values reach the SPA WITHOUT a rebuild, unlike build-time `VITE_*` vars.
 */
interface RuntimeConfig {
  turnstileSiteKey?: string | null;
}
declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}
const runtime: RuntimeConfig =
  (typeof window !== "undefined" && window.__APP_CONFIG__) || {};

/**
 * Cloudflare Turnstile site key. Prefers the RUNTIME value injected by the
 * server (so prod just needs `TURNSTILE_SITE_KEY` set on the host — no rebuild),
 * and falls back to the build-time `VITE_TURNSTILE_SITE_KEY` for local dev.
 */
export const TURNSTILE_SITE_KEY: string | undefined =
  runtime.turnstileSiteKey || env.VITE_TURNSTILE_SITE_KEY;
