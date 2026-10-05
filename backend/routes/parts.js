/**
 * Pièces d'un projet — une ligne du tableau.
 * Monté sur /api :
 *   POST   /api/projects/:id/parts          ajouter une pièce
 *   POST   /api/projects/:id/parts/reorder  réordonner ({ ids: [...] })
 *   PUT    /api/parts/:id                   mise à jour partielle (+ filaments)
 *   DELETE /api/parts/:id
 */
const router = require('express').Router();
const db = require('../db');

const STATUSES = ['a_trancher', 'pret', 'en_cours', 'imprime'];

async function loadParts({ projectId = null, partId = null }) {
  const [parts] = await db.query(
    `SELECT * FROM parts WHERE ${partId ? 'id=?' : 'project_id=?'} ORDER BY sort_order, id`,
    [partId || projectId]
  );
  if (!parts.length) return [];
  const ids = parts.map(p => p.id);
  const [fils] = await db.query(
    `SELECT part_id, filament_id, material, color_name, weight_g FROM part_filaments
     WHERE part_id IN (?) ORDER BY sort_order, id`, [ids]
  );
  for (const p of parts) {
    p.filaments = fils
      .filter(f => f.part_id === p.id)
      .map(f => ({ filament_id: f.filament_id, material: f.material, color_name: f.color_name, weight_g: f.weight_g }));
  }
  return parts;
}

// Valeurs acceptées pour chaque champ modifiable
function cleanField(key, value) {
  switch (key) {
    case 'name':      return String(value ?? '').trim().slice(0, 150);
    case 'file_name': return value ? String(value).trim().slice(0, 255) : null;
    case 'material':   return value && String(value).trim() ? String(value).trim().replace(/\s+/g, ' ').slice(0, 50) : null;
    case 'color_name': return value && String(value).trim() ? String(value).trim().replace(/\s+/g, ' ').slice(0, 100) : null;
    case 'notes':     return value ? String(value) : null;
    case 'quantity': {
      const q = parseInt(value, 10);
      if (!Number.isFinite(q) || q < 1) throw new Error('La quantité doit être un entier ≥ 1');
      return q;
    }
    case 'printer_id':
      return value === null || value === '' || value === undefined ? null : parseInt(value, 10);
    case 'print_time_s': {
      if (value === null || value === '' || value === undefined) return null;
      const s = parseInt(value, 10);
      if (!Number.isFinite(s) || s < 0) throw new Error('Temps invalide');
      return s;
    }
    case 'status':
      if (!STATUSES.includes(value)) throw new Error('Statut inconnu');
      return value;
  }
}
const FIELDS = ['name', 'file_name', 'notes', 'quantity', 'printer_id', 'material', 'color_name', 'print_time_s', 'status'];

function cleanFilaments(list) {
  if (!Array.isArray(list)) throw new Error('filaments doit être une liste');
  return list
    .map(f => ({
      filament_id: f.filament_id === null || f.filament_id === '' || f.filament_id === undefined
        ? null : parseInt(f.filament_id, 10),
      material: cleanField('material', f.material),
      color_name: cleanField('color_name', f.color_name),
      weight_g: f.weight_g === null || f.weight_g === '' || f.weight_g === undefined
        ? null : Math.round(Number(f.weight_g) * 100) / 100,
    }))
    .filter(f => f.filament_id !== null || f.weight_g !== null || f.material !== null || f.color_name !== null)
    .map(f => {
      if (f.weight_g !== null && (!Number.isFinite(f.weight_g) || f.weight_g < 0)) {
        throw new Error('Poids invalide');
      }
      return f;
    });
}

async function replaceFilaments(conn, partId, list) {
  await conn.query('DELETE FROM part_filaments WHERE part_id=?', [partId]);
  if (list.length) {
    await conn.query(
      'INSERT INTO part_filaments (part_id, filament_id, material, color_name, weight_g, sort_order) VALUES ?',
      [list.map((f, i) => [partId, f.filament_id, f.material, f.color_name, f.weight_g, i])]
    );
  }
}

router.post('/projects/:id/parts', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [[project]] = await conn.query('SELECT id FROM projects WHERE id=?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    const [[{ next }]] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM parts WHERE project_id=?', [project.id]);
    const data = { name: '', quantity: 1, status: 'a_trancher' };
    for (const k of FIELDS) if (k in req.body) data[k] = cleanField(k, req.body[k]);
    const filaments = 'filaments' in req.body ? cleanFilaments(req.body.filaments) : [];

    await conn.beginTransaction();
    const cols = Object.keys(data);
    const [r] = await conn.query(
      `INSERT INTO parts (project_id, sort_order, ${cols.join(',')}) VALUES (?, ?, ${cols.map(() => '?').join(',')})`,
      [project.id, next, ...cols.map(c => data[c])]
    );
    await replaceFilaments(conn, r.insertId, filaments);
    await conn.query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [project.id]);
    await conn.commit();
    const [part] = await loadParts({ partId: r.insertId });
    res.status(201).json(part);
  } catch (e) {
    await conn.rollback().catch(() => {});
    const isInput = /invalide|Statut|quantité|liste/.test(e.message);
    res.status(isInput ? 400 : 500).json({ error: e.message });
  } finally { conn.release(); }
});

router.post('/projects/:id/parts/reorder', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)) : [];
    await conn.beginTransaction();
    for (let i = 0; i < ids.length; i++) {
      await conn.query('UPDATE parts SET sort_order=? WHERE id=? AND project_id=?',
        [i + 1, ids[i], req.params.id]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { conn.release(); }
});

// ── Modifications en lot ──────────────────────────────────────

// Bobine du cache FilaFlow (pour reprendre sa matière et sa couleur)
async function cachedFilament(conn, id) {
  const [[f]] = await conn.query('SELECT id, material, color_name FROM filament_cache WHERE id=?', [id]);
  return f || null;
}
const trimOrNull = v => (v && String(v).trim() ? String(v).trim().replace(/\s+/g, ' ') : null);

/**
 * Appliquer une bobine, une imprimante et/ou un statut à une sélection de pièces.
 * Bobine : seulement pour les pièces à un filament (les multicolores sont signalées, pas modifiées) ;
 * poids conservé ; matière et couleur reprises de la bobine.
 */
router.post('/projects/:id/parts/bulk', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const ids = (Array.isArray(req.body.part_ids) ? req.body.part_ids : []).map(n => parseInt(n, 10)).filter(Number.isFinite);
    const set = req.body.set || {};
    if (!ids.length) return res.status(400).json({ error: 'Aucune pièce sélectionnée' });
    const has = k => Object.prototype.hasOwnProperty.call(set, k) && set[k] !== undefined;
    if (!has('filament_id') && !has('printer_id') && !has('status')) return res.status(400).json({ error: 'Rien à modifier' });
    const status = has('status') ? cleanField('status', set.status) : null;
    const printerId = has('printer_id') ? cleanField('printer_id', set.printer_id) : null;

    await conn.beginTransaction();
    const [parts] = await conn.query('SELECT id FROM parts WHERE project_id=? AND id IN (?)', [req.params.id, ids]);
    const partIds = parts.map(p => p.id);
    const skipped = [];
    let fil = null;
    if (has('filament_id')) {
      fil = await cachedFilament(conn, parseInt(set.filament_id, 10));
      if (!fil) throw new Error('Bobine inconnue : actualisez le stock');
    }
    for (const pid of partIds) {
      const sets = [], vals = [];
      if (has('printer_id')) { sets.push('printer_id=?'); vals.push(printerId); }
      if (has('status'))     { sets.push('status=?');     vals.push(status); }
      if (fil) {
        const [lines] = await conn.query('SELECT weight_g FROM part_filaments WHERE part_id=? ORDER BY sort_order, id', [pid]);
        if (lines.length > 1) skipped.push(pid);
        else {
          await replaceFilaments(conn, pid, [{ filament_id: fil.id, material: null, color_name: null,
            weight_g: lines[0] ? lines[0].weight_g : null }]);
          sets.push('material=?', 'color_name=?');
          vals.push(trimOrNull(fil.material), trimOrNull(fil.color_name));
        }
      }
      if (sets.length) await conn.query(`UPDATE parts SET ${sets.join(', ')} WHERE id=?`, [...vals, pid]);
    }
    await conn.query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [req.params.id]);
    await conn.commit();
    const updated = [];
    for (const pid of partIds) updated.push((await loadParts({ partId: pid }))[0]);
    res.json({ parts: updated, skipped_multicolor: skipped });
  } catch (e) {
    await conn.rollback().catch(() => {});
    const isInput = /invalide|Statut|inconnue|Aucune|Rien/.test(e.message);
    res.status(isInput ? 400 : 500).json({ error: e.message });
  } finally { conn.release(); }
});

/**
 * Remplacer une bobine par une autre dans tout le projet, y compris dans les pièces multicolores
 * (seule la ligne de cette bobine change). Poids conservés. Pièces imprimées exclues par défaut.
 */
router.post('/projects/:id/replace-spool', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const from = parseInt(req.body.from, 10), to = parseInt(req.body.to, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return res.status(400).json({ error: 'Bobines à préciser' });
    if (from === to) return res.status(400).json({ error: 'Choisissez une bobine différente' });
    const includePrinted = !!req.body.include_printed;

    await conn.beginTransaction();
    const fil = await cachedFilament(conn, to);
    if (!fil) throw new Error('Bobine inconnue : actualisez le stock');
    const [lines] = await conn.query(
      `SELECT pf.id, pf.part_id FROM part_filaments pf JOIN parts p ON p.id = pf.part_id
       WHERE p.project_id=? AND pf.filament_id=? ${includePrinted ? '' : "AND p.status <> 'imprime'"}`,
      [req.params.id, from]);
    const partIds = [...new Set(lines.map(l => l.part_id))];
    if (lines.length) {
      await conn.query('UPDATE part_filaments SET filament_id=?, material=?, color_name=? WHERE id IN (?)',
        [fil.id, trimOrNull(fil.material), trimOrNull(fil.color_name), lines.map(l => l.id)]);
      // Pièces à un seul filament : leurs colonnes Matière / Couleur suivent la nouvelle bobine
      await conn.query(
        `UPDATE parts p SET p.material=?, p.color_name=?
         WHERE p.id IN (?) AND (SELECT COUNT(*) FROM part_filaments x WHERE x.part_id = p.id) = 1`,
        [trimOrNull(fil.material), trimOrNull(fil.color_name), partIds]);
      await conn.query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [req.params.id]);
    }
    await conn.commit();
    const updated = [];
    for (const pid of partIds) updated.push((await loadParts({ partId: pid }))[0]);
    res.json({ parts: updated, replaced: lines.length });
  } catch (e) {
    await conn.rollback().catch(() => {});
    res.status(/inconnue|préciser|différente/.test(e.message) ? 400 : 500).json({ error: e.message });
  } finally { conn.release(); }
});

router.put('/parts/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [[current]] = await conn.query('SELECT id, project_id FROM parts WHERE id=?', [req.params.id]);
    if (!current) return res.status(404).json({ error: 'Pièce introuvable' });
    const sets = [], vals = [];
    for (const k of FIELDS) {
      if (k in req.body) { sets.push(`${k}=?`); vals.push(cleanField(k, req.body[k])); }
    }
    const filaments = 'filaments' in req.body ? cleanFilaments(req.body.filaments) : null;

    await conn.beginTransaction();
    if (sets.length) await conn.query(`UPDATE parts SET ${sets.join(', ')} WHERE id=?`, [...vals, current.id]);
    if (filaments) await replaceFilaments(conn, current.id, filaments);
    await conn.query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [current.project_id]);
    await conn.commit();
    const [part] = await loadParts({ partId: current.id });
    res.json(part);
  } catch (e) {
    await conn.rollback().catch(() => {});
    const isInput = /invalide|Statut|quantité|liste/.test(e.message);
    res.status(isInput ? 400 : 500).json({ error: e.message });
  } finally { conn.release(); }
});

router.delete('/parts/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM parts WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Pièce introuvable' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, loadParts };
