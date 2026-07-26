@echo off
chcp 65001 > nul
title 網頁預覽服務

echo ===================================
echo   正在啟動 Gmail 監控面板預覽服務
echo ===================================
echo.

set PORT=%1
if "%PORT%"=="" (
    set PORT=1008
)

echo 預覽連接埠設定為: %PORT%
echo 正在啟動開發伺服器...
echo.

call npx astro dev --host --port %PORT%

pause
