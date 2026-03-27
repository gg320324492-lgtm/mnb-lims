#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/lab-miniapp-mvp-staging}"
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
PM2_APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend-${DEPLOY_ENV}}"
DEFAULT_TAG="${ROLLBACK_TAG:-}"

if [ ! -d "$APP_ROOT/.git" ]; then
  echo "[rollback-entry] repo not found: $APP_ROOT"
  exit 1
fi

cd "$APP_ROOT"

echo "[rollback-entry] fetch latest deploy tags"
git fetch --tags origin >/dev/null 2>&1 || true

if [ -z "$DEFAULT_TAG" ]; then
  DEFAULT_TAG="$(git tag --list "deploy-ok-${DEPLOY_ENV}-*" | sort -r | head -n 1)"
fi

if [ -z "$DEFAULT_TAG" ]; then
  echo "[rollback-entry] no deploy-ok tag found for env=${DEPLOY_ENV}"
  exit 1
fi

echo "[rollback-entry] env=${DEPLOY_ENV} app=${PM2_APP_NAME}"
echo "[rollback-entry] target tag=${DEFAULT_TAG}"

echo "[rollback-entry] recent deploy tags:"
git tag --list "deploy-ok-${DEPLOY_ENV}-*" | sort -r | head -n 10 | sed 's/^/  - /'

ROLLBACK_CONFIRM="${ROLLBACK_CONFIRM:-false}"
if [ "$ROLLBACK_CONFIRM" != "true" ]; then
  printf "\n确认回滚到 %s ? 输入 YES 继续: " "$DEFAULT_TAG"
  read -r answer
  if [ "$answer" != "YES" ]; then
    echo "[rollback-entry] cancelled"
    exit 0
  fi
fi

APP_ROOT="$APP_ROOT" PM2_APP_NAME="$PM2_APP_NAME" DEPLOY_ENV="$DEPLOY_ENV" \
  "$APP_ROOT/scripts/rollback-to-tag.sh" "$DEFAULT_TAG"

echo "[rollback-entry] completed"
