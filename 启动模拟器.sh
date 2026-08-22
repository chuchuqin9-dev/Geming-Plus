#!/usr/bin/env bash
# MOBA 对战模拟器 一键启动（macOS / Linux）
# 双击或执行：./启动模拟器.sh

cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  MOBA 对战模拟器 一键启动"
echo "============================================"
echo ""

# 1) 检查运行环境
if ! command -v node >/dev/null 2>&1; then
  echo "[操作失败] 未检测到 Node.js 运行环境。"
  echo ""
  echo "本项目需要先安装 Node.js（LTS 版），下载地址："
  echo "    https://nodejs.org/"
  echo ""
  exit 1
fi
echo "[OK] 检测到 Node.js: $(node -v)"

# 2) 自动安装缺失依赖
if [ ! -d node_modules ]; then
  echo ""
  echo "[安装] 首次运行，正在自动安装依赖（可能需要几分钟）..."
  npm install || { echo "[失败] 依赖安装失败，请检查网络后重试。"; exit 1; }
  echo "[OK] 依赖安装完成。"
else
  echo "[OK] 依赖已就绪。"
fi

# 3) 启动本地服务（后台）
echo ""
echo "[启动] 正在启动本地网页服务..."
npm run dev >/dev/null 2>&1 &
DEV_PID=$!

# 4) 等待服务就绪，自动打开浏览器
FOUND=""
for p in $(seq 5173 5180); do
  if curl -s -o /dev/null --max-time 1 -w "%{http_code}" "http://localhost:$p/" 2>/dev/null | grep -q 200; then
    FOUND=1
    PORT=$p
    break
  fi
  sleep 1
done

if [ -n "$FOUND" ]; then
  echo "[成功] 服务已就绪！"
  echo ""
  echo "  访问地址:  http://localhost:$PORT/"
  echo ""
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT/"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT/"
  else
    echo "请手动在浏览器打开上面的地址。"
  fi
else
  echo "[提示] 暂未检测到服务就绪，请稍后手动访问："
  echo "       http://localhost:5173/"
fi
echo ""
echo "想停止服务：关闭后台进程即可（或 Ctrl+C 终端）。"
echo "数据自动保存在浏览器本地。"
echo ""
echo "（本窗口可保持打开，服务在后台运行。）"
wait $DEV_PID 2>/dev/null
exit 0