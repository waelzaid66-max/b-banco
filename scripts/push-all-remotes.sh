#!/usr/bin/env bash
# Push main + production tag to all configured GitHub remotes (owner credentials).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${1:-v1.1.4-production-2026-07-10}"
REMOTES=(origin bbanco bdeals boom)

git fetch origin main
SHA="$(git rev-parse HEAD)"
echo "Publishing $SHA as $TAG"

for remote in "${REMOTES[@]}"; do
  if git remote get-url "$remote" &>/dev/null; then
    echo "[$remote] push main"
    git push "$remote" main || echo "WARN: $remote main push failed"
    echo "[$remote] push tag $TAG"
    git push "$remote" "$TAG" --force || echo "WARN: $remote tag push failed"
  else
    echo "SKIP: remote $remote not configured"
  fi
done

echo "Done. Sync aws-virgen separately: ./scripts/publish-aws-virgen-rc.sh $TAG"
