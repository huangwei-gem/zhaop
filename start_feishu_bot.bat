@echo off
chcp 65001 > nul
echo =============================
echo   Feishu Recruitment Bot
echo =============================
echo.
cd /d C:\Users\35796\Downloads\飞书机器人
set APP_ID=cli_aab1ca3228f91cef
set APP_SECRET=BKSG0cWSaWrOpwFERaMQJg5mZnH2Kks3
set INTERVAL=30
echo [1/2] Starting...
echo [2/2] Close this window to stop
echo.
node src\index.js
pause