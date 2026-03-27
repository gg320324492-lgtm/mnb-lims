#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GITHUB_OUTPUT_FILE="${GITHUB_OUTPUT:-}"

LAST_TAG="$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null || true)"
if [ -n "$LAST_TAG" ]; then
  RANGE="${LAST_TAG}..HEAD"
else
  RANGE="HEAD"
fi

COMMITS_RAW="$(git -C "$REPO_ROOT" log --pretty=format:'- %h %s (%an)' ${RANGE} -- 2>/dev/null || true)"
if [ -z "$COMMITS_RAW" ]; then
  COMMITS_RAW="- no commit changes found"
fi

MIGRATIONS_RAW="$(git -C "$REPO_ROOT" diff --name-only ${RANGE} -- 'backend/migrations/*.sql' 2>/dev/null || true)"
if [ -z "$MIGRATIONS_RAW" ]; then
  MIGRATIONS_RAW="- none"
else
  MIGRATIONS_RAW="$(printf '%s\n' "$MIGRATIONS_RAW" | sed 's/^/- /')"
fi

cat <<EOF
## Release Summary

- Previous tag: ${LAST_TAG:-none}
- Commit range: ${RANGE}

### Commits
${COMMITS_RAW}

### Migrations
${MIGRATIONS_RAW}

### Rollback
- staging: ROLLBACK_CONFIRM=true DEPLOY_ENV=staging APP_ROOT=/srv/lab-miniapp-mvp-staging PM2_APP_NAME=lab-miniapp-backend-staging bash scripts/rollback-entry.sh
- production: ROLLBACK_CONFIRM=true DEPLOY_ENV=production APP_ROOT=/srv/lab-miniapp-mvp PM2_APP_NAME=lab-miniapp-backend-production bash scripts/rollback-entry.sh
EOF

if [ -n "$GITHUB_OUTPUT_FILE" ]; then
  {
    echo "release_notes<<__NOTES__"
    cat <<OUT
## Release Summary

- Previous tag: ${LAST_TAG:-none}
- Commit range: ${RANGE}

### Commits
${COMMITS_RAW}

### Migrations
${MIGRATIONS_RAW}

### Rollback
- staging: ROLLBACK_CONFIRM=true DEPLOY_ENV=staging APP_ROOT=/srv/lab-miniapp-mvp-staging PM2_APP_NAME=lab-miniapp-backend-staging bash scripts/rollback-entry.sh
- production: ROLLBACK_CONFIRM=true DEPLOY_ENV=production APP_ROOT=/srv/lab-miniapp-mvp PM2_APP_NAME=lab-miniapp-backend-production bash scripts/rollback-entry.sh
OUT
    echo "__NOTES__"
  } >> "$GITHUB_OUTPUT_FILE"
fi
