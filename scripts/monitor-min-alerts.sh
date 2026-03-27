#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${PM2_APP_NAME:-lab-miniapp-backend-production}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
RESTART_THRESHOLD="${RESTART_THRESHOLD:-5}"
WINDOW_MINUTES="${WINDOW_MINUTES:-5}"
HTTP_5XX_THRESHOLD="${HTTP_5XX_THRESHOLD:-20}"

ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"
ALERT_CHANNEL="${ALERT_CHANNEL:-generic}" # generic | feishu | dingtalk | wecom

send_alert() {
  local level="$1"
  local msg="$2"
  echo "[${level}] ${msg}"

  if [[ -z "$ALERT_WEBHOOK" ]]; then
    return
  fi

  local payload=""
  if [[ "$ALERT_CHANNEL" = "feishu" ]]; then
    payload="{\"msg_type\":\"text\",\"content\":{\"text\":\"[${level}] ${APP_NAME} ${msg}\"}}"
  elif [[ "$ALERT_CHANNEL" = "dingtalk" ]]; then
    payload="{\"msgtype\":\"text\",\"text\":{\"content\":\"[${level}] ${APP_NAME} ${msg}\"}}"
  elif [[ "$ALERT_CHANNEL" = "wecom" ]]; then
    payload="{\"msgtype\":\"text\",\"text\":{\"content\":\"[${level}] ${APP_NAME} ${msg}\"}}"
  else
    payload="{\"level\":\"${level}\",\"app\":\"${APP_NAME}\",\"message\":\"${msg}\"}"
  fi

  curl -fsS -X POST "$ALERT_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null || true
}

if ! curl -fsS "$HEALTH_URL" >/dev/null; then
  send_alert "critical" "health check failed: $HEALTH_URL"
fi

PM2_JSON="$(pm2 jlist 2>/dev/null || echo '[]')"
RESTARTS="$(python -c "import json,sys;d=json.loads(sys.argv[1]);
for p in d:
  if p.get('name')==sys.argv[2]:
    print(p.get('pm2_env',{}).get('restart_time',0));
    break
else:
  print(0)
" "$PM2_JSON" "$APP_NAME")"

if [[ "${RESTARTS}" =~ ^[0-9]+$ ]] && (( RESTARTS >= RESTART_THRESHOLD )); then
  send_alert "warning" "pm2 restart count high: ${RESTARTS} >= ${RESTART_THRESHOLD}"
fi

SINCE_TS="$(date -u -d "-${WINDOW_MINUTES} minutes" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S)"
PM2_LOG_DIR="${PM2_HOME:-$HOME/.pm2}/logs"
OUT_LOG="$PM2_LOG_DIR/${APP_NAME}-out.log"
ERR_LOG="$PM2_LOG_DIR/${APP_NAME}-error.log"

COUNT_5XX=0
if [[ -f "$OUT_LOG" ]]; then
  COUNT_5XX=$(( COUNT_5XX + $(python -c "import re,sys
cnt=0
for line in open(sys.argv[1],encoding='utf-8',errors='ignore'):
  if re.search(r'\"status\"\s*:\s*5\\d\\d', line):
    cnt += 1
print(cnt)
" "$OUT_LOG") ))
fi
if [[ -f "$ERR_LOG" ]]; then
  COUNT_5XX=$(( COUNT_5XX + $(python -c "import re,sys
cnt=0
for line in open(sys.argv[1],encoding='utf-8',errors='ignore'):
  if 'server_error' in line or re.search(r'\b5\\d\\d\b', line):
    cnt += 1
print(cnt)
" "$ERR_LOG") ))
fi

if (( COUNT_5XX >= HTTP_5XX_THRESHOLD )); then
  send_alert "warning" "5xx spike detected: count=${COUNT_5XX}, threshold=${HTTP_5XX_THRESHOLD}"
fi

echo "[monitor] done"
