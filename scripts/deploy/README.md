# 自托管部署（Oracle Cloud + Cloudflare Tunnel）

本專案可在 **Vercel** 與 **自托管 Node** 之間切換，由單一環境變數 `DEPLOY_TARGET` 控制：

| `DEPLOY_TARGET` | adapter | 背景工作 | 用途 |
| --- | --- | --- | --- |
| 未設定 / 其他值 | `@astrojs/vercel` | `waitUntil()` | Vercel（預設） |
| `node` | `@astrojs/node` standalone | 直接背景執行 | 自托管 |

兩個 adapter 都留在 `dependencies`，切換不需要動依賴，改變數後重新 build 即可；
要切回 Vercel 只要把 `DEPLOY_TARGET` 拿掉。判定邏輯在
[`astro.config.mjs`](../../astro.config.mjs)（build 時）與
[`src/lib/deployTarget.ts`](../../src/lib/deployTarget.ts)（runtime）。

---

## 環境變數是 runtime 讀取的

`src/lib/env.ts` 的 `env()` 以動態索引讀 `process.env`，Vite 無法靜態分析，
因此**機密不會被寫進 `dist/`**：產物可以安全地在機器之間搬運，
輪替金鑰也只要改 `/etc/gmailm/env` 後 `systemctl restart`，不必重新 build。

唯一例外是 `PUBLIC_*`（例如 `PUBLIC_PUSHER_KEY`）—— 這些本來就要送進瀏覽器，
必須在 **build 時**存在。所以 `deploy.sh` 會先 source env file 再 build。

> 遷移前的舊寫法 `import.meta.env.X` 會被 Vite 在 build 時替換成字面值，
> 導致 Supabase service key、`CRON_SECRET`、Discord bot token 全部被硬編碼進產物。
> 這在 Vercel 上碰巧可行（build 環境有完整變數），但自托管會壞掉。已全面改掉。

---

## 一次性設置

### 1. 系統與 Node

```bash
sudo useradd -r -m -d /opt/gmailm -s /bin/bash gmailm
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git curl
node -v   # 應為 v24.x
```

> Oracle 免費方案多為 **Ampere A1（aarch64）**。本專案沒有原生模組，
> 但第一次 `npm ci` 仍應在主機上實跑一次確認。

### 2. 取得程式碼

```bash
sudo -u gmailm git clone https://github.com/AmemiyaLai/gmailM.git /opt/gmailm
```

### 3. 環境變數

```bash
sudo mkdir -p /etc/gmailm
sudo cp /opt/gmailm/.env.example /etc/gmailm/env
sudo chmod 600 /etc/gmailm/env
sudo chown root:root /etc/gmailm/env
sudo nano /etc/gmailm/env     # 填入 Vercel 後台現有的值
```

**必須加上 `DEPLOY_TARGET=node`** —— 漏掉的話 runtime 會走 Vercel 分支，
Discord 的「確認刪除」按鈕會因為同步等待而超過 3 秒限制。

不要用 repo 內的 `.env`：那個檔案屬於 `gmailm` 使用者，權限管控不如 `/etc/gmailm/env`。

### 4. systemd

```bash
sudo cp /opt/gmailm/scripts/deploy/gmailm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gmailm
sudo systemctl status gmailm
```

第一次啟動前要先 build 一次：

```bash
sudo -u gmailm bash -c 'cd /opt/gmailm && npm ci && set -a && source /etc/gmailm/env && set +a && npm run build'
```

> **記憶體**：`astro build` 建議留 2GB 以上。機器不足時可在別處 build 再把 `dist/` 傳上來
> —— 因為機密不會被寫進產物，這樣做是安全的。

### 5. Cloudflare Tunnel

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

cloudflared tunnel login
cloudflared tunnel create gmailm          # 記下輸出的 TUNNEL_ID
sudo cp /opt/gmailm/scripts/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml     # 把 <TUNNEL_ID> 換成實際值
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

主機**不需要**開任何 inbound 埠 —— 這正好避開 OCI Security List 與
Oracle 映像內建 iptables 這兩層（兩者預設都擋 80/443，是自架最常見的卡關點）。

### 6. DNS 切換

```bash
cloudflared tunnel route dns gmailm gmailm.autodesignlab.org
```

這會把 Cloudflare DNS 上 `gmailm` 的記錄改成指向 `<TUNNEL_ID>.cfargotunnel.com` 的
CNAME（proxied）。原本指向 Vercel 的記錄會被取代。

### 7. ⚠️ 驗證 Cloudflare Access bypass

Zero Trust 的 Access policy 會對未登入請求回 **302 導向登入頁**，
外部服務收到 302 只會安靜失敗。以下路徑必須有 bypass policy，切換後**逐一驗證**：

| 路徑 | 呼叫方 |
| --- | --- |
| `/api/webhook/gmail` | Google Pub/Sub push |
| `/api/webhook/inbound-email` | Cloudflare Email Worker |
| `/api/discord/interactions` | Discord |
| `/api/gmail/watch-renew` | GitHub Actions |
| `/api/gmail/hourly-summary` | GitHub Actions |
| `/api/gmail/first-sender-digest` | GitHub Actions |
| `/api/gmail/sender-trust-backfill` | GitHub Actions |
| `/api/inbound/digest` | GitHub Actions |

```bash
# 應回 200，不是 302
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" \
  https://gmailm.autodesignlab.org/api/gmail/watch-renew
```

---

## 日常部署

```bash
sudo -u gmailm /opt/gmailm/scripts/deploy/deploy.sh
```

## 回滾到 Vercel

1. 從 `/etc/gmailm/env` 移除 `DEPLOY_TARGET=node`
2. Cloudflare DNS 上把 `gmailm` 記錄改回指向 Vercel
3. `sudo systemctl stop gmailm cloudflared`

程式碼完全不用動 —— Vercel 端維持原本的 build 與部署流程。

## 切換期間

先在 GitHub 上把 `.github/workflows/*.yml` 的 schedule 停用（或用 `workflow_dispatch` 手動觸發），
避免 DNS 傳播期間 cron 打到半死的端點而噴 5xx 告警。

---

## 外部服務能否一併自托管

| 服務 | 可自托管 | 說明 |
| --- | --- | --- |
| **Supabase** | ✅ | 專案只用 `.from()` 與兩支 `.rpc()`，沒用到 Auth / Storage / Realtime（即時走 Pusher），因此不必跑官方那套約 4GB RAM 的完整 stack，**Postgres + PostgREST** 兩個容器就夠。`src/lib/supabase.ts` 一行都不用改，只換 `SUPABASE_URL` 與自簽的 `service_role` JWT。代價是備份、PITR、監控全變成自己的責任 —— **建議先讓 Astro 自托管跑穩，再單獨遷移資料庫**，兩件事同時搬會無法二分定位問題。 |
| **Pusher** | ✅ | `soketi` 相容 Pusher protocol。程式碼已預留：設定 `PUSHER_HOST` / `PUBLIC_PUSHER_HOST` 即切換，未設定則維持 Pusher 雲端。 |
| **Google Pub/Sub** | ❌ | Gmail API 的 `users.watch()` **只接受 GCP Pub/Sub topic**，這是 Google 端的規格，沒有替代端點（emulator 只能本機測試，Gmail 不會推到它）。不過現況已經很好：push subscription 是推到你自己的 `/api/webhook/gmail`，GCP 只是轉信差，不存放郵件內容，免費額度（每月 10GB）遠遠用不完。真要脫離只能改用 `history.list` 輪詢（`/api/gmail/sync` 已具備），但即時性從秒級降為分鐘級且配額消耗大增，不建議。 |
| Gemini / Discord / Safe Browsing / CF Email Worker | ❌ | 本質為外部服務。`SAFE_BROWSING_API_KEY` 是選用的，不設定仍可運作。 |

---

## 排錯

```bash
sudo journalctl -u gmailm -f            # 應用日誌
sudo journalctl -u cloudflared -f       # tunnel 日誌
curl -I http://127.0.0.1:1008/          # 繞過 tunnel 直接測應用
```

| 症狀 | 檢查 |
| --- | --- |
| 外部回 302 | Cloudflare Access bypass（見上表） |
| 外部回 502、本機 200 | cloudflared 未執行，或 config.yml 的 service 位址錯誤 |
| 頁面出現「Supabase 未配置」 | `/etc/gmailm/env` 未被 systemd 載入，或 `SUPABASE_*` 拼錯 |
| 即時推播不會動 | `PUBLIC_PUSHER_*` 是 build 時 inline，改完必須**重新 build**，重啟無效 |
| Discord 按鈕顯示「應用程式未及時回應」 | `DEPLOY_TARGET=node` 沒設到 |
