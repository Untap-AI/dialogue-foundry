# NOTE: This service spawns the local Python web-crawler as a subprocess.
# If you run it in Docker, the crawler must be reachable from inside the
# container (bind-mount CRAWLER_DIR and install its Python deps in the image,
# or run the container with the crawler mounted). For the mac-mini, running
# natively with pm2 (see ecosystem.config.cjs) is simpler.
FROM node:24-slim AS build
WORKDIR /repo

# Copy workspace manifests for install caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/demo-setup/package.json apps/demo-setup/
COPY packages ./packages

RUN corepack enable && pnpm install --filter @dialogue-foundry/demo-setup... --no-frozen-lockfile

COPY apps/demo-setup ./apps/demo-setup
RUN pnpm --filter @dialogue-foundry/demo-setup build

FROM node:24-slim
WORKDIR /repo
COPY --from=build /repo ./
ENV NODE_ENV=production
WORKDIR /repo/apps/demo-setup
EXPOSE 4000
CMD ["node", "dist/index.js"]
