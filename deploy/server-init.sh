#!/bin/bash
# 首次在新服务器上运行：安装 Node.js、Nginx、PM2，并克隆代码
# 用法: bash deploy/server-init.sh

set -e

APP_DIR="/opt/dispatch-system"
REPO="git@github.com:mashevictor/sanxi.git"

echo "==> 更新系统包..."
apt update && apt upgrade -y

echo "==> 安装 Git、Nginx、curl..."
apt install -y git nginx curl

if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  echo "==> 安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

if ! command -v pm2 &>/dev/null; then
  echo "==> 安装 PM2..."
  npm install -g pm2
fi

echo "==> Node $(node -v) / npm $(npm -v)"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> 克隆代码到 $APP_DIR ..."
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO" "$APP_DIR"
else
  echo "==> 代码目录已存在: $APP_DIR"
fi

echo ""
echo "初始化完成。接下来："
echo "  1. 上传 Excel 数据和 .env 到 $APP_DIR"
echo "  2. cd $APP_DIR && bash deploy/deploy.sh"
