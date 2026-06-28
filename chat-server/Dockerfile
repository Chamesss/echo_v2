# Multi-stage build for chat-server (a pnpm workspace package).
#
# IMPORTANT: build context must be the REPO ROOT so the workspace manifests +
# lockfile are present. From the repo root:
#   docker build -f chat-server/Dockerfile -t chat-server .
# (docker-compose.yml already sets the context correctly.)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ── Install prod+dev deps for chat-server's subtree (layer cached on manifests) ─
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY chat-server/package.json chat-server/
COPY chat-front/package.json chat-front/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter chat-server...

# ── Compile TS → dist, then produce a self-contained prod-only deploy dir ──────
FROM deps AS build
COPY chat-server/ chat-server/
RUN pnpm --filter chat-server build
RUN pnpm --filter chat-server deploy --prod /app

# ── Minimal runtime image ──────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Carries dist/ (incl. dist/src/server.js), drizzle/ migrations, and prod node_modules.
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
