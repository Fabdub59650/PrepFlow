/**
 * Duplication d'un projet (v1.23.0) et choix des bobines de la copie.
 *
 * La copie reprend le projet et ses pièces (quantités, fichiers, poids, temps, notes, thèmes, lien, marge…)
 * mais PAS l'historique d'impressions, ni l'imprimante (elle peut avoir changé), ni les bobines choisies :
 * seules la matière et la couleur de chaque filament sont gardées, pour choisir ensuite dans les bobines
 * disponibles au moment de la réimpression.
 */
const db = require('./db');
const { assignCode, withRetry } = require('./codes');

const clean = v => (v && String(v).trim() ? String(v).trim().replace(/\s+/g, ' ') : null);
const norm = v => (clean(v) || '').toLocaleLowerCase('fr');
const keyOf = (material, color) => norm(material) + '|' + norm(color);

/**
 * Matière et couleur « souhaitées » d'une ligne de filament : celles de la ligne, sinon celles de sa bobine,
 * sinon (pièce à un seul filament) celles de la pièce.
 */
function lineWish(line, part, single) {
  return {
    material: clean(line.material) || clean(line.fc_material) || (single ? clean(part.material) : null),
    color_name: clean(line.color_name) || clean(line.fc_color_name) || (single ? clean(part.color_name) : null),
  };
}

async function duplicateProject(srcId, wantedName) {
  return withRetry(async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[src]] = await conn.query('SELECT * FROM projects WHERE id=?', [srcId]);
      if (!src) { const e = new Error('Projet introuvable'); e.status = 404; throw e; }
      const name = (clean(wantedName) || `${src.name} (copie)`).slice(0, 150);
      const [r] = await conn.query(
        `INSERT INTO projects (name, notes, source_url, margin_pct, min_piece_price, status)
         VALUES (?, ?, ?, ?, ?, 'preparation')`,
        [name, src.notes, src.source_url, src.margin_pct, src.min_piece_price]);
      const newId = r.insertId;
      await assignCode(newId, conn);
      await conn.query(
        'INSERT INTO project_themes (project_id, theme_id) SELECT ?, theme_id FROM project_themes WHERE project_id=?',
        [newId, srcId]);

      const [parts] = await conn.query('SELECT * FROM parts WHERE project_id=? ORDER BY sort_order, id', [srcId]);
      const [lines] = parts.length ? await conn.query(
        `SELECT pf.part_id, pf.material, pf.color_name, pf.weight_g, pf.sort_order,
                fc.material AS fc_material, fc.color_name AS fc_color_name
         FROM part_filaments pf LEFT JOIN filament_cache fc ON fc.id = pf.filament_id
         WHERE pf.part_id IN (?) ORDER BY pf.sort_order, pf.id`, [parts.map(p => p.id)]) : [[]];
      let order = 0;
      for (const p of parts) {
        const mine = lines.filter(l => l.part_id === p.id);
        const single = mine.length === 1;
        const wishes = mine.map(l => lineWish(l, p, single));
        const [pr] = await conn.query(
          `INSERT INTO parts (project_id, sort_order, name, file_name, quantity, printer_id, material, color_name,
                              print_time_s, status, notes)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'pret', ?)`,
          [newId, ++order, p.name, p.file_name, p.quantity,
            single ? wishes[0].material : clean(p.material), single ? wishes[0].color_name : clean(p.color_name),
            p.print_time_s, p.notes]);
        if (mine.length) {
          await conn.query(
            'INSERT INTO part_filaments (part_id, filament_id, material, color_name, weight_g, sort_order) VALUES ?',
            [mine.map((l, i) => [pr.insertId, null, wishes[i].material, wishes[i].color_name, l.weight_g, i])]);
        }
      }
      await conn.commit();
      return newId;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally { conn.release(); }
  });
}

// Lignes de filament sans bobine d'un projet, avec leur matière / couleur souhaitées
async function unassignedLines(conn, projectId) {
  const [rows] = await conn.query(
    `SELECT pf.id, pf.part_id, pf.material, pf.color_name, p.name AS part_name, p.material AS part_material,
            p.color_name AS part_color_name,
            (SELECT COUNT(*) FROM part_filaments x WHERE x.part_id = p.id) AS n_lines
     FROM part_filaments pf JOIN parts p ON p.id = pf.part_id
     WHERE p.project_id=? AND pf.filament_id IS NULL ORDER BY p.sort_order, pf.sort_order, pf.id`, [projectId]);
  return rows.map(r => {
    const single = Number(r.n_lines) === 1;
    return {
      ...r,
      material: clean(r.material) || (single ? clean(r.part_material) : null),
      color_name: clean(r.color_name) || (single ? clean(r.part_color_name) : null),
    };
  });
}

/** Couples matière + couleur des lignes sans bobine : [{ material, color_name, lines, parts }] */
async function unassignedGroups(projectId, conn = db) {
  const map = new Map();
  for (const l of await unassignedLines(conn, projectId)) {
    const k = keyOf(l.material, l.color_name);
    if (!map.has(k)) map.set(k, { material: l.material, color_name: l.color_name, lines: 0, parts: new Set() });
    const g = map.get(k); g.lines++; g.parts.add(l.part_id);
  }
  return [...map.values()]
    .map(g => ({ material: g.material, color_name: g.color_name, lines: g.lines, parts: g.parts.size }))
    .sort((a, b) => (a.material || '~').localeCompare(b.material || '~', 'fr') || (a.color_name || '~').localeCompare(b.color_name || '~', 'fr'));
}

/**
 * Affecte des bobines aux lignes sans bobine, par couple matière + couleur.
 * assignments : [{ material, color_name, filament_id }]. Retourne le nombre de lignes modifiées.
 */
async function assignSpools(projectId, assignments) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const lines = await unassignedLines(conn, projectId);
    let done = 0;
    for (const a of assignments) {
      const fid = parseInt(a.filament_id, 10);
      if (!Number.isFinite(fid)) continue;
      const [[fil]] = await conn.query('SELECT id, material, color_name FROM filament_cache WHERE id=?', [fid]);
      if (!fil) { const e = new Error('Bobine inconnue : actualisez le stock'); e.status = 400; throw e; }
      const k = keyOf(a.material, a.color_name);
      const ids = lines.filter(l => !l.__done && keyOf(l.material, l.color_name) === k);
      if (!ids.length) continue;
      await conn.query('UPDATE part_filaments SET filament_id=?, material=?, color_name=? WHERE id IN (?)',
        [fil.id, clean(fil.material), clean(fil.color_name), ids.map(l => l.id)]);
      for (const l of ids) l.__done = true;
      done += ids.length;
      // Pièces à un seul filament : leurs colonnes Matière / Couleur suivent la bobine choisie
      const single = ids.filter(l => Number(l.n_lines) === 1).map(l => l.part_id);
      if (single.length) {
        await conn.query('UPDATE parts SET material=?, color_name=? WHERE id IN (?)',
          [clean(fil.material), clean(fil.color_name), single]);
      }
    }
    if (done) await conn.query('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [projectId]);
    await conn.commit();
    return done;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }
}

module.exports = { duplicateProject, unassignedGroups, assignSpools, keyOf };
