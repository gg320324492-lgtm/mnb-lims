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
retry_git() {
  local max_attempts=5
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$max_attempts" ]; then
      return 1
    fi
    echo "[deploy] git command failed, retry $attempt/$max_attempts ..."
    attempt=$((attempt + 1))
    sleep 3
  done
}

retry_git git fetch origin "$BRANCH"
git checkout "$BRANCH"
retry_git git pull --ff-only origin "$BRANCH"

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
  pm2 delete "$PM2_APP_NAME"
fi

set -a
. "$BACKEND_DIR/.env"
set +a

pm2 start "$BACKEND_DIR/src/app.js" --name "$PM2_APP_NAME" --cwd "$BACKEND_DIR" --update-env

pm2 save

echo "[deploy] health check"
HEALTH_PORT="$(grep -E '^PORT=' "$BACKEND_DIR/.env" | cut -d'=' -f2- | tr -d '\r')"
if [ -z "$HEALTH_PORT" ]; then
  HEALTH_PORT="3000"
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null; then
    echo "[deploy] health check passed"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "[deploy] health check failed after retries"
    exit 1
  fi
  sleep 2
done

echo "[deploy] done"
