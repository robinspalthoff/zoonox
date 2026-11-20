# Build context: Monorepo-Root (/)
# Dockerfile-Pfad: apps/dashboard/Dockerfile
#
# Coolify-Einstellungen:
#   Base Directory:    /
#   Dockerfile Path:   apps/dashboard/Dockerfile
#
# Selbst-Hosting (docker compose aus infra/docker/):
#   build context: ../..
#   dockerfile:    apps/dashboard/Dockerfile

# Basis: Debian (glibc), nicht Alpine. `canvas` (transitiv über jscanify) und
# `sharp` liefern Prebuilds nur für glibc — unter musl fällt canvas auf
# node-gyp zurück und der Build stirbt mangels Python/C++-Toolchain.
# openssl wird von den Prisma-Engines benötigt.

# ─── Stage 1: Dependencies ─────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Workspace-Manifeste für Layer-Caching
COPY package*.json ./
COPY apps/dashboard/package*.json ./apps/dashboard/
COPY packages/ui/package*.json ./packages/ui/
COPY packages/types/package*.json ./packages/types/
COPY packages/config/package*.json ./packages/config/

# Prisma Schema für postinstall (prisma generate benötigt schema.prisma)
COPY apps/dashboard/prisma ./apps/dashboard/prisma

# Alle Dependencies installieren (postinstall → prisma generate).
# --include=dev erzwingt devDependencies auch dann, wenn NODE_ENV=production
# in die Build-Umgebung durchgereicht wird (sonst fehlen turbo/next/typescript/
# esbuild und `npm run build` bricht mit "turbo: not found" ab).
RUN npm ci --include=dev

# ─── Stage 2: Builder ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* müssen zur BUILD-Zeit verfügbar sein — Next backt sie ins
# Frontend-Bundle. Als ARG deklariert und in ENV überführt, damit `next build`
# sie sieht. Werden von GitHub Actions via --build-arg gesetzt (aus den Repo-
# Variablen). Ohne diese Zeilen fällt die App auf Defaults zurück
# (z. B. Anzeigename "accounting-app" statt "zoonox").
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME

# Dashboard bauen (turbo handled Dependency-Reihenfolge)
RUN npm run build

# Background-Worker zu einer eigenständigen CJS-Datei bündeln (apps/dashboard/dist/worker.cjs).
# npm-Pakete bleiben external (zur Laufzeit aus node_modules aufgelöst); nur der
# lokale TS-Code (scripts/ + src/) wird gebündelt, inkl. @/-Alias via tsconfig.
RUN npm run build:worker --workspace zoonox-dashboard

# ─── Stage 3: Runner ───────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --ingroup nodejs nextjs

# Next.js standalone output (Monorepo: Next.js setzt outputFileTracingRoot auf Monorepo-Root,
# daher liegt server.js unter apps/dashboard/ innerhalb des standalone-Ordners)
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

# Prisma für Runtime-Migrationen (vollständige node_modules wg. transitiver Deps von @prisma/config)
COPY --from=builder /app/apps/dashboard/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Gebündelter Background-Worker (via ROLE=worker bzw. RUN_WORKER_INLINE gestartet)
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/dist ./apps/dashboard/dist

# Entrypoint: führt prisma migrate deploy aus, startet dann die App
COPY infra/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./entrypoint.sh"]
