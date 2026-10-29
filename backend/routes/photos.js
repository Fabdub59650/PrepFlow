// Image d'un projet : une seule, JPEG déjà réduit par le navigateur, stockée dans la base (suit la sauvegarde)
const router = require('express').Router();
const db = require('../db');

const MAX_BYTES = 600 * 1024;

// GET /api/projects/:id/photo : l'image (l'adresse porte ?v=version, donc cache long)
router.get('/:id/photo', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT mime, data, version FROM project_photos WHERE project_id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Pas d\'image pour ce projet' });
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('ETag', `"p${req.params.id}-${row.version}"`);
    res.send(row.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/projects/:id/photo  { image: "data:image/jpeg;base64,..." }
router.put('/:id/photo', async (req, res) => {
  try {
    const [[project]] = await db.query('SELECT id FROM projects WHERE id=?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Projet introuvable' });
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).image || ''));
    if (!m) return res.status(400).json({ error: 'Image JPEG attendue' });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 100 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return res.status(400).json({ error: 'Image invalide' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Image trop lourde (600 Ko maximum après réduction)' });
    await db.query(
      `INSERT INTO project_photos (project_id, mime, data) VALUES (?, 'image/jpeg', ?)
       ON DUPLICATE KEY UPDATE data=VALUES(data), mime=VALUES(mime), version=version+1`, [project.id, buf]);
    const [[row]] = await db.query('SELECT version FROM project_photos WHERE project_id=?', [project.id]);
    res.json({ photo_v: row.version });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/photo', async (req, res) => {
  try {
    await db.query('DELETE FROM project_photos WHERE project_id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
