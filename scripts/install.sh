#!/bin/bash
# ── PrepFlow — Installation sur le Pi (à côté de FilaFlow) ─────────
# Usage : sudo bash scripts/install.sh
# Rejouable : conserve le .env (mot de passe base) et les données.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

INSTALL_DIR="/opt/prepflow"
DB_NAME="prepflow"
DB_USER="prepflow"
PORT=3001
RUN_USER="${SUDO_USER:-pi}"
NGINX_SITE="/etc/nginx/sites-available/filaflow"
VERSION=$(python3 -c "import json;print(json.load(open('${PROJECT_DIR}/backend/package.json'))['version'])" 2>/dev/null || echo "?")

if [ "$EUID" -ne 0 ]; then echo "❌ À lancer avec sudo."; exit 1; fi

echo "========================================"
echo "  PrepFlow v${VERSION} — Installation"
echo "========================================"
echo "  Dossier projet : ${PROJECT_DIR}"
echo "  Service lancé en tant que : ${RUN_USER}"
echo ""

# ── 1. Prérequis (déjà présents avec FilaFlow) ─────────────────
echo "[1/6] Prérequis..."
for cmd in node npm mariadb nginx rsync openssl python3 curl; do
  command -v "$cmd" >/dev/null || { echo "  ❌ '$cmd' introuvable. Installez-le avant de continuer."; exit 1; }
done
NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then echo "  ❌ Node.js 18+ requis (actuel : $(node --version))."; exit 1; fi
id "$RUN_USER" >/dev/null 2>&1 || { echo "  ❌ Utilisateur '$RUN_USER' inexistant."; exit 1; }
if ss -ltn 2>/dev/null | grep -q ":${PORT} " && ! systemctl is-active --quiet prepflow; then
  echo "  ❌ Le port ${PORT} est déjà utilisé par un autre service :"; ss -ltnp | grep ":${PORT} "; exit 1
fi
echo "  ✓ Node.js $(node --version), MariaDB, Nginx présents"

# ── 2. Base de données ─────────────────────────────────────────
echo "[2/6] Base de données..."
ENV_FILE="${INSTALL_DIR}/backend/.env"
if [ -f "$ENV_FILE" ] && grep -q '^DB_PASSWORD=' "$ENV_FILE"; then
  DB_PASS=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
  echo "  ✓ Mot de passe existant conservé (.env)"
else
  DB_PASS=$(openssl rand -hex 16)
  echo "  ✓ Nouveau mot de passe généré"
fi
systemctl is-active --quiet mariadb || systemctl start mariadb
mariadb -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mariadb -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mariadb -e "ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mariadb -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
# Accès depuis Adminer : droits pour l'utilisateur pi, quel que soit son hôte
PI_HOSTS=$(mariadb -N -e "SELECT Host FROM mysql.user WHERE User='pi'")
if [ -n "$PI_HOSTS" ]; then
  for h in $PI_HOSTS; do
    mariadb -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO 'pi'@'${h}';"
  done
  echo "  ✓ Base visible dans Adminer (utilisateur pi@$(echo $PI_HOSTS | tr ' ' ','))"
else
  echo "  (pas d'utilisateur MariaDB 'pi' : droits Adminer non accordés)"
fi
mariadb -e "FLUSH PRIVILEGES;"
mariadb --default-character-set=utf8mb4 ${DB_NAME} < "${PROJECT_DIR}/sql/schema.sql"
echo "  ✓ Base '${DB_NAME}' prête (schéma idempotent)"

# ── 3. Fichiers ────────────────────────────────────────────────
echo "[3/6] Copie des fichiers dans ${INSTALL_DIR}..."
mkdir -p ${INSTALL_DIR}
rsync -a --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  "${PROJECT_DIR}/backend" "${PROJECT_DIR}/frontend" "${PROJECT_DIR}/sql" "${PROJECT_DIR}/scripts" \
  ${INSTALL_DIR}/
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << ENVEOF
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
PORT=${PORT}
HOST=127.0.0.1
NODE_ENV=production
ENVEOF
  echo "  ✓ .env créé"
else
  echo "  ✓ .env existant conservé"
fi
chown -R "${RUN_USER}:${RUN_USER}" ${INSTALL_DIR}
chmod 600 "$ENV_FILE"

# ── 4. Modules Node.js ─────────────────────────────────────────
echo "[4/6] Modules Node.js..."
sudo -u "${RUN_USER}" bash -c "cd ${INSTALL_DIR}/backend && npm install --omit=dev --quiet"
echo "  ✓ Modules installés"

# ── 5. Service systemd ─────────────────────────────────────────
echo "[5/6] Service systemd..."
sed "s/__USER__/${RUN_USER}/" "${PROJECT_DIR}/systemd/prepflow.service" > /etc/systemd/system/prepflow.service
systemctl daemon-reload
systemctl enable prepflow --quiet
systemctl restart prepflow
sleep 3
if ! systemctl is-active --quiet prepflow; then
  echo "  ❌ Le service n'a pas démarré : sudo journalctl -u prepflow -n 50"; exit 1
fi
if curl -sf "http://127.0.0.1:${PORT}/api/meta" >/dev/null; then
  echo "  ✓ Service actif, API joignable sur 127.0.0.1:${PORT}"
else
  echo "  ⚠ Service actif mais l'API ne répond pas encore : sudo journalctl -u prepflow -n 50"
fi

# ── 6. Nginx : /prepflow/ dans la configuration de FilaFlow ─────
echo "[6/6] Nginx..."
cp "${PROJECT_DIR}/nginx/prepflow.conf" /etc/nginx/snippets/prepflow.conf
if [ ! -f "$NGINX_SITE" ]; then
  echo "  ⚠ ${NGINX_SITE} introuvable. Ajoutez à la main, dans le bloc server HTTPS :"
  echo "      include snippets/prepflow.conf;"
else
  BACKUP="${NGINX_SITE}.bak-prepflow-$(date +%Y%m%d-%H%M%S)"
  cp "$NGINX_SITE" "$BACKUP"
  set +e
  python3 "${SCRIPT_DIR}/nginx_include.py" "$NGINX_SITE"
  RC=$?
  set -e
  case $RC in
    0) ;;
    2) echo "  ✓ include déjà présent"; rm -f "$BACKUP" ;;
    3) echo "  ⚠ Aucun bloc « location / » trouvé dans ${NGINX_SITE}."
       echo "    Ajoutez à la main dans le bloc server HTTPS : include snippets/prepflow.conf;"
       rm -f "$BACKUP" ;;
    *) echo "  ❌ Échec de la modification de ${NGINX_SITE}"; cp "$BACKUP" "$NGINX_SITE"; exit 1 ;;
  esac
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "  ✓ Nginx rechargé"
    [ -f "$BACKUP" ] && echo "  (copie de l'ancienne configuration : ${BACKUP})"
  else
    echo "  ❌ Configuration Nginx invalide, retour à l'état précédent :"
    nginx -t || true
    [ -f "$BACKUP" ] && cp "$BACKUP" "$NGINX_SITE"
    nginx -t 2>/dev/null && systemctl reload nginx
    exit 1
  fi
fi

echo ""
echo "========================================"
echo "  ✅ PrepFlow v${VERSION} installé et démarré"
echo "========================================"
echo "  Accès : https://$(hostname).local/prepflow/"
echo "  Logs  : sudo journalctl -u prepflow -f"
echo ""
