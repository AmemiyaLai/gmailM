# Gmail 即時監控面板

Gmail 新信件透過 GCP Pub/Sub 即時推送到 Astro SSR（Vercel）的 Webhook，寫入 Supabase，並透過 Pusher 即時廣播到瀏覽器面板。整個網域掛在 Cloudflare Access 之後做身分保護。

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

## 指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 建置 |
| `npm run preview` | 本地預覽建置結果 |
| `npm run type-check` | TypeScript 型別檢查 |
| `npm run test:unit` | 單元測試 |
| `npm run test:e2e` | E2E 測試 |
| `npm run check:all` | 完整品質檢查 |

## 架構

```
Gmail → GCP Pub/Sub → Webhook (Vercel) → Supabase + Pusher → 瀏覽器面板
                                ↑
                    Cloudflare Access（身分保護）
```
