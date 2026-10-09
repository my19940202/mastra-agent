FROM node:22.13.1-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS builder
ENV TURSO_DATABASE_URL=file:/tmp/mastra-build.db \
    MASTRA_DUCKDB_PATH=:memory:
RUN npm install --global pnpm@9.15.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN npm run build
RUN find .mastra/output -type f \( -name '*.db' -o -name '*.db-*' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.duckdb' -o -name '*.duckdb-*' \) -delete
RUN pnpm prune --prod

FROM base AS runner
ENV NODE_ENV=production \
    MASTRA_STORAGE_BACKEND=mysql \
    MASTRA_HOST=0.0.0.0 \
    PORT=8080 \
    MYSQL_SSL=true
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.mastra/output ./.mastra/output
COPY --chown=node:node scripts/start-container.mjs ./scripts/start-container.mjs
USER node
EXPOSE 8080
CMD ["node", "scripts/start-container.mjs"]
