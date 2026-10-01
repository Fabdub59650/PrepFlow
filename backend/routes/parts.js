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
