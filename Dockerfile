FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY tools/check-node-version.js ./tools/check-node-version.js
RUN npm ci --omit=dev --no-audit --no-fund

COPY server ./server

CMD ["node", "server/node-server.mjs"]