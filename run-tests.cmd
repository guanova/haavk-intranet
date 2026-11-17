@echo off
REM ==========================================================================
REM  run-tests.cmd — 一键运行全部自检
REM  1) 接口冒烟自检（68 项，真实 HTTP 请求 + 临时数据库，不污染线上数据）
REM  2) 端到端验收自检（完整业务闭环：注册→入职审批→点数→发帖→@审核→管理面板）
REM  3) 点数对账（流水合计必须等于余额合计）
REM ==========================================================================
setlocal
cd /d "%~dp0"

if "%HAAVK_ADMIN_PASSWORD%"=="" set HAAVK_ADMIN_PASSWORD=Haavk@Admin2026
if "%HAAVK_OFFICER_PASSWORD%"=="" set HAAVK_OFFICER_PASSWORD=Haavk@Officer2026

echo ============================================
echo [1/3] 接口冒烟自检
echo ============================================
node server\tools\smoke.js
if errorlevel 1 (
  echo.
  echo [失败] 接口冒烟自检未通过。
  exit /b 1
)

echo.
echo ============================================
echo [2/3] 端到端验收自检
echo ============================================
node tests\server\e2e.js
if errorlevel 1 (
  echo.
  echo [失败] 端到端验收未通过。
  exit /b 1
)

echo.
echo ============================================
echo [3/3] 点数对账
echo ============================================
if exist "data\haavk.db" (
  node server\tools\reconcile.js
) else (
  echo [跳过] 尚无运行数据库（data\haavk.db），先执行 start.cmd 启动一次服务。
)

echo.
echo 全部自检通过。
endlocal
