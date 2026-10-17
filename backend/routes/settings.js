// Réglages de l'interface (clé/valeur dans la table settings)
const router = require('express').Router();
const db = require('../db');

const COLOR_MODES = ['', 'light', 'dark', 'auto-system', 'auto-time'];

// Décimal (virgule ou point) entre min et max, renvoyé en texte avec au plus 4 décimales
function decimalIn(v, min, max) {
  const n = Number(String(v).trim().replace(',', '.'));
  return String(v).trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? String(Math.round(n * 10000) / 10000) : null;
}

// Clés modifiables et leur validation
const EDITABLE = {
  color_mode: v => (COLOR_MODES.includes(v) ? v : null),
  dark_from:  v => (/^\d{1,2}$/.test(String(v)) && +v >= 0 && +v <= 23 ? String(+v) : null),
  dark_to:    v => (/^\d{1,2}$/.test(String(v)) && +v >= 0 && +v <= 23 ? String(+v) : null),
  // Marge de sécurité appliquée aux besoins de filament (purges, ratés), en %
  needs_margin: v => (/^\d{1,3}$/.test(String(v).trim()) && +v >= 0 && +v <= 100 ? String(+v) : null),
  // Coût et prix : prix du kWh (€), marge par défaut (% du coût), prix minimum par pièce (€)
  kwh_price:       v => decimalIn(v, 0, 5),
  margin_pct:      v => decimalIn(v, 0, 1000),
  min_piece_price: v => decimalIn(v, 0, 10000),
};
const DEFAULTS = { color_mode: '', dark_from: '20', dark_to: '7', needs_margin: '10',
  kwh_price: '0.25', margin_pct: '30', min_piece_price: '0' };

async function readSettings() {
  const [rows] = await db.query(
    'SELECT key_name, value FROM settings WHERE key_name IN (?)', [Object.keys(EDITABLE)]);
  const out = { ...DEFAULTS };
  rows.forEach(r => { out[r.key_name] = r.value ?? ''; });
  return out;
}

router.get('/', async (req, res) => {
  try { res.json(await readSettings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', async (req, res) => {
  try {
    const entries = [];
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!EDITABLE[k]) continue;
      const clean = EDITABLE[k](v ?? '');
      if (clean === null) return res.status(400).json({ error: `Valeur invalide pour ${k}` });
      entries.push([k, clean]);
    }
    for (const [k, v] of entries) {
      await db.query(
        'INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)', [k, v]);
    }
    res.json(await readSettings());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
