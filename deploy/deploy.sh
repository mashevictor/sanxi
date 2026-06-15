#!/bin/bash
# 派单系统一键部署（在服务器项目根目录执行）
# 用法:
#   cd /opt/dispatch-system
#   bash deploy/deploy.sh

set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "=========================================="
echo "  派单系统部署"
echo "  目录: $APP_DIR"
echo "=========================================="

# ---------- .env ----------
if [ ! -f .env ]; then
  echo "==> 未找到 .env，从 .env.example 复制..."
  cp .env.example .env
  echo "    请编辑 .env 填入 DEEPSEEK_API_KEY（可选）: nano .env"
else
  echo "==> .env 已存在"
fi
chmod 600 .env 2>/dev/null || true

# ---------- Excel 数据检查 ----------
MISSING=0
for f in "园区数据.xlsx" "首访数据.xlsx" "项目数据.xlsx" "回访数据.xlsx" "派单员工表 (1).xls"; do
  if [ ! -f "$f" ]; then
    echo "!! 缺少数据文件: $f"
    MISSING=1
  fi
done
if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "警告: Excel 数据未齐全，页面只能加载「演示」数据。"
  echo "请从本机 scp 上传到 $APP_DIR"
  echo '  scp *.xlsx "派单员工表 (1).xls" root@101.32.209.251:/opt/dispatch-system/'
  echo ""
fi

# ---------- 构建 ----------
echo "==> 安装依赖..."
npm install

echo "==> 编译 TypeScript..."
npm run build

echo "==> 生成首屏缓存..."
npm run cache:sample-data

if [ ! -f dist/server.js ]; then
  echo "错误: dist/server.js 未生成，构建失败"
  exit 1
fi

# ---------- PM2 ----------
echo "==> 启动 / 重启 PM2..."
if pm2 describe dispatch-system &>/dev/null; then
  pm2 restart ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

# 提示配置开机自启（仅首次需要手动执行 pm2 startup 输出的命令）
if ! systemctl is-enabled pm2-root &>/dev/null 2>&1; then
  echo "    首次部署请执行: pm2 startup  （然后运行它输出的 sudo 命令）"
fi

# ---------- Nginx ----------
echo "==> 配置 Nginx..."
cp deploy/nginx/dispatch.conf /etc/nginx/sites-available/dispatch
ln -sf /etc/nginx/sites-available/dispatch /etc/nginx/sites-enabled/dispatch

# 移除默认站点，避免占用 80 端口
if [ -f /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
  echo "    已移除 Nginx 默认站点"
fi

nginx -t
systemctl enable nginx
systemctl reload nginx

echo ""
echo "=========================================="
echo "  部署完成"
echo "=========================================="
echo "  派单看板:  http://101.32.209.251/match.html"
echo "  Excel派单: http://101.32.209.251/"
echo "  部署文档:  http://101.32.209.251/docs/deploy-guide.html"
echo ""
echo "  常用命令:"
echo "    pm2 status"
echo "    pm2 logs dispatch-system"
echo "    pm2 restart dispatch-system"
echo "=========================================="
