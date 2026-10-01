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
      num(f.weight_total), num(f.weight_remaining), num(f.price), f.archived,
    ]);
    // Les filaments supprimés dans FilaFlow restent en cache : les pièces
    // qui les utilisent gardent un nom lisible.
    await db.query(
      `INSERT INTO filament_cache
         (id,name,brand,material,color_name,color_hex,spool_number,spool_label,
          weight_total,weight_remaining,price,archived)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), brand=VALUES(brand), material=VALUES(material),
         color_name=VALUES(color_name), color_hex=VALUES(color_hex),
         spool_number=VALUES(spool_number), spool_label=VALUES(spool_label), weight_total=VALUES(weight_total),
         weight_remaining=VALUES(weight_remaining), price=VALUES(price),
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

async function listFilaments({ force = false } = {}) {
  await sync({ force });
  const [rows] = await db.query(
    'SELECT * FROM filament_cache ORDER BY archived, material, name'
  );
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
