# Image that runs the shop app. Build: docker build -t shop-finance .
FROM node:20-slim
WORKDIR /app
# Copy only package files first so Docker can cache the (slow) npm install step.
COPY package*.json ./
# --omit=dev skips test-only packages (jsdom) in the production image.
RUN npm ci --omit=dev
COPY . .
# TZ makes "today" follow Cairo time; DB_FILE lives in /data so it can be a persistent volume.
ENV NODE_ENV=production TZ=Africa/Cairo PORT=3000
EXPOSE 3000
CMD ["node","src/server.js"]
