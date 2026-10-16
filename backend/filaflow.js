/**
 * filaflow.js — Lecture des filaments depuis l'API de FilaFlow (lecture seule)
 *
 * PrepFlow n'écrit jamais dans FilaFlow. Il interroge GET /api/filaments en
 * local (127.0.0.1:3000, sans passer par Nginx : FilaFlow autorise ces appels
 * sans mot de passe) et garde une copie dans la table filament_cache.
 * Si FilaFlow ne répond pas, la dernière copie connue est utilisée.
 */
const db = require('./db');

const SYNC_MIN_INTERVAL_MS = 10_000;   // pas plus d'une synchro toutes les 10 s
const FETCH_TIMEOUT_MS     = 3_000;

let lastSyncAt = 0;
let lastOnline = false;
let lastError  = null;
let syncing    = null;   // promesse en cours, partagée entre requêtes simultanées

async function baseUrl() {
  if (process.env.FILAFLOW_URL) return process.env.FILAFLOW_URL.replace(/\/+$/, '');
  try {
    const [[row]] = await db.query("SELECT value FROM settings WHERE key_name='filaflow_url'");
    if (row && row.value) return row.value.replace(/\/+$/, '');
  } catch (_) {}
  return 'http://127.0.0.1:3000';
}

async function fetchList(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FilaFlow a répondu ${res.status} sur ${url}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Réponse FilaFlow inattendue (liste attendue)');
  return data;
}

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

// Date de pesée « 2026-10-14 19:37:00 » (heure du Pi, comme dans FilaFlow) ; tolère le format ISO
const dt = v => (v ? String(v).replace('T', ' ').slice(0, 19) : null);

async function doSync() {
  const base = await baseUrl();
  // Filaments actifs + archivés : une pièce peut référencer une bobine vidée depuis.
  const [active, archived] = await Promise.all([
    fetchList(`${base}/api/filaments`),
    fetchList(`${base}/api/filaments?archived=1`),
  ]);
  const rows = [
    ...active.map(f => ({ ...f, archived: 0 })),
    ...archived.map(f => ({ ...f, archived: 1 })),
  ];
  if (rows.length) {
    const values = rows.map(f => [
      f.id, f.name ?? null, f.brand ?? null, f.material ?? null,
      f.color_name ?? null, f.color_hex ?? null, f.spool_number ?? null, f.spool_label ?? null,
      num(f.weight_total), num(f.weight_remaining), num(f.price), dt(f.last_weighed_at), f.archived,
    ]);
    // Les filaments supprimés dans FilaFlow restent en cache : les pièces
    // qui les utilisent gardent un nom lisible.
    await db.query(
      `INSERT INTO filament_cache
         (id,name,brand,material,color_name,color_hex,spool_number,spool_label,
          weight_total,weight_remaining,price,last_weighed_at,archived)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), brand=VALUES(brand), material=VALUES(material),
         color_name=VALUES(color_name), color_hex=VALUES(color_hex),
         spool_number=VALUES(spool_number), spool_label=VALUES(spool_label), weight_total=VALUES(weight_total),
         weight_remaining=VALUES(weight_remaining), price=VALUES(price),
         last_weighed_at=VALUES(last_weighed_at),
         archived=VALUES(archived), synced_at=CURRENT_TIMESTAMP`,
      [values]
    );
  }
}

async function sync({ force = false } = {}) {
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return lastOnline;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await doSync();
      lastOnline = true;
      lastError  = null;
    } catch (e) {
      lastOnline = false;
      lastError  = e.name === 'TimeoutError' ? 'FilaFlow ne répond pas' : e.message;
      console.warn('[FilaFlow] Synchronisation impossible :', lastError);
    } finally {
      lastSyncAt = Date.now();
      syncing = null;
    }
    return lastOnline;
  })();
  return syncing;
}

/**
 * Reste estimé d'une bobine (affiché dans PrepFlow uniquement, jamais écrit dans FilaFlow) :
 *   weight_estimated = dernière pesée (weight_remaining) − consommation des impressions terminées
 *                      (réussies ou ratées) après cette pesée.
 * Une nouvelle pesée dans FilaFlow avance last_weighed_at : le compteur repart de zéro tout seul.
 * reserved_g = poids prévu des impressions en cours (non encore décomptées).
 */
const LIST_SQL = `
  SELECT fc.*,
         COALESCE(u.used_g, 0)     AS used_since_weighing_g,
         COALESCE(u.runs_n, 0)     AS runs_since_weighing,
         COALESCE(rv.reserved_g, 0) AS reserved_g,
         CASE WHEN fc.weight_remaining IS NULL THEN NULL
              ELSE GREATEST(0, fc.weight_remaining - COALESCE(u.used_g, 0)) END AS weight_estimated
  FROM filament_cache fc
  LEFT JOIN (
    SELECT rf.filament_id, SUM(rf.weight_g) AS used_g, COUNT(DISTINCT r.id) AS runs_n
    FROM print_run_filaments rf
    JOIN print_runs r ON r.id = rf.run_id
    JOIN filament_cache c ON c.id = rf.filament_id
    WHERE r.state = 'termine' AND r.result IN ('ok', 'rate')
      AND (c.last_weighed_at IS NULL OR r.ended_at > c.last_weighed_at)
    GROUP BY rf.filament_id
  ) u ON u.filament_id = fc.id
  LEFT JOIN (
    SELECT rf.filament_id, SUM(rf.planned_g) AS reserved_g
    FROM print_run_filaments rf
    JOIN print_runs r ON r.id = rf.run_id
    WHERE r.state = 'en_cours'
    GROUP BY rf.filament_id
  ) rv ON rv.filament_id = fc.id
  ORDER BY fc.archived, fc.material, fc.name`;

async function listFilaments({ force = false } = {}) {
  await sync({ force });
  const [rows] = await db.query(LIST_SQL);
  const [[meta]] = await db.query('SELECT MAX(synced_at) AS synced_at FROM filament_cache');
  return {
    online: lastOnline,
    error: lastError,
    synced_at: meta ? meta.synced_at : null,
    filaments: rows,
  };
}

function status() {
  return { online: lastOnline, error: lastError, last_sync: lastSyncAt || null };
}

module.exports = { sync, listFilaments, status };
