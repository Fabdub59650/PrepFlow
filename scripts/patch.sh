#!/bin/bash
# ── PrepFlow — Mise à jour depuis le dossier du dépôt ────────────
# Usage : sudo bash scripts/patch.sh   (après un git pull)
set -e
INSTALL_DIR="/opt/prepflow"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ "$EUID" -ne 0 ]; then echo "❌ À lancer avec sudo."; exit 1; fi
if [ ! -d "$INSTALL_DIR" ]; then
  echo "❌ PrepFlow non trouvé dans $INSTALL_DIR — utilisez install.sh."; exit 1
fi

ver() { python3 -c "import json;print(json.load(open('$1'))['version'])" 2>/dev/null || echo "?"; }
echo "  Version installée : $(ver "$INSTALL_DIR/backend/package.json")"
echo "  Nouvelle version  : $(ver "$PROJECT_DIR/backend/package.json")"
read -p "  Continuer ? [o/N] " confirm
[[ "$confirm" == "o" || "$confirm" == "O" ]] || { echo "  Annulé."; exit 0; }

RUN_USER=$(stat -c '%U' "$INSTALL_DIR/backend")
systemctl stop prepflow 2>/dev/null || true
rsync -a --delete --exclude 'node_modules' --exclude '.env' \
  "$PROJECT_DIR/backend/" "$INSTALL_DIR/backend/"
rsync -a --delete "$PROJECT_DIR/frontend/" "$INSTALL_DIR/frontend/"
rsync -a "$PROJECT_DIR/sql" "$PROJECT_DIR/scripts" "$INSTALL_DIR/"
chown -R "$RUN_USER:$RUN_USER" "$INSTALL_DIR"
sudo -u "$RUN_USER" bash -c "cd $INSTALL_DIR/backend && npm install --omit=dev --quiet"
DB_NAME=$(grep '^DB_NAME=' "$INSTALL_DIR/backend/.env" | cut -d'=' -f2 | tr -d '"')
mariadb --default-character-set=utf8mb4 "${DB_NAME:-prepflow}" < "$PROJECT_DIR/sql/schema.sql"
cp "$PROJECT_DIR/nginx/prepflow.conf" /etc/nginx/snippets/prepflow.conf
nginx -t 2>/dev/null && systemctl reload nginx
systemctl start prepflow
sleep 3
systemctl is-active --quiet prepflow && echo "  ✅ Mise à jour terminée" || echo "  ⚠ Vérifiez : sudo journalctl -u prepflow -n 30"
