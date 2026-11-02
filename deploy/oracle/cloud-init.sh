#!/bin/bash
# Tributary public demo on an Oracle Cloud "Always Free" VM (Ampere A1, Ubuntu 24.04). Paste this file into
# "Show advanced options → Management → Initialization script" when creating the instance (docs/DEPLOY_ORACLE.md).
# It installs Docker, opens ports 80/443, builds the all-in-one demo image from GitHub main, and serves it over
# HTTPS at https://<public-ip-with-dashes>.sslip.io (a free wildcard DNS name; Caddy gets the certificate).
# Progress: sudo tail -f /var/log/tributary-setup.log
set -euo pipefail
exec > >(tee -a /var/log/tributary-setup.log) 2>&1

# --- settings (edit before pasting, or later in /etc/tributary.env) --------------------------------------------------
ADMIN_PASSWORD="change-me-$(openssl rand -hex 6)"   # password of the `admin` user (system administrator)
DOMAIN=""                                           # empty: <public-ip>.sslip.io; or your own name pointing at this VM
REF="main"                                          # git branch or tag to build (e.g. v2.0.0)

echo "[setup] packages and Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl iptables-persistent
curl -fsSL https://get.docker.com | sh

echo "[setup] firewall: allow 80 and 443 (Oracle's Ubuntu images reject everything else by default)"
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
netfilter-persistent save

if [ -z "$DOMAIN" ]; then
  IP=$(curl -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"
fi
cat > /etc/tributary.env <<ENV
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
TRIBUTARY_ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
chmod 600 /etc/tributary.env

echo "[setup] build the image from GitHub ($REF); about 20-30 minutes on the free VM"
curl -fsSL "https://raw.githubusercontent.com/sprinriver/Tributary/$REF/deploy/huggingface/Dockerfile" -o /tmp/Dockerfile
docker build --build-arg TRIBUTARY_REF="$REF" -t tributary -f /tmp/Dockerfile /tmp

echo "[setup] start Tributary (port 7860, local only) and Caddy (HTTPS on 80/443)"
docker network create tributary 2>/dev/null || true
docker run -d --name tributary --restart unless-stopped --network tributary --env-file /etc/tributary.env tributary
mkdir -p /etc/caddy
printf '%s {\n  reverse_proxy tributary:7860\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
docker run -d --name caddy --restart unless-stopped --network tributary -p 80:80 -p 443:443 \
  -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy-data:/data caddy:2.10.0-alpine

echo "[setup] done: open https://$DOMAIN in 2-3 minutes (admin password in /etc/tributary.env)"
