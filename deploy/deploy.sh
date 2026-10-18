#!/usr/bin/env bash
# Pull a build and (re)start one environment. Run on the server from the deploy/ folder.
#   ./deploy.sh staging   <tag>
#   ./deploy.sh production <tag>
set -euo pipefail
env="${1:?usage: deploy.sh staging|production <tag>}"
tag="${2:-latest}"
file=".env.${env}"
[[ -f "$file" ]] || { echo "Missing $file (copy .env.example)"; exit 1; }

export TAG="$tag"
project="taskboard-${env}"

echo "==> Backing up the database first"
./backup.sh "$env" || echo "   (no database yet, skipping backup)"

echo "==> Pulling images for tag $tag"
docker compose -p "$project" --env-file "$file" pull api web

echo "==> Starting"
docker compose -p "$project" --env-file "$file" up -d --remove-orphans

echo "==> Waiting for the API to be healthy"
for i in $(seq 1 30); do
  if docker compose -p "$project" --env-file "$file" exec -T api dotnet TaskBoard.Api.dll --healthcheck; then
    echo "==> $env is up on tag $tag"; exit 0
  fi
  sleep 2
done
echo "API did not become healthy; recent logs:"
docker compose -p "$project" --env-file "$file" logs --tail 80 api
exit 1
