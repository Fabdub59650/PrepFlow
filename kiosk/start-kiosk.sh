#!/bin/sh
# Lance Chromium en plein écran sur la page Atelier, et le relance s'il se ferme ou plante.
. "$(dirname "$0")/kiosk.conf"
CHROMIUM=$(command -v chromium || command -v chromium-browser)
if [ -z "$CHROMIUM" ]; then echo "Chromium introuvable : sudo apt install chromium" >&2; sleep 30; exit 1; fi

while true; do
  # Profil dans /tmp (en mémoire) : rien n'est écrit en continu sur la carte SD
  rm -rf /tmp/kiosk-profile
  "$CHROMIUM" \
    --kiosk --user-data-dir=/tmp/kiosk-profile --ozone-platform=x11 \
    --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \
    --disable-features=Translate --password-store=basic \
    --overscroll-history-navigation=0 --disable-pinch \
    --check-for-update-interval=31536000 \
    "$KIOSK_URL"
  sleep 3
done
