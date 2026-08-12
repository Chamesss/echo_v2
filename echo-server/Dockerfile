# Single-image build for the whole app on the Bun runtime: installs the Bun
# workspace, builds the React SPA, and runs the Express + WebSocket server (which
# also serves the SPA) — one long-running process, one origin.
#
# IMPORTANT: build context must be the REPO ROOT so the workspace manifests +
# lockfile are present. From the repo root:
#   docker build -f echo-server/Dockerfile -t echo .
# (docker-compose.yml + render.yaml already set the context correctly.)

# ── Install the whole workspace (layer cached on the manifests + lockfile) ──────
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY echo-server/package.json echo-server/
COPY echo-front/package.json echo-front/
# Not run in the image, but the root workspace list names it — bun resolves every
# workspace manifest up front, and --frozen-lockfile fails if one is missing.
COPY echo-mcp/package.json echo-mcp/
RUN bun install --frozen-lockfile

# ── Build the frontend (emits echo-front/dist) ─────────────────────────────────
FROM deps AS build
# No VITE_* build args needed: VITE_API_URL falls back to same-origin, and the
# Turnstile site key is injected at RUNTIME from the server's TURNSTILE_SITE_KEY
# env (see serveSpa in app.ts) — so CAPTCHA toggles via host env, no rebuild.
COPY . .
RUN bun run --filter echo-front build

# ── Runtime: run the server straight from TypeScript on Bun ─────────────────────
FROM oven/bun:1 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# Where app.ts looks for the built SPA to serve.
ENV FRONT_DIST_DIR=/repo/echo-front/dist
# Carries sources, the installed workspace node_modules, and the built SPA.
COPY --from=build /repo /repo
# Render/Railway inject PORT; the server reads process.env.PORT (default 4000).
EXPOSE 4000
CMD ["bun", "run", "echo-server/src/server.ts"]
