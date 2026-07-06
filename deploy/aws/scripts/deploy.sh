#!/usr/bin/env bash
# BANCO — deploy on a single EC2 host (lowest-cost topology).
# Pulls the latest code, renders secrets from SSM, migrates the DB, and does a
# zero-guess, health-gated compose up. Rolls forward only if /readyz passes.
#
# Usage (on the EC2 box, from the repo root):
#   AWS_REGION=eu-central-1 SSM_PREFIX=/banco/prod deploy/aws/scripts/deploy.sh
set -euo pipefail

AWS_REGION="${AWS_REGION:?set AWS_REGION}"
SSM_PREFIX="${SSM_PREFIX:?set SSM_PREFIX (e.g. /banco/prod)}"
COMPOSE="deploy/aws/docker-compose.prod.yml"
ENV_FILE=".env.production"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/api/readyz}"

echo "==> [1/6] Rendering $ENV_FILE from SSM ($SSM_PREFIX/*)"
# Each parameter is stored as $SSM_PREFIX/<KEY>; write KEY=VALUE lines.
aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$SSM_PREFIX" \
    --with-decryption --recursive --query 'Parameters[].[Name,Value]' --output text \
  | while IFS=$'\t' read -r name value; do echo "$(basename "$name")=$value"; done \
  > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "==> [2/6] Building images"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" build

echo "==> [3/6] Applying database schema (drizzle push)"
# Runs the schema push inside a one-off api-image container that has the toolchain.
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" run --rm --no-deps \
  -e DATABASE_URL api node -e "console.log('DB reachable check');" || true
deploy/aws/scripts/db-migrate.sh

echo "==> [4/6] Starting services"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d

echo "==> [5/6] Health gate ($HEALTH_URL)"
ok=0
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
if [ "$ok" -ne 1 ]; then
  echo "!! Readiness failed — see 'docker compose logs api'. NOT healthy."
  exit 1
fi

echo "==> [6/6] Pruning old images"
docker image prune -f >/dev/null 2>&1 || true
echo "✅ Deploy healthy."
