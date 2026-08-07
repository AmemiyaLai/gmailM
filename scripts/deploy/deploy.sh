#!/usr/bin/env bash
#
# 自托管部署腳本 —— 在主機上以 gmailm 使用者執行：
#   sudo -u gmailm /opt/gmailm/scripts/deploy/deploy.sh
#
# 前置條件見同目錄的 README.md。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gmailm}"
SERVICE="${SERVICE:-gmailm}"
ENV_FILE="${ENV_FILE:-/etc/gmailm/env}"

cd "$APP_DIR"

echo "==> 拉取最新程式碼"
git pull --ff-only

echo "==> 安裝依賴"
npm ci

echo "==> 建置（DEPLOY_TARGET=node）"
# build 需要 PUBLIC_* 變數（會被寫進前端 bundle）。其餘機密是 runtime 讀取，
# 不會進到 dist/，因此產物本身不含任何金鑰。
set -a
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && source "$ENV_FILE"
set +a
DEPLOY_TARGET=node npm run build

echo "==> 重啟服務"
sudo systemctl restart "$SERVICE"

echo "==> 等待就緒"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-1008}/"; then
    echo "==> 部署完成，服務已就緒"
    exit 0
  fi
  sleep 1
done

echo "!! 服務在 30 秒內未回應，印出最近日誌供排查" >&2
sudo journalctl -u "$SERVICE" -n 50 --no-pager >&2
exit 1
