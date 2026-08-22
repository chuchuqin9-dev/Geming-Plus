@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title MOBA 对战模拟器 - 一键启动
cd /d "%~dp0"

echo ============================================
echo   MOBA 对战模拟器 一键启动
echo ============================================
echo.

:: ============ 1) 检查运行环境 ============
where node >nul 2>nul
if errorlevel 1 (
  echo [操作失败] 未检测到 Node.js 运行环境。
  echo.
  echo 本项目需要先安装 Node.js（含 npm 包管理器）。
  echo 请到官网下载 LTS 稳定版并安装后，再双击本文件：
  echo     https://nodejs.org/
  echo.
  echo 安装完 Node.js 后无需做任何其他配置。
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo [OK] 检测到 Node.js: %NODE_VER%

:: ============ 2) 自动安装缺失依赖 ============
if not exist node_modules (
  echo.
  echo [安装] 首次运行，正在自动安装依赖（可能需要几分钟，请勿关闭窗口）...
  call npm install
  if errorlevel 1 goto :installdep_error
  echo [OK] 依赖安装完成。
) else (
  echo [OK] 依赖已就绪。
)

:: ============ 3) 启动本地服务 ============
echo.
echo [启动] 正在启动本地网页服务...
start "MOBA模拟器服务" cmd /k "title MOBA 模拟器服务 && npm run dev"

echo [启动] 服务窗口已打开，正在等待服务就绪...
echo.

:: ============ 4) 等待服务就绪并自动打开浏览器 ============
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
  echo [成功] 服务已就绪！
  echo.
  echo   访问地址:   http://localhost:!PORT!/
  echo.
  echo 正在自动打开浏览器...
  start "" "http://localhost:!PORT!/"
) else (
  echo [提示] 暂未检测到服务就绪，请稍后手动访问：
  echo         http://localhost:5173/
  echo        （若 5173 被占用，Vite 会自动改用其他端口，请查看黑色服务窗口中的实际地址）
)

echo.
echo ------------------------------------------------------------
echo  使用说明：
echo    - 想停止服务：直接关闭弹出的黑色“MOBA模拟器服务”窗口。
echo    - 想再次打开：再次双击本文件即可。
echo    - 数据自动保存在浏览器本地，重启后仍会保留。
echo ------------------------------------------------------------
echo.
pause
exit /b 0

:installdep_error
echo.
echo [失败] 依赖自动安装失败。
echo.
echo 请检查：
echo    1. 网络连接是否正常；
echo    2. 是否安装 Node.js（https://nodejs.org/）；
echo 可稍后重新双击本文件重试，或参见 README.md 的「常见问题」。
echo.
pause
exit /b 1