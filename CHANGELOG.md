# Changelog

## v1.2.0 — 01/10/2026

- Nouvelle colonne « Couleur » avant « Filament » : liste des noms de couleur des bobines actives
  de FilaFlow (champ « nom couleur »), avec le nombre de bobines par couleur ; saisie libre possible
- La liste « Filament » ne propose que les bobines de la couleur choisie (sans tenir compte des
  majuscules ni des espaces en trop)
- Choisir une bobine remplit la couleur ; choisir une couleur incompatible retire la bobine (poids conservé)
- Pièces multicolores : pastilles des couleurs, réglage dans la fenêtre « Plusieurs filaments »
- Base : colonne parts.color_name (ajoutée automatiquement à la mise à jour)

## v1.1.0 — 30/09/2026

- Mode clair / sombre comme dans FilaFlow : bouton dans la barre du haut, réglage enregistré en base
- Nouvelle page Paramètres › Apparence : Atelier sombre (défaut), toujours clair, toujours sombre,
  suivre le thème du système, selon l'heure (heures réglables)
- Pas de flash au chargement : dernier mode gardé dans le navigateur et appliqué avant l'affichage
- install.sh : droits Adminer accordés à l'utilisateur MariaDB pi quel que soit son hôte

## v1.0.0 — 30/09/2026

Première version.

- Projets, pièces, imprimantes ; tableau éditable Tabulator avec ligne de totaux
- Plusieurs filaments par pièce (multicolore)
- Lecture seule du stock FilaFlow avec copie locale de secours
- Synthèse : temps et poids restants, coût matière, temps par imprimante, besoin par bobine avec alerte
- Installation (`install.sh`) : base MariaDB dédiée, service systemd, bloc Nginx `/prepflow/`
