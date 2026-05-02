# ============================================================
# Trading AI — Production Docker Image
# Node.js 20 + Next.js standalone build
# ============================================================
FROM node:20-alpine AS base

# Dependencies (ALL deps for build)
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create data directory for persistent storage
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ═══ Batch 1 (C1) defense-in-depth: scrub any .env leak from image ═══
# .dockerignore excludes .env at COPY time; this is a belt-and-suspenders
# guard in case Next.js standalone tracing pulls .env into the output.
# If a .env exists post-standalone-copy, build FAILS LOUDLY (fail-closed)
# rather than shipping secrets.
RUN if find /app -name ".env*" -type f 2>/dev/null | grep -q .; then \
      echo "SECURITY: .env file leaked into image — FAILING BUILD"; \
      find /app -name ".env*" -type f; \
      exit 1; \
    fi

USER nextjs
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
