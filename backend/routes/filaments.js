// Filaments FilaFlow (copie locale). ?refresh=1 force une synchronisation.
const router = require('express').Router();
const filaflow = require('../filaflow');

router.get('/', async (req, res) => {
  try {
    res.json(await filaflow.listFilaments({ force: req.query.refresh === '1' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
