#!/bin/sh
# Docker Entrypoint — läuft vor dem App-Start.
#
# ROLE steuert, was der Container ausführt:
#   ROLE=web    (Default) — Prisma-Migrationen + Next.js-Server
#   ROLE=worker           — nur der Background-Worker (keine Migrationen;
#                           die führt die web-Rolle beim Deploy aus)
#
# Für Single-Service-Deployments (z. B. eine einzelne Coolify-App) kann der
# Worker zusätzlich in der web-Rolle mitlaufen: RUN_WORKER_INLINE=true.

set -e

ROLE="${ROLE:-web}"

if [ "$ROLE" = "worker" ]; then
  echo ""
  echo "→ Starte Background-Worker (ROLE=worker)…"
  exec node apps/dashboard/dist/worker.cjs
fi

# ── web-Rolle ──────────────────────────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo "✖ DATABASE_URL ist nicht gesetzt — Migration und App-Start nicht möglich." >&2
  echo "  In Coolify als Environment-Variable (Runtime) mit dem internen"        >&2
  echo "  Postgres-Connection-String hinterlegen und neu deployen."              >&2
  exit 1
fi

echo ""
echo "→ Prisma: Schema-Migrationen werden eingespielt..."
node node_modules/prisma/build/index.js migrate deploy

echo "→ Migrationen erfolgreich."
echo ""

# Optional: Worker im selben Container mitlaufen lassen (Single-Service-Deploy).
# Bewusst ohne Neustart-Isolation — für getrennte Skalierung/Neustarts besser
# einen eigenen Container mit ROLE=worker deployen.
if [ "$RUN_WORKER_INLINE" = "true" ]; then
  echo "→ RUN_WORKER_INLINE=true — Worker läuft im selben Container mit…"
  node apps/dashboard/dist/worker.cjs &
fi

# App starten (Next.js standalone output — Monorepo: server.js liegt unter apps/dashboard/)
exec node apps/dashboard/server.js
