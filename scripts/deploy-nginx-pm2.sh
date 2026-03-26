#!/usr/bin/env bash
set -euo pipefail

# ========= 可配置参数（也可通过环境变量覆盖） =========
APP_ROOT="${APP_ROOT:-/srv/lab-miniapp-mvp}"
REPO_URL="${REPO_URL:-}"                # 首次部署建议传入，例如 git@github.com:org/repo.git
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
DOMAIN="${DOMAIN:-_}"                    # 例如 lab-api.example.com，默认 _ 表示兜底 server

# MySQL 连接（写入 backend/.env）
USE_MYSQL="${USE_MYSQL:-true}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-lab_miniapp}"
DB_POOL_SIZE="${DB_POOL_SIZE:-10}"
CORS_ORIGINS="${CORS_ORIGINS:-}"

# ========= 路径 =========
BACKEND_DIR="$APP_ROOT/backend"
SQL_INIT_FILE="$BACKEND_DIR/sql/init.sql"
ENV_FILE="$BACKEND_DIR/.env"
ECOSYSTEM_FILE="$BACKEND_DIR/ecosystem.config.js"
NGINX_SITE_FILE="/etc/nginx/conf.d/lab-miniapp-backend.conf"

echo "[deploy] APP_ROOT=$APP_ROOT"
echo "[deploy] BRANCH=$DEPLOY_BRANCH"

# 0) 依赖检查
command -v git >/dev/null 2>&1 || { echo "[deploy] git 未安装"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[deploy] node 未安装"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[deploy] npm 未安装"; exit 1; }
command -v pm2 >/dev/null 2>&1 || npm i -g pm2
command -v nginx >/dev/null 2>&1 || { echo "[deploy] nginx 未安装"; exit 1; }
command -v mysql >/dev/null 2>&1 || { echo "[deploy] mysql 客户端未安装"; exit 1; }

# 1) 拉取代码（首次部署可自动 clone）
if [ ! -d "$APP_ROOT/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "[deploy] 首次部署缺少 REPO_URL（仓库地址）"
    exit 1
  fi
  echo "[deploy] 首次部署，克隆仓库"
  mkdir -p "$APP_ROOT"
  git clone "$REPO_URL" "$APP_ROOT"
fi

cd "$APP_ROOT"
git fetch origin "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH"
git pull --ff-only origin "$DEPLOY_BRANCH"

# 2) 安装后端依赖
cd "$BACKEND_DIR"
npm ci --omit=dev

# 3) 写入后端 .env
cat > "$ENV_FILE" <<EOF
PORT=$BACKEND_PORT
NODE_ENV=production
CORS_ORIGINS=$CORS_ORIGINS

USE_MYSQL=$USE_MYSQL
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
DB_POOL_SIZE=$DB_POOL_SIZE
EOF

echo "[deploy] 已写入 $ENV_FILE"

# 4) 初始化/更新 MySQL 表结构与种子数据
if [ -f "$SQL_INIT_FILE" ]; then
  echo "[deploy] 执行 MySQL 初始化脚本"
  MYSQL_PWD="$DB_PASSWORD" mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" < "$SQL_INIT_FILE"
else
  echo "[deploy] 未找到 $SQL_INIT_FILE"
  exit 1
fi

# 5) PM2 启动/重启
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  pm2 start "$ECOSYSTEM_FILE" --only "$PM2_APP_NAME" --update-env
fi
pm2 save

# 6) Nginx 反向代理配置
cat > "$NGINX_SITE_FILE" <<EOF
server {
  listen 80;
  server_name $DOMAIN;

  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:$BACKEND_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF

nginx -t
systemctl reload nginx

echo "[deploy] 完成：Nginx + PM2 + MySQL 已就绪"
