@echo off
rem Windows: double-click to start Earshot. Windows 双击启动。
rem 如需移动安装位置，请把下面的路径改成 Earshot 文件夹所在位置。
set "EARSHOT_DIR=%~dp0"
cd /d "%EARSHOT_DIR%"
where node >nul 2>nul || (echo Please install Node.js first: https://nodejs.org & pause & exit /b 1)
if not exist .env node tools\setup.cjs
start "" http://localhost:8787
node server\index.js
pause
