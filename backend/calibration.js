/**
 * calibration.js — Écart entre le poids prévu (Elegoo Slicer) et la consommation réelle (pesées FilaFlow)
 *
 * Lecture seule : l'historique des pesées vient de GET /api/weighings de FilaFlow (jamais d'écriture).
 * Les pesées marquées « suspectes » par FilaFlow (champ `flag`, tant qu'elles ne sont pas confirmées) sont ignorées.
 *
 * Principe : pour une bobine, entre deux pesées consécutives (poids net N1 puis N2), la consommation
 * mesurée est N1 − N2. On la compare au poids retenu des impressions de PrepFlow terminées dans
 * l'intervalle. Le coefficient d'une bobine = Σ mesuré / Σ retenu sur ses intervalles valides.
 * Repli quand une bobine a trop peu de données : coefficient du filament (matière + couleur), puis de la matière.
 */
const db = require('./db');
const filaflow = require('./filaflow');

const MIN_INTERVAL_G  = 20;    // sous ce poids retenu, la précision de la balance (±1-2 g) noie le signal
const MAX_GAP_DAYS    = 45;    // au-delà, trop de risques d'impressions hors PrepFlow
const RATIO_MIN       = 0.5;   // hors de cette plage, l'intervalle est écarté (impression hors PrepFlow, erreur de pesée)
const RATIO_MAX       = 1.6;
const MIN_PLANNED_G   = 150;   // données minimales pour un coefficient (par groupe)
const MIN_INTERVALS   = 3;
const CLAMP           = [0.7, 1.3];   // plage dans laquelle un coefficient pourra être appliqué

const ts = s => new Date(String(s).replace(' ', 'T')).getTime();

/**
 * weighings : [{ filament_id, net_weight, created_at }]
 * runs      : [{ filament_id, relay, started_at, ended_at, state, result, basis_g }] (une ligne par run et bobine)
 *               basis_g = poids du slicer × % réalisé (indépendant d'une éventuelle correction manuelle du poids)
 * Renvoie { intervals: [...] } avec les intervalles analysés (valides ou écartés, avec la raison).
 */
function buildIntervals(weighings, runs) {
  const byFil = new Map();
  for (const w of weighings) {
    if (!byFil.has(w.filament_id)) byFil.set(w.filament_id, []);
    byFil.get(w.filament_id).push({ net: Number(w.net_weight), t: ts(w.created_at), at: String(w.created_at).slice(0, 19) });
  }
  const runsBy = new Map();
  for (const r of runs) {
    if (!runsBy.has(r.filament_id)) runsBy.set(r.filament_id, []);
    runsBy.get(r.filament_id).push({ ...r, ts0: ts(r.started_at), ts1: r.ended_at ? ts(r.ended_at) : null });
  }
  const out = [];
  for (const [fid, list] of byFil) {
    list.sort((a, b) => a.t - b.t);
    const fr = runsBy.get(fid) || [];
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      const row = { filament_id: fid, from: a.at, to: b.at, measured_g: Math.round((a.net - b.net) * 10) / 10, planned_g: 0, runs: 0, ok: false, reason: null };
      const done = fr.filter(r => r.state === 'termine' && r.result !== 'annule' && r.ts1 !== null && r.ts1 > a.t && r.ts1 <= b.t);
      row.planned_g = Math.round(done.reduce((s, r) => s + Number(r.basis_g || 0), 0) * 100) / 100;
      row.runs = done.length;
      // une impression en cours à l'instant d'une pesée fausserait la mesure
      const spans = t => fr.some(r => r.ts0 < t && (r.ts1 === null || r.ts1 > t) && r.result !== 'annule');
      const open = spans(a.t) || spans(b.t);
      if (b.t - a.t > MAX_GAP_DAYS * 86400000) row.reason = 'intervalle trop long';
      else if (open) row.reason = 'impression à cheval sur une pesée';
      else if (row.measured_g < -2) row.reason = 'poids en hausse (nouvelle bobine ou correction)';
      // relais de bobine : la part de chaque bobine est estimée, pas mesurée, donc l'intervalle n'est pas fiable
      else if (done.some(r => Number(r.relay) === 1)) row.reason = 'relais de bobine';
      else if (row.planned_g < MIN_INTERVAL_G) row.reason = row.planned_g === 0 ? 'aucune impression PrepFlow' : 'poids trop faible';
      else {
        const ratio = row.measured_g / row.planned_g;
        if (ratio < RATIO_MIN || ratio > RATIO_MAX) row.reason = 'écart aberrant (impression hors PrepFlow ?)';
        else row.ok = true;
      }
      out.push(row);
    }
  }
  return out;
}

const sum = (l, k) => l.reduce((s, x) => s + x[k], 0);
function coef(list) {
  const ok = list.filter(x => x.ok);
  const planned = sum(ok, 'planned_g'), measured = sum(ok, 'measured_g');
  const k = planned > 0 ? measured / planned : null;
  return {
    intervals: ok.length, planned_g: Math.round(planned), measured_g: Math.round(measured),
    k: k === null ? null : Math.round(k * 1000) / 1000,
    enough: ok.length >= MIN_INTERVALS && planned >= MIN_PLANNED_G,
  };
}

/** Regroupe : une ligne par bobine, avec le coefficient retenu (bobine, sinon filament, sinon matière). */
function summarize(intervals, filaments) {
  const fmap = new Map(filaments.map(f => [f.id, f]));
  const groupKey = { spool: f => f.id, filament: f => `${f.material}|${f.color_name}`, material: f => `${f.material}` };
  const ivs = intervals.filter(i => fmap.has(i.filament_id));
  const groups = {};
  for (const level of Object.keys(groupKey)) {
    const m = new Map();
    for (const i of ivs) {
      const key = groupKey[level](fmap.get(i.filament_id));
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(i);
    }
    groups[level] = new Map([...m].map(([k, l]) => [k, coef(l)]));
  }
  const rows = [];
  const ids = new Set(ivs.map(i => i.filament_id));
  for (const id of ids) {
    const f = fmap.get(id);
    const own = groups.spool.get(groupKey.spool(f));
    const fil = groups.filament.get(groupKey.filament(f));
    const mat = groups.material.get(groupKey.material(f));
    let used = null, level = null;
    if (own.enough) { used = own; level = 'bobine'; }
    else if (fil.enough) { used = fil; level = 'filament'; }
    else if (mat.enough) { used = mat; level = 'matière'; }
    const k = used ? used.k : null;
    rows.push({
      filament_id: id, name: f.name, spool_number: f.spool_number, material: f.material, color_name: f.color_name, color_hex: f.color_hex,
      own, level, k, k_applied: k === null ? null : Math.min(CLAMP[1], Math.max(CLAMP[0], k)),
      clamped: k !== null && (k < CLAMP[0] || k > CLAMP[1]),
      excluded: ivs.filter(i => i.filament_id === id && !i.ok).length,
      recent: ivs.filter(i => i.filament_id === id).sort((a, b) => (a.to < b.to ? 1 : -1)).slice(0, 6)
        .map(i => ({ from: i.from, to: i.to, measured_g: i.measured_g, planned_g: i.planned_g, runs: i.runs, ok: i.ok, reason: i.reason })),
    });
  }
  rows.sort((a, b) => (b.own.planned_g - a.own.planned_g));
  const all = coef(ivs);
  const materials = [...groups.material].map(([material, c]) => ({ material, ...c })).sort((a, b) => b.planned_g - a.planned_g);
  return { overall: all, materials, spools: rows };
}

let cache = { at: 0, weighings: null };
async function fetchWeighings() {
  if (cache.weighings && Date.now() - cache.at < 30_000) return cache.weighings;
  const base = await filaflow.baseUrl();
  const res = await fetch(`${base}/api/weighings?limit=20000`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`FilaFlow a répondu ${res.status} sur /api/weighings`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Réponse FilaFlow inattendue (liste attendue)');
  // FilaFlow ≥ 1.13 marque `flag` une pesée automatique jugée suspecte et non confirmée : elle n'est pas fiable pour mesurer
  const usable = data.filter(w => !w.flag);
  cache = { at: Date.now(), weighings: usable };
  return usable;
}

async function compute() {
  await filaflow.sync();
  const weighings = await fetchWeighings();
  const [runs] = await db.query(
    `SELECT rf.filament_id, rf.relay, r.started_at, r.ended_at, r.state, r.result,
            CASE WHEN rf.planned_g > 0 THEN rf.planned_g * COALESCE(r.progress_pct, 100) / 100 ELSE rf.weight_g END AS basis_g
       FROM print_run_filaments rf JOIN print_runs r ON r.id = rf.run_id`);
  const [filaments] = await db.query('SELECT id, name, spool_number, material, color_name, color_hex FROM filament_cache');
  const intervals = buildIntervals(weighings, runs);
  return { ...summarize(intervals, filaments), thresholds: { min_intervals: MIN_INTERVALS, min_planned_g: MIN_PLANNED_G, clamp: CLAMP } };
}

/**
 * Coefficients appliqués aux calculs : Map filament_id → coefficient (plafonné), vide si la calibration est désactivée
 * (Paramètres) ou si FilaFlow est injoignable et qu'aucun calcul récent n'existe. Calcul mis en cache 5 minutes.
 */
let coefCache = { at: 0, map: new Map() };
async function getCoefficients() {
  try {
    const [[row]] = await db.query("SELECT value FROM settings WHERE key_name='calibration_apply'");
    if (row && row.value === '0') return new Map();
  } catch (_) {}
  if (Date.now() - coefCache.at < 5 * 60_000) return coefCache.map;
  try {
    const c = await compute();
    coefCache = { at: Date.now(), map: new Map(c.spools.filter(r => r.k_applied !== null).map(r => [r.filament_id, r.k_applied])) };
  } catch (e) {
    // FilaFlow injoignable : on garde le dernier résultat connu (ou rien), sans bloquer les pages
    coefCache.at = Date.now() - 3 * 60_000;   // nouvel essai dans 2 minutes
  }
  return coefCache.map;
}

module.exports = { compute, getCoefficients, buildIntervals, summarize, coef };
