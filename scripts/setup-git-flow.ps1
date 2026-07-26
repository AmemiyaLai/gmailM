<#
.SYNOPSIS
    從此 Astro 範本初始化一個新專案的 Git Flow 結構。

.DESCRIPTION
    此腳本設計用於「將此範本複製到新專案後，一次性執行」。
    執行後將會：
    1. 初始化 Git 倉庫（套用全域範本，含 commit-msg hook）
    2. 設定 Git 本機設定
    3. 建立初始 commit（chore: initial commit）
    4. 建立 develop 分支
    5. 顯示下一步操作指引

.PARAMETER ProjectName
    專案名稱（會寫入 README.md 標題），預設使用目前資料夾名稱。

.PARAMETER RemoteUrl
    遠端倉庫 URL（選填），若提供則自動設定 origin remote。

.EXAMPLE
    .\scripts\setup-git-flow.ps1

.EXAMPLE
    .\scripts\setup-git-flow.ps1 -ProjectName "my-project" -RemoteUrl "https://github.com/user/repo.git"
#>

param(
    [string]$ProjectName = (Split-Path -Leaf (Get-Location)),
    [string]$RemoteUrl = ""
)

# 顏色輸出工具
function Write-Step {
    param([string]$Message)
    Write-Host "  ▶ $Message" -ForegroundColor Cyan
}
function Write-Done {
    param([string]$Message)
    Write-Host "  ✔ $Message" -ForegroundColor Green
}
function Write-Info {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor Gray
}
function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "  $Message" -ForegroundColor White
    Write-Host "  $("─" * $Message.Length)" -ForegroundColor DarkGray
}

# ─── 開始執行 ───
Write-Host ""
Write-Host "  ══════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "   Git Flow 初始化腳本" -ForegroundColor Cyan
Write-Host "   專案：$ProjectName" -ForegroundColor Cyan
Write-Host "  ══════════════════════════════════════" -ForegroundColor DarkCyan

# 1. 檢查是否已是 Git 倉庫
Write-Header "Step 1：初始化 Git 倉庫"
if (Test-Path ".git") {
    Write-Host "  ⚠️  .git 目錄已存在，跳過 git init。" -ForegroundColor Yellow
} else {
    Write-Step "執行 git init -b main"
    git init -b main
    Write-Done "Git 倉庫初始化完成（main 分支）"
}

# 2. 更新 README.md
Write-Header "Step 2：設定 README.md"
Write-Step "寫入專案標題至 README.md"
$readmeContent = @"
# $ProjectName

> 使用 [Astro 基礎範本](https://github.com/) 建立的專案。

## 開發指令

| 指令 | 說明 |
|------|------|
| ``npm run dev`` | 啟動開發伺服器（http://localhost:4321） |
| ``npm run build`` | 建置正式版本 |
| ``npm run preview`` | 預覽建置結果 |

## Git Flow 工作流程

\`\`\`
main        ← 正式版本（保護分支）
└── develop ← 開發主線
    └── feature/xxx ← 功能開發
\`\`\`

請參考 ``docs/git-flow-guide.md`` 了解完整工作流程。
"@
$readmeContent | Out-File -FilePath "README.md" -Encoding utf8
Write-Done "README.md 已更新"

# 3. 初始 commit
Write-Header "Step 3：建立初始 Commit"
Write-Step "git add . && git commit"
git add .
git commit -m "chore: initial commit from astro template"
if ($LASTEXITCODE -eq 0) {
    Write-Done "初始 commit 建立成功"
} else {
    Write-Host "  ❌ Commit 失敗，請檢查 commit-msg hook 是否正確安裝。" -ForegroundColor Red
    exit 1
}

# 4. 建立 develop 分支
Write-Header "Step 4：建立分支結構"
Write-Step "建立 develop 分支"
git checkout -b develop
Write-Done "develop 分支建立完成"

# 5. 設定 Remote（選填）
if ($RemoteUrl -ne "") {
    Write-Header "Step 5：設定遠端倉庫"
    Write-Step "git remote add origin $RemoteUrl"
    git remote add origin $RemoteUrl
    Write-Done "遠端倉庫設定完成"
}

# 6. 完成訊息
Write-Host ""
Write-Host "  ══════════════════════════════════════" -ForegroundColor DarkGreen
Write-Host "   ✅ Git Flow 初始化完成！" -ForegroundColor Green
Write-Host "  ══════════════════════════════════════" -ForegroundColor DarkGreen
Write-Host ""
Write-Host "  目前分支：develop" -ForegroundColor Yellow
Write-Host ""
Write-Host "  下一步：" -ForegroundColor Cyan
Write-Host "    1. 安裝依賴：npm install" -ForegroundColor White
Write-Host "    2. 啟動開發伺服器：npm run dev" -ForegroundColor White
Write-Host "    3. 開發新功能：git checkout -b feature/功能名稱" -ForegroundColor White
if ($RemoteUrl -eq "") {
    Write-Host "    4. 設定遠端倉庫（之後再執行）：" -ForegroundColor White
    Write-Host "       git remote add origin <遠端倉庫 URL>" -ForegroundColor Gray
}
Write-Host ""
