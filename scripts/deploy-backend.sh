#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/lab-miniapp-mvp}"
BACKEND_DIR="$APP_ROOT/backend"
BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
PM2_APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend-$DEPLOY_ENV}"
ENV_FILE="$BACKEND_DIR/.env.$DEPLOY_ENV"
MIGRATION_VERSION="${MIGRATION_VERSION:-m001}"

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

PREV_COMMIT="$(git rev-parse HEAD)"
TS="$(date +%Y%m%d-%H%M%S)"
PRE_DEPLOY_TAG="predeploy-${DEPLOY_ENV}-${TS}"
POST_DEPLOY_TAG="deploy-ok-${DEPLOY_ENV}-${TS}-${MIGRATION_VERSION}"

git tag -f "$PRE_DEPLOY_TAG" "$PREV_COMMIT" >/dev/null 2>&1 || true

rollback_now() {
  echo "[deploy] trigger auto rollback -> $PRE_DEPLOY_TAG"
  APP_ROOT="$APP_ROOT" PM2_APP_NAME="$PM2_APP_NAME" "$APP_ROOT/scripts/rollback-to-tag.sh" "$PRE_DEPLOY_TAG"
}

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

set -a
. "$BACKEND_DIR/.env"
set +a

echo "[deploy] install backend deps"
npm ci --omit=dev

echo "[deploy] run db migrations"
npm run db:migrate

echo "[deploy] restart pm2 app"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 delete "$PM2_APP_NAME"
fi

pm2 start "$BACKEND_DIR/src/app.js" --name "$PM2_APP_NAME" --cwd "$BACKEND_DIR" --update-env
pm2 save

echo "[deploy] health check"
HEALTH_PORT="${PORT:-3000}"
FAILED=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null; then
    echo "[deploy] health check passed"
    FAILED=0
    break
  fi
  FAILED=$((FAILED + 1))
  sleep 2
done

if [ "$FAILED" -ge 3 ]; then
  echo "[deploy] health check continuous failed ($FAILED times), auto rollback"
  rollback_now
  exit 1
fi

cd "$APP_ROOT"
git tag -f "$POST_DEPLOY_TAG" HEAD >/dev/null 2>&1 || true
git tag --list "deploy-ok-${DEPLOY_ENV}-*" | sort | head -n -30 | xargs -r git tag -d >/dev/null 2>&1 || true

echo "[deploy] done, tag=$POST_DEPLOY_TAG"
