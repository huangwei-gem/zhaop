@echo off
chcp 65001 > nul
echo =============================
echo   飞书招聘机器人
echo =============================
echo.
set APP_ID=cli_aab1ca3228f91cef
set APP_SECRET=BKSG0cWSaWrOpwFERaMQJg5mZnH2Kks3
set INTERVAL=30
echo [1/2] 正在启动...
cd /d "%~dp0"
echo [2/2] 监控已启动，关闭此窗口可停止
echo.
node src\index.js
pause