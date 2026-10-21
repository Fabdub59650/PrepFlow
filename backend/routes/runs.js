/**
 * Suivi de production — impressions (runs) des pièces.
 * Monté sur /api :
 *   POST   /api/runs/start                  démarrer un lancement (groupé si plusieurs pièces)
 *   POST   /api/parts/:id/runs/start        démarrer une seule pièce
 *   POST   /api/runs/:id/finish             terminer une impression (ok / raté / annulé)
 *   POST   /api/batches/:batchId/finish     terminer d'un coup toutes les impressions d'un lancement groupé
 *   PUT    /api/runs/:id                    corriger notes et poids d'une impression terminée
 *   DELETE /api/runs/:id                    supprimer une impression (erreur de saisie)
 *   GET    /api/runs                        liste (?state=en_cours|termine, ?project_id=, ?part_id=, ?limit=)
 *   GET    /api/projects/:id/runs           impressions d'un projet
 *   GET    /api/runs/waste                  gâchis : grammes, heures et coût perdus sur les impressions ratées (?days=)
 *
 * PrepFlow n'écrit jamais dans FilaFlow : la consommation est enregistrée ici (print_run_filaments)
 * et le reste estimé des bobines se calcule à la lecture (voir filaflow.js).
 */
const crypto = require('crypto');
const router = require('express').Router();
const db = require('../db');

const RESULTS = ['ok', 'rate', 'annule'];
const MAX_GROUP = 50;

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const missing = msg => Object.assign(new Error(msg), { status: 404 });
const conflict = msg => Object.assign(new Error(msg), { status: 409 });
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

const round2 = n => Math.round(n * 100) / 100;

// « 2026-10-16 21:05[:00] » ou « 2026-10-16T21:05 » → « 2026-10-16 21:05:00 » (heure locale du Pi) ; null si absent
function parseDt(v, label) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!m) throw bad(`${label} invalide (attendu AAAA-MM-JJ HH:MM)`);
  const out = `${m[1]} ${m[2]}:${m[3] || '00'}`;
  if (Number.isNaN(Date.parse(out.replace(' ', 'T') + 'Z'))) throw bad(`${label} invalide`);
  return out;
}

async function withTx(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }
}

// ── Statut de la pièce, déduit de ses impressions ─────────────
// imprime  : les impressions réussies couvrent la quantité
// en_cours : une impression est active
// pret     : impressions terminées mais quantité non atteinte (ou dernière impression supprimée)
// Une pièce sans aucune impression garde son statut manuel.
async function recomputePartStatus(conn, partId) {
  const [[part]] = await conn.query('SELECT id, project_id, quantity, status FROM parts WHERE id=? FOR UPDATE', [partId]);
  if (!part) return null;
  const [[agg]] = await conn.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN state='en_cours' THEN 1 ELSE 0 END), 0) AS running,
            COALESCE(SUM(CASE WHEN state='termine' AND result='ok' THEN quantity ELSE 0 END), 0) AS done
     FROM print_runs WHERE part_id=?`, [partId]);
  const total = Number(agg.total), running = Number(agg.running), done = Number(agg.done);
  let next = part.status;
  if (total > 0 && done >= part.quantity) next = 'imprime';
  else if (running > 0) next = 'en_cours';
  else if (total > 0) next = part.status === 'a_trancher' ? 'a_trancher' : 'pret';
  else if (part.status === 'en_cours') next = 'pret';
  if (next !== part.status) {
    await conn.query('UPDATE parts SET status=? WHERE id=?', [next, partId]);
  }
  await conn.query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [part.project_id]);
  return next;
}

// ── Lecture ───────────────────────────────────────────────────
async function loadRuns({ ids = null, state = null, projectId = null, partId = null, limit = 200 } = {}) {
  const where = [], params = [];
  if (ids)       { where.push('r.id IN (?)');      params.push(ids.length ? ids : [0]); }
  if (state)     { where.push('r.state=?');        params.push(state); }
  if (projectId) { where.push('p.project_id=?');   params.push(projectId); }
  if (partId)    { where.push('r.part_id=?');      params.push(partId); }
  const [runs] = await db.query(
    `SELECT r.*, p.name AS part_name, p.file_name, p.quantity AS part_quantity, p.print_time_s,
            p.project_id, pj.code AS project_code, pj.name AS project_name,
            prn.name AS printer_name,
            CASE WHEN p.print_time_s IS NULL THEN NULL ELSE p.print_time_s * r.quantity END AS planned_time_s,
            CASE WHEN r.state='en_cours' THEN GREATEST(0, TIMESTAMPDIFF(SECOND, r.started_at, NOW())) ELSE NULL END AS elapsed_s,
            -- Lancement groupé : temps prévu de tout le plateau (null si une pièce n'a pas de temps)
            (SELECT CASE WHEN COUNT(*) = COUNT(p2.print_time_s) THEN SUM(p2.print_time_s * r2.quantity) END
               FROM print_runs r2 JOIN parts p2 ON p2.id = r2.part_id
               WHERE r.batch_id IS NOT NULL AND r2.batch_id = r.batch_id) AS batch_planned_time_s
     FROM print_runs r
     JOIN parts p     ON p.id = r.part_id
     JOIN projects pj ON pj.id = p.project_id
     LEFT JOIN printers prn ON prn.id = r.printer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (r.state='en_cours') DESC, COALESCE(r.ended_at, r.started_at) DESC, r.id DESC
     LIMIT ?`, [...params, Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000)]);
  if (!runs.length) return [];
  const [fils] = await db.query(
    `SELECT rf.run_id, rf.filament_id, rf.material, rf.color_name, rf.planned_g, rf.weight_g,
            fc.name, fc.spool_number
     FROM print_run_filaments rf LEFT JOIN filament_cache fc ON fc.id = rf.filament_id
     WHERE rf.run_id IN (?) ORDER BY rf.id`, [runs.map(r => r.id)]);
  for (const r of runs) r.filaments = fils.filter(f => f.run_id === r.id).map(({ run_id, ...f }) => f);
  return runs;
}

router.get('/runs', async (req, res) => {
  try {
    const state = req.query.state || null;
    if (state && !['en_cours', 'termine'].includes(state)) throw bad('État inconnu');
    res.json(await loadRuns({
      state,
      projectId: parseInt(req.query.project_id, 10) || null,
      partId: parseInt(req.query.part_id, 10) || null,
      limit: req.query.limit,
    }));
  } catch (e) { fail(res, e); }
});


// ── Gâchis ────────────────────────────────────────────────────
// Impressions ratées sur la période : filament consommé, temps machine et coût matière perdus.
// Temps : la durée réelle d'un lancement groupé est celle du plateau ; elle est répartie à parts égales
// entre les pièces du lot pour ne pas être comptée plusieurs fois.
router.get('/runs/waste', async (req, res) => {
  try {
    const days = Math.max(0, parseInt(req.query.days, 10) || 0);
    const [runs] = await db.query(
      `SELECT r.id, r.result, r.batch_id, r.duration_s, r.ended_at, r.printer_id, p.project_id,
              pj.code AS project_code, pj.name AS project_name, prn.name AS printer_name
       FROM print_runs r
       JOIN parts p ON p.id = r.part_id
       JOIN projects pj ON pj.id = p.project_id
       LEFT JOIN printers prn ON prn.id = r.printer_id
       WHERE r.state='termine' AND r.result IN ('ok','rate')
         ${days ? 'AND r.ended_at >= DATE_SUB(NOW(), INTERVAL ? DAY)' : ''}`, days ? [days] : []);
    const empty = { days, totals: { runs: 0, failed: 0, fail_pct: 0, grams_used: 0, grams_lost: 0, seconds_lost: 0, cost_lost: 0, cost_complete: true },
      by_project: [], by_printer: [], by_filament: [], by_month: [] };
    if (!runs.length) return res.json(empty);
    const [fils] = await db.query(
      `SELECT rf.run_id, rf.filament_id, rf.weight_g, fc.name, fc.spool_number, fc.price, fc.weight_total
       FROM print_run_filaments rf LEFT JOIN filament_cache fc ON fc.id = rf.filament_id
       WHERE rf.run_id IN (?)`, [runs.map(r => r.id)]);
    const filsBy = new Map();
    for (const f of fils) { if (!filsBy.has(f.run_id)) filsBy.set(f.run_id, []); filsBy.get(f.run_id).push(f); }
    const batchSize = new Map();
    for (const r of runs) if (r.batch_id) batchSize.set(r.batch_id, (batchSize.get(r.batch_id) || 0) + 1);

    const t = empty.totals;
    const groups = { project: new Map(), printer: new Map(), filament: new Map(), month: new Map() };
    const bump = (map, key, label, add) => {
      if (!map.has(key)) map.set(key, { key, label, runs: 0, failed: 0, grams_lost: 0, seconds_lost: 0, cost_lost: 0 });
      const g = map.get(key);
      for (const [k, v] of Object.entries(add)) g[k] += v;
    };
    for (const r of runs) {
      const lines = filsBy.get(r.id) || [];
      const used = lines.reduce((a, f) => a + (Number(f.weight_g) || 0), 0);
      t.runs++; t.grams_used += used;
      const failed = r.result === 'rate';
      const secs = failed && r.duration_s ? r.duration_s / (r.batch_id ? batchSize.get(r.batch_id) : 1) : 0;
      let cost = 0;
      const perLine = [];
      for (const f of lines) {
        const w = Number(f.weight_g) || 0;
        const ppg = f.price !== null && f.price !== undefined ? Number(f.price) / 1000 : null;
        if (failed && w > 0 && ppg === null) t.cost_complete = false;
        const c = failed && ppg !== null ? w * ppg : 0;
        cost += c; perLine.push({ f, w, c });
      }
      const month = String(r.ended_at).slice(0, 7);
      const base = { runs: 1, failed: failed ? 1 : 0, grams_lost: failed ? used : 0, seconds_lost: secs, cost_lost: cost };
      bump(groups.project, r.project_id, `${r.project_code ? r.project_code + ' · ' : ''}${r.project_name}`, base);
      bump(groups.printer, r.printer_id ?? 0, r.printer_name || 'Sans imprimante', base);
      bump(groups.month, month, month, base);
      if (failed) for (const { f, w, c } of perLine) {
        bump(groups.filament, f.filament_id ?? 0, f.name ? `${f.name}${f.spool_number ? ' (' + String(f.spool_number).trim() + ')' : ''}` : 'Bobine inconnue',
          { runs: 0, failed: 1, grams_lost: w, seconds_lost: 0, cost_lost: c });
      }
      if (failed) { t.failed++; t.grams_lost += used; t.seconds_lost += secs; t.cost_lost += cost; }
    }
    t.fail_pct = Math.round(1000 * t.failed / t.runs) / 10;
    const out = m => [...m.values()].map(g => ({ ...g, grams_lost: round2(g.grams_lost), seconds_lost: Math.round(g.seconds_lost), cost_lost: round2(g.cost_lost) }));
    t.grams_used = round2(t.grams_used); t.grams_lost = round2(t.grams_lost);
    t.seconds_lost = Math.round(t.seconds_lost); t.cost_lost = round2(t.cost_lost);
    const byLost = (a, b) => b.grams_lost - a.grams_lost || b.failed - a.failed;
    res.json({ days, totals: t,
      by_project: out(groups.project).filter(g => g.failed).sort(byLost),
      by_printer: out(groups.printer).sort(byLost),
      by_filament: out(groups.filament).sort(byLost),
      by_month: out(groups.month).sort((a, b) => b.key.localeCompare(a.key)) });
  } catch (e) { fail(res, e); }
});

router.get('/projects/:id/runs', async (req, res) => {
  try {
    res.json(await loadRuns({ projectId: parseInt(req.params.id, 10), limit: req.query.limit }));
  } catch (e) { fail(res, e); }
});

// ── Démarrer ──────────────────────────────────────────────────
// Bobines d'une pièce, regroupées par bobine FilaFlow : { filament_id, material, color_name, unit_g }
async function partSpools(conn, part) {
  const [lines] = await conn.query(
    'SELECT filament_id, weight_g FROM part_filaments WHERE part_id=? ORDER BY sort_order, id', [part.id]);
  const byId = new Map();
  for (const l of lines) {
    const w = l.weight_g === null || l.weight_g === undefined ? null : Number(l.weight_g);
    if (l.filament_id === null) {
      if (w) throw bad(`La pièce « ${part.name || '(sans nom)'} » a un poids sans bobine choisie`);
      continue;
    }
    byId.set(l.filament_id, (byId.get(l.filament_id) || 0) + (w || 0));
  }
  if (!byId.size) throw bad(`La pièce « ${part.name || '(sans nom)'} » n'a pas de bobine choisie`);
  const ids = [...byId.keys()];
  const [cached] = await conn.query('SELECT id, material, color_name FROM filament_cache WHERE id IN (?)', [ids]);
  const info = new Map(cached.map(c => [c.id, c]));
  return ids.map(id => ({
    filament_id: id,
    material: info.get(id)?.material ?? null,
    color_name: info.get(id)?.color_name ?? null,
    unit_g: byId.get(id),
  }));
}

/**
 * items : [{ part_id, quantity }] — une seule entrée = impression simple, plusieurs = lancement groupé
 * (un run par pièce, même imprimante, même heure de début, même batch_id).
 */
async function startRuns(body) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw bad('Aucune pièce à lancer');
  if (rawItems.length > MAX_GROUP) throw bad(`Un lancement groupé est limité à ${MAX_GROUP} pièces`);

  // Même pièce citée deux fois : quantités additionnées
  const wanted = new Map();
  for (const it of rawItems) {
    const partId = parseInt(it.part_id, 10);
    const qty = it.quantity === undefined || it.quantity === null || it.quantity === '' ? 1 : parseInt(it.quantity, 10);
    if (!Number.isFinite(partId)) throw bad('Pièce invalide');
    if (!Number.isFinite(qty) || qty < 1) throw bad('La quantité doit être un entier ≥ 1');
    wanted.set(partId, (wanted.get(partId) || 0) + qty);
  }
  const startedAt = parseDt(body.started_at, 'Heure de début');

  const ids = await withTx(async conn => {
    const partIds = [...wanted.keys()].sort((a, b) => a - b);   // ordre fixe : évite les interblocages
    const [parts] = await conn.query(
      'SELECT id, project_id, name, printer_id FROM parts WHERE id IN (?) ORDER BY id FOR UPDATE', [partIds]);
    if (parts.length !== partIds.length) throw missing('Pièce introuvable');

    // Imprimante : celle demandée, sinon celle que partagent toutes les pièces
    let printerId = body.printer_id === undefined || body.printer_id === null || body.printer_id === ''
      ? null : parseInt(body.printer_id, 10);
    if (printerId !== null && !Number.isFinite(printerId)) throw bad('Imprimante invalide');
    if (printerId === null) {
      const shared = new Set(parts.map(p => p.printer_id));
      if (shared.size === 1 && parts[0].printer_id !== null) printerId = parts[0].printer_id;
      else throw bad('Choisissez une imprimante');
    }
    const [[printer]] = await conn.query('SELECT id, active FROM printers WHERE id=?', [printerId]);
    if (!printer) throw bad('Imprimante inconnue');
    if (!printer.active) throw bad('Cette imprimante est désactivée');

    const batchId = parts.length > 1 ? crypto.randomUUID() : null;
    const created = [];
    for (const part of parts) {
      const qty = wanted.get(part.id);
      const spools = await partSpools(conn, part);
      const [r] = await conn.query(
        `INSERT INTO print_runs (part_id, printer_id, batch_id, quantity, started_at)
         VALUES (?, ?, ?, ?, COALESCE(?, NOW()))`,
        [part.id, printerId, batchId, qty, startedAt]);
      await conn.query(
        'INSERT INTO print_run_filaments (run_id, filament_id, material, color_name, planned_g, weight_g) VALUES ?',
        [spools.map(s => {
          const planned = round2(s.unit_g * qty);
          return [r.insertId, s.filament_id, s.material, s.color_name, planned, planned];
        })]);
      await recomputePartStatus(conn, part.id);
      created.push(r.insertId);
    }
    // Premier lancement d'un projet en préparation : il passe « en cours »
    const projectIds = [...new Set(parts.map(p => p.project_id))];
    await conn.query("UPDATE projects SET status='en_cours' WHERE id IN (?) AND status='preparation'", [projectIds]);
    return created;
  });
  return loadRuns({ ids });
}

router.post('/runs/start', async (req, res) => {
  try { res.status(201).json(await startRuns(req.body || {})); }
  catch (e) { fail(res, e); }
});

router.post('/parts/:id/runs/start', async (req, res) => {
  try {
    const b = req.body || {};
    res.status(201).json(await startRuns({
      printer_id: b.printer_id, started_at: b.started_at,
      items: [{ part_id: req.params.id, quantity: b.quantity }],
    }));
  } catch (e) { fail(res, e); }
});

// ── Terminer ──────────────────────────────────────────────────
// Poids retenus : prévu × % réalisé, sauf correction explicite par bobine
function cleanWeights(list, rows) {
  if (list === undefined || list === null) return new Map();
  if (!Array.isArray(list)) throw bad('weights doit être une liste');
  const known = new Set(rows.map(r => r.filament_id));
  const out = new Map();
  for (const w of list) {
    const fid = parseInt(w.filament_id, 10);
    const g = Number(w.weight_g);
    if (!known.has(fid)) throw bad("Bobine inconnue pour cette impression");
    if (w.weight_g === null || w.weight_g === '' || !Number.isFinite(g) || g < 0) throw bad('Poids invalide');
    out.set(fid, round2(g));
  }
  return out;
}

async function finishRun(conn, runId, body) {
  const [[run]] = await conn.query('SELECT * FROM print_runs WHERE id=? FOR UPDATE', [runId]);
  if (!run) throw missing('Impression introuvable');
  if (run.state !== 'en_cours') throw conflict('Cette impression est déjà terminée');

  const result = body.result;
  if (!RESULTS.includes(result)) throw bad('Résultat inconnu (ok, rate ou annule)');
  let pct;
  if (result === 'ok') pct = 100;
  else if (result === 'annule') pct = 0;
  else {
    pct = parseInt(body.progress_pct, 10);
    if (!Number.isFinite(pct) || pct < 0 || pct > 99) throw bad('Pourcentage réalisé requis (0 à 99) pour une impression ratée');
  }
  const endedAt = parseDt(body.ended_at, 'Heure de fin');
  if (endedAt && endedAt < run.started_at) throw bad("L'heure de fin précède l'heure de début");

  const [rows] = await conn.query('SELECT filament_id, planned_g FROM print_run_filaments WHERE run_id=?', [run.id]);
  const overrides = result === 'annule' ? new Map() : cleanWeights(body.weights, rows);
  for (const r of rows) {
    const g = result === 'annule' ? 0
      : overrides.has(r.filament_id) ? overrides.get(r.filament_id)
      : round2(Number(r.planned_g) * pct / 100);
    await conn.query('UPDATE print_run_filaments SET weight_g=? WHERE run_id=? AND filament_id=?', [g, run.id, r.filament_id]);
  }
  const notes = 'notes' in body ? (body.notes && String(body.notes).trim() ? String(body.notes).trim() : null) : run.notes;
  await conn.query(
    `UPDATE print_runs
     SET state='termine', result=?, progress_pct=?, ended_at=COALESCE(?, NOW()),
         duration_s=GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, COALESCE(?, NOW()))), notes=?
     WHERE id=?`, [result, pct, endedAt, endedAt, notes, run.id]);
  await recomputePartStatus(conn, run.part_id);
  return run.id;
}

router.post('/runs/:id/finish', async (req, res) => {
  try {
    const id = await withTx(conn => finishRun(conn, req.params.id, req.body || {}));
    res.json((await loadRuns({ ids: [id] }))[0]);
  } catch (e) { fail(res, e); }
});

// Lancement groupé : même résultat pour toutes les impressions encore en cours du lot
router.post('/batches/:batchId/finish', async (req, res) => {
  try {
    const { weights, ...body } = req.body || {};     // pas de poids corrigés en lot : un par impression
    const ids = await withTx(async conn => {
      const [runs] = await conn.query(
        "SELECT id FROM print_runs WHERE batch_id=? AND state='en_cours' ORDER BY id FOR UPDATE", [req.params.batchId]);
      if (!runs.length) throw missing('Aucune impression en cours pour ce lancement');
      for (const r of runs) await finishRun(conn, r.id, body);
      return runs.map(r => r.id);
    });
    res.json(await loadRuns({ ids }));
  } catch (e) { fail(res, e); }
});

// ── Corriger / supprimer ──────────────────────────────────────
router.put('/runs/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const id = await withTx(async conn => {
      const [[run]] = await conn.query('SELECT * FROM print_runs WHERE id=? FOR UPDATE', [req.params.id]);
      if (!run) throw missing('Impression introuvable');
      if ('notes' in b) {
        await conn.query('UPDATE print_runs SET notes=? WHERE id=?',
          [b.notes && String(b.notes).trim() ? String(b.notes).trim() : null, run.id]);
      }
      if ('weights' in b) {
        if (run.state !== 'termine') throw conflict("Les poids se corrigent à la fin de l'impression");
        const [rows] = await conn.query('SELECT filament_id FROM print_run_filaments WHERE run_id=?', [run.id]);
        for (const [fid, g] of cleanWeights(b.weights, rows)) {
          await conn.query('UPDATE print_run_filaments SET weight_g=? WHERE run_id=? AND filament_id=?', [g, run.id, fid]);
        }
      }
      return run.id;
    });
    res.json((await loadRuns({ ids: [id] }))[0]);
  } catch (e) { fail(res, e); }
});

router.delete('/runs/:id', async (req, res) => {
  try {
    await withTx(async conn => {
      const [[run]] = await conn.query('SELECT id, part_id FROM print_runs WHERE id=? FOR UPDATE', [req.params.id]);
      if (!run) throw missing('Impression introuvable');
      await conn.query('DELETE FROM print_runs WHERE id=?', [run.id]);
      await recomputePartStatus(conn, run.part_id);
    });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

module.exports = { router, loadRuns };
