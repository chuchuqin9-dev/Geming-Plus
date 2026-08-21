#!/usr/bin/env bash
# 双击（或 ./启动模拟器.sh）一键启动 MOBA 对战模拟器（macOS / Linux）
cd "$(dirname "$0")" || exit 1

echo ""
echo "正在启动MOBA模拟器..."
echo "请稍候..."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "启动失败："
  echo "请检查："
  echo "  1. 项目文件是否完整"
  echo "  2. 是否安装必要运行环境（需要 Node.js，含 npm）"
  echo "  3. 是否参考开始使用说明"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖，请稍候（可能需要几分钟）..."
  npm install || { echo "启动失败：依赖安装失败，请参考开始使用说明"; exit 1; }
fi

echo "正在启动本地网页服务..."
npm run dev >/dev/null 2>&1 &
sleep 4

echo "启动成功，正在打开浏览器。"
if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173/"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173/"
else
  echo "若浏览器未自动打开，请手动访问：http://localhost:5173/"
fi

echo ""
echo "若浏览器未自动打开，请手动访问：http://localhost:5173/"
echo "关闭服务器请关闭该终端窗口。"
exit 0