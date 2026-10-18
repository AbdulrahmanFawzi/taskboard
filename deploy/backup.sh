#!/usr/bin/env bash
# Dump one environment's database to backups/<env>-<timestamp>.sql.gz and keep the last 14.
set -euo pipefail
env="${1:?usage: backup.sh staging|production}"
project="taskboard-${env}"
mkdir -p backups
out="backups/${env}-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose -p "$project" --env-file ".env.${env}" exec -T db pg_dump -U taskboard -d taskboard | gzip > "$out"
echo "Saved $out"
ls -1t backups/${env}-*.sql.gz | tail -n +15 | xargs -r rm --
