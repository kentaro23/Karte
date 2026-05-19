#!/usr/bin/env bash
# One-shot local setup for Medixus カルテ (mac ARM/Intel or Linux).
#   bash scripts/setup.sh            # uses project-local Postgres (scripts/pg.sh)
#   DB=docker bash scripts/setup.sh  # uses Docker Postgres (docker compose)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> env files"
[ -f .env ] || cp .env.example .env
[ -f apps/emr-web/.env ] || cp apps/emr-web/.env.example apps/emr-web/.env

echo "==> pnpm install"
pnpm install

if [ "${DB:-local}" = "docker" ]; then
  echo "==> postgres (docker compose)"
  docker compose up -d db
  echo -n "   waiting for db"
  until docker compose exec -T db pg_isready -U postgres -d medixus_karte >/dev/null 2>&1; do
    echo -n "."; sleep 2
  done; echo " ready"
else
  echo "==> postgres (project-local cluster)"
  bash scripts/pg.sh init
  bash scripts/pg.sh start
fi

echo "==> prisma generate + migrate + append-only triggers"
pnpm db:generate
pnpm db:migrate
pnpm db:triggers

echo "==> seed demo clinic"
pnpm seed

echo ""
echo "Setup complete →  pnpm dev   →  http://localhost:3000  (doctor / Medixus#2026)"
