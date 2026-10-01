/**
 * updater.js — Contrôle de version et mise à jour depuis GitHub
 *
 * Différences avec l'updater de FilaFlow :
 *  - la dernière version est le tag le plus récent (vX.Y.Z), pas une « Release » GitHub :
 *    pousser un tag suffit ;
 *  - les notes viennent du CHANGELOG.md de ce tag ;
 *  - l'URL téléchargée est construite côté serveur à partir de la version vérifiée
 *    (le navigateur n'envoie qu'un numéro de version) ;
 *  - PrepFlow ne tourne pas en root : après la mise à jour, le processus s'arrête avec
 *    un code d'erreur et systemd le relance (Restart=on-failure dans prepflow.service).
 */
const router = require('express').Router();
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFile } = require('child_process');
const db   = require('../db');

const REPO        = process.env.UPDATER_REPO || 'Fabdub59650/prepflow';
const API_BASE    = process.env.UPDATER_API_BASE || 'https://api.github.com';
const RAW_BASE    = process.env.UPDATER_RAW_BASE || 'https://raw.githubusercontent.com';
const TAR_BASE    = process.env.UPDATER_TARBALL_BASE || 'https://codeload.github.com';
const INSTALL_DIR = path.resolve(__dirname, '..', '..');
const WORK_DIR    = path.join(os.tmpdir(), 'prepflow-update');
const AUTO_CHECK_MS = 6 * 3600 * 1000;      // vérification automatique : au plus toutes les 6 h
const UA = { 'User-Agent': 'PrepFlow-Updater', Accept: 'application/vnd.github+json' };

const currentVersion = () => {
  try { return JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'backend', 'package.json'), 'utf8')).version; }
  catch (_) { return '0.0.0'; }
};

// ── Comparaison de versions X.Y.Z ─────────────────────────────
const parseVer = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
function compareVersions(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// ── État (mémoire + persistance légère en base) ───────────────
let cache = null;                         // dernier résultat de vérification
let progress = { state: 'idle', step: null, error: null, version: null };

async function loadCache() {
  if (cache) return cache;
  try {
    const [[row]] = await db.query("SELECT value FROM settings WHERE key_name='_update_check'");
    if (row && row.value) cache = JSON.parse(row.value);
  } catch (_) {}
  return cache;
}
async function saveCache(c) {
  cache = c;
  try {
    await db.query(
      "INSERT INTO settings (key_name, value) VALUES ('_update_check', ?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [JSON.stringify(c)]);
  } catch (_) {}
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'GitHub ne répond pas' : 'GitHub injoignable : vérifiez l\'accès Internet du Pi');
  }
  if (res.status === 404) throw new Error('Dépôt GitHub introuvable ou privé (' + REPO + ')');
  if (res.status === 403) throw new Error('Limite de requêtes GitHub atteinte, réessayez dans une heure');
  if (!res.ok) throw new Error('GitHub a répondu ' + res.status);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  return res.text();
}

// Sections du CHANGELOG comprises entre la version installée (exclue) et la dernière (incluse)
function changelogBetween(md, from, to) {
  if (!md) return '';
  const parts = md.split(/^(?=## v?\d+\.\d+\.\d+)/m);
  return parts
    .filter(p => {
      const m = p.match(/^## v?(\d+\.\d+\.\d+)/);
      return m && compareVersions(m[1], from) > 0 && compareVersions(m[1], to) <= 0;
    })
    .join('')
    .trim();
}

// Le service systemd ou le bloc Nginx de la nouvelle version diffèrent-ils de ceux installés ?
async function infraChanges(tag) {
  const changed = [];
  const checks = [
    { label: 'service systemd', remote: 'systemd/prepflow.service', local: '/etc/systemd/system/prepflow.service',
      normalize: s => s.replace(/__USER__/g, os.userInfo().username) },
    { label: 'bloc Nginx', remote: 'nginx/prepflow.conf', local: '/etc/nginx/snippets/prepflow.conf', normalize: s => s },
  ];
  for (const c of checks) {
    let local;
    try { local = fs.readFileSync(c.local, 'utf8'); } catch (_) { continue; }   // non installé (développement)
    const remote = await getText(`${RAW_BASE}/${REPO}/${tag}/${c.remote}`);
    if (remote !== null && c.normalize(remote).trim() !== local.trim()) changed.push(c.label);
  }
  return changed;
}

async function check() {
  const current = currentVersion();
  const tags = await getJson(`${API_BASE}/repos/${REPO}/tags?per_page=100`);
  const versions = tags.map(t => t.name).filter(n => /^v?\d+\.\d+\.\d+$/.test(n));
  if (!versions.length) throw new Error('Aucun tag de version (vX.Y.Z) sur ' + REPO);
  const latestTag = versions.sort((a, b) => compareVersions(b, a))[0];
  const latest = latestTag.replace(/^v/i, '');
  const isNewer = compareVersions(latest, current) > 0;
  let notes = '', infra = [];
  if (isNewer) {
    notes = changelogBetween(await getText(`${RAW_BASE}/${REPO}/${latestTag}/CHANGELOG.md`), current, latest);
    infra = await infraChanges(latestTag);
  }
  const result = {
    current_version: current, latest_version: latest, latest_tag: latestTag,
    is_newer: isNewer, notes, infra_changes: infra, checked_at: new Date().toISOString(),
  };
  await saveCache(result);
  return result;
}

// ── Exécution de commandes ────────────────────────────────────
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} : ${(stderr || err.message).toString().trim().split('\n').slice(-3).join(' ')}`));
      else resolve(stdout);
    });
  });
}

async function runUpdate(target) {
  const step = s => { progress.step = s; console.log('[Updater]', s); };
  progress = { state: 'running', step: null, error: null, version: target.latest_version };
  try {
    step('Téléchargement de ' + target.latest_tag);
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const res = await fetch(`${TAR_BASE}/${REPO}/tar.gz/refs/tags/${target.latest_tag}`,
      { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error('Téléchargement impossible (' + res.status + ')');
    const archive = path.join(WORK_DIR, 'release.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

    step('Extraction');
    const extract = path.join(WORK_DIR, 'src');
    fs.mkdirSync(extract);
    await run('tar', ['-xzf', archive, '-C', extract, '--strip-components=1']);
    const pkg = JSON.parse(fs.readFileSync(path.join(extract, 'backend', 'package.json'), 'utf8'));
    if (pkg.version !== target.latest_version) {
      throw new Error(`Version inattendue dans l'archive : ${pkg.version} (attendu ${target.latest_version})`);
    }

    step('Copie des fichiers');
    await run('rsync', ['-a', '--delete', '--exclude', 'node_modules', '--exclude', '.env',
      path.join(extract, 'backend') + '/', path.join(INSTALL_DIR, 'backend') + '/']);
    await run('rsync', ['-a', '--delete', path.join(extract, 'frontend') + '/', path.join(INSTALL_DIR, 'frontend') + '/']);
    await run('rsync', ['-a', path.join(extract, 'sql'), path.join(extract, 'scripts'), INSTALL_DIR + '/']);

    step('Modules Node.js');
    await run('npm', ['install', '--omit=dev', '--quiet', '--no-audit', '--no-fund'], { cwd: path.join(INSTALL_DIR, 'backend') });

    step('Schéma de la base');
    await new Promise((resolve, reject) => {
      const child = execFile('mariadb', [
        '--default-character-set=utf8mb4',
        '-h', process.env.DB_HOST || 'localhost',
        '-u', process.env.DB_USER || 'prepflow',
        process.env.DB_NAME || 'prepflow',
      ], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, timeout: 60000 },
      (err, _o, stderr) => err ? reject(new Error('mariadb : ' + (stderr || err.message).trim())) : resolve());
      fs.createReadStream(path.join(INSTALL_DIR, 'sql', 'schema.sql')).pipe(child.stdin);
    });

    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    step('Redémarrage');
    progress.state = 'restarting';
    // Arrêt avec code d'erreur : systemd relance PrepFlow (Restart=on-failure)
    setTimeout(() => process.exit(75), 1500);
  } catch (e) {
    progress.state = 'error';
    progress.error = e.message;
    console.error('[Updater] Échec :', e.message);
  }
}

// ── Routes ────────────────────────────────────────────────────

// État connu ; ?auto=1 relance une vérification si la dernière date de plus de 6 h
router.get('/status', async (req, res) => {
  try {
    let c = await loadCache();
    const current = currentVersion();
    const stale = !c || Date.now() - new Date(c.checked_at).getTime() > AUTO_CHECK_MS || c.current_version !== current;
    if (req.query.auto === '1' && stale) {
      try { c = await check(); } catch (_) { /* hors ligne : on garde l'ancien résultat */ }
    }
    const isNewer = !!(c && compareVersions(c.latest_version, current) > 0);
    res.json({ ...(c || {}), current_version: current, is_newer: isNewer, progress });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/check', async (req, res) => {
  try { res.json(await check()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/update', async (req, res) => {
  try {
    if (progress.state === 'running' || progress.state === 'restarting') {
      return res.status(409).json({ error: 'Une mise à jour est déjà en cours' });
    }
    if (fs.existsSync(path.join(INSTALL_DIR, '.git'))) {
      return res.status(400).json({ error: 'PrepFlow tourne depuis un dépôt Git : mettez à jour avec git pull et patch.sh' });
    }
    const c = await loadCache();
    const wanted = String(req.body.version || '');
    if (!c || !c.is_newer || c.latest_version !== wanted || compareVersions(wanted, currentVersion()) <= 0) {
      return res.status(400).json({ error: 'Version non vérifiée : relancez la vérification' });
    }
    res.json({ ok: true, version: wanted });
    setTimeout(() => runUpdate(c), 200);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/progress', (req, res) => res.json(progress));

module.exports = router;
module.exports.compareVersions = compareVersions;
module.exports.changelogBetween = changelogBetween;
