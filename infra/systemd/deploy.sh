#!/bin/bash
# deploy.sh — Install and start the Unified Platform on a fresh Ubuntu/Debian server
# Run as root or with sudo

set -e

APP_DIR="/opt/unified-platform"
SERVICE="unified-platform"
PYTHON="python3.11"

echo "=== Unified Platform Deployment Script ==="

# 1. System dependencies
echo "[1/6] Installing system packages..."
apt-get update -q
apt-get install -y -q python3.11 python3.11-venv python3-pip tesseract-ocr tesseract-ocr-hin nginx curl

# 2. App directory
echo "[2/6] Setting up app directory at $APP_DIR..."
mkdir -p $APP_DIR
cp -r . $APP_DIR/
chown -R www-data:www-data $APP_DIR

# 3. Python venv + deps
echo "[3/6] Creating virtualenv and installing requirements..."
sudo -u www-data $PYTHON -m venv $APP_DIR/venv
sudo -u www-data $APP_DIR/venv/bin/pip install -q --upgrade pip
sudo -u www-data $APP_DIR/venv/bin/pip install -q -r $APP_DIR/backend/requirements.txt

# 4. .env check
if [ ! -f "$APP_DIR/.env" ]; then
    echo "[!] .env not found — copying from .env.example"
    cp $APP_DIR/.env.example $APP_DIR/.env
    echo "[!] EDIT $APP_DIR/.env before starting the service!"
fi

# 5. systemd service
echo "[4/6] Installing systemd service..."
cp $APP_DIR/systemd/unified-platform.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE

# 6. Nginx config
echo "[5/6] Installing Nginx config..."
cp $APP_DIR/nginx.conf /etc/nginx/sites-available/unified-platform
ln -sf /etc/nginx/sites-available/unified-platform /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

echo "[6/6] Starting service..."
systemctl start $SERVICE
sleep 3
systemctl status $SERVICE --no-pager

echo ""
echo "=== Deployment complete ==="
echo "API:   http://$(hostname -I | awk '{print $1}'):8080/health"
echo "Admin: http://$(hostname -I | awk '{print $1}'):8080/admin/"
echo ""
echo "Edit .env and restart: systemctl restart $SERVICE"
