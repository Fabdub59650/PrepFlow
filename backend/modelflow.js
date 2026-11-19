/**
 * modelflow.js — Lecture des modèles 3D depuis l'API de ModelFlow (lecture seule)
 *
 * PrepFlow n'écrit jamais dans ModelFlow. Il interroge GET /api/models/:id en local
 * (127.0.0.1:3002, sans passer par Nginx) au moment de lier un projet à un modèle, et garde
 * dans le projet une copie du code et du nom. Si ModelFlow ne répond pas, le lien déjà
 * enregistré continue de s'afficher avec cette copie.
 */
const db = require('./db');

const FETCH_TIMEOUT_MS = 3_000;

async function baseUrl() {
  if (process.env.MODELFLOW_URL) return process.env.MODELFLOW_URL.replace(/\/+$/, '');
  try {
    const [[row]] = await db.query("SELECT value FROM settings WHERE key_name='modelflow_url'");
    if (row && row.value) return row.value.replace(/\/+$/, '');
  } catch (_) {}
  return 'http://127.0.0.1:3002';
}

const fail = (msg, status) => Object.assign(new Error(msg), { status });

// Un modèle (avec thèmes, lien source, dossier…) ; erreur 404 / 502 lisible sinon
async function fetchModel(id) {
  const n = parseInt(id, 10);
  if (!Number.isInteger(n) || n < 1) throw fail('Modèle inconnu', 400);
  let res;
  try { res = await fetch(`${await baseUrl()}/api/models/${n}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }); }
  catch (_) { throw fail('ModelFlow ne répond pas : impossible de lire le modèle.', 502); }
  if (res.status === 404) throw fail('Ce modèle n\'existe plus dans ModelFlow.', 404);
  if (!res.ok) throw fail(`ModelFlow a répondu ${res.status}.`, 502);
  return res.json();
}

// L'image du modèle (Buffer JPEG) ou null
async function fetchModelPhoto(id) {
  try {
    const res = await fetch(`${await baseUrl()}/api/models/${parseInt(id, 10)}/photo`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 100 && buf[0] === 0xFF && buf[1] === 0xD8 ? buf : null;
  } catch (_) { return null; }
}

module.exports = { fetchModel, fetchModelPhoto };
