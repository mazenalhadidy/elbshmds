# syntax=docker/dockerfile:1
# Production image of the shop server (for a cloud VM / NAS / any Docker host).
# The shop PC does NOT need Docker: it keeps using start-shop.cmd + the auto-updater.
#   build:  docker build -t elbshmds .
#   run:    docker compose up -d        (see docker-compose.yml)

# ---- 1. build the screens (needs dev dependencies: vite, vue) ----
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- 2. runtime: production dependencies + server code + built screens only ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production TZ=Africa/Cairo PORT=3000 SHOP_HOME=/app DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /src/dist ./dist
ARG GIT_SHA=local
RUN printf '{"sha":"%s","date":null}\n' "$GIT_SHA" > version.json \
 && mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
