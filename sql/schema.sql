-- ══════════════════════════════════════════════════════════════
-- PrepFlow — schéma MariaDB (idempotent : rejouable sans perte)
-- Base : prepflow — utilisateur : prepflow
-- ══════════════════════════════════════════════════════════════

-- Paramètres clé/valeur (_version, filaflow_url, …)
CREATE TABLE IF NOT EXISTS `settings` (
  `key_name`   varchar(64)  NOT NULL,
  `value`      text         DEFAULT NULL,
  `updated_at` timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Imprimantes (propres à PrepFlow : FilaFlow ne les gère pas)
CREATE TABLE IF NOT EXISTS `printers` (
  `id`         int(11)      NOT NULL AUTO_INCREMENT,
  `name`       varchar(100) NOT NULL,
  `active`     tinyint(1)   NOT NULL DEFAULT 1,
  `sort_order` int(11)      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_printer_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projets : un ensemble de pièces à imprimer
CREATE TABLE IF NOT EXISTS `projects` (
  `id`         int(11)      NOT NULL AUTO_INCREMENT,
  `name`       varchar(150) NOT NULL,
  `notes`      text         DEFAULT NULL,
  `status`     enum('preparation','en_cours','termine','archive') NOT NULL DEFAULT 'preparation',
  `created_at` timestamp    NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_project_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pièces d'un projet (une ligne du tableau)
-- print_time_s : temps d'impression UNITAIRE en secondes
CREATE TABLE IF NOT EXISTS `parts` (
  `id`           int(11)      NOT NULL AUTO_INCREMENT,
  `project_id`   int(11)      NOT NULL,
  `sort_order`   int(11)      NOT NULL DEFAULT 0,
  `name`         varchar(150) NOT NULL DEFAULT '',
  `file_name`    varchar(255) DEFAULT NULL,
  `quantity`     int(11)      NOT NULL DEFAULT 1,
  `printer_id`   int(11)      DEFAULT NULL,
  `material`     varchar(50)  DEFAULT NULL,
  `color_name`   varchar(100) DEFAULT NULL,
  `print_time_s` int(11)      DEFAULT NULL,
  `status`       enum('a_trancher','pret','en_cours','imprime') NOT NULL DEFAULT 'a_trancher',
  `notes`        text         DEFAULT NULL,
  `created_at`   timestamp    NOT NULL DEFAULT current_timestamp(),
  `updated_at`   timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_part_project` (`project_id`,`sort_order`),
  CONSTRAINT `fk_part_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_part_printer` FOREIGN KEY (`printer_id`) REFERENCES `printers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.2.0 : couleur souhaitée (sert à préfiltrer les bobines, remplie aussi par la bobine choisie)
ALTER TABLE `parts` ADD COLUMN IF NOT EXISTS `color_name` varchar(100) DEFAULT NULL AFTER `printer_id`;
-- v1.3.0 : matière souhaitée (préfiltre les couleurs et les bobines)
ALTER TABLE `parts` ADD COLUMN IF NOT EXISTS `material` varchar(50) DEFAULT NULL AFTER `printer_id`;

-- Filaments utilisés par une pièce (plusieurs en multicolore)
-- filament_id : identifiant du filament dans FilaFlow (pas de clé étrangère : autre base)
-- weight_g    : poids UNITAIRE de ce filament pour une pièce
CREATE TABLE IF NOT EXISTS `part_filaments` (
  `id`          int(11)      NOT NULL AUTO_INCREMENT,
  `part_id`     int(11)      NOT NULL,
  `filament_id` int(11)      DEFAULT NULL,
  `material`    varchar(50)  DEFAULT NULL,
  `color_name`  varchar(100) DEFAULT NULL,
  `weight_g`    decimal(8,2) DEFAULT NULL,
  `sort_order`  int(11)      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_pf_part` (`part_id`),
  KEY `idx_pf_filament` (`filament_id`),
  CONSTRAINT `fk_pf_part` FOREIGN KEY (`part_id`) REFERENCES `parts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.3.0 : matière et couleur souhaitées par ligne de filament (fenêtre multicolore)
ALTER TABLE `part_filaments` ADD COLUMN IF NOT EXISTS `material`   varchar(50)  DEFAULT NULL AFTER `filament_id`;
ALTER TABLE `part_filaments` ADD COLUMN IF NOT EXISTS `color_name` varchar(100) DEFAULT NULL AFTER `material`;

-- Copie locale des filaments de FilaFlow (lecture seule côté PrepFlow)
-- Rafraîchie à chaque consultation ; sert de secours si FilaFlow est arrêté.
CREATE TABLE IF NOT EXISTS `filament_cache` (
  `id`               int(11)      NOT NULL,
  `name`             varchar(150) DEFAULT NULL,
  `brand`            varchar(100) DEFAULT NULL,
  `material`         varchar(50)  DEFAULT NULL,
  `color_name`       varchar(100) DEFAULT NULL,
  `color_hex`        varchar(9)   DEFAULT NULL,
  `spool_number`     varchar(50)  DEFAULT NULL,
  `spool_label`      varchar(100) DEFAULT NULL,
  `weight_total`     decimal(8,2) DEFAULT NULL,
  `weight_remaining` decimal(8,2) DEFAULT NULL,
  `price`            decimal(8,2) DEFAULT NULL,
  `archived`         tinyint(1)   NOT NULL DEFAULT 0,
  `synced_at`        timestamp    NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.3.1 : n° de bobine (champ « N° de bobine » de FilaFlow)
ALTER TABLE `filament_cache` ADD COLUMN IF NOT EXISTS `spool_number` varchar(50) DEFAULT NULL AFTER `color_hex`;

-- v1.8.0 : code projet unique PAAMMNN (ex. P261001 = 1er projet d'octobre 2026), jamais réutilisé
ALTER TABLE `projects` ADD COLUMN IF NOT EXISTS `code` varchar(12) DEFAULT NULL AFTER `id`;
CREATE UNIQUE INDEX IF NOT EXISTS `uq_project_code` ON `projects` (`code`);
-- Dernier numéro attribué par mois (AAMM) : un code supprimé n'est jamais redonné
CREATE TABLE IF NOT EXISTS `project_code_counters` (
  `period`   char(4) NOT NULL,
  `last_seq` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Valeurs par défaut
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('filaflow_url', 'http://127.0.0.1:3000');
-- Imprimantes initiales : seulement si la table est vide (un renommage n'est pas écrasé à la mise à jour)
INSERT INTO `printers` (name, sort_order)
  SELECT d.n, d.s FROM (SELECT 'Neptune 4 Plus' AS n, 1 AS s UNION ALL SELECT 'Centauri Carbon 2', 2) d
  WHERE NOT EXISTS (SELECT 1 FROM `printers`);
