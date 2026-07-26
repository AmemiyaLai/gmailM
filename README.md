# Astro 基礎專案範本

> 一個預配置完整的 Astro 基礎範本，整合設計系統、SEO 最佳化、Cloudflare Pages、D1 與 Git Flow 工作流程，讓你每次開新專案都能立刻投入開發。

## 可配置知識網站框架

目前範例已整合 `@amemiyalai/wiki-center` 私有套件，並採用內容驅動路由。建立新網站時，主要修改 `src/site.config.ts`、`src/content/knowledge/zh-tw/` 與 `public/` 即可。

### 私有套件權限

`wiki-center` 以 GitHub repository dependency 引用。執行 `npm install` 前，請確認本機 SSH key 已有該 repository 的讀取權限；GitHub Actions 則需設定可讀取 private repository 的套件權限或 deploy key。

網站只從 `@amemiyalai/wiki-center` 的公開入口匯入元件，不應引用套件內部 `src/components`。

### 路由

```text
/                         首頁
/knowledge                知識庫分類
/knowledge/[...slug]      Markdown/MDX 動態文章
/search                   搜尋介面
/about                    關於頁
/api/health               Cloudflare D1 健康檢查
```

文章 frontmatter 必須包含 `contentId`、`slug`、`title`、`description`、`locale`、`moduleId` 與 `order`。設定 `published: false` 可保留草稿而不產生公開頁面。

### Cloudflare Pages 與 D1

```powershell
npm install
Copy-Item .env.example .env
npm run cf:login
npm run cf:d1:create
# 將輸出的 database_id 填入 wrangler.jsonc
npm run cf:d1:migrate:local
npm run cf:d1:migrate:remote
npm run cf:pages:deploy
```

Cloudflare API Token、Account ID 與 D1 資料庫資訊不可提交至 Git。GitHub Actions 使用 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` secrets，以及 `CF_PAGES_PROJECT_NAME` repository variable。

### 品質檢查與 GitHub Actions

- `npm run check:all`：型別、單元測試、路由基線與 build。
- `.github/workflows/quality-gate.yml`：PR 與 `main`／`develop` 的品質門檻。
- `.github/workflows/cloudflare-pages.yml`：`main` 部署 production，`develop` 部署 preview。
- D1 migration 不會在一般 PR 自動套用，正式 migration 請透過受保護流程執行。

---

## 目錄

- [快速開始](#快速開始)
- [專案結構](#專案結構)
- [預設設定說明](#預設設定說明)
  - [設計系統（CSS）](#設計系統css)
  - [SEO 元件](#seo-元件)
  - [Cloudflare Pages 與 D1](#cloudflare-pages-與-d1)
  - [Astro 設定](#astro-設定)
- [測試框架](#測試框架)
  - [Vitest 單元測試](#vitest-單元測試)
  - [Playwright E2E 測試](#playwright-e2e-測試)
- [安全防護：敏感檔案偵測](#安全防護敏感檔案偵測)
- [Git Flow 工作流程](#git-flow-工作流程)
  - [分支架構](#分支架構)
  - [Commit 訊息規範](#commit-訊息規範)
  - [Git Hooks](#git-hooks)
- [全域 Git 環境配置](#全域-git-環境配置)
- [環境變數](#環境變數)
- [開發指令](#開發指令)

---

## 快速開始

### 從此範本建立新專案

```powershell
# 1. 複製範本到新的專案資料夾
Copy-Item -Recurse "H:\template\astro\" "你的新專案路徑\"

# 2. 進入專案
cd 你的新專案路徑

# 3. 安裝依賴
npm install

# 4. 初始化 Git Flow（建立 main/develop 分支與初始 commit）
.\scripts\setup-git-flow.ps1

# 5. 啟動開發伺服器
npm run dev
```

> 開發伺服器預設在 http://localhost:4321

---

## 專案結構

```
astro/
├── src/
│   ├── components/
│   │   └── BaseHead.astro     ← SEO meta 標籤元件
│   ├── layouts/
│   │   └── BaseLayout.astro   ← 基礎版面
│   ├── pages/
│   │   └── index.astro        ← 首頁範例
│   └── styles/
│       └── global.css         ← 全域設計系統
├── docs/
│   └── git-flow-guide.md      ← Git Flow 完整說明
├── scripts/
│   └── setup-git-flow.ps1     ← 新專案初始化腳本
├── public/
│   └── favicon.svg
├── .env.example               ← 環境變數範本
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

---

## 預設設定說明

### 設計系統（CSS）

**檔案**：[`src/styles/global.css`](src/styles/global.css)

全域樣式系統基於 **CSS 自定義屬性（Custom Properties）**，分為以下幾個區塊：

#### 顏色系統

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `--color-bg` | `#09090b` | 主要背景色（深黑） |
| `--color-bg-secondary` | `#18181b` | 次要背景色 |
| `--color-surface` | `#1c1c1f` | 卡片/面板背景 |
| `--color-text` | `#fafafa` | 主要文字色 |
| `--color-text-secondary` | `#a1a1aa` | 次要文字色 |
| `--color-primary` | `#6366f1` | 主色調（靛紫） |
| `--color-border` | `#3f3f46` | 邊框顏色 |

> 修改主色調只需調整 `--color-primary` 一個變數即可。

#### 字體系統

- **內文字體**：Inter（Google Fonts，已在 `BaseHead.astro` 引入）
- **等寬字體**：Fira Code / Cascadia Code / JetBrains Mono（本地 fallback）
- 字體大小從 `--font-size-xs`（12px）到 `--font-size-4xl`（48px）

#### 間距系統

基礎單位 **4px**，提供 `--space-1` 到 `--space-24`（4px ~ 96px）。

#### 工具類別

| 類別 | 說明 |
|------|------|
| `.container` | 最大寬度 1280px，水平置中，含內邊距 |
| `.card` | 卡片樣式（深色背景 + 邊框 + hover 效果） |
| `.btn` / `.btn-primary` / `.btn-outline` | 按鈕樣式 |
| `.badge` / `.badge-primary` | 標籤/徽章 |
| `.sr-only` | 螢幕閱讀器專用（視覺隱藏） |

---

### SEO 元件

**檔案**：[`src/components/BaseHead.astro`](src/components/BaseHead.astro)

在 `BaseLayout.astro` 中自動引入，使用時只需傳入 props：

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
---
<BaseLayout
  title="頁面標題"
  description="頁面描述（用於 SEO）"
  image="/path/to/og-image.png"
>
  <!-- 頁面內容 -->
</BaseLayout>
```

**BaseHead 自動處理：**
- `<title>` 標籤（格式：`頁面標題 | 網站名稱`）
- `<meta name="description">`
- Open Graph 標籤（og:title, og:description, og:image, og:url）
- Twitter Card 標籤
- `<link rel="canonical">` 規範化 URL
- Google Fonts（Inter）引入

**修改網站名稱**：編輯 `BaseHead.astro` 中的 `siteTitle` 常數：

```javascript
const siteTitle = "My Astro Site"; // ← 修改這裡
```

---

### Cloudflare Pages 與 D1

範例已配置 `wrangler.jsonc`，使用 Cloudflare Pages 部署 `dist/`，並透過 `DB` binding 讓 Pages Functions 存取 D1。

```powershell
npm run cf:login
npx wrangler d1 create astro-template-db
# 將產生的 database_id 填入 wrangler.jsonc
npm run cf:d1:migrate:local
npm run cf:d1:migrate:remote
npm run cf:pages:deploy
```

D1 只能在伺服器端 Pages Function 使用；範例端點為 `/api/health`。

---

### Astro 設定

**檔案**：[`astro.config.mjs`](astro.config.mjs)

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `site` | `https://your-domain.com` | **部署前必須修改**，影響 canonical URL 與 og:image 路徑 |
| `output` | `"static"` | 靜態輸出，若需 SSR 改為 `"server"` |

**修改網站 URL**：

```javascript
// astro.config.mjs
export default defineConfig({
  site: "https://your-actual-domain.com", // ← 修改這裡
});
```

---

## Git Flow 工作流程

詳細說明請參考 [`docs/git-flow-guide.md`](docs/git-flow-guide.md)。

### 分支架構

```
main              ← 正式版本（受保護，僅接受 PR 合併）
└── develop       ← 開發主線（受保護，僅接受 PR 合併）
    ├── feature/user-auth     ← 功能開發分支
    ├── feature/payment       ← 另一個功能
    └── hotfix/critical-bug   ← 緊急修補（從 main 分出）
```

### Commit 訊息規範

**這個範本配置了兩套不同的規範，依據目前所在分支自動切換：**

---

#### 受保護分支（`main`、`master`、`develop`）

> 這些分支只允許版本發布 commit，格式為**語意化版本號（SemVer）**。

**格式**：`vMAJOR.MINOR.PATCH`

```
v1.0.0    ← 初始正式發布
v1.1.0    ← 新增功能（向下相容）
v1.1.1    ← 錯誤修復
v2.0.0    ← 重大版本（可能含破壞性變更）
v1.0.0-rc.1     ← 候選版本（Release Candidate）
v1.0.0-beta.2   ← 測試版
```

**版本號規則（SemVer）**：
- `MAJOR`：重大版本，含破壞性變更時遞增
- `MINOR`：新增功能，向下相容時遞增，PATCH 歸零
- `PATCH`：錯誤修復，向下相容時遞增

> 受保護分支上的 commit 通常由 `git merge` 或 PR 自動產生，手動 commit 時才需填版本號。

---

#### 功能分支（`feature/*`、`hotfix/*`、`release/*` 等）

> 日常開發在功能分支上進行，格式為 **Conventional Commits**。

**格式**：`<type>(<scope>): <description>`

| type | 說明 | 範例 |
|------|------|------|
| `feat` | 新功能 | `feat: 新增使用者登入功能` |
| `fix` | 錯誤修復 | `fix(auth): 修復 JWT token 過期問題` |
| `docs` | 文件變更 | `docs: 更新 README 安裝說明` |
| `style` | 格式調整（不影響邏輯） | `style: 統一縮排為 2 空格` |
| `refactor` | 重構 | `refactor(api): 簡化請求處理邏輯` |
| `perf` | 效能優化 | `perf: 使用虛擬列表優化長清單渲染` |
| `test` | 測試相關 | `test: 新增登入流程單元測試` |
| `chore` | 雜務 | `chore: 更新依賴版本` |
| `ci` | CI/CD 配置 | `ci: 新增 GitHub Actions 部署工作流` |
| `build` | 建置系統 | `build: 升級 Astro 至 v7` |
| `revert` | 還原 commit | `revert: 還原 feat: 新增購物車功能` |

**破壞性變更**：在 type 後加 `!`：
```
feat!: 重構 API 路由結構（舊路徑將失效）
```

---

### Git Hooks

本範本配置兩個全域 Git Hooks（安裝於 `~/.git_template/hooks/`）：

#### `commit-msg`（格式驗證）

- **觸發時機**：每次執行 `git commit` 時
- **行為**：依據目前分支，驗證 commit 訊息格式（版本號 或 Conventional Commits）
- **略過**（不建議）：`git commit --no-verify -m "訊息"`

#### `pre-push`（推送保護）

- **觸發時機**：每次執行 `git push` 時
- **行為**：偵測到你正在直接 push 至 `main`、`master` 或 `develop` 時，顯示警告並阻止
- **強制推送**（謹慎使用）：`git push --no-verify`

> **重要**：Hook 只能在本地阻止操作。完整的分支保護必須在 GitHub/GitLab 上設定。請參考 [`docs/git-flow-guide.md`](docs/git-flow-guide.md) 的「GitHub 分支保護設定」章節。

---

## 全域 Git 環境配置

此範本附帶的 Git 配置是**全域性**的（一次設定，所有新專案自動套用），透過以下兩個機制實現：

### 1. Git 全域範本目錄（`~/.git_template`）

每次執行 `git init` 時，Git 會自動將 `~/.git_template/` 的內容複製到新倉庫的 `.git/` 目錄中。

```
~/.git_template/
└── hooks/
    ├── commit-msg   ← Commit 格式驗證
    └── pre-push     ← 受保護分支推送攔截
```

**設定指令（已執行過，記錄於此）**：
```powershell
git config --global init.templateDir "$HOME/.git_template"
```

### 2. 全域 `.gitignore`（`~/.gitignore_global`）

所有專案自動忽略以下類型的檔案，無需在每個專案重複設定：

- Windows 系統暫存（Thumbs.db, Desktop.ini）
- Node.js（node_modules/, dist/）
- Astro 建置輸出（.astro/）
- 環境變數（.env, .env.local）
- 編輯器設定（.idea/, .vscode/settings.json）
- Python 暫存（\_\_pycache\_\_/, .venv/）
- 日誌與暫存檔（*.log, *.tmp）

**設定指令（已執行過，記錄於此）**：
```powershell
git config --global core.excludesfile "$HOME/.gitignore_global"
```

### 3. PowerShell 函式 `git-init-flow`

已加入 `$PROFILE`，重開 PowerShell 後可直接使用：

```powershell
mkdir my-new-project
cd my-new-project
git-init-flow
```

**執行後自動完成：**
1. `git init -b main`（套用全域範本 → Hooks 自動複製）
2. 建立 `README.md`
3. `git commit -m "chore: initial commit"`
4. `git checkout -b develop`

---

## 環境變數

複製 `.env.example` 為 `.env` 並填入實際值：

```powershell
Copy-Item .env.example .env
```

| 變數 | 說明 | 必填 |
|------|------|------|
| `PUBLIC_SITE_URL` | 網站完整 URL（影響 canonical URL） | 建議填寫 |
| `PUBLIC_SITE_NAME` | 網站名稱 | 否 |

> 帶有 `PUBLIC_` 前綴的變數可在前端 JavaScript 中存取。不帶前綴的變數僅限伺服器端使用。

---

## 開發指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 啟動開發伺服器（http://localhost:4321，含熱更新） |
| `npm run build` | 建置正式版本（輸出至 `dist/`） |
| `npm run preview` | 本地預覽 `dist/` 建置結果 |
| `npm run type-check` | TypeScript 型別檢查（`astro check`） |
| `npm test` | 執行所有測試（單元 + E2E） |
| `npm run test:unit` | 執行 Vitest 單元測試（單次） |
| `npm run test:unit:watch` | Vitest 監看模式（開發時使用） |
| `npm run test:unit:coverage` | 產生覆蓋率報告（輸出至 `coverage/`） |
| `npm run test:e2e` | 執行 Playwright E2E 測試（需先建置） |
| `npm run test:e2e:ui` | 開啟 Playwright UI 模式（互動除錯） |
| `npm run test:e2e:debug` | Playwright 逐步除錯模式 |
| `npm run test:e2e:report` | 開啟 Playwright HTML 測試報告 |

---

## 技術棧

| 項目 | 版本 | 說明 |
|------|------|------|
| [Astro](https://astro.build) | ^7.1.1 | 核心框架 |
| Cloudflare Pages / D1 | Wrangler | 靜態部署與邊緣資料庫 |
| [Vitest](https://vitest.dev) | ^4.x | 單元測試框架 |
| [@playwright/test](https://playwright.dev) | ^1.x | E2E 測試框架 |
| TypeScript | 內建 | 嚴格模式（`astro/tsconfigs/strict`） |
| Node.js | >=22.12.0 | 最低執行環境要求 |

---

## 測試框架

### Vitest 單元測試

**設定檔**：[`vitest.config.ts`](vitest.config.ts)
**測試目錄**：`src/__tests__/`（或任意 `*.test.ts` / `*.spec.ts` 檔案）

Vitest 適合測試純 TypeScript 的**工具函式、商業邏輯**。Astro 元件（`.astro`）的渲染測試建議使用 Playwright E2E。

```powershell
# 單次執行
npm run test:unit

# 監看模式（開發時使用，存檔即重跑）
npm run test:unit:watch

# 產生覆蓋率報告（輸出至 coverage/index.html）
npm run test:unit:coverage
```

**覆蓋率閾值**（`vitest.config.ts` 中設定，預設 60%）：
- Statements / Branches / Functions / Lines 均需達到 60%
- 低於閾值時 CI 會失敗，可依專案成熟度調整

---

### Playwright E2E 測試

**設定檔**：[`playwright.config.ts`](playwright.config.ts)
**測試目錄**：`e2e/`

Playwright 測試真實瀏覽器行為，涵蓋頁面導航、表單互動與無障礙檢查。

```powershell
# 執行所有 E2E 測試（自動啟動 dev server）
npm run test:e2e

# 開啟互動式 UI（視覺化除錯，推薦）
npm run test:e2e:ui

# 查看最後一次的 HTML 報告
npm run test:e2e:report
```

**預設瀏覽器矩陣**（`playwright.config.ts` 中設定）：
- Chromium（Chrome/Edge）
- Firefox
- WebKit（Safari）

> 首次使用需下載瀏覽器：`npx playwright install`

**CI 環境差異**（自動偵測 `process.env.CI`）：
- 失敗自動重試 2 次
- Worker 數量設為 1（穩定性優先）
- `reuseExistingServer` 設為 false（每次 CI 都重啟伺服器）

---

## 安全防護：敏感檔案偵測

此範本在全域 Git Hook（`pre-commit`）中內建**雙層敏感資訊掃描**，每次 `git commit` 前自動執行。

### 第一層：敏感檔案名稱偵測

以下類型的檔案**無法被提交**（即使在暫存區）：

| 類型 | 範例 |
|------|------|
| 環境變數 | `.env`、`.env.local`、`.env.production` |
| 私鑰 | `*.pem`、`*.key`、`id_rsa`、`id_ed25519` |
| 憑證/金鑰庫 | `*.p12`、`*.pfx`、`*.jks`、`*.keystore` |
| 服務帳號 | `service-account.json`、`serviceAccountKey.json` |
| 資料庫憑證 | `credentials`、`*.htpasswd` |

> `.env.example` **允許提交**（僅含變數名稱，不含真實值）

### 第二層：敏感內容模式掃描

掃描**暫存區所有文字檔的內容**，偵測以下硬編碼（hardcoded）的敏感資訊：

| 偵測項目 | 範例模式 |
|----------|----------|
| AWS Access Key | `AKIA` 開頭的 20 字元字串 |
| API 金鑰賦值 | `api_key = "sk-xxx"` |
| 密碼賦值 | `password = "mypassword"` |
| Bearer Token | `Authorization: Bearer eyJ...` |
| GitHub Token | `ghp_` 開頭 |
| Google API Key | `AIza` 開頭 |
| Stripe 金鑰 | `sk_live_` / `pk_live_` 開頭 |
| JWT Token | 完整三段式 `eyJ...eyJ...xxx` |
| 私鑰內容 | `-----BEGIN PRIVATE KEY-----` |
| 資料庫連線字串 | `postgresql://user:password@host` |

### 正確做法：使用環境變數

```typescript
// ❌ 錯誤：直接在程式碼中硬編碼
const apiKey = "sk-abc123def456";

// ✅ 正確：從環境變數讀取
const apiKey = import.meta.env.API_KEY;
```

在 `.env` 中設定（不提交到 Git）：
```
API_KEY=sk-abc123def456
```

### 誤報處理

若掃描結果為誤報（例如測試用的假金鑰），可在提交時略過 Hook：

```powershell
# 謹慎使用，確認內容安全後再執行
git commit --no-verify -m "chore: 更新測試資料"
```

> **重要**：若敏感資訊已被提交至遠端倉庫，必須立即**輪換（rotate）所有金鑰**，光是刪除 commit 或推送是不夠的。
