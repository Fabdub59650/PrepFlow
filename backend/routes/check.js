/**
 * Contrôle des pièces à l'écran (fiche de contrôle interactive).
 * Monté sur /api :
 *   PUT  /api/parts/:id/check             { qty, note }  enregistre une ligne (qty null = à vérifier)
 *   POST /api/projects/:id/check/finish   enregistre la date de fin de contrôle
 *   POST /api/projects/:id/check/reset    remet toutes les lignes à vérifier
 * Les colonnes check_* ne sont jamais copiées par la duplication : chaque projet se contrôle seul.
 */
const router = require('express').Router();
const db = require('../db');

router.put('/parts/:id/check', async (req, res) => {
  try {
    const [[part]] = await db.query('SELECT id, project_id, quantity FROM parts WHERE id=?', [req.params.id]);
    if (!part) return res.status(404).json({ error: 'Pièce introuvable' });
    const { qty, note } = req.body || {};
    let q = null;
    if (qty !== null && qty !== undefined && qty !== '') {
      q = Number(qty);
      if (!Number.isInteger(q) || q < 0) return res.status(400).json({ error: 'Quantité comptée invalide' });
      q = Math.min(q, part.quantity);
    }
    const n = typeof note === 'string' && note.trim() ? note.trim().slice(0, 255) : null;
    // Une remarque seule ne rend pas une ligne « vérifiée » ; remettre à vérifier garde la remarque
    await db.query('UPDATE parts SET check_qty=?, check_note=? WHERE id=?', [q, n, part.id]);
    // Toute modification du contrôle rouvre un contrôle déjà terminé
    await db.query('UPDATE projects SET check_done_at=NULL WHERE id=?', [part.project_id]);
    const [[row]] = await db.query('SELECT id, quantity, check_qty, check_note FROM parts WHERE id=?', [part.id]);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/projects/:id/check/finish', async (req, res) => {
  try {
    const [[p]] = await db.query('SELECT id FROM projects WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Projet introuvable' });
    await db.query('UPDATE projects SET check_done_at=NOW() WHERE id=?', [p.id]);
    const [[row]] = await db.query('SELECT check_done_at FROM projects WHERE id=?', [p.id]);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/projects/:id/check/reset', async (req, res) => {
  try {
    const [[p]] = await db.query('SELECT id FROM projects WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Projet introuvable' });
    await db.query('UPDATE parts SET check_qty=NULL, check_note=NULL WHERE project_id=?', [p.id]);
    await db.query('UPDATE projects SET check_done_at=NULL WHERE id=?', [p.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
