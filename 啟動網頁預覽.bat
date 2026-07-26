@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
  echo 找不到 node_modules，請先執行 npm install。
  pause
  exit /b 1
)

echo 正在啟動 Astro 開發伺服器...
call npx astro dev --background

if errorlevel 1 (
  echo Astro 開發伺服器啟動失敗。
  pause
  exit /b 1
)

timeout /t 3 /nobreak >nul
start "" "http://localhost:4321"

echo 網頁預覽已開啟：http://localhost:4321
echo 可使用「astro dev status」查看伺服器狀態。
echo 可使用「astro dev stop」停止伺服器。
exit /b 0
