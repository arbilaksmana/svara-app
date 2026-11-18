# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.5.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SERVE_STATIC=1 \
    DB_PATH=/app/data/svara.sqlite
WORKDIR /app
RUN npm install -g --allow-scripts=esbuild tsx@4.23.15
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["tsx", "server/index.ts", "--serve"]
