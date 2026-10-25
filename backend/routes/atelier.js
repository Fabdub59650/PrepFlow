/**
 * Page Atelier (v1.25.0) : lancer et terminer les impressions depuis l'écran tactile 7" du Pi 3.
 * Monté sur /api. Lecture seule : les écritures passent par les routes existantes
 * (POST /api/runs/start, POST /api/runs/:id/finish, POST /api/batches/:id/finish,
 * POST /api/projects/:id/assign-spools), donc le comportement reste identique à la page Production.
 *   GET /api/atelier                impressions en cours + projets (avec ce qui reste à lancer) + version
 *   GET /api/atelier/projects/:id   pièces d'un projet prêtes à lancer + bobines à choisir
 */
const router = require('express').Router();
const db = require('../db');
const { loadRuns } = require('./runs');
const { loadParts } = require('./parts');
const { unassignedGroups } = require('../duplicate');

const VERSION = (() => {
  try { return require('../package.json').version; } catch (_) { return null; }
})();

// Une pièce se lance si au moins une bobine est choisie et qu'aucun poids n'est resté sans bobine
// (même règle que startRuns dans routes/runs.js)
const isLaunchable = (spools, orphans) => Number(spools) > 0 && Number(orphans) === 0;

router.get('/atelier', async (req, res) => {
  try {
    const running = await loadRuns({ state: 'en_cours', limit: 200 });
    const [projects] = await db.query(
      `SELECT id, code, name, status, updated_at FROM projects
       WHERE status IN ('preparation','en_cours','termine')
       ORDER BY updated_at DESC LIMIT 300`);
    const todo = new Map(projects.map(p => [p.id, { todo_parts: 0, todo_pieces: 0, todo_time_s: 0, needs_spools: 0 }]));
    if (projects.length) {
      const [parts] = await db.query(
        `SELECT pt.id, pt.project_id, pt.quantity, pt.status, pt.print_time_s,
                ra.n_runs, COALESCE(ra.ok_qty, 0) AS ok_qty, COALESCE(ra.running_qty, 0) AS running_qty,
                (SELECT COUNT(*) FROM part_filaments f WHERE f.part_id = pt.id AND f.filament_id IS NOT NULL) AS spools,
                (SELECT COUNT(*) FROM part_filaments f WHERE f.part_id = pt.id AND f.filament_id IS NULL AND COALESCE(f.weight_g, 0) > 0) AS orphans,
                (SELECT COUNT(*) FROM part_filaments f WHERE f.part_id = pt.id AND f.filament_id IS NULL) AS free_lines
         FROM parts pt
         LEFT JOIN (SELECT part_id, COUNT(*) AS n_runs,
                           SUM(CASE WHEN state='termine' AND result='ok' THEN quantity ELSE 0 END) AS ok_qty,
                           SUM(CASE WHEN state='en_cours' THEN quantity ELSE 0 END) AS running_qty
                    FROM print_runs GROUP BY part_id) ra ON ra.part_id = pt.id
         WHERE pt.project_id IN (?)`, [projects.map(p => p.id)]);
      for (const p of parts) {
        const done = p.n_runs ? Math.min(p.quantity, Number(p.ok_qty)) : (p.status === 'imprime' ? p.quantity : 0);
        const remaining = Math.max(0, p.quantity - done - Number(p.running_qty));
        if (p.status === 'a_trancher' || remaining < 1) continue;
        const launchable = isLaunchable(p.spools, p.orphans);
        const needsSpools = !launchable && Number(p.free_lines) > 0;
        if (!launchable && !needsSpools) continue;      // aucun filament renseigné : à compléter sur le PC
        const t = todo.get(p.project_id);
        t.todo_parts++;
        t.todo_pieces += remaining;
        t.todo_time_s += remaining * (Number(p.print_time_s) || 0);
        if (needsSpools) t.needs_spools++;
      }
    }
    res.json({
      version: VERSION,
      running,
      projects: projects.map(p => ({ ...p, ...todo.get(p.id) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/atelier/projects/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[project]] = await db.query('SELECT id, code, name, status FROM projects WHERE id=?', [id]);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    const parts = await loadParts({ projectId: id });
    const [running] = parts.length ? await db.query(
      `SELECT part_id, SUM(quantity) AS qty FROM print_runs
       WHERE state='en_cours' AND part_id IN (?) GROUP BY part_id`, [parts.map(p => p.id)]) : [[]];
    const runningBy = new Map(running.map(r => [r.part_id, Number(r.qty)]));
    for (const p of parts) {
      const fils = p.filaments || [];
      const orphans = fils.filter(f => !f.filament_id && Number(f.weight_g) > 0).length;
      p.running_qty = runningBy.get(p.id) || 0;
      p.remaining = Math.max(0, p.quantity - p.done_qty - p.running_qty);
      p.launchable = isLaunchable(fils.filter(f => f.filament_id).length, orphans);
      p.needs_spools = !p.launchable && fils.some(f => !f.filament_id);
    }
    res.json({ project, parts, groups: await unassignedGroups(id) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = { router };
