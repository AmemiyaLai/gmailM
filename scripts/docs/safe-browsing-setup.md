# Google Safe Browsing 設定指南（首次寄件者網域信譽）

首次寄件者的「安全狀態」由三個訊號合成：

1. Gmail 的 `Authentication-Results` 標頭（SPF / DKIM / DMARC）— 主判定
2. **Google Safe Browsing 網域信譽** ← 本文件要設定的
3. 本地知名網域白名單

`SAFE_BROWSING_API_KEY` 是**選用**的。未設定時整個功能照常運作，只是判定少一個訊號：
證據列會出現「查詢未完成（SAFE_BROWSING_API_KEY 未設定，略過外部信譽查詢），本次判定未採計此訊號」。

沿用既有的 GCP 專案即可（`GCP_PROJECT_ID`，Pub/Sub 已在用），**不需要新建專案**。

---

## ⚠️ 先確認授權條款

Google 有兩個網域信譽產品，別選錯：

| 產品 | 端點 | 費用 | 條款 |
|---|---|---|---|
| **Safe Browsing API v4**（本專案採用） | `safebrowsing.googleapis.com` | 免費 | **僅限非商業用途** |
| Web Risk API | `webrisk.googleapis.com` | 依用量計費 | 允許商業用途 |

本專案是個人 Gmail 監控面板，屬非商業用途，適用 Safe Browsing v4。
若日後轉為商業服務，必須改接 Web Risk API — 屆時只需改寫
[`src/lib/safeBrowsing.ts`](../../src/lib/safeBrowsing.ts) 的端點與請求格式，
判定邏輯（`senderTrust.ts`）與資料表（`domain_reputation`）都不用動。

---

## 步驟 1：啟用 Safe Browsing API

1. 開 <https://console.cloud.google.com/apis/library/safebrowsing.googleapis.com>
2. 頁面左上角確認**專案選擇器**是 `.env` 裡 `GCP_PROJECT_ID` 的那個專案
3. 按 **啟用**（Enable）

啟用後停留幾秒，狀態會變成「API 已啟用」。

## 步驟 2：建立 API 金鑰

1. 前往 <https://console.cloud.google.com/apis/credentials>
2. 上方 **+ 建立憑證** → **API 金鑰**
3. 彈窗會直接顯示金鑰（`AIza` 開頭、共 39 字元）→ 先複製起來
4. 彈窗內按 **編輯 API 金鑰**（或之後從清單點金鑰名稱進去）

## 步驟 3：限制金鑰（重要）

API 金鑰放在伺服器端，一旦外洩任何人都能耗掉你的配額。務必做以下設定：

**應用程式限制** → 選 **無**

> 不要選「HTTP 參照網址」——那只對瀏覽器端請求有效，伺服器端呼叫沒有 Referer 標頭會直接被擋。
> 也不要選「IP 位址」——Vercel 的 serverless 函式出口 IP 是動態的，鎖 IP 會不定時失敗。

**API 限制** → 選 **限制金鑰** → 下拉勾選 **Safe Browsing API** → 儲存

這一步才是真正的防護：就算金鑰外洩，也只能拿來查 Safe Browsing，動不了你專案裡的 Gmail、Pub/Sub 等其他 API。

## 步驟 4：寫入環境變數

### 本機

編輯 `.env`（已在 `.gitignore` 中）：

```
SAFE_BROWSING_API_KEY=AIza...你的金鑰...
```

> `.env.example` 裡的 `your_safe_browsing_api_key_here` 是佔位符，**不要**把真金鑰寫進去。
> `scripts/check-secrets.mjs` 會在 `git push` 前掃描，真實的 `AIza` 金鑰被提交會直接擋下。

### Vercel（正式環境）

```bash
vercel env add SAFE_BROWSING_API_KEY production
# 貼上金鑰後 Enter
```

或到 Vercel Dashboard → 專案 → **Settings** → **Environment Variables** 新增。

**加完必須重新部署才會生效**（環境變數只在 build/啟動時注入）：

```bash
vercel --prod
```

---

## 步驟 5：驗證

### 本機驗證

```bash
astro dev --background
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:4321/api/gmail/sender-trust-backfill?limit=5&force=true"
```

`force=true` 會跳過 Gmail 呼叫、直接以既有標頭重評，是驗證信譽查詢最快的方式。

接著開 <http://localhost:4321/first-senders>，展開任一列的「依據」：

- ✅ 設定成功 → 出現 **Google Safe Browsing** 連結，說明文字為
  「未列於惡意網域名單（2026-07-31 查詢）」
- ❌ 金鑰無效／未啟用 API → 「查詢未完成（外部信譽 API 回應 HTTP 403），本次判定未採計此訊號」
- ❌ 金鑰沒設到 → 「查詢未完成（SAFE_BROWSING_API_KEY 未設定，略過外部信譽查詢）」

### 直接測 API（跳過本專案）

```bash
curl -s -X POST \
  "https://safebrowsing.googleapis.com/v4/threatMatches:find?key=你的金鑰" \
  -H "Content-Type: application/json" \
  -d '{
    "client": {"clientId":"gmail-monitor-panel","clientVersion":"1.0.0"},
    "threatInfo": {
      "threatTypes":["MALWARE","SOCIAL_ENGINEERING"],
      "platformTypes":["ANY_PLATFORM"],
      "threatEntryTypes":["URL"],
      "threatEntries":[{"url":"testsafebrowsing.appspot.com/s/phishing.html"}]
    }
  }'
```

Google 官方的測試網址應回傳含 `matches` 的結果。
若換成 `apple.com` 則回傳 `{}`（乾淨）。回 `403` 代表 API 未啟用或金鑰被限制擋掉。

---

## 配額與快取

Safe Browsing Lookup API 的預設免費配額約為 **10,000 requests/day**
（實際值以 <https://console.cloud.google.com/apis/api/safebrowsing.googleapis.com/quotas> 為準）。

本專案的設計讓配額幾乎不可能耗盡：

- 查詢單位是**網域**而非寄件者 —— 一個 `apple.com` 服務所有來自該網域的寄件者
- 結果存進 `domain_reputation` 表，`clean` 快取 7 天、`threat` 依 API 回傳的 `cacheDuration`
- 單一請求最多批量送查 100 個網域 —— 回填 50 筆寄件者通常只花 1 次請求

若真的遇到 429/403，`lookupDomains()` 會降級為 `error` 並以 1 小時短退避重試，
判定照常完成，不會中斷回填或即時 webhook。

---

## 相關檔案

| 檔案 | 職責 |
|---|---|
| [`src/lib/safeBrowsing.ts`](../../src/lib/safeBrowsing.ts) | 呼叫 API、分批、降級處理（永不 throw） |
| [`src/lib/domainReputation.ts`](../../src/lib/domainReputation.ts) | 網域快取層與 TTL |
| [`src/lib/senderTrust.ts`](../../src/lib/senderTrust.ts) | 三訊號合成判定（純函式） |
| [`supabase/migrations/0009_sender_trust.sql`](../../supabase/migrations/0009_sender_trust.sql) | `domain_reputation` 表 |
