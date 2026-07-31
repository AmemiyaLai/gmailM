# gmailM Inbound Email Worker

Cloudflare Email Worker：接收 `autodesignlab.org` 的來信（Cloudflare Email Routing），
以 [postal-mime](https://github.com/postalsys/postal-mime) 在邊緣解析 MIME，
轉成 JSON 後 POST 至 gmailM 的 `/api/webhook/inbound-email`，存入 Supabase 供「站點收件匣」頁面瀏覽。

```
寄件者 ──MX──▶ Cloudflare Email Routing ──▶ 本 Worker（解析＋裁剪）
                                                 │ POST JSON + Bearer secret
                                                 ▼
                              gmailM (Vercel) /api/webhook/inbound-email ──▶ Supabase
```

## 部署步驟

### 1. 啟用 Email Routing

1. Cloudflare dashboard → 網域 `autodesignlab.org` → **Email** → **Email Routing** → Enable。
2. 依提示新增 MX 紀錄（`route1/2/3.mx.cloudflare.net`）與 SPF TXT。
   ⚠️ 若網域已有 SPF 紀錄，**合併** `include:_spf.mx.cloudflare.net` 到既有那筆，不要建立第二筆 SPF TXT。

### 2. 部署 Worker

```bash
cd scripts/cloudflare-email-worker
npm install
npx wrangler deploy
npx wrangler secret put WEBHOOK_SECRET   # 值 = Vercel 的 INBOUND_EMAIL_WEBHOOK_SECRET
```

### 3. 設定路由規則（Catch-all → Worker）

Email Routing → **Routing rules** → **Catch-all address** → Action 選 **Send to a Worker** → 選 `gmailm-inbound-email` → 啟用。

> **取捨**：Catch-all 配合站台的「別名自動登記」，新子站啟用新別名完全不用動 Cloudflare 設定；
> 代價是打到任意 local-part 的垃圾信會在站台建立「未分類」別名（可在頁面停用）。
> 若噪音過多，可改為逐一新增 custom address 規則指向本 Worker。

### 4. Vercel 端環境變數

| 變數 | 說明 |
|---|---|
| `INBOUND_EMAIL_WEBHOOK_SECRET` | 與步驟 2 的 `WEBHOOK_SECRET` 相同 |
| `INBOUND_EMAIL_DOMAIN` | `autodesignlab.org`（未設定時即為此預設值） |

### 5. Cloudflare Access 注意事項

若 `gmailm.autodesignlab.org` 受 Cloudflare Access 保護，Worker 的請求會被 302 導向登入頁而失敗。二擇一：

- **Bypass 政策**：Access 應用程式加一條 policy，對路徑 `/api/webhook/inbound-email` 設 Bypass（Everyone）。
  webhook 本身有 Bearer secret 驗證，Bypass 不會造成未授權寫入。
- **Service Token**：建立 Access service token，`wrangler secret put CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`，
  並取消 `worker.js` 內兩行標頭的註解後重新部署。

### 6. 驗證

1. 從外部信箱寄一封信到 `test@autodesignlab.org`（可夾一個小附件）。
2. `npx wrangler tail` 觀察 Worker log，應看到 webhook 回 200。
3. 開 `https://gmailm.autodesignlab.org/inbound`，應出現「未分類」別名與該封信。
4. 在頁面下方「別名管理」把 `test` 改名，重整後 chips 應顯示新標籤。

## 行為說明

- 原始郵件 > 10MB：直接 `setReject`（拒收，寄件者會收到退信）。
- 附件 > 1MB：只送 metadata（`dropped: true`），內容不落地。
- 整包 JSON > 3.5MB：由大到小改丟附件內容，仍超限則丟棄 HTML 內文（保留純文字）。
- webhook 回 5xx：丟出例外 → 上游 SMTP 暫時性失敗自動重試（配合站台端 Message-ID 冪等，不會重複入庫）。
- webhook 回 4xx：視為永久性錯誤，記 log 後吞掉，避免退信風暴。
