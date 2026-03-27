#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/lab-miniapp-mvp-staging}"
TARGET_TAG="${1:-deploy-ok-2026-03-26}"
PM2_APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend-staging}"
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
BACKEND_DIR="$APP_ROOT/backend"

if [ ! -d "$APP_ROOT/.git" ]; then
  echo "[rollback] repo not found: $APP_ROOT"
  exit 1
fi

cd "$APP_ROOT"

echo "[rollback] fetch tags"
git fetch --tags origin

echo "[rollback] checkout tag $TARGET_TAG"
git checkout "$TARGET_TAG"

cd "$BACKEND_DIR"

ENV_FILE="$BACKEND_DIR/.env.$DEPLOY_ENV"
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$BACKEND_DIR/.env"
fi

echo "[rollback] install backend deps"
npm ci --omit=dev

echo "[rollback] restart pm2"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 delete "$PM2_APP_NAME"
fi

set -a
if [ -f "$BACKEND_DIR/.env" ]; then
  . "$BACKEND_DIR/.env"
fi
set +a

pm2 start "$BACKEND_DIR/src/app.js" --name "$PM2_APP_NAME" --cwd "$BACKEND_DIR" --update-env
pm2 save

PORT_VALUE="$(grep -E '^PORT=' "$BACKEND_DIR/.env" | cut -d'=' -f2- | tr -d '\r' || true)"
if [ -z "$PORT_VALUE" ]; then
  PORT_VALUE="3001"
fi

curl -fsS "http://127.0.0.1:${PORT_VALUE}/api/health" >/dev/null

echo "[rollback] done: $TARGET_TAG"