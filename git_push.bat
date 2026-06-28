@echo off
chcp 65001 > nul
echo =============================
echo   Git Push to GitHub
echo =============================
echo.
cd /d C:\Users\35796\Downloads\飞书机器人
set /p msg=Enter commit message: 
if "%msg%"=="" set msg=update
git add .
git commit -m "%msg%"
git push
echo.
echo Done! Press any key to exit.
pause