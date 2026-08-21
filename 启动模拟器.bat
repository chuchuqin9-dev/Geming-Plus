@echo off
chcp 65001 >nul
title MOBA 对战模拟器
cd /d "%~dp0"

echo.
echo 正在启动MOBA模拟器...
echo 请稍候...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 启动失败：
  echo 请检查：
  echo   1. 项目文件是否完整
  echo   2. 是否安装必要运行环境（需要 Node.js，含 npm）
  echo   3. 是否参考开始使用说明
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，请稍候（可能需要几分钟）...
  call npm install
  if errorlevel 1 goto :error
)

echo 正在启动本地网页服务...
start "" cmd /k "title MOBA 服务 && npm run dev"

echo 启动成功，正在打开浏览器。
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173/"

echo.
echo 若浏览器未自动打开，请手动访问：http://localhost:5173/
echo 关闭服务器请直接关闭弹出的黑色窗口即可。
echo.
pause
exit /b 0

:error
echo.
echo 启动失败：
echo 请检查：
echo   1. 项目文件是否完整
echo   2. 是否安装必要运行环境
echo   3. 是否参考开始使用说明
echo.
pause
exit /b 1