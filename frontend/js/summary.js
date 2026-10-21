// Calculs dérivés d'une pièce et synthèse d'un projet (côté navigateur :
// la synthèse se met à jour à chaque saisie sans recharger le projet).
import { spoolStock, calibK } from './format.js';

/** Pièces réussies d'une ligne (calculées par le serveur à partir des impressions) */
export function doneQty(part) {
  const qty = part.quantity || 0;
  if (part.done_qty !== undefined && part.done_qty !== null) return Math.min(qty, Number(part.done_qty));
  return part.status === 'imprime' ? qty : 0;
}

/** Coût d'un gramme de filament : le prix saisi dans FilaFlow est un prix au kilo (€/kg) */
export function pricePerGram(f) {
  if (!f || f.price === null || f.price === undefined) return null;
  return Number(f.price) / 1000;
}

export function derivePart(part, filamentsById) {
  const qty = part.quantity || 0;
  const fils = part.filaments || [];
  const unitWeight = fils.reduce((s, f) => s + (Number(f.weight_g) || 0), 0);
  const hasWeight = fils.some(f => f.weight_g !== null && f.weight_g !== undefined);

  let cost = 0, costKnown = hasWeight;
  for (const f of fils) {
    if (f.weight_g === null || f.weight_g === undefined) continue;
    const spoolInfo = filamentsById.get(f.filament_id);
    const ppg = pricePerGram(spoolInfo);
    if (ppg === null) { costKnown = false; continue; }
    cost += ppg * Number(f.weight_g) * qty * calibK(spoolInfo);
  }

  return {
    unit_weight: hasWeight ? unitWeight : null,
    total_weight: hasWeight ? unitWeight * qty : null,
    total_time: part.print_time_s === null || part.print_time_s === undefined
      ? null : part.print_time_s * qty,
    cost: hasWeight ? cost : null,
    cost_complete: costKnown,
  };
}

/**
 * Synthèse d'un projet.
 * « Reste » = pièces restant à imprimer (quantité − pièces réussies) : les pièces déjà imprimées
 * sont déjà décomptées du stock (pesée ou reste estimé), on ne les recompte pas.
 */
export function summarize(parts, filamentsById, printers) {
  const s = {
    pieces: 0, pieces_done: 0,
    time_total: 0, time_left: 0,
    weight_total: 0, weight_left: 0,
    cost_total: 0, cost_complete: true,
    missing_time: 0, missing_weight: 0,
    byPrinter: new Map(),
    byFilament: new Map(),
  };

  for (const p of parts) {
    const d = derivePart(p, filamentsById);
    const qty = p.quantity || 0;
    const done = doneQty(p);
    const left = qty - done;                       // pièces restant à imprimer (celles en cours comprises)
    s.pieces += qty;
    s.pieces_done += done;

    if (d.total_time === null) s.missing_time++;
    else {
      s.time_total += d.total_time;
      s.time_left += (p.print_time_s || 0) * left;
    }
    if (d.total_weight === null) s.missing_weight++;
    else {
      s.weight_total += d.total_weight;
      s.weight_left += (d.unit_weight || 0) * left;
    }
    if (d.cost !== null) s.cost_total += d.cost;
    if (!d.cost_complete) s.cost_complete = false;

    const key = p.printer_id ?? 'none';
    if (!s.byPrinter.has(key)) {
      const pr = printers.find(x => x.id === p.printer_id);
      s.byPrinter.set(key, {
        printer_id: p.printer_id ?? null,
        name: pr ? pr.name : 'Sans imprimante',
        time_total: 0, time_left: 0, pieces: 0, pieces_left: 0,
      });
    }
    const bp = s.byPrinter.get(key);
    bp.pieces += qty;
    bp.pieces_left += left;
    if (d.total_time !== null) {
      bp.time_total += d.total_time;
      bp.time_left += (p.print_time_s || 0) * left;
    }

    for (const f of p.filaments || []) {
      if (f.filament_id === null || f.filament_id === undefined) continue;
      if (!s.byFilament.has(f.filament_id)) {
        const info = filamentsById.get(f.filament_id);
        s.byFilament.set(f.filament_id, {
          filament_id: f.filament_id,
          info: info || null,
          stock: info ? spoolStock(info).value : null,      // reste estimé si des impressions ont suivi la dernière pesée
          stock_estimated: info ? spoolStock(info).estimated : false,
          used_total: 0,
          needed: 0,
        });
      }
      const bf = s.byFilament.get(f.filament_id);
      const wu = (Number(f.weight_g) || 0) * calibK(bf.info);   // calibré : poids du slicer × coefficient prévu/réel
      bf.used_total += wu * qty;
      bf.needed += wu * left;
    }
  }

  for (const bf of s.byFilament.values()) {
    bf.sufficient = bf.stock === null ? null : bf.stock >= bf.needed;
    bf.margin = bf.stock === null ? null : bf.stock - bf.needed;
  }
  s.short = [...s.byFilament.values()].filter(b => b.sufficient === false);
  return s;
}
