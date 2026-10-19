/**
 * Thèmes de projet (Noël, Halloween, Statuettes…) : plusieurs thèmes possibles par projet.
 *   GET /api/themes   liste des thèmes avec le nombre de projets (pour l'autocomplétion)
 *   GET /api/themes/stats          totaux par thème (projets, pièces, temps, poids, coût de revient)
 *   PUT /api/themes/:id            renommer et/ou changer la couleur ({ name?, color? })
 *   POST /api/themes/:id/merge     fusionner dans un autre thème ({ into })
 *   POST /api/themes/cleanup       supprimer les thèmes qui ne servent à aucun projet
 *   DELETE /api/themes/:id         supprimer un thème (les projets sont conservés)
 * Les thèmes d'un projet se lisent et s'écrivent via /api/projects (champ `themes`).
 *
 * Le nom est unique sans tenir compte des majuscules ni des accents (collation
 * utf8mb4_unicode_ci) : « Noel » et « Noël » désignent le même thème, dont la première
 * graphie saisie est conservée.
 */
const router = require('express').Router();
const db = require('../db');
const { computeCost } = require('./cost');

// Palette de l'interface (les teintes elles-mêmes sont définies dans le CSS, en clair et en sombre)
const COLORS = ['rouge', 'orange', 'jaune', 'vert', 'turquoise', 'bleu', 'violet', 'rose', 'gris'];

const MAX_NAME = 40;
const MAX_PER_PROJECT = 20;

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw Object.assign(new Error('Le nom du thème est obligatoire'), { status: 400 });
  if (name.length > MAX_NAME) {
    throw Object.assign(new Error(`Un thème ne peut pas dépasser ${MAX_NAME} caractères`), { status: 400 });
  }
  return name;
}

// Nettoie la liste reçue : texte, espaces simplifiés, doublons (à la casse et aux accents près) retirés.
// Renvoie un tableau de noms, ou lance une Error 400 si la saisie est invalide.
function parseThemeNames(input) {
  if (!Array.isArray(input)) throw Object.assign(new Error('Les thèmes doivent être une liste'), { status: 400 });
  const collator = new Intl.Collator('fr', { sensitivity: 'base' });
  const out = [];
  for (const raw of input) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (name.length > MAX_NAME) {
      throw Object.assign(new Error(`Un thème ne peut pas dépasser ${MAX_NAME} caractères`), { status: 400 });
    }
    if (!out.some(n => collator.compare(n, name) === 0)) out.push(name);
  }
  if (out.length > MAX_PER_PROJECT) {
    throw Object.assign(new Error(`Un projet ne peut pas avoir plus de ${MAX_PER_PROJECT} thèmes`), { status: 400 });
  }
  return out;
}

// Thèmes de plusieurs projets : Map project_id → [{ id, name, color }] triés par nom
async function themesByProject(projectIds) {
  const map = new Map();
  if (!projectIds.length) return map;
  const [rows] = await db.query(
    `SELECT pt.project_id, t.id, t.name, t.color
       FROM project_themes pt JOIN themes t ON t.id = pt.theme_id
      WHERE pt.project_id IN (?)
      ORDER BY t.name`, [projectIds]);
  for (const r of rows) {
    if (!map.has(r.project_id)) map.set(r.project_id, []);
    map.get(r.project_id).push({ id: r.id, name: r.name, color: r.color });
  }
  return map;
}

// Remplace les thèmes d'un projet par la liste donnée (les thèmes inconnus sont créés).
// Un thème qui n'a plus de projet est conservé (avec sa couleur) : il se supprime depuis
// Paramètres › Thèmes.
async function setProjectThemes(projectId, names) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const ids = [];
    for (const name of names) {
      await conn.query('INSERT IGNORE INTO themes (name) VALUES (?)', [name]);
      const [[t]] = await conn.query('SELECT id FROM themes WHERE name = ?', [name]);
      if (!ids.includes(t.id)) ids.push(t.id);
    }
    await conn.query('DELETE FROM project_themes WHERE project_id = ?', [projectId]);
    if (ids.length) {
      await conn.query('INSERT INTO project_themes (project_id, theme_id) VALUES ?', [ids.map(id => [projectId, id])]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

const sendError = (res, e) => res.status(e.status || 500).json({ error: e.message });

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id, t.name, t.color, COUNT(pt.project_id) AS projects_count
         FROM themes t LEFT JOIN project_themes pt ON pt.theme_id = t.id
        GROUP BY t.id, t.name, t.color
        ORDER BY t.name`);
    res.json(rows);
  } catch (e) { sendError(res, e); }
});

// Totaux par thème, tous projets confondus (archivés compris). Les pièces, le temps et le poids sont
// ceux du tableau (prévus) ; le coût de revient est celui de la page projet (réel pour ce qui est imprimé).
// Un projet qui a plusieurs thèmes compte dans chacun d'eux : ne pas additionner les lignes.
router.get('/stats', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pt.theme_id, pt.project_id, pr.pieces, pr.time_s, pr.weight_g
         FROM project_themes pt
         LEFT JOIN (SELECT pa.project_id,
                           SUM(pa.quantity)                                          AS pieces,
                           SUM(pa.quantity * COALESCE(pa.print_time_s, 0))           AS time_s,
                           SUM(pa.quantity * COALESCE(w.unit_weight, 0))             AS weight_g
                      FROM parts pa
                      LEFT JOIN (SELECT part_id, SUM(weight_g) AS unit_weight FROM part_filaments GROUP BY part_id) w
                             ON w.part_id = pa.id
                     GROUP BY pa.project_id) pr ON pr.project_id = pt.project_id`);
    const costs = new Map();   // project_id → { cost, complete }
    for (const projectId of new Set(rows.map(r => r.project_id))) {
      const c = await computeCost(projectId);
      const incomplete = !!c && !!c.flags && Object.values(c.flags).some(Boolean);
      costs.set(projectId, { cost: c && c.totals ? c.totals.cost : 0, complete: !incomplete });
    }
    const out = {};
    for (const r of rows) {
      const o = out[r.theme_id] || (out[r.theme_id] = { theme_id: r.theme_id, projects: 0, pieces: 0, time_s: 0, weight_g: 0, cost: 0, cost_complete: true });
      const c = costs.get(r.project_id);
      o.projects++;
      o.pieces += Number(r.pieces) || 0;
      o.time_s += Number(r.time_s) || 0;
      o.weight_g += Number(r.weight_g) || 0;
      o.cost += c.cost;
      if (!c.complete) o.cost_complete = false;
    }
    for (const o of Object.values(out)) {
      o.weight_g = Math.round(o.weight_g * 10) / 10;
      o.cost = Math.round(o.cost * 100) / 100;
    }
    res.json(Object.values(out));
  } catch (e) { sendError(res, e); }
});

// Supprime les thèmes sans projet (déclaré avant /:id)
router.post('/cleanup', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM themes WHERE id NOT IN (SELECT theme_id FROM project_themes)');
    res.json({ deleted: r.affectedRows });
  } catch (e) { sendError(res, e); }
});

router.put('/:id', async (req, res) => {
  try {
    const sets = [], vals = [];
    if ('name' in req.body) { sets.push('name=?'); vals.push(cleanName(req.body.name)); }
    if ('color' in req.body) {
      const c = req.body.color;
      if (c !== null && c !== '' && !COLORS.includes(c)) return res.status(400).json({ error: 'Couleur inconnue' });
      sets.push('color=?'); vals.push(c || null);
    }
    if (sets.length) {
      try {
        const [r] = await db.query(`UPDATE themes SET ${sets.join(', ')} WHERE id=?`, [...vals, req.params.id]);
        if (!r.affectedRows) {
          const [[exists]] = await db.query('SELECT id FROM themes WHERE id=?', [req.params.id]);
          if (!exists) return res.status(404).json({ error: 'Thème introuvable' });
        }
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ error: 'Un thème porte déjà ce nom (casse et accents ignorés). Utilisez « Fusionner » pour les regrouper.' });
        }
        throw e;
      }
    }
    const [[row]] = await db.query('SELECT id, name, color FROM themes WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Thème introuvable' });
    res.json(row);
  } catch (e) { sendError(res, e); }
});

// Les projets du thème fusionné passent dans le thème cible (nom et couleur de la cible conservés)
router.post('/:id/merge', async (req, res) => {
  const from = Number(req.params.id), into = Number(req.body && req.body.into);
  if (!Number.isInteger(into) || into === from) return res.status(400).json({ error: 'Choisissez un autre thème' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.query('SELECT id FROM themes WHERE id IN (?)', [[from, into]]);
    if (found.length !== 2) { await conn.rollback(); return res.status(404).json({ error: 'Thème introuvable' }); }
    await conn.query(
      'INSERT IGNORE INTO project_themes (project_id, theme_id) SELECT project_id, ? FROM project_themes WHERE theme_id = ?',
      [into, from]);
    await conn.query('DELETE FROM themes WHERE id = ?', [from]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    sendError(res, e);
  } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM themes WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Thème introuvable' });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

module.exports = { router, parseThemeNames, themesByProject, setProjectThemes, COLORS };
