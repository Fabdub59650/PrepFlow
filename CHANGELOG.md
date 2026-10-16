# Changelog

## v1.13.0 — 16/10/2026

Suivi de production : boutons dans les projets et page « Production ».

- Tableau d'un projet : colonne **▶ Démarrer** / **■ Terminer** sur chaque pièce, avec l'avancement
  (pièces réussies sur quantité) ; le bouton reste actif sur une pièce déjà imprimée (réimpression)
- Fenêtre « Lancer » : imprimante, quantité du lancement (par défaut le reste à imprimer), besoin en
  filament par bobine comparé au reste estimé (avertissement si insuffisant, sans bloquer),
  heure de début modifiable si l'impression est déjà partie
- Lancement groupé (plateau mixte) : cocher plusieurs pièces puis **▶ Lancer la sélection** ; les pièces
  sans bobine choisie sont signalées et exclues
- Fenêtre « Terminer » : Réussie / Ratée / Annulée par pièce, % réalisé pour un raté (consommation
  proratisée, valeur par défaut visible), poids retenu corrigeable par bobine, notes, heure de fin ;
  un lancement groupé se termine d'un coup (« Pour toutes ») puis s'ajuste pièce par pièce
- Nouvelle page **Production** : impressions en cours (une carte par imprimante ou plateau, durée écoulée
  qui avance, barre de progression sur la durée prévue) et historique filtrable par projet et par
  résultat, avec temps et poids prévus contre réels ; pastille du menu = nombre d'impressions en cours
- Sélecteurs de bobine : reste estimé (« ~320 g ») avec l'âge de la dernière pesée au lieu du seul
  poids de la dernière pesée
- Aucun changement des totaux de projet ni de la page Besoins (quantités partielles : v1.13.1)

## v1.12.0 — 16/10/2026

Suivi de production, partie serveur (les boutons et la page « Production » arrivent en v1.13.0).

- Nouvelles tables `print_runs` (une impression = un lancement d'une pièce sur une imprimante) et
  `print_run_filaments` (consommation par bobine : poids prévu figé au démarrage, poids retenu à la fin)
- Lancement groupé (plateau mixte) : une impression par pièce, même imprimante, même heure de début,
  même `batch_id` ; fin groupée possible en un appel
- Fin d'impression : réussie, ratée (consommation = prévu × % réalisé) ou annulée (aucune consommation) ;
  poids corrigeables bobine par bobine ; durée réelle calculée ; heure de début/fin modifiable
- Statut de la pièce déduit des impressions : « imprimé » quand les impressions réussies couvrent la
  quantité, « en cours » tant qu'une impression est active ; une pièce sans impression garde son statut manuel ;
  le premier lancement d'un projet en préparation le passe « en cours »
- Reste estimé des bobines : dernière pesée FilaFlow − consommation des impressions terminées depuis
  cette pesée (`weight_estimated`), et poids « réservé » par les impressions en cours (`reserved_g`).
  Calculé à la lecture, jamais écrit dans FilaFlow : une nouvelle pesée remet le compteur à zéro
- La copie locale des filaments mémorise la date de dernière pesée (`last_weighed_at`)
- API : `POST /api/runs/start`, `POST /api/parts/:id/runs/start`, `POST /api/runs/:id/finish`,
  `POST /api/batches/:batchId/finish`, `PUT` et `DELETE /api/runs/:id`, `GET /api/runs`,
  `GET /api/projects/:id/runs` ; `GET /api/filaments` renvoie les nouveaux champs d'estimation

## v1.11.3 — 16/10/2026

- Thème commun avec FilaFlow : nouveau fichier `frontend/css/theme.css` (polices, palette graphite / béton,
  espacements typographiques), identique dans les deux dépôts ; l'accent bleu reste propre à PrepFlow
- Typographie alignée sur FilaFlow : menu, boutons et titres en Barlow Condensed majuscules ; libellés,
  en-têtes de colonnes, étiquettes et état FilaFlow en IBM Plex Mono

## v1.11.2 — 11/10/2026

- Page Besoins : les projets terminés ne sont plus pris en compte, comme les archivés (absents de la
  liste et retirés de la sélection mémorisée s'ils y étaient restés cochés)
- Raccourci « En préparation et en cours » retiré, devenu identique à « Tous » ; mention sous la liste

## v1.11.1 — 09/10/2026

- En-tête de page fixe au défilement, sous la barre du haut (titre et boutons d'action) sur toutes les pages
- Projet : l'en-tête se compacte une fois fixé (code, nom, statut, actions) et la barre d'outils du
  tableau (Ajouter une pièce, Remplacer une bobine, filtre, sélection en lot) reste visible dessous ;
  sur écran étroit, seul l'en-tête reste fixe
- Page Besoins : la liste des projets reste placée sous l'en-tête fixe

## v1.11.0 — 09/10/2026

- Tableau des pièces : filtre par bobine (bobines du projet avec leur nombre de pièces, ou
  « Sans bobine choisie »), y compris les pièces multicolores qui utilisent la bobine
- Totaux du tableau et « Tout sélectionner » limités aux pièces affichées ; les synthèses sous le
  tableau restent calculées sur tout le projet
- Ajouter une pièce retire le filtre ; le filtre n'est pas mémorisé d'une visite à l'autre

## v1.10.0 — 04/10/2026

- « Remplacer une bobine » : remplace une bobine par une autre dans tout le projet, y compris
  dans les pièces multicolores (seule la ligne concernée change) ; poids conservés, matière et couleur
  reprises de la nouvelle bobine ; pièces imprimées exclues par défaut
- Sélection de pièces (cases à cocher, tout sélectionner) et barre de modification en lot :
  bobine, imprimante, statut ; les pièces multicolores gardent leur bobine (signalé)
- Modifications enregistrées en une seule transaction ; totaux et synthèses mis à jour

## v1.9.1 — 04/10/2026

- Page Besoins : liste des projets élargie (420 px) ; les noms longs passent à la ligne au lieu d'être tronqués

## v1.9.0 — 04/10/2026

- Nouvelle page « Besoins » : sélection de projets (mémorisée ; par défaut en préparation et en cours)
  et récapitulatif du filament nécessaire comparé au stock FilaFlow
- Par bobine (défaut) ou par référence (matière + couleur, toutes marques et bobines confondues)
- Colonnes : besoin, stock, solde, à commander (avec estimation en bobines), projets concernés
- Bloc « À choisir ou à acheter » pour le filament souhaité sans bobine choisie, comparé au stock libre
  des bobines de même matière et couleur
- Pièces non imprimées uniquement ; marge de sécurité appliquée aux besoins, réglable dans
  Paramètres › Calcul des besoins (10 % par défaut)
- Export CSV (séparateur « ; », s'ouvre directement dans Excel)

## v1.8.0 — 03/10/2026

- Code projet unique attribué à la création : P + année + mois + numéro du mois sur 2 chiffres
  (P261001 = 1er projet d'octobre 2026) ; numéro remis à 01 chaque mois, jamais réutilisé même après
  suppression ; non modifiable, même si le projet est renommé
- Projets existants : code attribué selon leur mois de création, dans l'ordre chronologique
- Liste des projets : colonne « Code » triable ; page du projet : code à côté du titre avec bouton Copier
  (pour nommer le dossier des STL) ; code repris dans le titre de l'onglet
- Base : colonne projects.code (unique) et table project_code_counters

## v1.7.0 — 02/10/2026

- Liste des projets : colonne « Créé le » (date, heure au survol), triable
- Page d'un projet : date de création et de dernière modification sous le titre

## v1.6.0 — 02/10/2026

- Tableau des pièces triable par les en-têtes : croissant, décroissant, puis retour à l'ordre manuel
- Tri d'affichage uniquement : l'ordre manuel (glisser-déposer) est conservé ; poignée masquée
  pendant un tri ; « Garder cet ordre » enregistre l'ordre trié comme nouvel ordre manuel
- Statut trié selon le cycle (À trancher → Imprimé), textes sans tenir compte des accents,
  cellules vides toujours en fin de liste ; tri mémorisé par projet dans le navigateur

## v1.5.1 — 02/10/2026

- Tableau des pièces : total en bas de la colonne « Pièce » avec le nombre d'éléments (lignes),
  à côté du total de la colonne « Qté » (nombre de pièces à imprimer)

## v1.5.0 — 02/10/2026

- Liste des projets triable par les en-têtes (Projet, Statut, Pièces, Bobines, Temps, Poids,
  Avancement) ; statut trié selon le cycle de vie ; tri mémorisé dans le navigateur
- Nouvelle colonne « Bobines » : nombre de bobines différentes choisies dans le projet,
  liste des bobines (avec n°) au survol
- Tableau des pièces : au-delà de 10 pièces, défilement à l'intérieur du tableau ; en-tête, totaux
  et bouton « Ajouter une pièce » restent visibles ; une pièce ajoutée est amenée à l'écran

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
