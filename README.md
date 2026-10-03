# PrepFlow

Préparation des impressions 3D : pour chaque projet, un tableau des pièces à imprimer
avec l'imprimante, le filament, le temps et le poids, et une synthèse qui vérifie
que les bobines suffisent.

PrepFlow tourne sur le même Pi que [FilaFlow](https://github.com/Fabdub59650/filaflow)
et lit son stock de filament **en lecture seule** (API locale `127.0.0.1:3000`).
Il n'écrit jamais dans FilaFlow : les consommations réelles restent mesurées par la balance.

Accès : **https://filaflow.local/prepflow/**

## Fonctionnalités (v1)

- Projets avec statut (en préparation, en cours, terminé, archivé) et notes
- Tableau éditable façon tableur (Tabulator) : pièce, fichier, quantité, imprimante,
  filament, poids et temps unitaires, totaux calculés, coût, statut, notes
- Plusieurs filaments par pièce (multicolore)
- Code projet unique (P + AAMM + n° du mois, ex. P261001), copiable pour nommer le dossier des STL
- Colonnes Matière et Couleur qui préfiltrent en cascade les couleurs et les bobines proposées
- Saisie des temps souple : `1h25`, `1 h 25`, `45m`, `1:25`, `1:25:30`, ou `85` (minutes)
- Synthèse : temps et poids restants, coût matière, temps par imprimante,
  besoin par bobine comparé au poids restant pesé dans FilaFlow, avec alerte si une bobine ne suffit pas
- Les pièces marquées « Imprimé » ne comptent plus dans le besoin (la balance les a déjà décomptées)
- Copie locale du stock : PrepFlow reste utilisable si FilaFlow est arrêté
- Mode clair / sombre : bouton dans la barre du haut, modes automatiques dans Paramètres › Apparence

## Architecture

| Élément | Détail |
|---|---|
| Backend | Node.js + Express, port 3001, écoute sur 127.0.0.1 uniquement |
| Base | MariaDB, base `prepflow`, utilisateur `prepflow` (mot de passe généré, dans `.env`) |
| Frontend | Vanilla JS (modules ES), Tabulator 6.6 embarqué dans `frontend/vendor/` |
| Accès | Nginx de FilaFlow : `include snippets/prepflow.conf;` → `location /prepflow/` |
| Service | systemd `prepflow`, installé dans `/opt/prepflow` |

```
backend/        server.js, db.js, filaflow.js (lecture du stock), routes/
frontend/       index.html, css/, js/ (app, store, views/), vendor/tabulator/, fonts/
sql/schema.sql  schéma idempotent (rejoué à chaque mise à jour)
nginx/          bloc location /prepflow/
systemd/        prepflow.service
scripts/        install.sh, patch.sh, nginx_include.py
```

Tables : `projects`, `parts`, `part_filaments`, `printers`, `filament_cache`, `settings`.

## Installation

```bash
cd ~
git clone https://github.com/Fabdub59650/prepflow.git
cd prepflow
sudo bash scripts/install.sh
```

Le script : crée la base et l'utilisateur, applique le schéma, copie les fichiers dans
`/opt/prepflow`, installe le service systemd, puis ajoute l'include dans
`/etc/nginx/sites-available/filaflow` (copie de sauvegarde, `nginx -t`, retour arrière si erreur).
Si un utilisateur MariaDB `pi` existe (Adminer), il reçoit les droits sur la base `prepflow`, quel que soit son hôte.

## Mise à jour

```bash
cd ~/prepflow
git pull            # ou git pull <bundle> main
sudo bash scripts/patch.sh
```

## Version

PrepFlow compare sa version au **tag le plus récent** du dépôt GitHub (`vX.Y.Z`) :
pousser le tag suffit, aucune « Release » GitHub n'est nécessaire. Les notes affichées
viennent du `CHANGELOG.md` du tag, d'où le format des titres : `## vX.Y.Z — date`.
Paramètres › Version permet de mettre à jour sans SSH ; `patch.sh` reste nécessaire
quand une version modifie le service systemd ou le bloc Nginx.

Seul `backend/package.json` est à bumper : le serveur lit la version au démarrage,
l'affiche dans l'interface et la persiste en base (`settings._version`).

## Sauvegarde

⚠ La base `prepflow` n'est pas encore incluse dans la sauvegarde NAS de FilaFlow.
