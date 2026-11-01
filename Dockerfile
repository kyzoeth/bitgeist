FROM node:24-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/lib/wasmReplayWorker.mjs ./lib/wasmReplayWorker.mjs
COPY --from=builder /app/data/canonical-states ./data/canonical-states

RUN mkdir -p /data/canonical-states

EXPOSE 3000

CMD ["sh", "-c", "mkdir -p /data/canonical-states && exec ./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
