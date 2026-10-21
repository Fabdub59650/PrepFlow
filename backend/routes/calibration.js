// Calibration : écart prévu / réel par bobine, d'après les pesées de FilaFlow (lecture seule)
const router = require('express').Router();
const calibration = require('../calibration');

router.get('/calibration', async (req, res) => {
  try { res.json(await calibration.compute()); }
  catch (e) {
    const off = e.name === 'TimeoutError' || /fetch failed|ECONN/i.test(e.message);
    res.status(off ? 503 : 500).json({ error: off ? 'FilaFlow ne répond pas : calibration indisponible' : e.message });
  }
});

module.exports = { router };
