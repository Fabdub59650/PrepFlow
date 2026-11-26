const router = require('express').Router();
const db = require('../db');
const { loadParts } = require('./parts');
const { assignCode, withRetry } = require('../codes');
const { parseThemeNames, themesByProject, setProjectThemes } = require('./themes');
const { duplicateProject, unassignedGroups, assignSpools } = require('../duplicate');
const { fetchModel, fetchModelPhoto, markModelPrinted } = require('../modelflow');

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

// Reprend du modèle ce qui manque au projet : lien source et image (jamais d'écrasement).
// Renvoie la liste de ce qui a été repris : ['lien', 'image']
async function fillFromModel(projectId, model) {
  const filled = [];
  const [[p]] = await db.query('SELECT source_url FROM projects WHERE id=?', [projectId]);
  if (p && !p.source_url && cleanSourceUrl(model.source_url).value) {
    await db.query('UPDATE projects SET source_url=? WHERE id=?', [model.source_url, projectId]);
    filled.push('lien');
  }
  const [[ph]] = await db.query('SELECT 1 AS x FROM project_photos WHERE project_id=?', [projectId]);
  if (!ph && model.photo_v) {
    const buf = await fetchModelPhoto(model.id);
    if (buf) {
      await db.query("INSERT INTO project_photos (project_id, mime, data) VALUES (?, 'image/jpeg', ?)", [projectId, buf]);
      filled.push('image');
    }
  }
  return filled;
}

const STATUSES = ['preparation', 'en_cours', 'termine', 'archive'];

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
         -- Reste à imprimer (page Accueil) : temps des pièces pas encore réussies, et pièces sans temps saisi
         COALESCE(SUM(GREATEST(0, pt.quantity - CASE WHEN ra.n_runs IS NULL THEN (CASE WHEN pt.status='imprime' THEN pt.quantity ELSE 0 END)
                           ELSE LEAST(pt.quantity, ra.ok_qty) END) * COALESCE(pt.print_time_s, 0)), 0) AS remaining_time_s,
         COALESCE(SUM(pt.print_time_s IS NULL AND CASE WHEN ra.n_runs IS NULL THEN pt.status <> 'imprime'
                           ELSE ra.ok_qty < pt.quantity END), 0) AS remaining_untimed,
         COALESCE(MAX(sp.spools_count), 0)                    AS spools_count,
         MAX(sp.spools_names)                                 AS spools_names,
         (SELECT version FROM project_photos WHERE project_id = p.id) AS photo_v,
         COALESCE(MAX(inc.incomplete_parts), 0) AS incomplete_parts,
         COALESCE(MAX(inc.miss_spool), 0)   AS miss_spool,
         COALESCE(MAX(inc.miss_weight), 0)  AS miss_weight,
         COALESCE(MAX(inc.miss_time), 0)    AS miss_time,
         COALESCE(MAX(inc.miss_printer), 0) AS miss_printer
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
       -- Pièces à compléter (hors « À trancher ») : sans bobine, sans poids, sans temps ou sans imprimante
       -- (l'imprimante n'est pas exigée d'une pièce déjà imprimée)
       LEFT JOIN (SELECT x.project_id,
                         SUM(x.m_spool) AS miss_spool, SUM(x.m_weight) AS miss_weight,
                         SUM(x.m_time) AS miss_time, SUM(x.m_printer) AS miss_printer,
                         SUM(x.m_spool OR x.m_weight OR x.m_time OR x.m_printer) AS incomplete_parts
                  FROM (SELECT pt.project_id,
                          (NOT EXISTS (SELECT 1 FROM part_filaments f WHERE f.part_id = pt.id)
                            OR EXISTS (SELECT 1 FROM part_filaments f WHERE f.part_id = pt.id AND f.filament_id IS NULL)) AS m_spool,
                          NOT EXISTS (SELECT 1 FROM part_filaments f WHERE f.part_id = pt.id AND f.weight_g IS NOT NULL) AS m_weight,
                          (pt.print_time_s IS NULL) AS m_time,
                          (pt.printer_id IS NULL AND pt.status <> 'imprime') AS m_printer
                        FROM parts pt WHERE pt.status <> 'a_trancher') x
                  GROUP BY x.project_id) inc ON inc.project_id = p.id
       ${withArchived ? '' : "WHERE p.status <> 'archive'"}
       GROUP BY p.id
       ORDER BY FIELD(p.status,'en_cours','preparation','termine','archive'), p.updated_at DESC`
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
        const [r] = await conn.query("INSERT INTO projects (name, notes, source_url, status) VALUES (?, ?, ?, 'preparation')", [name, req.body.notes || null, srcUrl.value]);
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

// Créer un projet à partir d'un modèle de ModelFlow : nom, lien source, image et thèmes repris, lien posé
router.post('/from-model', async (req, res) => {
  try {
    const model = await fetchModel(req.body && req.body.model_id);
    const name = String(model.name || '').trim().slice(0, 150) || model.code;
    const srcUrl = cleanSourceUrl(model.source_url).value;
    const id = await withRetry(async () => {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const [r] = await conn.query(
          "INSERT INTO projects (name, source_url, status, model_id, model_code, model_name) VALUES (?, ?, 'preparation', ?, ?, ?)",
          [name, srcUrl, model.id, model.code, name]);
        await assignCode(r.insertId, conn);
        await conn.commit();
        return r.insertId;
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally { conn.release(); }
    });
    const themeNames = (model.themes || []).map(t => t.name).filter(Boolean);
    if (themeNames.length) { try { await setProjectThemes(id, parseThemeNames(themeNames)); } catch (_) {} }
    await fillFromModel(id, model);
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [id]);
    row.themes = (await themesByProject([id])).get(id) || [];
    res.status(201).json(row);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
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
    let model = null;
    if ('model_id' in req.body) {
      if (req.body.model_id === null || req.body.model_id === '') {
        sets.push('model_id=NULL', 'model_code=NULL', 'model_name=NULL');
      } else {
        try { model = await fetchModel(req.body.model_id); }
        catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
        sets.push('model_id=?', 'model_code=?', 'model_name=?'); vals.push(model.id, model.code, String(model.name).slice(0, 150));
      }
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
    // Statut avant la modification : le modèle ne passe « Imprimé » qu'au moment où le projet devient « Terminé »
    const [[before]] = await db.query('SELECT status, model_id FROM projects WHERE id=?', [req.params.id]);
    if (sets.length) {
      await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id=?`, [...vals, req.params.id]);
    }
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Projet introuvable' });
    let modelPrinted = null;
    if (before && before.model_id && before.status !== 'termine' && req.body.status === 'termine') {
      modelPrinted = await markModelPrinted(before.model_id);
    }
    if (themeNames) await setProjectThemes(row.id, themeNames);
    let filled = [];
    if (model) {
      filled = await fillFromModel(row.id, model);
      if (filled.includes('lien')) row.source_url = model.source_url;
    }
    row.themes = (await themesByProject([row.id])).get(row.id) || [];
    res.json({
      ...row, filled,
      ...(modelPrinted && !modelPrinted.failed ? { model_printed: modelPrinted } : {}),
      ...(modelPrinted && modelPrinted.failed ? { model_warning: true } : {}),
    });
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
