# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma

# ---- Alleen productie-dependencies (voor de uiteindelijke runtime-image) ----
FROM base AS deps
RUN npm ci --omit=dev
RUN npx prisma generate

# ---- Volledige install + build (TypeScript/Tailwind hebben devDependencies nodig) ----
FROM base AS builder
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Uiteindelijke, kleinere runtime-image ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=2809

RUN addgroup -S ringtools && adduser -S ringtools -G ringtools

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R ringtools:ringtools /app

USER ringtools
EXPOSE 2809

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
