@echo off

chcp 65001 > nul

echo =============================

echo   飞书招聘机器人

echo =============================

echo.

:: 加载 .env 配置

if exist .env for /f "usebackq tokens=1,* delims==" %%a in (.env) do set "%%a=%%b"

set INTERVAL=30

echo [1/2] 正在启动...

cd /d "%~dp0"

echo [2/2] 监控已启动，关闭此窗口可停止

echo.

node src\index.js

pause

