/**
 * Maintenance des imprimantes.
 *   GET    /api/maintenance                        état de toutes les imprimantes (heures, tâches, échéances, historique récent)
 *   POST   /api/printers/:id/maintenance/tasks     créer une tâche { name, interval_hours?, interval_days? }
 *   POST   /api/printers/:id/maintenance/defaults  ajouter les tâches types (modifiables)
 *   PUT    /api/maintenance/tasks/:id              modifier nom / intervalles
 *   DELETE /api/maintenance/tasks/:id
 *   POST   /api/maintenance/tasks/:id/done         « Fait » { done_at?, note?, cost? } : remet le compteur à zéro
 *   DELETE /api/maintenance/log/:id                retirer une entrée d'historique
 *
 * Heures d'une imprimante = heures « déjà faites » saisies + durées réelles de ses impressions terminées
 * (un lancement groupé compte une seule fois). Tout est calculé à la lecture.
 */
const router = require('express').Router();
const db = require('../db');

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const missing = msg => Object.assign(new Error(msg), { status: 404 });
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;

const SOON_RATIO = 0.1;   // « bientôt » : moins de 10 % de l'intervalle restant

// Tâches types proposées sur demande (valeurs modifiables ensuite)
const DEFAULT_TASKS = [
  { name: 'Nettoyage de la buse', interval_hours: 100, interval_days: null },
  { name: 'Tension des courroies', interval_hours: 300, interval_days: null },
  { name: 'Contrôle du plateau', interval_hours: 200, interval_days: null },
  { name: 'Graissage des axes', interval_hours: null, interval_days: 180 },
];

function parseDt(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!m) throw bad('Date invalide (attendu AAAA-MM-JJ HH:MM)');
  return `${m[1]} ${m[2]}:${m[3] || '00'}`;
}

function cleanInterval(v, label) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1 || n > 100000) throw bad(`${label} : entier entre 1 et 100000`);
  return n;
}

/** Heures d'impression de chaque imprimante (à l'instant, ou jusqu'à `at`) : Map(id → heures) */
async function printerHours({ at = null, printerId = null } = {}) {
  const [rows] = await db.query(
    `SELECT pr.id, pr.base_hours, COALESCE(u.secs, 0) AS secs
     FROM printers pr
     LEFT JOIN (
       SELECT printer_id, SUM(d) AS secs FROM (
         SELECT printer_id, COALESCE(batch_id, CONCAT('r', id)) AS k, MAX(duration_s) AS d
         FROM print_runs
         WHERE state='termine' AND duration_s IS NOT NULL ${at ? 'AND ended_at <= ?' : ''}
         GROUP BY printer_id, k) x
       GROUP BY printer_id) u ON u.printer_id = pr.id
     ${printerId ? 'WHERE pr.id = ?' : ''}`, [...(at ? [at] : []), ...(printerId ? [printerId] : [])]);
  return new Map(rows.map(r => [r.id, round1(Number(r.base_hours) + Number(r.secs) / 3600)]));
}

function taskState(t, ref, hoursNow) {
  const out = { hours_left: null, days_left: null, state: 'ok' };
  const ratios = [];
  if (t.interval_hours) {
    out.hours_left = round1(t.interval_hours - (hoursNow - ref.hours));
    ratios.push(out.hours_left / t.interval_hours);
  }
  if (t.interval_days) {
    out.days_left = Math.floor(t.interval_days - ref.age_min / 1440);
    ratios.push(out.days_left / t.interval_days);
  }
  const worst = Math.min(...ratios);
  out.state = worst < 0 ? 'overdue' : (worst <= SOON_RATIO ? 'soon' : 'ok');
  out.ratio = worst;
  return out;
}

async function buildState() {
  const [printers] = await db.query('SELECT id, name, active, base_hours FROM printers ORDER BY sort_order, name');
  const hours = await printerHours();
  const [tasks] = await db.query('SELECT * FROM maintenance_tasks ORDER BY sort_order, id');
  const [logs] = await db.query(
    `SELECT l.id, l.task_id, l.done_at, l.printer_hours, l.note, l.cost,
            TIMESTAMPDIFF(MINUTE, l.done_at, NOW()) AS age_min, t.name AS task_name, t.printer_id
     FROM maintenance_log l JOIN maintenance_tasks t ON t.id = l.task_id
     ORDER BY l.done_at DESC, l.id DESC`);
  const [startAges] = await db.query('SELECT id, TIMESTAMPDIFF(MINUTE, start_at, NOW()) AS age_min FROM maintenance_tasks');
  const startAge = new Map(startAges.map(r => [r.id, Number(r.age_min)]));

  let overdueTotal = 0;
  const out = printers.map(p => {
    const h = hours.get(p.id) ?? Number(p.base_hours);
    const mine = tasks.filter(t => t.printer_id === p.id).map(t => {
      const last = logs.find(l => l.task_id === t.id) || null;
      const ref = last
        ? { hours: Number(last.printer_hours), age_min: Number(last.age_min) }
        : { hours: Number(t.start_hours), age_min: startAge.get(t.id) || 0 };
      return {
        id: t.id, name: t.name, interval_hours: t.interval_hours, interval_days: t.interval_days,
        last_at: last ? last.done_at : null, last_hours: last ? Number(last.printer_hours) : null,
        ...taskState(t, ref, h),
      };
    });
    const overdue = mine.filter(t => t.state === 'overdue').length;
    const soon = mine.filter(t => t.state === 'soon').length;
    overdueTotal += p.active ? overdue : 0;
    const next = [...mine].sort((a, b) => a.ratio - b.ratio)[0] || null;
    const myLogs = logs.filter(l => l.printer_id === p.id);
    const totalCost = myLogs.reduce((a, l) => a + (Number(l.cost) || 0), 0);
    return {
      printer_id: p.id, name: p.name, active: !!p.active,
      base_hours: Number(p.base_hours), hours: h,
      tasks: mine, overdue, soon,
      next: next ? { task: next.name, state: next.state, hours_left: next.hours_left, days_left: next.days_left } : null,
      history: myLogs.slice(0, 15).map(l => ({ id: l.id, task_id: l.task_id, task: l.task_name, done_at: l.done_at,
        printer_hours: Number(l.printer_hours), note: l.note, cost: l.cost === null ? null : Number(l.cost) })),
      cost_total: round2(totalCost),
      cost_per_hour: h > 0 && totalCost > 0 ? round2(totalCost / h) : null,
    };
  });
  return { overdue_total: overdueTotal, printers: out };
}

router.get('/maintenance', async (req, res) => {
  try { res.json(await buildState()); } catch (e) { fail(res, e); }
});

async function nextSort(printerId) {
  const [[{ n }]] = await db.query('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM maintenance_tasks WHERE printer_id=?', [printerId]);
  return n;
}

async function insertTask(printerId, { name, interval_hours, interval_days }) {
  const h = (await printerHours({ printerId })).get(printerId) ?? 0;
  await db.query(
    'INSERT INTO maintenance_tasks (printer_id, name, interval_hours, interval_days, start_hours, sort_order) VALUES (?,?,?,?,?,?)',
    [printerId, name, interval_hours, interval_days, h, await nextSort(printerId)]);
}

router.post('/printers/:id/maintenance/tasks', async (req, res) => {
  try {
    const pid = parseInt(req.params.id, 10);
    const [[pr]] = await db.query('SELECT id FROM printers WHERE id=?', [pid]);
    if (!pr) throw missing('Imprimante introuvable');
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) throw bad('Le nom de la tâche est obligatoire');
    const interval_hours = cleanInterval(req.body.interval_hours, 'Intervalle en heures');
    const interval_days = cleanInterval(req.body.interval_days, 'Intervalle en jours');
    if (!interval_hours && !interval_days) throw bad('Indiquez un intervalle en heures et/ou en jours');
    await insertTask(pid, { name, interval_hours, interval_days });
    res.status(201).json(await buildState());
  } catch (e) { fail(res, e); }
});

router.post('/printers/:id/maintenance/defaults', async (req, res) => {
  try {
    const pid = parseInt(req.params.id, 10);
    const [[pr]] = await db.query('SELECT id FROM printers WHERE id=?', [pid]);
    if (!pr) throw missing('Imprimante introuvable');
    const [existing] = await db.query('SELECT name FROM maintenance_tasks WHERE printer_id=?', [pid]);
    const have = new Set(existing.map(t => t.name.toLowerCase()));
    for (const t of DEFAULT_TASKS) if (!have.has(t.name.toLowerCase())) await insertTask(pid, t);
    res.status(201).json(await buildState());
  } catch (e) { fail(res, e); }
});

router.put('/maintenance/tasks/:id', async (req, res) => {
  try {
    const [[t]] = await db.query('SELECT * FROM maintenance_tasks WHERE id=?', [req.params.id]);
    if (!t) throw missing('Tâche introuvable');
    const b = req.body || {};
    const name = 'name' in b ? String(b.name || '').trim().slice(0, 100) : t.name;
    if (!name) throw bad('Le nom de la tâche est obligatoire');
    const interval_hours = 'interval_hours' in b ? cleanInterval(b.interval_hours, 'Intervalle en heures') : t.interval_hours;
    const interval_days = 'interval_days' in b ? cleanInterval(b.interval_days, 'Intervalle en jours') : t.interval_days;
    if (!interval_hours && !interval_days) throw bad('Indiquez un intervalle en heures et/ou en jours');
    await db.query('UPDATE maintenance_tasks SET name=?, interval_hours=?, interval_days=? WHERE id=?',
      [name, interval_hours, interval_days, t.id]);
    res.json(await buildState());
  } catch (e) { fail(res, e); }
});

router.delete('/maintenance/tasks/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM maintenance_tasks WHERE id=?', [req.params.id]);
    if (!r.affectedRows) throw missing('Tâche introuvable');
    res.json(await buildState());
  } catch (e) { fail(res, e); }
});

router.post('/maintenance/tasks/:id/done', async (req, res) => {
  try {
    const [[t]] = await db.query('SELECT * FROM maintenance_tasks WHERE id=?', [req.params.id]);
    if (!t) throw missing('Tâche introuvable');
    const b = req.body || {};
    const at = parseDt(b.done_at);
    let cost = null;
    if (b.cost !== undefined && b.cost !== null && b.cost !== '') {
      cost = Number(String(b.cost).replace(',', '.'));
      if (!Number.isFinite(cost) || cost < 0 || cost > 100000) throw bad('Coût invalide');
      cost = round2(cost);
    }
    const note = b.note && String(b.note).trim() ? String(b.note).trim() : null;
    const hours = (await printerHours({ at, printerId: t.printer_id })).get(t.printer_id) ?? 0;
    if (at) {
      const [[chk]] = await db.query('SELECT (? > NOW()) AS future', [at]);
      if (chk.future) throw bad('La date ne peut pas être dans le futur');
    }
    await db.query(
      `INSERT INTO maintenance_log (task_id, done_at, printer_hours, note, cost)
       VALUES (?, ${at ? '?' : 'NOW()'}, ?, ?, ?)`,
      [t.id, ...(at ? [at] : []), hours, note, cost]);
    res.status(201).json(await buildState());
  } catch (e) { fail(res, e); }
});

router.delete('/maintenance/log/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM maintenance_log WHERE id=?', [req.params.id]);
    if (!r.affectedRows) throw missing('Entrée introuvable');
    res.json(await buildState());
  } catch (e) { fail(res, e); }
});

module.exports = { router, buildState };
