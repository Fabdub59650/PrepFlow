/**
 * codes.js — Code unique des projets : P + AAMM + numéro du mois sur 2 chiffres
 *   P261001 = 1er projet d'octobre 2026, P261002 = 2e…, P261101 = 1er de novembre.
 * Le numéro repart à 01 chaque mois et n'est jamais réutilisé (table project_code_counters),
 * même après suppression d'un projet : un dossier portant ce code peut exister sur l'ordinateur.
 * Au-delà de 99 projets dans un mois, le numéro passe simplement à 3 chiffres (P2610100).
 */
const db = require('./db');

// « 2026-10-02 18:34:00 » → « 2610 » (date de création telle qu'enregistrée, heure du Pi)
const periodOf = createdAt => {
  const s = String(createdAt);
  return s.slice(2, 4) + s.slice(5, 7);
};
const formatCode = (period, seq) => 'P' + period + String(seq).padStart(2, '0');

/** Attribue un code au projet (dans la transaction de l'appelant si conn est fourni) */
async function assignCode(projectId, conn = null) {
  const own = !conn;
  const c = conn || await db.getConnection();
  try {
    if (own) await c.beginTransaction();
    const [[p]] = await c.query('SELECT id, code, created_at FROM projects WHERE id=? FOR UPDATE', [projectId]);
    if (!p) throw new Error('Projet introuvable');
    if (p.code) { if (own) await c.commit(); return p.code; }
    const period = periodOf(p.created_at);
    // Verrouille la ligne du compteur du mois (créée si besoin) avant de lire le dernier numéro
    await c.query('INSERT INTO project_code_counters (period, last_seq) VALUES (?, 0) ON DUPLICATE KEY UPDATE last_seq = last_seq', [period]);
    const [[counter]] = await c.query('SELECT last_seq FROM project_code_counters WHERE period=? FOR UPDATE', [period]);
    // Sécurité : ne jamais repartir en dessous d'un code existant (compteur perdu, restauration…)
    const [[{ maxSeq }]] = await c.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(code, 6) AS UNSIGNED)), 0) AS maxSeq FROM projects WHERE code LIKE ?",
      ['P' + period + '%']);
    const seq = Math.max(counter.last_seq, maxSeq) + 1;
    const code = formatCode(period, seq);
    await c.query('UPDATE project_code_counters SET last_seq=? WHERE period=?', [seq, period]);
    await c.query('UPDATE projects SET code=? WHERE id=?', [code, p.id]);
    if (own) await c.commit();
    return code;
  } catch (e) {
    if (own) await c.rollback().catch(() => {});
    throw e;
  } finally {
    if (own) c.release();
  }
}

/** Projets sans code (créés avant la v1.8.0) : codes attribués dans l'ordre chronologique */
async function backfillCodes() {
  const [rows] = await db.query('SELECT id FROM projects WHERE code IS NULL ORDER BY created_at, id');
  for (const r of rows) await assignCode(r.id);
  if (rows.length) console.log(`[Codes] ${rows.length} projet(s) existant(s) ont reçu un code`);
}

/** Rejoue fn si MariaDB signale un interblocage (créations simultanées) */
async function withRetry(fn, attempts = 6) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const retryable = e && (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT' || e.code === 'ER_DUP_ENTRY');
      if (!retryable || i >= attempts) throw e;
      await new Promise(r => setTimeout(r, 20 + Math.random() * 80 * i));
    }
  }
}

module.exports = { assignCode, backfillCodes, formatCode, periodOf, withRetry };
