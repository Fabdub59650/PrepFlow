const router = require('express').Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pr.*, (SELECT COUNT(*) FROM parts p WHERE p.printer_id = pr.id) AS parts_count
       FROM printers pr ORDER BY pr.sort_order, pr.name`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: "Le nom de l'imprimante est obligatoire" });
    const [[{ next }]] = await db.query('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM printers');
    const [r] = await db.query('INSERT INTO printers (name, sort_order) VALUES (?, ?)', [name, next]);
    const [[row]] = await db.query('SELECT * FROM printers WHERE id=?', [r.insertId]);
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Une imprimante porte déjà ce nom' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const sets = [], vals = [];
    if ('name' in req.body) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: "Le nom de l'imprimante est obligatoire" });
      sets.push('name=?'); vals.push(name);
    }
    if ('active' in req.body) { sets.push('active=?'); vals.push(req.body.active ? 1 : 0); }
    if (sets.length) await db.query(`UPDATE printers SET ${sets.join(', ')} WHERE id=?`, [...vals, req.params.id]);
    const [[row]] = await db.query('SELECT * FROM printers WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Imprimante introuvable' });
    res.json(row);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Une imprimante porte déjà ce nom' });
    res.status(500).json({ error: e.message });
  }
});

// Supprimer une imprimante : les pièces qui l'utilisaient passent à « aucune »
router.delete('/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM printers WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Imprimante introuvable' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
