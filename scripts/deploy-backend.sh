#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/lab-miniapp-mvp}"
BACKEND_DIR="$APP_ROOT/backend"
BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
PM2_APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend-$DEPLOY_ENV}"
ENV_FILE="$BACKEND_DIR/.env.$DEPLOY_ENV"

if [[ "$DEPLOY_ENV" != "staging" && "$DEPLOY_ENV" != "production" ]]; then
  echo "[deploy] DEPLOY_ENV must be staging or production"
  exit 1
fi

echo "[deploy] app root: $APP_ROOT"
echo "[deploy] env: $DEPLOY_ENV"
echo "[deploy] branch: $BRANCH"

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

if [ ! -f "$ENV_FILE" ]; then
  echo "[deploy] missing env file: $ENV_FILE"
  echo "[deploy] create it from backend/.env.$DEPLOY_ENV.example"
  exit 1
fi

cp "$ENV_FILE" "$BACKEND_DIR/.env"

echo "[deploy] install backend deps"
npm ci --omit=dev

echo "[deploy] restart pm2 app"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  APP_ROOT="$APP_ROOT" PM2_APP_NAME="$PM2_APP_NAME" DEPLOY_ENV="$DEPLOY_ENV" pm2 start ecosystem.config.js --only "$PM2_APP_NAME" --update-env
fi

pm2 save

echo "[deploy] health check"
HEALTH_URL="$(grep -E '^PUBLIC_WEB_BASE=' "$BACKEND_DIR/.env" | cut -d'=' -f2- | tr -d '\r')"
if [ -z "$HEALTH_URL" ]; then
  HEALTH_URL="http://127.0.0.1:$(grep -E '^PORT=' "$BACKEND_DIR/.env" | cut -d'=' -f2- | tr -d '\r')"
fi
curl -fsS "$HEALTH_URL/api/health" >/dev/null

echo "[deploy] done"
