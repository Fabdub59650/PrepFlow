#!/bin/sh
# Règle l'extinction de l'écran selon l'heure : nuit (éteint, réveil au toucher) et jour (extinction longue).
# Lancé par ~/.xinitrc. Tout passe par DPMS : un toucher sur l'écran le rallume.
. "$(dirname "$0")/kiosk.conf"
export DISPLAY=:0

mode_now() {
  h=$(date +%H); h=${h#0}; [ -z "$h" ] && h=0
  if [ "$NIGHT_FROM" -gt "$NIGHT_TO" ]; then
    if [ "$h" -ge "$NIGHT_FROM" ] || [ "$h" -lt "$NIGHT_TO" ]; then echo night; else echo day; fi
  else
    if [ "$h" -ge "$NIGHT_FROM" ] && [ "$h" -lt "$NIGHT_TO" ]; then echo night; else echo day; fi
  fi
}

last=""
while true; do
  mode=$(mode_now)
  if [ "$mode" != "$last" ]; then
    xset s off
    if [ "$mode" = night ]; then
      xset +dpms; xset dpms 0 0 "$NIGHT_OFF_AFTER"
      xset dpms force off
    else
      if [ "$DAY_OFF_AFTER" -gt 0 ]; then xset +dpms; xset dpms 0 0 "$DAY_OFF_AFTER"; else xset -dpms; fi
      xset dpms force on
    fi
    last=$mode
  fi
  sleep 30
done
