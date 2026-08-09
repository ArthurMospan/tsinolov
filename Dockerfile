FROM node:22-bookworm-slim AS builder

WORKDIR /app/bot
COPY bot/package*.json ./
RUN npm ci
COPY bot/ ./
RUN npm run build

WORKDIR /app/webapp
COPY webapp/package*.json ./
RUN npm ci
COPY webapp/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    SERVER_HOST=0.0.0.0 \
    DATABASE_PATH=/data/database.sqlite

WORKDIR /app/bot
COPY --from=builder /app/bot/package*.json ./
COPY --from=builder /app/bot/node_modules ./node_modules
COPY --from=builder /app/bot/dist ./dist
COPY --from=builder /app/webapp/dist /app/webapp/dist

RUN mkdir -p /data
EXPOSE 3000

CMD ["node", "dist/bot/index.js"]
