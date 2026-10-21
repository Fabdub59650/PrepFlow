/**
 * Coût de revient et prix de vente d'un projet.
 *   GET /api/projects/:id/cost
 *
 * Base : pièces déjà imprimées → poids et temps RÉELS des impressions (ratés compris) ;
 * pièces restant à imprimer → poids et temps PRÉVUS.
 * Coût machine par heure d'une imprimante = puissance moyenne (kW) × prix du kWh + usure (€/h).
 * Prix de vente d'une ligne = max(coût × (1 + marge), minimum par pièce × quantité).
 */
const router = require('express').Router();
const db = require('../db');

const round2 = n => Math.round(n * 100) / 100;
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

async function readSettings() {
  const [rows] = await db.query("SELECT key_name, value FROM settings WHERE key_name IN ('kwh_price','margin_pct','min_piece_price')");
  const m = new Map(rows.map(r => [r.key_name, r.value]));
  const get = (k, d) => { const n = Number(String(m.get(k) ?? '').replace(',', '.')); return m.has(k) && Number.isFinite(n) ? n : d; };
  return { kwh_price: get('kwh_price', 0.25), margin_pct: get('margin_pct', 30), min_piece_price: get('min_piece_price', 0) };
}

async function computeCost(projectId) {
  const [[project]] = await db.query('SELECT id, code, name, margin_pct, min_piece_price FROM projects WHERE id=?', [projectId]);
  if (!project) return null;
  const st = await readSettings();
  const margin = num(project.margin_pct) ?? st.margin_pct;
  const minPiece = num(project.min_piece_price) ?? st.min_piece_price;

  const [parts] = await db.query('SELECT id, name, quantity, printer_id, print_time_s, status FROM parts WHERE project_id=? ORDER BY sort_order, id', [projectId]);
  const empty = { project_id: project.id, settings: { kwh_price: st.kwh_price, margin_pct: margin, min_piece_price: minPiece,
      default_margin_pct: st.margin_pct, default_min_piece_price: st.min_piece_price,
      margin_is_default: num(project.margin_pct) === null, min_is_default: num(project.min_piece_price) === null },
    parts: [], totals: null };
  if (!parts.length) return empty;
  const ids = parts.map(p => p.id);
  const [printers] = await db.query('SELECT id, name, power_w, wear_eur_h FROM printers');
  const prn = new Map(printers.map(p => [p.id, p]));
  const [fc] = await db.query('SELECT id, price, weight_total FROM filament_cache');
  const ppg = new Map(fc.map(f => [f.id, f.price !== null ? Number(f.price) / 1000 : null]));
  const [pfils] = await db.query('SELECT part_id, filament_id, weight_g FROM part_filaments WHERE part_id IN (?)', [ids]);
  const [runs] = await db.query(
    `SELECT id, part_id, printer_id, batch_id, quantity, state, result, duration_s, progress_pct FROM print_runs WHERE part_id IN (?)`, [ids]);
  const [rfils] = runs.length ? await db.query(
    'SELECT run_id, filament_id, weight_g, planned_g FROM print_run_filaments WHERE run_id IN (?)', [runs.map(r => r.id)]) : [[]];
  const kmap = await require('../calibration').getCoefficients();   // calibration prévu/réel par bobine
  const batchSize = new Map();
  for (const r of runs) if (r.batch_id) batchSize.set(r.batch_id, (batchSize.get(r.batch_id) || 0) + 1);

  const flags = { missing_price: false, missing_power: false, missing_printer: false, missing_weight: false, missing_time: false };
  const rate = printerId => {
    const p = prn.get(printerId);
    if (!p) { flags.missing_printer = true; return { kwh: 0, wear: 0 }; }
    if (p.power_w === null || p.power_w === undefined) flags.missing_power = true;
    return { kwh: (num(p.power_w) || 0) / 1000, wear: num(p.wear_eur_h) || 0 };
  };

  const out = [];
  for (const part of parts) {
    const mine = runs.filter(r => r.part_id === part.id);
    const finished = mine.filter(r => r.state === 'termine' && (r.result === 'ok' || r.result === 'rate'));
    const doneQty = mine.length
      ? Math.min(part.quantity, mine.filter(r => r.state === 'termine' && r.result === 'ok').reduce((a, r) => a + r.quantity, 0))
      : (part.status === 'imprime' ? part.quantity : 0);
    // Pièces sans impression mais déjà imprimées (statut manuel) : pas de réel, on retient le prévu
    const leftQty = mine.length ? part.quantity - doneQty : part.quantity;
    const manualDone = !mine.length && part.status === 'imprime';
    const planQty = manualDone ? part.quantity : leftQty;

    let material = 0, hoursKwh = 0, hoursWear = 0, hours = 0, wasteMaterial = 0, wasteMachine = 0;
    // Réel
    for (const r of finished) {
      let mat = 0;
      for (const f of rfils.filter(x => x.run_id === r.id)) {
        let g = Number(f.weight_g) || 0;
        // seul un poids non corrigé à la main est une estimation du slicer, donc calibrable
        const uncorrected = Math.abs(g - (Number(f.planned_g) || 0) * (r.progress_pct ?? 100) / 100) < 0.05;
        if (uncorrected) g *= kmap.get(f.filament_id) || 1;
        const pr = ppg.get(f.filament_id);
        if (pr === null || pr === undefined) { if (g > 0) flags.missing_price = true; continue; }
        mat += g * pr;
      }
      let secs = r.duration_s;
      if (secs === null || secs === undefined) secs = (part.print_time_s || 0) * r.quantity;
      else if (r.batch_id) secs = secs / batchSize.get(r.batch_id);
      const h = secs / 3600, rt = rate(r.printer_id ?? part.printer_id);
      material += mat; hours += h; hoursKwh += h * rt.kwh; hoursWear += h * rt.wear;
      if (r.result === 'rate') { wasteMaterial += mat; wasteMachine += h * (rt.kwh * st.kwh_price + rt.wear); }
    }
    // Prévu
    if (planQty > 0) {
      const lines = pfils.filter(f => f.part_id === part.id);
      if (!lines.some(f => f.weight_g !== null)) flags.missing_weight = true;
      for (const f of lines) {
        const g = (Number(f.weight_g) || 0) * planQty * (kmap.get(f.filament_id) || 1);
        const pr = f.filament_id === null ? null : ppg.get(f.filament_id);
        if (pr === null || pr === undefined) { if (g > 0) flags.missing_price = true; continue; }
        material += g * pr;
      }
      if (part.print_time_s === null) flags.missing_time = true;
      const h = ((part.print_time_s || 0) * planQty) / 3600, rt = rate(part.printer_id);
      hours += h; hoursKwh += h * rt.kwh; hoursWear += h * rt.wear;
    }
    const electricity = hoursKwh * st.kwh_price, wear = hoursWear;
    const total = material + electricity + wear;
    const priceMargin = total * (1 + margin / 100), priceMin = minPiece * part.quantity;
    const price = Math.max(priceMargin, priceMin);
    out.push({
      part_id: part.id, name: part.name, quantity: part.quantity, done_qty: doneQty,
      basis: !finished.length ? 'prevu' : (planQty > 0 ? 'mixte' : 'reel'),
      hours: round2(hours), material: round2(material), electricity: round2(electricity), wear: round2(wear),
      cost: round2(total), price: round2(price), min_applied: priceMin > priceMargin,
      waste: round2(wasteMaterial + wasteMachine),
    });
  }
  const sum = k => round2(out.reduce((a, x) => a + x[k], 0));
  const pieces = out.reduce((a, x) => a + x.quantity, 0);
  const totals = { pieces, hours: sum('hours'), material: sum('material'), electricity: sum('electricity'), wear: sum('wear'),
    cost: sum('cost'), price: sum('price'), waste: sum('waste') };
  totals.profit = round2(totals.price - totals.cost);
  totals.margin_obtained_pct = totals.cost > 0 ? Math.round(1000 * totals.profit / totals.cost) / 10 : null;
  totals.cost_per_piece = pieces ? round2(totals.cost / pieces) : null;
  totals.price_per_piece = pieces ? round2(totals.price / pieces) : null;
  return { ...empty, parts: out, totals, flags };
}

router.get('/projects/:id/cost', async (req, res) => {
  try {
    const r = await computeCost(parseInt(req.params.id, 10));
    if (!r) return res.status(404).json({ error: 'Projet introuvable' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, computeCost };
