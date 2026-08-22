@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title MOBA 对战模拟器 - 开发环境
cd /d "%~dp0"

echo ============================================
echo   MOBA 对战模拟器 - 本地开发环境
echo   （代码改动保存后页面自动热更新 HMR）
echo ============================================
echo.

:: ---------- 1) 检查运行环境 ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [操作失败] 未检测到 Node.js 运行环境。
  echo   请先安装 Node.js LTS：https://nodejs.org/  ，安装后重新双击本文件。
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo [OK] Node.js: %NODE_VER%

:: ---------- 2) 安装 / 校验依赖 ----------
if not exist node_modules (
  echo.
  echo [安装] 首次运行，正在自动安装依赖（需要几分钟）...
  call npm install
  if errorlevel 1 goto :installdep_error
  echo [OK] 依赖安装完成。
) else (
  echo [OK] 依赖已就绪。
)

:: ---------- 3) 启动开发服务（新窗口，保留日志输出）----------
echo.
echo [启动] 正在启动前端开发服务（http://localhost:5173/）...
echo [提示] 开发日志与热更新信息显示在黑色服务窗口里。
echo.
start "MOBA开发服务" cmd /k "title MOBA 开发服务 && npm run dev"

:: ---------- 4) 等待服务就绪并打开浏览器 ----------
set "FOUND="
for /L %%p in (5173,1,5180) do (
  for /f "usebackq delims=" %%c in (`powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%%p/' -TimeoutSec 1).StatusCode } catch { 0 }"`) do set "STATUS=%%c"
  if "!STATUS!"=="200" (
    set "PORT=%%p"
    set "FOUND=1"
    goto :found
  )
)

:found
if defined FOUND (
  echo [OK] 服务已就绪！
  echo   前端访问地址:  http://localhost:!PORT!/
  echo [打开] 正在打开浏览器...
  start "" "http://localhost:!PORT!/"
) else (
  echo [提示] 暂未检测到服务就绪，请稍后手动访问：http://localhost:5173/
)

echo.
echo ------------------------------------------------------------
echo  开发模式说明：
echo   - 修改 src/ 下代码并保存，浏览器会自动热更新，无需重启。
echo   - 控制台与网络日志请打开浏览器开发者工具（F12）查看。
echo   - 关闭服务：关闭黑色“MOBA开发服务”窗口。
echo ------------------------------------------------------------
echo.
pause
exit /b 0

:installdep_error
echo.
echo [失败] 依赖安装失败，请检查网络后重试。
echo.
pause
exit /b 1