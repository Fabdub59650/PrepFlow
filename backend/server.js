require('dotenv').config();
const express = require('express');
const path    = require('path');
const db      = require('./db');
const filaflow = require('./filaflow');

const VERSION = (() => {
  try { return require('./package.json').version; } catch (_) { return '?'; }
})();

const app  = express();
const PORT = parseInt(process.env.PORT) || 3001;
// Écoute locale uniquement : l'accès passe par Nginx (https://filaflow.local/prepflow/)
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '2mb' }));

// Frontend statique. Chemins relatifs dans le HTML : fonctionne sous /prepflow/.
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('/api/meta', (req, res) => {
  res.json({ version: VERSION, filaflow: filaflow.status() });
});

app.use('/api/projects',  require('./routes/projects'));
app.use('/api/printers',  require('./routes/printers'));
app.use('/api/filaments', require('./routes/filaments'));
app.use('/api/settings',  require('./routes/settings'));
app.use('/api/updater',   require('./routes/updater'));
app.use('/api/needs',     require('./routes/needs'));
app.use('/api',           require('./routes/parts').router);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route API inconnue : ' + req.originalUrl }));

// Erreurs JSON mal formées, etc.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`PrepFlow v${VERSION} à l'écoute sur ${HOST}:${PORT}`);
  db.query(
    "INSERT INTO settings (key_name, value) VALUES ('_version', ?) ON DUPLICATE KEY UPDATE value=?",
    [VERSION, VERSION]
  ).catch(e => console.warn('[Version] Impossible de persister la version :', e.message));
  filaflow.sync({ force: true });
  require('./codes').backfillCodes()
    .catch(e => console.warn('[Codes] Attribution des codes impossible :', e.message));
});
