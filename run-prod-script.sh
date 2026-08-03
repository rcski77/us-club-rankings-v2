#!/usr/bin/env bash
set -euo pipefail

# Runs a prisma/*.ts one-off script against the prod database, from a throwaway
# container on the homelab Docker host -- attaches to the same Docker network
# docker-compose.prod.yml's app/postgres containers use, so DATABASE_URL's `postgres`
# hostname resolves the same way it does for the real app. No changes to the prod
# stack, no port exposed. Generalizes the inline "first deploy, seed the empty
# database" command documented in docker-compose.prod.yml's header comment so it
# doesn't have to be retyped/adapted by hand for every new script (e.g.
# prisma/backtestElo.ts, a read-only report, is just as safe to run this way as the
# write-heavy seed scripts that command was written for).
#
# Run from the repo root ON THE HOMELAB HOST (not your dev machine -- Postgres isn't
# published to the host, so this only works where the Docker network is reachable),
# with .env.prod present:
#
#   ./run-prod-script.sh prisma/backtestElo.ts
#   ./run-prod-script.sh prisma/seed.ts
#
# Override COMPOSE_NETWORK if your checkout's directory name (and therefore Compose's
# default project/network name) differs from this repo's.

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path/to/prisma-script.ts> [script args...]" >&2
  exit 1
fi

if [ ! -f .env.prod ]; then
  echo "Error: .env.prod not found in $(pwd) -- run this from the repo root on the homelab host." >&2
  exit 1
fi

POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env.prod | head -1 | cut -d= -f2-)
if [ -z "$POSTGRES_PASSWORD" ]; then
  echo "Error: POSTGRES_PASSWORD not set in .env.prod" >&2
  exit 1
fi

NETWORK="${COMPOSE_NETWORK:-us-club-rankings-v2_default}"

docker run --rm --network "$NETWORK" \
  -v "$PWD":/app -w /app \
  -e DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/us_club_rankings" \
  node:24-alpine sh -c 'npm ci && npx tsx "$@"' sh "$@"
