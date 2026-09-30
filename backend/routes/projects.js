const router = require('express').Router();
const db = require('../db');
const { loadParts } = require('./parts');

const STATUSES = ['preparation', 'en_cours', 'termine', 'archive'];

// Liste des projets avec leurs totaux (temps, poids, avancement)
router.get('/', async (req, res) => {
  try {
    const withArchived = req.query.archived === '1';
    const [rows] = await db.query(
      `SELECT p.*,
         COUNT(pt.id)                                         AS parts_count,
         COALESCE(SUM(pt.quantity), 0)                        AS pieces_count,
         COALESCE(SUM(CASE WHEN pt.status='imprime' THEN pt.quantity ELSE 0 END), 0) AS pieces_done,
         COALESCE(SUM(pt.quantity * COALESCE(pt.print_time_s, 0)), 0) AS total_time_s,
         COALESCE(SUM(pt.quantity * COALESCE(w.unit_weight, 0)), 0)   AS total_weight_g
       FROM projects p
       LEFT JOIN parts pt ON pt.project_id = p.id
       LEFT JOIN (SELECT part_id, SUM(weight_g) AS unit_weight
                  FROM part_filaments GROUP BY part_id) w ON w.part_id = pt.id
       ${withArchived ? '' : "WHERE p.status <> 'archive'"}
       GROUP BY p.id
       ORDER BY FIELD(p.status,'en_cours','preparation','termine','archive'), p.updated_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom du projet est obligatoire' });
    const [r] = await db.query('INSERT INTO projects (name, notes) VALUES (?, ?)',
      [name, req.body.notes || null]);
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [r.insertId]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Projet complet : en-tête + pièces (avec leurs filaments)
router.get('/:id', async (req, res) => {
  try {
    const [[project]] = await db.query('SELECT * FROM projects WHERE id=?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    project.parts = await loadParts({ projectId: project.id });
    res.json(project);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mise à jour partielle : seuls les champs envoyés sont modifiés
router.put('/:id', async (req, res) => {
  try {
    const sets = [], vals = [];
    if ('name' in req.body) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Le nom du projet est obligatoire' });
      sets.push('name=?'); vals.push(name);
    }
    if ('notes' in req.body) { sets.push('notes=?'); vals.push(req.body.notes || null); }
    if ('status' in req.body) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Statut inconnu' });
      sets.push('status=?'); vals.push(req.body.status);
    }
    if (sets.length) {
      await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id=?`, [...vals, req.params.id]);
    }
    const [[row]] = await db.query('SELECT * FROM projects WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Projet introuvable' });
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
