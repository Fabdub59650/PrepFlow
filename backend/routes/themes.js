/**
 * Thèmes de projet (Noël, Halloween, Statuettes…) : plusieurs thèmes possibles par projet.
 *   GET /api/themes   liste des thèmes avec le nombre de projets (pour l'autocomplétion)
 * Les thèmes d'un projet se lisent et s'écrivent via /api/projects (champ `themes`).
 *
 * Le nom est unique sans tenir compte des majuscules ni des accents (collation
 * utf8mb4_unicode_ci) : « Noel » et « Noël » désignent le même thème, dont la première
 * graphie saisie est conservée.
 */
const router = require('express').Router();
const db = require('../db');

const MAX_NAME = 40;
const MAX_PER_PROJECT = 20;

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

// Thèmes de plusieurs projets : Map project_id → [{ id, name }] triés par nom
async function themesByProject(projectIds) {
  const map = new Map();
  if (!projectIds.length) return map;
  const [rows] = await db.query(
    `SELECT pt.project_id, t.id, t.name
       FROM project_themes pt JOIN themes t ON t.id = pt.theme_id
      WHERE pt.project_id IN (?)
      ORDER BY t.name`, [projectIds]);
  for (const r of rows) {
    if (!map.has(r.project_id)) map.set(r.project_id, []);
    map.get(r.project_id).push({ id: r.id, name: r.name });
  }
  return map;
}

// Remplace les thèmes d'un projet par la liste donnée (les thèmes inconnus sont créés).
// Les thèmes qui ne servent plus à aucun projet sont supprimés : la liste d'autocomplétion
// ne garde pas les fautes de frappe.
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
    await conn.query('DELETE FROM themes WHERE id NOT IN (SELECT theme_id FROM project_themes)');
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id, t.name, COUNT(pt.project_id) AS projects_count
         FROM themes t LEFT JOIN project_themes pt ON pt.theme_id = t.id
        GROUP BY t.id, t.name
        ORDER BY t.name`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, parseThemeNames, themesByProject, setProjectThemes };
