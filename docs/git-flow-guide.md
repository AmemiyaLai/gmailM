# Git Flow 工作流程指南

## 分支架構

```
main
└── develop
    ├── feature/user-auth
    ├── feature/payment
    └── hotfix/critical-bug
```

| 分支 | 說明 | 允許直接 push |
|------|------|--------------|
| `main` | 正式版本，對應線上環境 | ❌（僅 PR） |
| `develop` | 開發主線，功能整合測試 | ❌（僅 PR） |
| `feature/*` | 單一功能開發 | ✅ |
| `hotfix/*` | 緊急修補（從 main 分支出） | ✅ |
| `release/*` | 版本發布準備 | ✅ |

---

## Commit 訊息規範（Conventional Commits）

格式：`<type>(<scope>): <description>`

### 允許的 type

| type | 說明 | 範例 |
|------|------|------|
| `feat` | 新功能 | `feat: 新增使用者登入功能` |
| `fix` | 錯誤修復 | `fix(auth): 修復 JWT token 過期問題` |
| `docs` | 文件變更 | `docs: 更新 README 安裝說明` |
| `style` | 格式調整（不影響邏輯） | `style: 調整縮排格式` |
| `refactor` | 重構 | `refactor(api): 簡化請求處理邏輯` |
| `perf` | 效能優化 | `perf: 使用虛擬列表優化長清單` |
| `test` | 測試相關 | `test: 新增登入流程測試` |
| `chore` | 雜務 | `chore: 更新依賴版本` |
| `ci` | CI/CD 配置 | `ci: 新增 GitHub Actions 工作流` |
| `build` | 建置系統 | `build: 升級 Astro 至 v7` |
| `revert` | 還原 commit | `revert: 還原 feat: 新增購物車` |

### 破壞性變更

在 type 後加 `!` 表示破壞性變更：

```
feat!: 重構 API 路由結構
```

---

## 標準開發流程

### 開發新功能

```powershell
# 1. 確保 develop 是最新狀態
git checkout develop
git pull origin develop

# 2. 建立功能分支
git checkout -b feature/your-feature-name

# 3. 開發並提交
git add .
git commit -m "feat: 你的功能描述"

# 4. 推送功能分支
git push origin feature/your-feature-name

# 5. 在 GitHub/GitLab 建立 PR，目標為 develop
```

### 修復緊急 Bug（Hotfix）

```powershell
# 1. 從 main 分支出
git checkout main
git pull origin main
git checkout -b hotfix/bug-description

# 2. 修復並提交
git add .
git commit -m "fix: 修復描述"

# 3. 推送並建立 PR，目標為 main
# 4. 合併後，也要將修復合併回 develop
git checkout develop
git merge hotfix/bug-description
```

### 版本發布（Release）

```powershell
# 1. 從 develop 建立 release 分支
git checkout develop
git checkout -b release/v1.0.0

# 2. 修改版本號、CHANGELOG 等
git commit -m "chore: release v1.0.0"

# 3. 建立 PR 合併至 main（並打 Tag）
# 4. 同步合併回 develop
```

---

## Git Hooks 說明

### `commit-msg`（全域）

- **位置**：`~/.git_template/hooks/commit-msg`
- **作用**：驗證每次 commit 訊息是否符合 Conventional Commits 格式
- **略過方式**（不建議）：`git commit --no-verify -m "訊息"`

### `pre-push`（全域）

- **位置**：`~/.git_template/hooks/pre-push`
- **作用**：當你嘗試直接 push 到 `main` 或 `develop` 時發出警告
- **強制 push**（謹慎使用）：`git push --no-verify`

---

## GitHub 分支保護設定

推送到 GitHub 後，請設定以下保護規則：

### main 分支

- Settings → Branches → Add rule → `main`
- ✅ Require a pull request before merging
- ✅ Require approvals (建議 1 人以上)
- ✅ Require status checks to pass before merging（有 CI/CD 時）
- ✅ Do not allow bypassing the above settings

### develop 分支

- 再新增一條規則 → `develop`
- ✅ Require a pull request before merging
- ✅ Require approvals (可設 0 人，允許自己 merge)

---

## 常用 Git 指令快速參考

```powershell
# 查看所有分支
git branch -a

# 刪除本地已合併的功能分支
git branch -d feature/your-feature-name

# 刪除遠端功能分支
git push origin --delete feature/your-feature-name

# 同步 develop 的最新變更到功能分支
git checkout feature/your-feature
git rebase develop

# 查看 commit 圖形化歷史
git log --oneline --graph --all
```
