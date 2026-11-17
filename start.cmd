@echo off
REM ==========================================================================
REM  start.cmd — 启动哈夫克内网（Node 原生 HTTP + SQLite，零第三方依赖）
REM  首次运行会自动建库、迁移并播种出厂数据（部门/岗位/板块/AI 高管/管理员）
REM ==========================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。本服务需要 Node.js 22.5 或更高版本。
  echo        下载地址：https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%a in ('node -p "process.versions.node"') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 22 (
  echo [错误] 当前 Node.js 版本过低（需要 22.5+，内置 node:sqlite）。
  node -v
  pause
  exit /b 1
)

if "%HAAVK_ADMIN_PASSWORD%"=="" set HAAVK_ADMIN_PASSWORD=Haavk@Admin2026
if "%HAAVK_OFFICER_PASSWORD%"=="" set HAAVK_OFFICER_PASSWORD=Haavk@Officer2026
if "%PORT%"=="" set PORT=8137

echo ============================================
echo  哈夫克内网 正在启动
echo  地址      http://127.0.0.1:%PORT%/
echo  管理面板  http://127.0.0.1:%PORT%/#/admin
echo  管理员    webops_admin / %HAAVK_ADMIN_PASSWORD%
echo ============================================
echo  关闭此窗口即停止服务。
echo.

node server\index.js
pause
