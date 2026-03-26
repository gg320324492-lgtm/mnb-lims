#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/lab-miniapp-mvp}"
BACKEND_DIR="$APP_ROOT/backend"
BRANCH="${DEPLOY_BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend}"

echo "[deploy] app root: $APP_ROOT"

if [ ! -d "$APP_ROOT/.git" ]; then
  echo "[deploy] repo not found at $APP_ROOT"
  exit 1
fi

cd "$APP_ROOT"

echo "[deploy] fetch and checkout $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

cd "$BACKEND_DIR"

echo "[deploy] install backend deps"
npm ci --omit=dev

echo "[deploy] restart pm2 app"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  pm2 start ecosystem.config.js --only "$PM2_APP_NAME"
fi

pm2 save

echo "[deploy] done"
