# Build from the repository root: docker build -f apps/apply-worker/Dockerfile .
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/apply-worker/package.json apps/apply-worker/package.json
COPY apps/extension/package.json apps/extension/package.json
RUN pnpm install --filter @orbit/apply-worker... --frozen-lockfile --ignore-scripts
COPY apps/extension/src apps/extension/src
COPY apps/apply-worker apps/apply-worker
RUN pnpm --filter @orbit/apply-worker build \
    && pnpm --filter @orbit/apply-worker deploy --prod /bundle

# Install the browser from the locked Playwright package; it cannot drift from the runtime library version.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /bundle ./
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && useradd --create-home --uid 10001 orbitapply \
    && mkdir -p /data/receipts && chown -R orbitapply:orbitapply /data
USER orbitapply
ENV NODE_ENV=production ORBIT_APPLY_OUTBOX=/data/receipts
CMD ["node", "src/main.mjs"]
