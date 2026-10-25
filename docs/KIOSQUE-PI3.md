# Kiosque Atelier — Raspberry Pi 3B+ et écran Waveshare 7" (1024×600)

Le Pi 3 affiche la page **Atelier** de PrepFlow (`https://filaflow.local/prepflow/atelier.html`) en plein écran.
La page Atelier n'a volontairement pas de lien dans le menu de PrepFlow : on n'y arrive que par son adresse.
Il ne fait que de l'affichage : tout tourne sur le Pi 4 de FilaFlow/PrepFlow. Si le Pi 3 tombe, rien n'est perdu.

## Matériel

- Pi 3B+, alimentation 5 V / 3 A (une alimentation faible provoque des redémarrages et un écran qui scintille).
- Écran Waveshare 7" 1024×600 : HDMI pour l'image, **USB pour le tactile** (les deux câbles sont nécessaires).
- Câble Ethernet vers la box, IP fixe.

## 1. Système

1. Avec Raspberry Pi Imager : **Raspberry Pi OS Lite (64 bits)**, nom `atelier`, utilisateur `pi`, SSH activé, clé ou mot de passe, fuseau Europe/Paris.
2. Premier démarrage, connexion en SSH (`ssh pi@atelier.local`), puis :

```
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y --no-install-recommends xserver-xorg xinit x11-xserver-utils openbox unclutter chromium libnss3-tools
```

(Si le paquet `chromium` n'existe pas sous ce nom, essayer `chromium-browser`.)

## 2. IP fixe sur l'Ethernet

Adapter les adresses à la box (passerelle = adresse de la box) :

```
nmcli con show                       # nom de la connexion filaire, ex. « Wired connection 1 »
sudo nmcli con mod "Wired connection 1" ipv4.method manual \
  ipv4.addresses 192.168.1.141/24 ipv4.gateway 192.168.1.1 ipv4.dns "192.168.1.1"
sudo nmcli con up "Wired connection 1"
```

Réserver aussi 192.168.1.141 hors de la plage DHCP de la box.

## 3. Accès à FilaFlow / PrepFlow

Le Pi 3 doit résoudre `filaflow.local` vers le Pi 4 (vérifier l'IP du Pi 4, ici 192.168.1.145) :

```
echo "192.168.1.145 filaflow.local" | sudo tee -a /etc/hosts
```

Certificat auto-signé de FilaFlow : à ajouter au magasin de Chromium, sinon la page affiche un avertissement.

```
echo | openssl s_client -connect filaflow.local:443 -servername filaflow.local 2>/dev/null | openssl x509 > /tmp/filaflow.crt
mkdir -p ~/.pki/nssdb && certutil -d sql:$HOME/.pki/nssdb -N --empty-password
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n filaflow -i /tmp/filaflow.crt
```

## 4. Installer le kiosque

Depuis le dossier `~/prepflow` du Pi 4 (ou après `git pull`), copier `kiosk/` sur le Pi 3 :

```
scp -r kiosk pi@atelier.local:prepflow-kiosk      # depuis le Pi 4
```

Puis sur le Pi 3 :

```
chmod +x ~/prepflow-kiosk/*.sh ~/prepflow-kiosk/xinitrc
cp ~/prepflow-kiosk/xinitrc ~/.xinitrc
cat ~/prepflow-kiosk/bash_profile.snippet >> ~/.bash_profile
sudo raspi-config nonint do_boot_behaviour B2     # console avec connexion automatique
```

Ménager la carte SD (journaux en mémoire) :

```
sudo mkdir -p /etc/systemd/journald.conf.d
printf "[Journal]\nStorage=volatile\n" | sudo tee /etc/systemd/journald.conf.d/volatile.conf
```

Redémarrer : `sudo reboot`. L'Atelier s'affiche seul.

## 5. Réglages (`~/prepflow-kiosk/kiosk.conf`)

| Réglage | Défaut | Effet |
|---|---|---|
| `NIGHT_FROM` / `NIGHT_TO` | 22 / 7 | plage horaire de nuit |
| `NIGHT_OFF_AFTER` | 120 s | la nuit, l'écran s'éteint 2 min après le dernier toucher |
| `DAY_OFF_AFTER` | 1800 s | le jour, extinction après 30 min (0 = jamais) |
| `KIOSK_URL` | …/atelier.html | ajouter `?veille=60` pour changer la veille de la page (90 s par défaut, 0 = jamais) |

Deux niveaux le jour : après 90 s la page passe en veille (écran sombre, heure et avancement), puis l'écran
s'éteint vraiment. Un toucher rallume ; le premier toucher sur la veille est avalé pour éviter un faux clic.
Après modification : `sudo reboot`.

## 6. Tests au premier démarrage

À vérifier sur le matériel (non testable sans l'écran) :

1. L'image remplit l'écran 1024×600 et le tactile répond. Sinon, ajouter à la fin de `/boot/firmware/cmdline.txt` (même ligne) : `video=HDMI-A-1:1024x600M@60`.
2. Extinction : en SSH, `DISPLAY=:0 xset dpms force off` éteint le rétroéclairage ; un toucher le rallume.
   Si l'écran reste allumé ou ne se réveille pas au toucher, la veille de la page fonctionne quand même (écran sombre) :
   mettre `NIGHT_OFF_AFTER` et `DAY_OFF_AFTER` à 0 et signaler le comportement observé.
3. Pas d'avertissement de certificat. Sinon, refaire la copie du certificat (§3).
4. Couper le courant puis le rallumer : l'Atelier revient seul, sans clavier.

## Dépannage

- Écran blanc ou « site inaccessible » : `ping filaflow.local` depuis le Pi 3, puis vérifier le Pi 4. La page affiche « PrepFlow injoignable » et se reconnecte seule.
- Fermer Chromium : le script le relance en 3 secondes.
- Accès SSH : `ssh pi@192.168.1.141`.
- Mise à jour de PrepFlow : la page se recharge seule quand la version change.
