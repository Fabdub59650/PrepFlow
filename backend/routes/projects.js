const router = require('express').Router();
const db = require('../db');
const { loadParts } = require('./parts');
const { assignCode, withRetry } = require('../codes');
const { parseThemeNames, themesByProject, setProjectThemes } = require('./themes');
const { duplicateProject, unassignedGroups, assignSpools } = require('../duplicate');

// Lien source : http(s) uniquement (jamais javascript:, data:…), 500 caractères max
function cleanSourceUrl(v) {
  const u = String(v == null ? '' : v).trim();
  if (!u) return { value: null };
  if (u.length > 500) return { error: 'Lien trop long (500 caractères maximum).' };
  let ok = false;
  try { const x = new URL(u); ok = x.protocol === 'http:' || x.protocol === 'https:'; } catch { ok = false; }
  if (!ok) return { error: 'Le lien doit commencer par http:// ou https://' };
  return { value: u };
}

const STATUSES = ['idee', 'preparation', 'en_cours', 'termine', 'archive'];

// Liste des projets avec leurs totaux (temps, poids, avancement)
router.get('/', async (req, res) => {
  try {
    const withArchived = req.query.archived === '1';
    const [rows] = await db.query(
      `SELECT p.*,
         COUNT(pt.id)                                         AS parts_count,
         COALESCE(SUM(pt.quantity), 0)                        AS pieces_count,
         COALESCE(SUM(CASE WHEN ra.n_runs IS NULL THEN (CASE WHEN pt.status='imprime' THEN pt.quantity ELSE 0 END)
                           ELSE LEAST(pt.quantity, ra.ok_qty) END), 0) AS pieces_done,
         COALESCE(SUM(pt.quantity * COALESCE(pt.print_time_s, 0)), 0) AS total_time_s,
         COALESCE(SUM(pt.quantity * COALESCE(w.unit_weight, 0)), 0)   AS total_weight_g,
         COALESCE(MAX(sp.spools_count), 0)                    AS spools_count,
         MAX(sp.spools_names)                                 AS spools_names,
         (SELECT version FROM project_photos WHERE project_id = p.id) AS photo_v
       FROM projects p
       LEFT JOIN parts pt ON pt.project_id = p.id
       LEFT JOIN (SELECT part_id, COUNT(*) AS n_runs,
                         COALESCE(SUM(CASE WHEN state='termine' AND result='ok' THEN quantity ELSE 0 END), 0) AS ok_qty
                  FROM print_runs GROUP BY part_id) ra ON ra.part_id = pt.id
       LEFT JOIN (SELECT part_id, SUM(weight_g) AS unit_weight
                  FROM part_filaments GROUP BY part_id) w ON w.part_id = pt.id
       -- Bobines différentes réellement choisies dans le projet (les intentions sans bobine ne comptent pas)
       LEFT JOIN (SELECT p2.project_id,
                         COUNT(DISTINCT pf.filament_id) AS spools_count,
                         GROUP_CONCAT(DISTINCT CONCAT(
                           COALESCE(fc.name, CONCAT('Filament ', pf.filament_id)),
                           IF(fc.spool_number IS NULL OR TRIM(fc.spool_number) = '', '', CONCAT(' (', TRIM(fc.spool_number), ')'))
                         ) ORDER BY fc.name SEPARATOR ', ') AS spools_names
                  FROM part_filaments pf
                  JOIN parts p2 ON p2.id = pf.part_id
                  LEFT JOIN filament_cache fc ON fc.id = pf.filament_id
                  WHERE pf.filament_id IS NOT NULL
                  GROUP BY p2.project_id) sp ON sp.project_id = p.id
       ${withArchived ? '' : "WHERE p.status <> 'archive'"}
       GROUP BY p.id
       ORDER BY FIELD(p.status,'en_cours','preparation','idee','termine','archive'), p.updated_at DESC`
    );
    const themes = await themesByProject(rows.map(r => r.id));
    for (const r of rows) r.themes = themes.get(r.id) || [];
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom du projet est obligatoire' });
    const srcUrl = cleanSourceUrl(req.body.source_url);
    if (srcUrl.error) return res.status(400).json({ error: srcUrl.error });
    // Création et attribution du code dans la même transaction
    // (rejouée en cas d'interblocage entre deux créations simultanées)
    const id = await withRetry(async () => {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const [r] = await conn.query("INSERT INTO projects (name, notes, source_url, status) VALUES (?, ?, ?, 'idee')", [name, req.body.notes || null, srcUrl.value]);
        await assignCode(r.insertId, conn);
        await conn.commit();
        return r.insertId;
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally { conn.release(); }
    });
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [id]);
    row.themes = [];
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dupliquer un projet : mêmes pièces, sans historique, imprimante ni bobines choisies (matière et couleur gardées)
router.post('/:id/duplicate', async (req, res) => {
  try {
    const id = await duplicateProject(parseInt(req.params.id, 10), req.body && req.body.name);
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [id]);
    row.themes = (await themesByProject([id])).get(id) || [];
    res.status(201).json({ project: row, groups: await unassignedGroups(id) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Choisir des bobines pour les lignes sans bobine : [{ material, color_name, filament_id }]
router.post('/:id/assign-spools', async (req, res) => {
  try {
    const list = Array.isArray(req.body && req.body.assignments) ? req.body.assignments : [];
    if (!list.length) return res.status(400).json({ error: 'Aucune bobine à affecter' });
    const [[p]] = await db.query('SELECT id FROM projects WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Projet introuvable' });
    const lines = await assignSpools(p.id, list);
    res.json({ lines, groups: await unassignedGroups(p.id) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Projet complet : en-tête + pièces (avec leurs filaments)
router.get('/:id', async (req, res) => {
  try {
    const [[project]] = await db.query('SELECT * FROM projects WHERE id=?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    project.parts = await loadParts({ projectId: project.id });
    project.themes = (await themesByProject([project.id])).get(project.id) || [];
    const [[ph]] = await db.query('SELECT version FROM project_photos WHERE project_id=?', [project.id]);
    project.photo_v = ph ? ph.version : null;
    res.json(project);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mise à jour partielle : seuls les champs envoyés sont modifiés
router.put('/:id', async (req, res) => {
  try {
    const sets = [], vals = [];
    let themeNames = null;
    if ('themes' in req.body) {
      try { themeNames = parseThemeNames(req.body.themes); }
      catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    }
    if ('name' in req.body) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Le nom du projet est obligatoire' });
      sets.push('name=?'); vals.push(name);
    }
    if ('notes' in req.body) { sets.push('notes=?'); vals.push(req.body.notes || null); }
    if ('source_url' in req.body) {
      const r = cleanSourceUrl(req.body.source_url);
      if (r.error) return res.status(400).json({ error: r.error });
      sets.push('source_url=?'); vals.push(r.value);
    }
    for (const [k, max] of [['margin_pct', 1000], ['min_piece_price', 10000]]) {
      if (!(k in req.body)) continue;
      const v = req.body[k];
      if (v === null || v === '') { sets.push(`${k}=NULL`); continue; }
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > max) return res.status(400).json({ error: `Valeur invalide pour ${k}` });
      sets.push(`${k}=?`); vals.push(Math.round(n * 100) / 100);
    }
    if ('status' in req.body) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Statut inconnu' });
      sets.push('status=?'); vals.push(req.body.status);
    }
    if (sets.length) {
      await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id=?`, [...vals, req.params.id]);
    }
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Projet introuvable' });
    if (themeNames) await setProjectThemes(row.id, themeNames);
    row.themes = (await themesByProject([row.id])).get(row.id) || [];
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM projects WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Projet introuvable' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
