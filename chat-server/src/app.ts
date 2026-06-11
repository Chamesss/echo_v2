import express from "express";
import cors from "cors";
import helmet from "helmet";
import { corsOrigins } from "./config/env.js";
import { requestId } from "./shared/middleware/request-id.js";
import { authenticate } from "./shared/middleware/authenticate.js";
import { errorHandler } from "./shared/errors/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { docsRouter } from "./modules/docs/docs.routes.js";
import { workspacesRouter } from "./modules/workspaces/workspaces.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";

/**
 * Builds the configured Express application.
 *
 * Imported by `server.ts` in production and by integration tests (which need
 * the app without binding to a port). The middleware order below is
 * load-bearing — read the comments before reshuffling.
 */
export const app = express();

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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// API docs are public — no auth, mounted before any auth wall.
app.use("/api/docs", docsRouter);

registerModuleRoutes(app);

// Error handler MUST be last so it catches errors from every preceding layer.
app.use(errorHandler);

function registerModuleRoutes(application: express.Express): void {
  application.use("/api/workspaces", authenticate, workspacesRouter);
  application.use("/api/users", authenticate, usersRouter);
}
