import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { corsOrigins, env } from "./config/env.js";
import { pool } from "./infrastructure/database/pool.js";
import { backplane } from "./infrastructure/realtime/backplane.js";
import { logger } from "./shared/logger/logger.js";
import { asyncHandler } from "./shared/middleware/async-handler.js";
import { requestId } from "./shared/middleware/request-id.js";
import { authenticate } from "./shared/middleware/authenticate.js";
import { errorHandler } from "./shared/errors/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { docsRouter } from "./modules/docs/docs.routes.js";
import { workspacesRouter } from "./modules/workspaces/workspaces.routes.js";
import { acceptInvitesRouter } from "./modules/members/accept-invites.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { preferencesRouter } from "./modules/preferences/preferences.routes.js";
import { attachmentsRouter } from "./modules/attachments/attachments.routes.js";
import { filesRouter } from "./modules/files/files.routes.js";

/**
 * Builds the configured Express application.
 *
 * Imported by `server.ts` in production and by integration tests (which need
 * the app without binding to a port). The middleware order below is
 * load-bearing — read the comments before reshuffling.
 */
export const app = express();

// Behind Render/Railway's TLS-terminating proxy: trust the forwarded headers
// (one hop) so `req.ip`/`req.protocol` reflect the real client + https — needed
// for correct rate limiting, secure-cookie handling, and redirect URLs.
app.set("trust proxy", 1);

// CORS must be first so it handles the OPTIONS preflight before any other
// middleware decides to short-circuit. `credentials: true` is required for
// the browser to send/receive Better Auth's session cookie across origins.
app.use(cors({ origin: corsOrigins, credentials: true }));

// Security response headers: HSTS, X-Content-Type-Options (noSniff),
// X-Frame-Options, Referrer-Policy, Cross-Origin-* isolation, etc. Runs after
// CORS so it never interferes with the preflight, but before everything else
// so every response (including /api/auth/*) carries the headers.
//
// CSP is deliberately turned off here. This server returns JSON for the API —
// there's no markup for a Content-Security-Policy to protect — and its one
// HTML surface, the Scalar docs page (/api/docs), loads scripts/styles from a
// CDN and would break under helmet's strict default policy. The application's
// real CSP belongs on the frontend host that serves the SPA shell.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(requestId);

// Better Auth handles its own body parsing. Mount it BEFORE express.json so
// the JSON parser doesn't consume the request body first and leave the auth
// handler with nothing to read.
app.use("/api/auth", authRouter);

// Everything below this line gets JSON parsing.
app.use(express.json({ limit: "1mb" }));

/**
 * Liveness. Touches nothing on purpose: `render.yaml` points `healthCheckPath`
 * here, so verifying the database would let a Neon blip or a cold start cycle a
 * healthy instance.
 */
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Readiness — for humans and dashboards, deliberately NOT `healthCheckPath`.
 * Short timeout of its own: a probe that hangs 15s has already failed.
 */
app.get(
  "/health/ready",
  asyncHandler(async (_req, res) => {
    const checks = { database: false, realtime: backplane.isDeliveryHealthy() };

    try {
      const client = await pool.connect();
      try {
        // Session-level, not `SET LOCAL` — the latter is silently ignored outside
        // a transaction. Reset before release so the pooled connection isn't
        // left with the probe's ceiling.
        await client.query("SET statement_timeout = 2000");
        await client.query("SELECT 1");
        checks.database = true;
      } finally {
        try {
          await client.query("RESET statement_timeout");
        } finally {
          client.release();
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "readiness probe: database unreachable");
    }

    const ready = checks.database && checks.realtime;
    res.status(ready ? 200 : 503).json({ ready, checks });
  }),
);

// API docs are public — no auth, mounted before any auth wall.
app.use("/api/docs", docsRouter);

// Signed-redirect for owned private-bucket objects (avatars + message attachments).
// Public: loaded by <img>/<video> tags that can't send the session cookie
// cross-origin; the (namespaced, uuid-bearing) object key is the bearer token.
app.use("/api/files", filesRouter);

registerModuleRoutes(app);

// Serve the built React SPA (single-origin production deploy). Mounted AFTER the
// API routes so it can't shadow them, and only when a build is present — in dev
// the frontend runs on its own Vite origin and in tests there is no build.
serveSpa(app);

// Error handler MUST be last so it catches errors from every preceding layer.
app.use(errorHandler);

function registerModuleRoutes(application: express.Express): void {
  application.use("/api/workspaces", authenticate, workspacesRouter);
  // Invites are NOT workspace-scoped (invitees aren't members yet) and auth is
  // split PER-ROUTE inside the router: GET /:token is public (a logged-out
  // invitee must view it to sign up), POST /:token/accept is authenticated.
  application.use("/api/invites", acceptInvitesRouter);
  application.use("/api/users", authenticate, usersRouter);
  // The notification inbox is user-scoped and spans workspaces, so (like invite
  // acceptance) it sits behind `authenticate` but outside the workspace wall.
  application.use("/api/notifications", authenticate, notificationsRouter);
  // UI preferences (theme, density) are user-global — one payload per person,
  // shared across every workspace — so they sit outside the workspace wall too.
  application.use("/api/preferences", authenticate, preferencesRouter);
  // Attachment policy is user-scoped (workspace-agnostic); presign is mounted
  // on the channel router (needs the channel-membership context).
  application.use("/api/attachments", authenticate, attachmentsRouter);
}

/**
 * Serve the compiled frontend (Vite `dist`) so one process serves the SPA, the
 * REST API, and the WebSocket upgrade on a single origin.
 *
 * `FRONT_DIST_DIR` overrides the location (set in the Docker image); the default
 * resolves the sibling `echo-front/dist` from this file. We no-op when there's no
 * build — keeping `bun dev` (frontend on a separate Vite port) and the
 * integration tests (which import `app` with no build) unaffected.
 *
 * Static assets are hashed and served directly; every other GET that asks for
 * HTML falls back to `index.html` so React Router can resolve client-side routes
 * (deep links / refresh). The fallback regex deliberately excludes the
 * `/api`, `/health`, and `/ws` namespaces, so an unmatched `/api/*` still flows
 * through to the JSON 404 in `errorHandler` instead of returning the SPA shell.
 * (The WS upgrade is handled on the raw HTTP server in `server.ts`, independent
 * of Express routing, so it is never affected by this anyway.)
 */
function serveSpa(application: express.Express): void {
  const distDir =
    process.env.FRONT_DIST_DIR ??
    path.resolve(fileURLToPath(import.meta.url), "../../../echo-front/dist");
  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) return;

  // Inject RUNTIME public config into index.html. `VITE_*` vars are frozen at
  // build time, but the deploy host's runtime env is not — so values only known
  // at deploy (e.g. the Turnstile site key) reach the SPA without a rebuild. The
  // client reads `window.__APP_CONFIG__` (see echo-front config/env.ts). Values
  // here are PUBLIC by definition (they ship to the browser). `<` is escaped so
  // a value can't break out of the <script>.
  const runtimeConfig = { turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null };
  const configScript = `<script>window.__APP_CONFIG__=${JSON.stringify(
    runtimeConfig,
  ).replace(/</g, "\\u003c")}</script>`;
  const indexHtml = readFileSync(indexPath, "utf8").replace(
    "</head>",
    `${configScript}</head>`,
  );

  // Serve hashed assets directly, but `index: false` so `/` flows through the
  // HTML handler below (which injects config) instead of the raw file.
  application.use(express.static(distDir, { index: false }));
  application.get(
    /^\/(?!api(?:\/|$)|health(?:\/|$)|ws(?:\/|$)).*/,
    (req, res, next) => {
      if (req.method !== "GET" || !req.accepts("html")) return next();
      res.type("html").send(indexHtml);
    },
  );
}
