# Single-image build for the whole app on the Bun runtime: installs the Bun
# workspace, builds the React SPA, and runs the Express + WebSocket server (which
# also serves the SPA) — one long-running process, one origin.
#
# IMPORTANT: build context must be the REPO ROOT so the workspace manifests +
# lockfile are present. From the repo root:
#   docker build -f chat-server/Dockerfile -t chat .
# (docker-compose.yml + render.yaml already set the context correctly.)

# ── Install the whole workspace (layer cached on the manifests + lockfile) ──────
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY chat-server/package.json chat-server/
COPY chat-front/package.json chat-front/
RUN bun install --frozen-lockfile

# ── Build the frontend (emits chat-front/dist) ─────────────────────────────────
FROM deps AS build
# Vite bakes VITE_* vars at BUILD time. VITE_API_URL is intentionally left unset
# (the SPA falls back to same-origin in prod). Pass VITE_TURNSTILE_SITE_KEY as a
# build arg ONLY if you also set TURNSTILE_SECRET_KEY at runtime — enabling one
# without the other locks users out of auth. Leave both unset to disable CAPTCHA.
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
COPY . .
RUN bun run --filter chat-front build

# ── Runtime: run the server straight from TypeScript on Bun ─────────────────────
FROM oven/bun:1 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# Where app.ts looks for the built SPA to serve.
ENV FRONT_DIST_DIR=/repo/chat-front/dist
# Carries sources, the installed workspace node_modules, and the built SPA.
COPY --from=build /repo /repo
# Render/Railway inject PORT; the server reads process.env.PORT (default 4000).
EXPOSE 4000
CMD ["bun", "run", "chat-server/src/server.ts"]
