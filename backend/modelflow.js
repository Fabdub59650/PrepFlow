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

// Un projet relié vient d'être terminé : le modèle passe « Imprimé » dans ModelFlow (jamais l'inverse).
// Ne lève jamais d'erreur : { code, name } si le modèle a changé, { failed: true } si ModelFlow n'a pas pu être mis à jour,
// null s'il n'y avait rien à faire (modèle déjà « Imprimé » ou introuvable).
async function markModelPrinted(id) {
  const n = parseInt(id, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  try {
    const url = `${await baseUrl()}/api/models/${n}`;
    const cur = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (cur.status === 404) return null;
    if (!cur.ok) return { failed: true };
    const m = await cur.json();
    if (m.status === 'imprime') return null;
    const put = await fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'imprime' }), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return put.ok ? { code: m.code, name: m.name } : { failed: true };
  } catch (_) { return { failed: true }; }
}

module.exports = { fetchModel, fetchModelPhoto, markModelPrinted };
