# Discord Bot 設定指南（關鍵字清理審核）

`/cleanup` 的審核訊息需要**可點擊的按鈕**，而 Discord 的按鈕（message components）只能由 Application 擁有的訊息攜帶——現有的 `DISCORD_WEBHOOK_URL` 送不出按鈕。因此這個功能必須額外建立一個 Discord Application + Bot。

其餘既有通知（重要郵件、首次寄件者、每小時摘要）繼續走 Webhook，不受影響。

## 需要取得的三個值

| 環境變數 | 從哪裡拿 | 長相 |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Developer Portal → **General Information** | 64 字元 hex，例如 `a1b2c3...` |
| `DISCORD_BOT_TOKEN` | Developer Portal → **Bot** → Reset Token | 約 70 字元，含兩個 `.` |
| `DISCORD_CLEANUP_CHANNEL_ID` | Discord App 內對頻道右鍵 → 複製頻道 ID | 18–19 位數字 |

---

## 步驟 1：建立 Application

1. 開 <https://discord.com/developers/applications>（用你平常的 Discord 帳號登入）
2. 右上角 **New Application**
3. 輸入名稱（例如 `Gmail 監控面板`）→ 勾選同意條款 → **Create**

建立後會直接進入 **General Information** 頁面。

## 步驟 2：拿 `DISCORD_PUBLIC_KEY`

還在 **General Information** 頁面：

- 往下找到 **PUBLIC KEY** 欄位 → 按 **Copy**
- 這就是 `DISCORD_PUBLIC_KEY`

> 這個值用來驗證「按鈕點擊事件真的來自 Discord」（Ed25519 簽章）。它不是機密，但填錯的話 interaction endpoint 會一律回 401。
>
> 同一頁的 **APPLICATION ID** 這個專案不需要，可以忽略。

## 步驟 3：拿 `DISCORD_BOT_TOKEN`

1. 左側選單點 **Bot**
2. 找到 **TOKEN** 區塊 → 按 **Reset Token**（新版 Portal 不會顯示既有 token，只能重設）
3. 彈窗確認 → 完整 token 會顯示一次 → 立刻 **Copy** 存好
4. 這就是 `DISCORD_BOT_TOKEN`

> ⚠️ **token 只會出現這一次**，關掉就只能再 Reset 一次（舊 token 會失效）。
> 這是機密，等同 bot 的密碼，絕對不要提交進 Git（本專案的 pre-commit hook 會擋 `.env`）。

同一頁的建議設定：

- **PUBLIC BOT**：建議**關閉**（只有你能把它加進伺服器）
- **Privileged Gateway Intents**（Presence / Server Members / Message Content）：**全部不用開**。這個 bot 只負責發訊息和回應按鈕，不需要讀取他人訊息內容。

## 步驟 4：把 Bot 邀請進你的伺服器

1. 左側選單點 **OAuth2**
2. 找到 **OAuth2 URL Generator**
3. **SCOPES** 勾選：`bot`
4. 下方展開的 **BOT PERMISSIONS** 勾選：
   - `View Channels`
   - `Send Messages`
   - `Embed Links`
5. 頁面最下方會產生一段 **GENERATED URL** → 按 Copy → 貼到瀏覽器開啟
6. 選擇要加入的伺服器 → **繼續** → **授權**

完成後 bot 會出現在該伺服器的成員清單（顯示為離線是正常的，這個 bot 不需要維持 gateway 連線）。

## 步驟 5：拿 `DISCORD_CLEANUP_CHANNEL_ID`

在 **Discord App**（不是 Developer Portal）裡操作：

1. 先開啟開發者模式：**使用者設定（左下齒輪）** → **進階** → 開啟 **開發者模式**
2. 回到伺服器，對你要接收審核訊息的頻道**右鍵** → **複製頻道 ID**
3. 這就是 `DISCORD_CLEANUP_CHANNEL_ID`

> 建議開一個專用頻道（例如 `#郵件清理審核`），跟其他通知分開。
>
> 若該頻道有自訂權限，請確認 bot 的身分組在這個頻道有「檢視頻道」與「發送訊息」權限，否則送出時會收到 `403 Missing Permissions`。

## 步驟 6：填入環境變數並部署

在 `.env`（本機）與 **Vercel → Settings → Environment Variables**（線上）都填入：

```bash
DISCORD_BOT_TOKEN=你的_bot_token
DISCORD_CLEANUP_CHANNEL_ID=你的頻道ID
DISCORD_PUBLIC_KEY=你的_public_key
```

**填完必須先重新部署**，再做步驟 7。

## 步驟 7：設定 Interactions Endpoint URL（順序很重要）

⚠️ 這一步**必須在步驟 6 部署完成之後**才能做。Discord 在你按下儲存的瞬間就會對這個網址送一個 PING 測試，若當時線上環境還沒有 `DISCORD_PUBLIC_KEY`，簽章驗證會失敗、Discord 會拒絕儲存。

1. 回到 Developer Portal → **General Information**
2. 找到 **INTERACTIONS ENDPOINT URL** 欄位，填入：

   ```
   https://gmailm.autodesignlab.org/api/discord/interactions
   ```

3. 按 **Save Changes**

**存檔成功（沒有跳紅字錯誤）就代表簽章驗證正確**，這是最好的驗證方式。

### 如果存檔失敗

Discord 會顯示類似 `interactions endpoint url could not be verified`，逐項確認：

| 可能原因 | 檢查方式 |
|---|---|
| 線上環境沒有 `DISCORD_PUBLIC_KEY` | Vercel 環境變數有填？填完有**重新部署**嗎？ |
| Public Key 複製錯誤 | 應為 64 字元純 hex，不含空白 |
| 網址打錯 | 結尾是 `/api/discord/interactions`，且是 `https` |
| Cloudflare Access 擋住了 | 這個路徑必須對外公開，Discord 帶不了你的身分憑證 |

> **Cloudflare Access 注意**：本專案整個網域掛在 Cloudflare Access 後面。`/api/discord/interactions` 需要加入 bypass 規則（比照 `/api/webhook/gmail` 的處理方式），否則 Discord 的 PING 會被登入頁擋掉。這支端點本身有 Ed25519 簽章驗證，不靠 Access 保護。

---

## 驗證整條流程

1. 執行 migration：`supabase/migrations/0007_cleanup_keywords.sql`
2. 開 `/cleanup`，從「建議關鍵字」挑一組（例如 `udnpaper.com`）→ 確認預覽有命中 → 按「新增」
3. 按「**立即送審至 Discord**」
4. 到你設定的頻道確認收到訊息，且下方有兩顆按鈕
5. 先測**❌ 取消** → 訊息應就地改成「已取消」、按鈕消失、Gmail 完全沒動
6. 再送一次 → 按 **✅ 確認刪除** → 訊息改成「已將 N 封郵件移至垃圾桶」→ 到 Gmail 垃圾桶確認郵件在裡面（30 天內可復原）

> 送審有 **5 秒冷卻期**，連續點兩次第二次會顯示「請稍候 N 秒」，這是正常的防洗版機制。

## 常見錯誤訊息

| 訊息 | 原因 | 解法 |
|---|---|---|
| `DISCORD_BOT_TOKEN 或 DISCORD_CLEANUP_CHANNEL_ID 未設定` | 環境變數沒填或沒重新部署 | 補上步驟 6 |
| `Discord 送出清理審核失敗 (401)` | Bot token 錯誤或已被 Reset | 重新執行步驟 3 |
| `Discord 送出清理審核失敗 (403) Missing Permissions` | Bot 沒有該頻道的發送權限 | 檢查步驟 4 的權限與頻道權限覆寫 |
| `Discord 送出清理審核失敗 (404)` | 頻道 ID 錯誤，或 bot 不在該伺服器 | 重新執行步驟 4、5 |
| 按鈕點了沒反應／顯示「應用程式沒有回應」 | Interactions Endpoint URL 沒設定或被 Access 擋住 | 檢查步驟 7 |
