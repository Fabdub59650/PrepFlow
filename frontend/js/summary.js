// Calculs dérivés d'une pièce et synthèse d'un projet (côté navigateur :
// la synthèse se met à jour à chaque saisie sans recharger le projet).

/** Coût d'un gramme de filament : prix de la bobine / poids net de la bobine */
export function pricePerGram(f) {
  if (!f || f.price === null || f.price === undefined || !f.weight_total) return null;
  return Number(f.price) / Number(f.weight_total);
}

export function derivePart(part, filamentsById) {
  const qty = part.quantity || 0;
  const fils = part.filaments || [];
  const unitWeight = fils.reduce((s, f) => s + (Number(f.weight_g) || 0), 0);
  const hasWeight = fils.some(f => f.weight_g !== null && f.weight_g !== undefined);

  let cost = 0, costKnown = hasWeight;
  for (const f of fils) {
    if (f.weight_g === null || f.weight_g === undefined) continue;
    const ppg = pricePerGram(filamentsById.get(f.filament_id));
    if (ppg === null) { costKnown = false; continue; }
    cost += ppg * Number(f.weight_g) * qty;
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
 * « Reste » = pièces non imprimées : les pièces déjà imprimées ont déjà été
 * retirées du stock par la balance, on ne les recompte pas face au stock.
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
    const done = p.status === 'imprime';
    s.pieces += qty;
    if (done) s.pieces_done += qty;

    if (d.total_time === null) s.missing_time++;
    else {
      s.time_total += d.total_time;
      if (!done) s.time_left += d.total_time;
    }
    if (d.total_weight === null) s.missing_weight++;
    else {
      s.weight_total += d.total_weight;
      if (!done) s.weight_left += d.total_weight;
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
    if (!done) bp.pieces_left += qty;
    if (d.total_time !== null) {
      bp.time_total += d.total_time;
      if (!done) bp.time_left += d.total_time;
    }

    for (const f of p.filaments || []) {
      if (f.filament_id === null || f.filament_id === undefined) continue;
      if (!s.byFilament.has(f.filament_id)) {
        const info = filamentsById.get(f.filament_id);
        s.byFilament.set(f.filament_id, {
          filament_id: f.filament_id,
          info: info || null,
          stock: info && info.weight_remaining !== null ? Number(info.weight_remaining) : null,
          used_total: 0,
          needed: 0,
        });
      }
      const bf = s.byFilament.get(f.filament_id);
      const w = (Number(f.weight_g) || 0) * qty;
      bf.used_total += w;
      if (!done) bf.needed += w;
    }
  }

  for (const bf of s.byFilament.values()) {
    bf.sufficient = bf.stock === null ? null : bf.stock >= bf.needed;
    bf.margin = bf.stock === null ? null : bf.stock - bf.needed;
  }
  s.short = [...s.byFilament.values()].filter(b => b.sufficient === false);
  return s;
}
