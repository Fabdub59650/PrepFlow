# Changelog

## v1.32.0 — 26/10/2026

- **Bobines à peser.** Comme le reste d'une bobine est estimé depuis sa dernière pesée, PrepFlow signale maintenant celles à repeser dans FilaFlow : un bandeau « ⚖ n bobines à peser » sur l'Atelier (touche = liste avec la consommation et l'ancienneté de la pesée) et un encadré repliable en haut de la page Production. Une bobine est signalée si elle a servi depuis sa dernière pesée et que l'un des deux seuils est atteint : **150 g consommés** ou **14 jours** depuis la pesée (réglables dans Paramètres › Général › « Bobines à peser », 0 désactive un seuil). Lecture seule : rien n'est écrit dans FilaFlow. Sur l'Atelier, le bandeau partage la ligne avec celui de la maintenance
- **Cartes « En cours » : n° de bobine.** Chaque ligne affiche le nom de la bobine avec son n° entre parenthèses (« PLA Noir (12) ») avant le poids prévu

## v1.31.0 — 26/10/2026

- **Atelier : filtre « Prêtes / Toutes » dans la fenêtre Lancer.** La liste des pièces s'ouvre sur **Prêtes** : les pièces qui ont encore un reste à imprimer, hors « À trancher » (une pièce dont la bobine reste à choisir y figure, grisée, comme avant). **Toutes** ajoute les pièces déjà imprimées (réimpression), en cours à 100 % et à trancher. Si aucune pièce n'est prête, la fenêtre s'ouvre sur Toutes ; le filtre n'apparaît pas quand tout est déjà prêt. « Tout / rien » ne touche que les pièces affichées, et revenir sur Prêtes désélectionne les pièces masquées. Le besoin en filament reste calculé sur la sélection. Aucune modification de base de données ni de serveur

## v1.30.1 — 25/10/2026

- **Fenêtre « Terminer l'impression » : n° de la bobine entre parenthèses** à côté de son nom (« PLA Noir (12) »), sur la ligne du poids retenu et dans le choix « Bobine vidée » du relais, pour vérifier plus facilement la bobine

## v1.30.0 — 25/10/2026

- **Corriger la bobine d'une impression lancée par erreur.** Dans « Corriger l'impression », chaque ligne de filament a maintenant un sélecteur de bobine : la même matière et la même couleur viennent en premier, avec le reste de chaque bobine. Les bobines déjà utilisées par l'impression et les bobines archivées ne sont pas proposées ; un avertissement apparaît si la matière change. L'enregistrement remplace la bobine de la ligne en gardant le poids retenu. Possible sur une impression terminée (historique) comme sur une impression **en cours** (lien « Corriger » sur sa carte, page Production). La consommation, le stock estimé des deux bobines, la calibration et le coût se corrigent seuls. Le résultat, la matière et la couleur du prévu ne changent pas (supprimer et refaire reste la règle pour le résultat). Non proposé sur l'écran Atelier

## v1.29.0 — 25/10/2026

- **Atelier : badge de la bobine quand on passe une puce NFC sur le lecteur.** L'Atelier écoute le flux de lecture de FilaFlow (`/api/nfc/events`, même adresse que PrepFlow) et affiche pendant quelques secondes la bobine reconnue (numéro, nom, couleur), son reste (estimé ou pesé, avec l'ancienneté de la pesée) et, si une impression en cours l'utilise, l'imprimante et le projet (« ▶ En cours sur Neptune 4 Plus · P261001 »). Une puce non liée affiche « Puce non liée à une bobine ». La lecture réveille aussi la veille de la page. Lecture seule : rien n'est écrit dans FilaFlow ni dans PrepFlow, et FilaFlow n'est pas modifié. `?nfc=0` dans l'adresse désactive l'écoute

## v1.28.0 — 25/10/2026

- **Atelier : maintenance des imprimantes à l'écran tactile.** Un bandeau orange « Maintenance à faire · n tâches dépassées » apparaît en haut de l'Atelier dès qu'une tâche d'une imprimante active est dépassée. Il ouvre la liste par imprimante, avec l'échéance (« dépassée de 12 h ») et un bouton **Fait** (confirmation avant d'enregistrer). Même suivi que la page Imprimantes : la tâche repart de zéro et l'entretien est ajouté à l'historique. Le coût et la note se saisissent sur la page Imprimantes. Aucune modification de base de données ni de serveur

## v1.27.1 — 25/10/2026

- Atelier : le bouton « Chercher par code » n'apparaît plus dans l'onglet « À contrôler » (liste courte, la recherche n'y sert pas)

## v1.27.0 — 25/10/2026

- **Atelier : contrôle des pièces à l'écran tactile.** Un onglet **À contrôler** (à côté de « À lancer ») liste les projets dont toutes les pièces sont imprimées et dont le contrôle n'est pas terminé, avec l'avancement (« contrôle en cours · 2 / 5 »). Une fiche plein écran 1024×600 reprend le contrôle du téléphone : un toucher = tout présent, boutons − / + pour les quantités partielles, « Terminer le contrôle » (confirmation si incomplet) ou « Contrôle et projet terminés ». Le contrôle est le même que sur téléphone ou PC : on peut commencer sur l'un et finir sur l'autre ; la remarque se saisit sur téléphone ou PC et s'affiche à l'Atelier
- La recherche par code ouvre directement le contrôle d'un projet qui n'a plus rien à lancer. `GET /api/atelier` renvoie en plus, pour chaque projet, l'état du contrôle (aucune modification de base de données)

## v1.26.0 — 25/10/2026

- Fenêtre « Terminer » (page Production) : en cas d'oubli, on peut saisir au choix l'**heure de fin** ou la **durée** (heures et minutes) de l'impression. La durée est convertie en heure de fin à partir du début de chaque impression, et la fin enregistrée s'affiche avant de valider. Sans saisie, la fin reste « maintenant »

## v1.25.2 — 25/10/2026

- Atelier : le menu ne propose plus que « Recharger la page » (et la version). Les liens « Ouvrir PrepFlow complet » et « Ouvrir FilaFlow » sont retirés : sur le kiosque, un toucher accidentel y menait sans moyen de revenir

## v1.25.1 — 25/10/2026

- La page **Atelier** n'a plus de lien dans le menu de PrepFlow : elle est réservée à l'écran tactile du kiosque. Elle reste accessible par son adresse (`https://filaflow.local/prepflow/atelier.html`), par exemple pour dépanner ou tester le kiosque depuis un poste
- Documentation (`docs/KIOSQUE-PI3.md`, README) : précision correspondante

## v1.25.0 — 25/10/2026

Page **Atelier** : lancer et terminer les impressions depuis un écran tactile 7" (Pi 3B+ + Waveshare 1024×600) posé près des imprimantes.

- Nouvelle page `atelier.html` (accès : `https://filaflow.local/prepflow/atelier.html`, lien **Atelier** dans le menu de PrepFlow) : gros boutons (≥ 56 px), aucun tableau, aucun clavier à l'écran, pensée pour 1024×600
- **En cours** (à gauche) : une carte par impression ou par plateau, avec l'imprimante, le temps écoulé, le temps prévu, le **reste** (ou le dépassement) et une barre de progression ; bouton **Terminer**
- **À lancer** (à droite) : les projets qui ont encore des pièces prêtes (les plus récents d'abord), avec le nombre de pièces et le temps restant ; recherche par **code** au pavé numérique (P261001 → on tape 261001)
- **Lancer** : une seule feuille, pièces cochées à gauche (quantité −/+, reste à imprimer proposé), imprimante à droite en gros boutons ; plusieurs pièces cochées = lancement groupé sur le même plateau ; le besoin en filament est comparé au reste estimé de chaque bobine, avec l'alerte « manque » et l'avertissement de maintenance dépassée comme sur le PC
- Les pièces dont la bobine n'est pas encore choisie (copie d'un projet) affichent un encadré **Bobines à choisir** : une liste de bobines, la même matière et la même couleur d'abord, filtrable par matière, puis le lancement est possible
- **Terminer** : Réussie / Ratée / Annulée ; une ratée se saisit en pourcentage réalisé (10 · 25 · 50 · 75 · 90 % ou un autre nombre au pavé) ; **J'ai changé de bobine** (relais) avec la part de la bobine vidée préremplie par son reste estimé ; pour un plateau, « Tout réussi » en un tap puis ajustement pièce par pièce
- **Veille** : après 90 secondes sans toucher, l'écran passe presque noir avec l'heure et l'avancement des impressions ; le premier toucher réveille l'écran **sans rien déclencher** (réglable : `atelier.html?veille=120`, `?veille=0` pour désactiver). La page se recharge toute seule pendant la veille après une mise à jour de PrepFlow
- La page se met à jour toute seule toutes les 12 secondes : un lancement fait depuis le PC apparaît sur l'écran de l'atelier
- Aucun changement de base de données ni de règles de calcul : mêmes routes que la page Production (`runs/start`, `runs/:id/finish`, `batches/:id/finish`, `assign-spools`) ; deux routes de lecture ajoutées : `GET /api/atelier` et `GET /api/atelier/projects/:id`
- Procédure d'installation du Pi 3B+ : `docs/KIOSQUE-PI3.md` et dossier `kiosk/`

## v1.24.0 — 23/10/2026

Contrôle des pièces à l'écran, sur téléphone, tablette ou PC : plus besoin d'imprimer la fiche.

- Le bouton **Fiche de contrôle** devient **Contrôle des pièces** : une liste à plat, une ligne par pièce (nom, fichier, couleur), avec un compteur **0 / 4**. Un tap sur la ligne la marque **complète** (« tout présent ») ; **−** et **+** servent aux cas partiels (3 sur 4)
- Trois états : à vérifier (gris), complète (vert), incomplète (orange, avec une **remarque** facultative, ex. « 1 cassée »)
- Barre de progression fixe en haut (« 7 / 12 lignes · 23 / 30 pièces ») et filtre **Reste à vérifier**
- Tout est **enregistré au fil de l'eau** : on peut interrompre, reprendre, ou continuer sur un autre appareil
- **Terminer le contrôle** enregistre la date (confirmation s'il reste des lignes incomplètes) ; **Recommencer** remet tout à zéro ; quand tout est complet, un bouton propose de **marquer le projet terminé** (jamais automatique)
- La page du projet affiche l'avancement du contrôle à côté du bouton (« 7/12 », « contrôlé »)
- Chaque projet se contrôle **indépendamment** : une copie (Dupliquer) repart d'un contrôle vierge
- La **version papier** (A4) reste disponible (bouton « Version papier ») et reprend les lignes déjà contrôlées, les quantités partielles, les remarques et la date
- L'écran reste allumé pendant le contrôle quand le navigateur le permet
- Téléphone : la barre de menus du haut ne déborde plus (les menus défilent sur le côté), ce qui rend toute l'application utilisable sur un petit écran
- Base : colonnes `parts.check_qty`, `parts.check_note` et `projects.check_done_at` (ajoutées par `schema.sql`, rien à faire à la main) ; API : `PUT /api/parts/:id/check`, `POST /api/projects/:id/check/finish` et `/reset`

## v1.23.0 — 23/10/2026

Dupliquer un projet pour le réimprimer.

- Bouton **Dupliquer** sur la page d'un projet (à côté de Fiche de contrôle) et icône de copie sur chaque ligne de la liste des projets
- La copie reçoit un **nouveau code** et le nom « <nom> (copie) », modifiable avant création
- Copiés : pièces (fichier, quantité, poids, temps, notes, ordre), thèmes, lien source, notes, réglages de marge, et pour chaque pièce la **matière et la couleur** voulues
- Remises à zéro : toutes les pièces repassent à **Prêt** ; ni l'historique d'impression ni l'avancement ne sont copiés
- **Non copiés** : l'**imprimante** (elle peut changer entre-temps) et le **choix de bobine**
- Fenêtre **Choisir les bobines** juste après la copie : pour chaque couleur, une liste des bobines en stock de la même matière et couleur en premier, ou « Plus tard » (Annuler) ; l'affectation se fait aussi plus tard dans le tableau ou avec « Remplacer une bobine »
- API : `POST /api/projects/:id/duplicate` et `POST /api/projects/:id/assign-spools` ; aucun changement de base de données

## v1.22.0 — 22/10/2026

Relais de bobine : une bobine se vide en cours d'impression et tu la remplaces par une autre.

- Fenêtre **Terminer** : nouveau bouton **J'ai changé de bobine** sur chaque impression (sauf annulée). Tu choisis la nouvelle bobine (même matière puis même couleur en premier), et la **part de la bobine vidée** est préremplie avec son reste estimé (calibration comprise), plafonné au poids de la pièce ; tu peux la modifier
- La bobine vidée reçoit sa part, la nouvelle bobine reçoit le reste du poids de la pièce (poids prévu réparti de la même façon) ; la répartition s'affiche en direct avant l'enregistrement. Le coût matière se calcule bobine par bobine avec leurs prix
- Refusé si la part de la bobine vidée couvre déjà tout le poids, ou si la nouvelle bobine est déjà utilisée par la pièce
- Fenêtre **Lancer** : quand une bobine risque de manquer, la ligne indique aussi l'ancienneté de la dernière pesée, avec un rappel du bouton de relais
- Historique de la page Production : pastille **relais** sur les impressions concernées ; **Corriger** fonctionne sur les deux bobines comme avant
- Calibration : les impressions avec relais sont écartées (la part de chaque bobine y est estimée, pas mesurée), mais leur consommation compte bien dans le reste estimé
- Base : nouvelle colonne `relay` sur `print_run_filaments` (ajoutée par `schema.sql`, rien à faire à la main) ; API : `POST /api/runs/:id/finish` accepte `relay: { from_filament_id, to_filament_id, from_g }` (pas de relais en lot)

## v1.21.0 — 22/10/2026

L'historique de la page Production reste lisible quand il s'allonge.

- Nouveau filtre **Période** : 30 derniers jours (par défaut), 3 mois, 12 mois ou depuis le début ; le choix est mémorisé
- Nouvelle **recherche** sur la pièce, le fichier, le projet, l'imprimante et les notes (insensible aux accents et à la casse ; plusieurs mots = tous requis)
- Vue **Liste** : 25 impressions affichées, puis « Afficher N de plus » ; le compteur indique « 25 sur 86 impressions »
- Vue **Par projet** : un bloc repliable par projet (code, nom, nombre d'impressions dont ratées, temps réel et prévu, filament réel et écart avec le prévu) ; le projet le plus récent est déplié au départ, les autres repliés. Le temps d'un lancement groupé est réparti entre les pièces du plateau, comme dans « Gâchis ». Le choix Liste / Par projet est mémorisé
- Les filtres Projet et Résultat s'appliquent aux deux vues, avec Corriger et Supprimer inchangés
- Fin du plafond fixe de 300 impressions : l'historique va jusqu'à 1 000 impressions sur la période choisie (mention affichée si ce maximum est atteint)
- API : `GET /api/runs` accepte `?days=N` ; aucun changement de base de données

## v1.20.1 — 21/10/2026

Ajustements de la fiche de contrôle après un premier essai sur papier.

- Nouvelle colonne **Couleur** : couleur de la pièce (ou celle de la bobine choisie si la ligne n'en porte pas), avec sa pastille ; une pièce multicolore liste la couleur de chacun de ses filaments
- Colonne « Qté comptée » supprimée, ainsi que le « Total compté » du pied de page (la case « Présent » suffit) ; la colonne Remarque est plus large
- Aucun changement de base ni d'API

## v1.20.0 — 21/10/2026

Fiche de contrôle imprimable pour vérifier, en fin de projet, que toutes les pièces sont bien là.

- Nouveau bouton **Fiche de contrôle** sur la page projet : ouvre une vue épurée au format A4 (adresse `#/projet/N/controle`), sans menus, prête à imprimer
- Liste à plat, dans l'ordre du tableau : n°, pièce (avec le nom du fichier STL s'il diffère du nom), quantité attendue, case « Présent », « Qté comptée » et « Remarque » à remplir à la main
- En-tête avec le code projet, le nom, la date d'édition et le nombre de pièces attendues ; pied de page avec total attendu / total compté, date du contrôle et signature
- Sur un projet de plusieurs pages, l'en-tête du tableau est répété et aucune ligne n'est coupée entre deux pages
- Rendu « papier » (fond blanc, texte noir) quel que soit le thème clair ou sombre ; le titre de la page devient le nom proposé pour un enregistrement en PDF
- Aucun changement de base ni d'API : la fiche lit le projet existant. La version écran (cases à cocher enregistrées) est prévue plus tard

## v1.19.3 — 21/10/2026

La calibration ignore les pesées suspectes de FilaFlow.

- Depuis FilaFlow 1.13, une pesée automatique de la balance jugée inhabituelle (poids qui remonte, sous la tare, baisse brutale) est marquée tant qu'elle n'est pas confirmée dans l'Inventaire. La calibration ne l'utilise plus pour mesurer la consommation réelle ; une fois confirmée dans FilaFlow, la pesée est de nouveau prise en compte
- Sans effet avec une version de FilaFlow plus ancienne (aucune pesée n'est marquée)

## v1.19.2 — 21/10/2026

Correctif du coût matière pour les bobines qui ne pèsent pas 1 kg.

- Le prix lu dans FilaFlow est un **prix au kilo** (€/kg) : le coût d'un gramme est désormais prix ÷ 1000, et non plus prix ÷ poids total de la bobine. Les deux calculs étaient identiques pour une bobine de 1 kg ; pour une bobine de 500 g à 30 €/kg, le coût matière était surestimé d'un facteur 2 (coût du projet, coût perdu des impressions ratées, totaux du thème)
- Aucun changement de base : les coûts se recalculent à l'affichage

## v1.19.1 — 21/10/2026

Calibration appliquée, et page Paramètres en rubriques.

- **Calibration appliquée** (case « Appliquer la calibration… » dans Paramètres › Calibration, cochée par défaut) : le coefficient prévu/réel
  d'une bobine ajuste le **stock estimé** (consommation depuis la dernière pesée), les **besoins** (page Besoins, onglet Bobines,
  fenêtre de lancement) et le **coût de revient** (page projet et onglet Coût). Coefficient plafonné entre × 0,7 et × 1,3
- Seuls les poids jamais corrigés à la main sont ajustés (un poids corrigé est déjà une valeur réelle) ; les poids et temps saisis
  dans le tableau, eux, restent ceux du slicer
- La mesure se fait désormais sur le poids du slicer (× % réalisé), indépendamment d'une correction manuelle
- Si FilaFlow est injoignable, le dernier coefficient connu est conservé (rien ne bloque)
- **Paramètres en rubriques** : Général (apparence, besoins, coût et prix), Calibration, Thèmes, Version. La rubrique ouverte est
  mémorisée pendant la session ; navigation aux flèches du clavier
- API : réglage `calibration_apply` ; `calib_k` renvoyé avec chaque filament

## v1.19.0 — 21/10/2026

Calibration : écart entre le poids prévu et la consommation réellement mesurée (première étape : mesure seule).

- **Paramètres › Calibration** : pour chaque bobine, PrepFlow compare la perte de poids entre deux pesées consécutives de FilaFlow
  au poids des impressions terminées entre les deux, et en tire un coefficient (ex. × 1,10 = la bobine consomme 10 % de plus que prévu).
  Détail des pesées consultable par bobine ; aucune saisie manuelle
- Intervalles écartés automatiquement : impression à cheval sur une pesée, poids en hausse (nouvelle bobine, correction), plus de 45 jours,
  moins de 20 g prévus, écart aberrant (impression faite hors PrepFlow). La raison est affichée
- Un coefficient n'est retenu qu'à partir de 3 intervalles et 150 g prévus ; sinon repli sur le même filament (matière + couleur),
  puis sur la même matière. Plafond d'application prévu : × 0,7 à × 1,3
- Pour l'instant, **rien n'est appliqué** aux besoins, au stock estimé ni au coût : on regarde d'abord les chiffres réels
- FilaFlow reste en lecture seule (historique via `GET /api/weighings`) ; API : `GET /api/calibration`

## v1.18.1 — 19/10/2026

Correctif : bas de page inaccessible.

- Page projet : quand la page n'était que légèrement plus haute que l'écran (cas typique de l'onglet « Coût et prix » sans le détail
  ouvert), l'en-tête se compactait au défilement, la page devenait plus courte que l'écran, le navigateur revenait en haut,
  l'en-tête se redéployait… et le bas restait hors d'atteinte. La page garde maintenant toujours de quoi défiler jusqu'au bas,
  quelle que soit la hauteur de l'écran

## v1.18.0 — 19/10/2026

Lien source d'un projet (MakerWorld, Printables…).

- Page projet : rangée **Lien** sous les thèmes. On colle l'adresse (Entrée ou clic ailleurs pour valider) ; elle s'affiche
  ensuite en lien cliquable avec le nom du site (ex. « makerworld.com ↗ »), ouvert dans un nouvel onglet. Le crayon ✎ rouvre la saisie ;
  champ vidé = lien supprimé. La rangée se replie avec l'en-tête compact au défilement
- Liste des projets : petite icône ↗ après le nom des projets qui ont un lien (pas de nouvelle colonne)
- Sécurité : seules les adresses `http://` et `https://` sont acceptées (500 caractères max), jamais `javascript:` ou `data:`
- Un seul lien par projet ; les liens supplémentaires peuvent aller dans les notes
- API : champ `source_url` sur `POST /api/projects` et `PUT /api/projects/:id` (400 si invalide), renvoyé par les lectures ;
  la mise à jour rejoue le schéma (colonne `projects.source_url`)

## v1.17.1 — 19/10/2026

Thèmes de projet : couleurs, gestion, totaux.

- **Couleurs** : chaque thème peut avoir une couleur parmi 9 (rouge, orange, jaune, vert, turquoise, bleu, violet, rose, gris),
  lisible en mode clair comme en mode sombre ; sans couleur, la pastille reste neutre. Les thèmes actifs du filtre portent une coche
- **Paramètres › Thèmes** : renommer, changer la couleur, fusionner dans un autre thème (les projets suivent, nom et couleur
  de la cible conservés), supprimer (les projets sont conservés) et « Supprimer les thèmes sans projet »
- **Totaux par thème** (Paramètres › Thèmes) : projets, pièces, temps, poids et coût de revient, archivés compris ; un astérisque
  signale un coût incomplet. Un projet qui a plusieurs thèmes compte dans chacun : les lignes ne s'additionnent pas
- **Filtre de la liste** : bascule « Tous » / « Au moins un » dès que deux thèmes sont choisis (mémorisée), et une ligne de résumé
  (projets, pièces, temps, poids) du filtre en cours
- Changement : un thème qui n'a plus de projet n'est plus supprimé automatiquement (il garde sa couleur) ; il apparaît
  dans l'autocomplétion jusqu'à sa suppression dans Paramètres › Thèmes
- API : `PUT /api/themes/:id`, `POST /api/themes/:id/merge`, `POST /api/themes/cleanup`, `DELETE /api/themes/:id`,
  `GET /api/themes/stats` ; le champ `color` est renvoyé avec les thèmes ; la mise à jour rejoue le schéma (colonne `themes.color`)

## v1.17.0 — 19/10/2026

Thèmes de projet (Noël, Halloween, Statuettes…).

- Page projet : rangée **Thèmes** sous le titre ; saisie avec autocomplétion des thèmes existants
  (Entrée, virgule ou choix dans la liste), croix pour retirer un thème. Plusieurs thèmes par projet
- Liste des projets : colonne **Thèmes** et pastilles de filtre au-dessus du tableau (avec le nombre de projets) ;
  un clic sur une pastille, dans le filtre ou dans une ligne, ajoute ou retire le thème. Plusieurs thèmes
  sélectionnés = le projet doit les porter **tous** ; le filtre est mémorisé dans le navigateur
- « Noel » et « Noël » sont le même thème (casse et accents ignorés), la première graphie saisie est conservée
- Un thème qui ne sert plus à aucun projet disparaît de la liste d'autocomplétion
- API : `GET /api/themes` ; champ `themes` (liste de noms) accepté par `PUT /api/projects/:id` et renvoyé par
  `GET /api/projects` et `GET /api/projects/:id` ; la mise à jour rejoue le schéma (tables `themes` et `project_themes`)

## v1.16.0 — 17/10/2026

Maintenance des imprimantes.

- Page Imprimantes : colonnes **Heures** (heures déjà faites avant PrepFlow + durées réelles des impressions
  terminées, un lancement groupé comptant une fois) et **Maintenance** (prochaine échéance, rouge si dépassée)
- Tâches par imprimante : intervalle en heures d'impression et/ou en jours (la première échéance atteinte compte) ;
  « Ajouter les tâches types » propose buse, courroies, plateau et axes, modifiables
- Bouton **Fait** : remet le compteur de la tâche à zéro, avec note, coût des pièces changées et date si c'était avant ;
  historique par imprimante et coût réel d'entretien par heure (affiché, sans effet sur le calcul des coûts)
- Changer les heures de départ d'une imprimante ne fausse pas les échéances déjà suivies
- Pastille rouge sur « Imprimantes » (tâches dépassées) et avertissement non bloquant dans la fenêtre « Lancer »
- API : `GET /api/maintenance` et routes `/api/maintenance/…` ; la mise à jour rejoue le schéma (nouvelles tables)

## v1.15.2 — 17/10/2026

- « Prévu et réalisé » : un lancement groupé compte désormais une seule fois (durée réelle du plateau contre
  temps prévu de toutes ses pièces) au lieu d'être exclu du temps réel
- API : `batch_planned_time_s` sur les impressions d'un lancement groupé

## v1.15.1 — 17/10/2026

Page projet plus compacte : onglets d'analyse sous le tableau.

- Trois onglets : **Bobines**, **Production** (temps par imprimante, prévu et réalisé) et **Coût et prix** ;
  l'onglet choisi est mémorisé
- Pastilles : rouge sur « Bobines » quand une bobine ne suffit pas, orange sur « Coût et prix » quand le calcul est incomplet
- Barre de chiffres : « Coût matière » devient **Coût de revient** avec le prix conseillé
- Aucune modification du serveur ni de la base

## v1.15.0 — 17/10/2026

Coût de revient et prix de vente (V2).

- Page projet : panneau **Coût et prix de vente** : coût de revient (matière, électricité, usure), prix conseillé,
  bénéfice, part de gâchis, détail par pièce
- Base de calcul : pièces imprimées au poids et au temps **réels** (ratés compris), pièces restantes au **prévu**
- Coût machine par heure = puissance moyenne × prix du kWh + usure (€/h) ; le temps d'un lancement groupé
  est réparti entre ses pièces
- Prix de vente d'une ligne = max(coût × (1 + marge), minimum par pièce × quantité)
- Imprimantes : colonnes **Puissance moyenne (W)** et **Usure (€/h)**
- Paramètres : prix du kWh, marge par défaut (30 %), prix minimum par pièce ; marge et minimum modifiables par projet
- Avertissement quand le calcul est incomplet (prix de bobine, puissance, imprimante, poids ou temps manquants)
- API : `GET /api/projects/:id/cost` ; la mise à jour rejoue le schéma (colonnes ajoutées aux imprimantes et aux projets)

## v1.14.0 — 17/10/2026

Bloc « Gâchis » sur la page Production.

- Impressions ratées : taux de ratés, filament perdu (et part du filament consommé), temps machine perdu,
  coût matière perdu (prix des bobines FilaFlow) ; la consommation est proratisée au % réalisé
- Ventilation par imprimante, par bobine, par projet et par mois ; période au choix (30 j, 90 j, 12 mois, tout)
- Le temps d'un lancement groupé est réparti à parts égales entre ses pièces
- API : `GET /api/runs/waste?days=`

## v1.13.1 — 16/10/2026

Quantités partielles, stock estimé dans les besoins, prévu contre réalisé, correction d'une impression.

- **Quantités partielles** : le « reste à imprimer » d'une pièce est sa quantité moins les pièces réussies
  (somme des impressions réussies). Temps restant, filament restant, pièces par imprimante, avancement de la
  liste des projets et page Besoins en tiennent compte. Une pièce sans impression garde son statut manuel
- **Stock estimé** dans « Bobines nécessaires », dans le bandeau rouge « Une bobine ne suffit pas » et dans
  la page Besoins (reste pesé − consommation des impressions depuis la dernière pesée, signalé par « ~ »).
  Les pièces en cours comptent toujours comme restant à imprimer
- Page projet : bloc **Prévu et réalisé** (nombre d'impressions et de ratées, temps réel contre prévu,
  filament réel contre prévu ; les lancements groupés sont exclus du temps)
- Page Production : bouton **Corriger** sur chaque ligne de l'historique (poids retenus par bobine, notes)

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
