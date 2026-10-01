# Changelog

## v1.4.0 — 01/10/2026

- Paramètres › Version : version installée comparée au dernier tag publié sur GitHub,
  notes de version tirées du CHANGELOG, mise à jour en un clic avec redémarrage automatique
- Pastille sur « Paramètres » quand une nouvelle version est disponible
  (vérification automatique au plus toutes les 6 h)
- Signale si une version modifie aussi le service systemd ou le bloc Nginx (patch.sh nécessaire)

## v1.3.1 — 01/10/2026

- Le n° de bobine (champ « N° de bobine » de FilaFlow) s'affiche entre parenthèses après le nom
  du filament : tableau, listes, fenêtre multicolore, synthèse des bobines, alertes
- L'étiquette libre des bobines partielles (« Bobine A »…) suit, précédée d'un point médian
- Base : colonne filament_cache.spool_number (remplie à la prochaine lecture du stock)

## v1.3.0 — 01/10/2026

- Nouvelle colonne « Matière » avant « Couleur » : matières des bobines actives de FilaFlow
  (champ « matière »), avec le nombre de bobines ; saisie libre possible
- Filtres en cascade : la matière limite les couleurs proposées, matière + couleur limitent les bobines
- Choisir une bobine remplit la matière et la couleur ; une matière incompatible retire la bobine
  (poids conservé), la couleur est gardée
- Fenêtre « Plusieurs filaments » : matière et couleur par ligne, qui filtrent la bobine de la ligne ;
  mêmes règles que le tableau ; une couleur ou une matière sans bobine est conservée comme intention
- Colonne « Pièce » figée à gauche lors du défilement horizontal ; colonnes resserrées (tient en 1440 px)
- Base : colonnes parts.material, part_filaments.material et part_filaments.color_name
  (ajoutées automatiquement à la mise à jour)

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
