// Besoins de filament sur un ensemble de projets : pièces (avec filaments) des projets demandés.
// Le calcul (regroupement par bobine ou par référence, comparaison au stock) se fait côté navigateur,
// avec la copie du stock FilaFlow, comme la synthèse d'un projet.
const router = require('express').Router();
const db = require('../db');
const { loadParts } = require('./parts');

router.get('/', async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').map(n => parseInt(n, 10)).filter(Number.isFinite);
    if (!ids.length) return res.json([]);
    const [projects] = await db.query(
      'SELECT id, code, name, status FROM projects WHERE id IN (?) ORDER BY code', [ids]);
    for (const p of projects) p.parts = await loadParts({ projectId: p.id });
    res.json(projects);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
