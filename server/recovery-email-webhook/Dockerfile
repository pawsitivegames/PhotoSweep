FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY server.mjs ./server.mjs
COPY http-request-body.mjs ./http-request-body.mjs

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
