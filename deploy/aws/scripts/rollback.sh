#!/usr/bin/env bash
# BANCO — roll back to the previous known-good git tag and redeploy.
# Deploys should always be made from a tag (v1.0.0, v1.0.1, …); this checks out
# the prior tag and re-runs deploy.sh. DB rollback is intentionally manual — a
# schema change may not be safely reversible; restore from an RDS snapshot if
# the release included a destructive migration.
set -euo pipefail

TARGET_TAG="${1:-}"
if [ -z "$TARGET_TAG" ]; then
  # Second-newest tag = previous release.
  TARGET_TAG="$(git tag --sort=-creatordate | sed -n '2p')"
fi
[ -n "$TARGET_TAG" ] || { echo "No previous tag found. Pass one explicitly."; exit 1; }

echo "==> Rolling back to tag: $TARGET_TAG"
git fetch --tags --quiet
git checkout --quiet "$TARGET_TAG"

echo "==> Redeploying $TARGET_TAG"
AWS_REGION="${AWS_REGION:?}" SSM_PREFIX="${SSM_PREFIX:?}" deploy/aws/scripts/deploy.sh

echo "⚠️  If this release ran a DESTRUCTIVE migration, restore the DB from the"
echo "    pre-deploy RDS snapshot separately — code rollback does not undo schema."
