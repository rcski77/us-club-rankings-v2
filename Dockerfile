# syntax=docker/dockerfile:1

FROM node:24-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache curl
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# resolveImportBatchInWorker (src/lib/import/resolveInWorker.ts) runs a plain .ts
# worker-thread entry via tsx, outside Next/Turbopack's own bundling -- so unlike the
# rest of this image, it needs the raw source tree, tsconfig.json (tsx reads it for
# compiler options), and tsx itself on disk. .next/standalone's node_modules above is
# pruned to only what Next's build traced, which doesn't include tsx (nothing
# statically imports it -- it's invoked via a plain path + execArgv string, by
# design, to stay decoupled from Turbopack's bundler). Copying the full
# builder node_modules over it is simpler and safer than hand-picking tsx's
# transitive deps, at the cost of a larger image -- an acceptable trade for a
# homelab deployment.
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
