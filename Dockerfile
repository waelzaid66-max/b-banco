###############################################################################
# BANCO API server — ROOT Dockerfile for AWS Elastic Beanstalk (Docker / AL2023)
#
# WHY THIS FILE EXISTS AT THE ROOT:
#   EB's single-container Docker platform looks for `Dockerfile` (or
#   `Dockerrun.aws.json`) at the ROOT of the uploaded source bundle. The richer
#   build at deploy/aws/Dockerfile.api is functionally identical but (a) is not
#   at the root and (b) uses BuildKit-only cache mounts that EB's builder may not
#   enable — so EB reported "Both 'Dockerfile' and 'Dockerrun.aws.json' are
#   missing". This root file is BuildKit-OPTIONAL (no cache mounts, no syntax
#   directive) so it builds on EB's classic Docker builder too.
#
# It builds ONLY the API server (artifacts/api-server). Architecture unchanged;
# no files moved. Context = the repository root (the EB bundle root).
#
# Node 24 is REQUIRED (pnpm@11.9 uses node:sqlite). PORT defaults to 8080 and is
# EXPOSEd — EB maps the load balancer's :80 to this container port.
###############################################################################

# ---- builder: install the API subtree, build + prune ------------------------
FROM node:24-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Copy the whole workspace source (minus node_modules/.git/dist via
# .dockerignore). The full copy is required because `pnpm install
# --frozen-lockfile` validates EVERY workspace member's package.json against the
# lockfile — a missing member (e.g. banco-mobile) would abort the install.
COPY . .

# Install ONLY the api-server + its workspace deps (lib/*) — the `...` suffix
# pulls dependencies. Mobile/admin/dealer/landing deps are NOT installed, so the
# build stays small and fast. This leaves a pnpm store-linked node_modules at
# /app/node_modules (+ /app/artifacts/api-server/node_modules symlinks into it).
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."

# Bundle the API (esbuild inlines the @workspace/* libs → dist/index.mjs; native /
# dynamically-loaded packages stay external and are resolved from node_modules).
RUN pnpm --filter @workspace/api-server run build

# ---- runner: copy the built app + its resolved node_modules -----------------
# We copy the pnpm-linked trees verbatim (root store + the api-server symlinks)
# rather than using `pnpm deploy` (which needs --legacy for non-injected
# workspaces and is slow); this keeps module resolution intact and reliable.
FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist

# Non-root.
RUN useradd -r -u 10001 -g root banco && chown -R banco:root /app
USER banco
WORKDIR /app/artifacts/api-server

ENV PORT=8080
EXPOSE 8080

# Liveness probe that does NOT touch the DB. The whole API is mounted under
# /api, so liveness is /api/healthz (NOT /healthz).
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
