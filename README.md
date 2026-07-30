# Gmail 即時監控面板

Gmail 新信件透過 GCP Pub/Sub 即時推送到 Astro SSR（Vercel）的 Webhook，寫入 Supabase，並透過 Pusher 即時廣播到瀏覽器面板；其中被 Gmail 標記為「重要」的郵件會額外推播到 Discord。整個網域掛在 Cloudflare Access 之後做身分保護。

## 技術棧

| 項目 | 說明 |
|------|------|
| [Astro](https://astro.build) | SSR 框架（Vercel adapter） |
| [Supabase](https://supabase.com) | PostgreSQL 資料庫（郵件儲存） |
| [Pusher Channels](https://pusher.com/channels) | 即時 WebSocket 廣播 |
| Google Cloud Pub/Sub | Gmail push 通知 |
| [Cloudflare Access](https://www.cloudflare.com/zero-trust/) | Zero Trust 身分驗證層 |
| [Vercel](https://vercel.com) | 部署平台 |

## 開發

```bash
npm install
cp .env.example .env    # 填入環境變數
npm run dev             # http://localhost:4321
```

`npm install` 會自動啟用專案的 Git Hooks；若需手動重新設定，執行 `npm run setup:hooks`。

## 指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 建置 |
| `npm run preview` | 本地預覽建置結果 |
| `npm run type-check` | TypeScript 型別檢查 |
| `npm run test:unit` | 單元測試 |
| `npm run test:e2e` | E2E 測試 |
| `npm run lint` | ESLint 複雜度檢查（目前僅警告） |
| `npm run check:all` | 完整品質檢查 |
| `npm run setup:hooks` | 啟用專案版本控制的 Git Hooks |

## Git 安全與提交規範

- 提交前會掃描暫存區，阻止 `.env`、私鑰、服務帳號、Google OAuth 憑證及常見硬編碼金鑰或密碼。
- 一般提交訊息必須符合 Conventional Commits，例如 `feat: 新增郵件篩選`；Git 產生的 merge/revert 提交不受此限制。
- 不可直接推送至 `main` 或 `develop`，請以 Pull Request 合併。
- 若確認是誤報，可謹慎使用 `git commit --no-verify` 或 `git push --no-verify`。實際金鑰一旦外洩，必須立即到對應服務撤銷並輪換，僅刪除 Git 紀錄並不足夠。

### 複雜度檢查

`npm run lint` 使用 ESLint 檢查正式 TypeScript、Astro 與 Node 腳本：圈複雜度上限 15、巢狀深度上限 4、單一函式上限 100 行。測試檔不套用這些門檻；CI 會顯示結果，但目前不會阻擋合併。

## 架構

```
Gmail → GCP Pub/Sub → Webhook (Vercel) → Supabase + Pusher → 瀏覽器面板
                                ↑                    ↓
                    Cloudflare Access（身分保護）  Discord（重要郵件通知）
```
