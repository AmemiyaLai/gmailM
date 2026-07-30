param(
    [int]$Port = 1008
)

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  正在啟動 Gmail 監控面板預覽服務" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "預覽連接埠設定為: $Port" -ForegroundColor Yellow
Write-Host "正在啟動開發伺服器..." -ForegroundColor Green
Write-Host ""

npx astro dev --host --port $Port
