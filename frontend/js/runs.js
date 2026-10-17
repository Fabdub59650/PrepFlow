// Suivi de production : fenêtres « Lancer » et « Terminer », utilisées par la vue projet et la page Production
import { api } from './api.js';
import { store } from './store.js';
import { toast, openDialog } from './ui.js';
import { overdueWarning } from './maintenance.js';
import { formatDuration, formatWeight, escapeHtml, filamentLabel, swatch, spoolStock, RUN_RESULT } from './format.js';

const round2 = n => Math.round(n * 100) / 100;

const parseWeight = s => {
  const t = String(s ?? '').trim().replace(',', '.').replace(/\s*g$/i, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? round2(n) : NaN;
};

/** Impressions d'un projet → Map(part_id → { done : pièces réussies, active : impressions en cours }) */
export function indexRuns(runs) {
  const byPart = new Map();
  for (const r of runs) {
    const e = byPart.get(r.part_id) || { done: 0, active: [] };
    if (r.state === 'en_cours') e.active.push(r);
    else if (r.result === 'ok') e.done += r.quantity;
    byPart.set(r.part_id, e);
  }
  return byPart;
}

/** Impressions à terminer ensemble : celles de la pièce et celles de leur lancement groupé */
export function runsToFinish(partId, runIdx) {
  const all = [];
  for (const e of runIdx.values()) all.push(...e.active);
  const mine = runIdx.get(partId)?.active || [];
  const batches = new Set(mine.map(r => r.batch_id).filter(Boolean));
  return all.filter(r => r.part_id === partId || (r.batch_id && batches.has(r.batch_id))).sort((a, b) => a.id - b.id);
}

/** Pastille du menu : nombre d'impressions en cours */
export async function updateRunsBadge() {
  try {
    const list = await api.get('runs?state=en_cours');
    document.querySelectorAll('[data-nav=production] .nav-badge').forEach(b => { b.textContent = list.length; b.hidden = !list.length; });
  } catch (_) { /* le menu reste tel quel */ }
}

// Une pièce se lance si au moins une bobine est choisie et qu'aucun poids n'est resté sans bobine
const launchable = p => {
  const fils = p.filaments || [];
  return fils.some(f => f.filament_id) && !fils.some(f => !f.filament_id && Number(f.weight_g) > 0);
};

/* ── Lancer ────────────────────────────────────────────────────── */

/**
 * parts : lignes du tableau (une seule = impression simple, plusieurs = lancement groupé)
 * runIdx : résultat de indexRuns, pour proposer la quantité restante
 */
export function openStartDialog({ parts, runIdx = new Map(), onDone }) {
  const ok = parts.filter(launchable);
  const skipped = parts.filter(p => !launchable(p));
  if (!ok.length) {
    toast(parts.length === 1
      ? `« ${parts[0].name || 'Sans nom'} » n'a pas de bobine choisie`
      : "Aucune des pièces sélectionnées n'a de bobine choisie", 'error');
    return null;
  }
  const printers = store.printers.filter(p => p.active);
  const shared = new Set(ok.map(p => p.printer_id));
  const initialPrinter = shared.size === 1 && ok[0].printer_id ? ok[0].printer_id : '';
  const doneOf = p => runIdx.get(p.id)?.done || 0;
  const group = ok.length > 1;

  return openDialog({
    title: group ? `Lancer ${ok.length} pièces ensemble` : 'Lancer une impression',
    confirmLabel: 'Lancer',
    wide: group,
    build(body) {
      body.innerHTML = `
        <p class="dialog-help">${group
          ? 'Un plateau : toutes les pièces partent sur la même imprimante, à la même heure.'
          : 'La consommation de filament est estimée à partir du poids de la pièce.'}</p>
        <label class="field"><span>Imprimante</span>
          <select class="select" data-k="printer">
            <option value="">Choisir…</option>
            ${printers.map(p => `<option value="${p.id}" ${p.id === initialPrinter ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select></label>
        <p class="start-skip maint-warn" data-maint hidden></p>
        <div class="start-items">
          ${ok.map(p => {
            const done = doneOf(p);
            const reprint = p.status === 'imprime' || done >= p.quantity;
            return `<div class="start-item" data-id="${p.id}">
              <span class="start-name">${escapeHtml(p.name || 'Sans nom')}</span>
              <span class="start-meta">${done ? `déjà ${done}/${p.quantity}` : `${p.quantity} à imprimer`}${reprint ? ' · <strong>réimpression</strong>' : ''}</span>
              <label class="qty-input">Qté <input type="number" min="1" step="1" data-qty value="${Math.max(1, p.quantity - done)}"></label>
            </div>`;
          }).join('')}
        </div>
        <div class="start-needs" data-needs></div>
        ${skipped.length ? `<p class="start-skip">Non lancée${skipped.length > 1 ? 's' : ''} (pas de bobine choisie) :
          ${skipped.map(p => escapeHtml(p.name || 'Sans nom')).join(', ')}.</p>` : ''}
        <details class="start-time">
          <summary>Heure de début (si l'impression est déjà lancée)</summary>
          <input type="datetime-local" class="select" data-k="started" aria-label="Heure de début">
        </details>`;

      // Besoin en filament par bobine, comparé au reste estimé (moins ce qui est déjà réservé par d'autres impressions)
      const drawNeeds = () => {
        const need = new Map();
        for (const row of body.querySelectorAll('.start-item')) {
          const p = ok.find(x => x.id === +row.dataset.id);
          const qty = Math.max(0, parseInt(row.querySelector('[data-qty]').value, 10) || 0);
          for (const f of p.filaments || []) {
            if (!f.filament_id) continue;
            need.set(f.filament_id, (need.get(f.filament_id) || 0) + (Number(f.weight_g) || 0) * qty);
          }
        }
        body.querySelector('[data-needs]').innerHTML = [...need.entries()].map(([fid, g]) => {
          const f = store.filamentsById.get(fid);
          const st = spoolStock(f);
          const avail = st.value === null ? null : st.value - (Number(f?.reserved_g) || 0);
          const short = avail !== null && g > avail;
          return `<div class="need-line ${short ? 'is-short' : ''}">
            ${swatch(f?.color_hex)}<span class="need-name">${escapeHtml(filamentLabel(f))}</span>
            <span class="need-g">${formatWeight(round2(g)) || '0 g'}</span>
            <span class="need-stock" title="${escapeHtml(st.title)}">${avail === null ? 'stock inconnu'
              : short ? `manque ${formatWeight(round2(g - avail))} (${st.text} dispo.)` : `${st.text}${st.estimated ? ' estimé' : ''} dispo.`}</span>
          </div>`;
        }).join('');
      };
      body.querySelectorAll('[data-qty]').forEach(i => i.addEventListener('input', drawNeeds));
      drawNeeds();

      // Avertissement (non bloquant) si l'imprimante choisie a une maintenance dépassée
      let maint = null;
      const drawMaint = () => {
        const box = body.querySelector('[data-maint]');
        const txt = maint ? overdueWarning(maint, parseInt(body.querySelector('[data-k=printer]').value, 10)) : '';
        box.hidden = !txt; box.innerHTML = txt;
      };
      body.querySelector('[data-k=printer]').addEventListener('change', drawMaint);
      api.get('maintenance').then(m => { maint = m; drawMaint(); }).catch(() => {});
    },
    async onConfirm(body) {
      const printer = parseInt(body.querySelector('[data-k=printer]').value, 10);
      if (!printer) { toast('Choisissez une imprimante', 'error'); return false; }
      const items = [...body.querySelectorAll('.start-item')].map(row => ({
        part_id: +row.dataset.id, quantity: parseInt(row.querySelector('[data-qty]').value, 10) }));
      if (items.some(i => !Number.isFinite(i.quantity) || i.quantity < 1)) {
        toast('La quantité doit être un entier ≥ 1', 'error'); return false;
      }
      const started = body.querySelector('[data-k=started]').value || undefined;
      await api.post('runs/start', { printer_id: printer, items, started_at: started });
      toast(items.length > 1 ? `Lancement groupé : ${items.length} pièces` : 'Impression lancée');
      try { await onDone?.(); } catch (e) { toast(e.message, 'error'); }
    },
  });
}

/* ── Terminer ──────────────────────────────────────────────────── */

/** runs : impressions en cours (une seule, ou tout un lancement groupé) */
export function openFinishDialog({ runs, onDone }) {
  const finished = new Set();           // impressions déjà enregistrées (reprise après une erreur partielle)
  const many = runs.length > 1;
  const nameOf = r => `${r.part_name || 'Sans nom'} × ${r.quantity}`;

  const card = r => `
    <div class="finish-run" data-id="${r.id}">
      <div class="finish-run-head">
        <strong>${escapeHtml(nameOf(r))}</strong>
        <span class="muted">${escapeHtml([r.project_code, r.printer_name].filter(Boolean).join(' · '))}${r.elapsed_s !== null && r.elapsed_s !== undefined ? ` · lancée depuis ${formatDuration(r.elapsed_s) || '0 min'}` : ''}</span>
      </div>
      <div class="finish-controls">
        <div class="seg" role="radiogroup" aria-label="Résultat de ${escapeHtml(r.part_name || 'la pièce')}">
          ${Object.entries(RUN_RESULT).map(([v, l]) => `
            <label class="seg-opt seg-${v}"><input type="radio" name="res-${r.id}" value="${v}" ${v === 'ok' ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        <label class="pct-input" data-pct-box hidden>Réalisé <input type="number" min="0" max="99" step="1" value="50" data-pct> %</label>
      </div>
      <div class="finish-weights" data-weights>
        ${r.filaments.map(f => `
          <label class="fw" data-fid="${f.filament_id}">
            ${swatch(store.filamentsById.get(f.filament_id)?.color_hex)}
            <span class="fw-name">${escapeHtml(f.name || filamentLabel(store.filamentsById.get(f.filament_id)))}</span>
            <span class="fw-plan">prévu ${formatWeight(Number(f.planned_g)) || '0 g'}</span>
            <input type="text" inputmode="decimal" data-w aria-label="Poids retenu de ${escapeHtml(f.name || 'la bobine')} en grammes">
            <span>g</span>
          </label>`).join('')}
      </div>
    </div>`;

  return openDialog({
    title: many ? `Terminer ${runs.length} impressions` : "Terminer l'impression",
    confirmLabel: 'Enregistrer',
    wide: true,
    build(body) {
      body.innerHTML = `
        ${many ? `<div class="finish-all"><span>Pour toutes :</span>
          ${Object.entries(RUN_RESULT).map(([v, l]) => `<button type="button" class="btn btn-sm" data-all="${v}">${l}</button>`).join('')}
          <span class="muted">puis ajustez pièce par pièce si besoin</span></div>` : ''}
        <div class="finish-runs">${runs.map(card).join('')}</div>
        <label class="field"><span>Notes (facultatif)</span><textarea rows="2" data-k="notes" placeholder="Réglage, problème rencontré…"></textarea></label>
        <details class="start-time">
          <summary>Heure de fin (si l'impression est déjà terminée)</summary>
          <input type="datetime-local" class="select" data-k="ended" aria-label="Heure de fin">
        </details>`;

      // Affichage selon le résultat : % réalisé pour un raté, poids par défaut en grisé, rien pour un annulé
      const sync = c => {
        const result = c.querySelector('input[type=radio]:checked').value;
        c.querySelector('[data-pct-box]').hidden = result !== 'rate';
        c.querySelector('[data-weights]').hidden = result === 'annule';
        const pct = result === 'ok' ? 100 : (parseInt(c.querySelector('[data-pct]').value, 10) || 0);
        const run = runs.find(x => x.id === +c.dataset.id);
        c.querySelectorAll('.fw').forEach(w => {
          const f = run.filaments.find(x => x.filament_id === +w.dataset.fid);
          w.querySelector('[data-w]').placeholder = formatWeight(round2(Number(f.planned_g) * pct / 100)).replace(' g', '') || '0';
        });
      };
      body.querySelectorAll('.finish-run').forEach(c => {
        sync(c);
        c.addEventListener('change', () => sync(c));
        c.addEventListener('input', e => { if (e.target.matches('[data-pct]')) sync(c); });
      });
      body.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => {
        body.querySelectorAll('.finish-run:not(.is-done)').forEach(c => {
          c.querySelector(`input[type=radio][value="${b.dataset.all}"]`).checked = true;
          sync(c);
        });
      }));
    },
    async onConfirm(body) {
      const notes = body.querySelector('[data-k=notes]').value.trim();
      const ended = body.querySelector('[data-k=ended]').value || undefined;
      // Validation de toutes les cartes avant d'enregistrer la première
      const payloads = [];
      for (const r of runs) {
        if (finished.has(r.id)) continue;
        const c = body.querySelector(`.finish-run[data-id="${r.id}"]`);
        const result = c.querySelector('input[type=radio]:checked').value;
        const payload = { result, ended_at: ended };
        if (notes) payload.notes = notes;
        if (result === 'rate') {
          const pct = parseInt(c.querySelector('[data-pct]').value, 10);
          if (!Number.isFinite(pct) || pct < 0 || pct > 99) {
            toast(`${nameOf(r)} : pourcentage réalisé entre 0 et 99`, 'error'); return false;
          }
          payload.progress_pct = pct;
        }
        if (result !== 'annule') {
          const weights = [];
          for (const w of c.querySelectorAll('.fw')) {
            const g = parseWeight(w.querySelector('[data-w]').value);
            if (Number.isNaN(g)) { toast(`${nameOf(r)} : poids non reconnu`, 'error'); return false; }
            if (g !== null) weights.push({ filament_id: +w.dataset.fid, weight_g: g });
          }
          if (weights.length) payload.weights = weights;
        }
        payloads.push({ r, c, payload });
      }
      for (const { r, c, payload } of payloads) {
        try {
          await api.post(`runs/${r.id}/finish`, payload);
          finished.add(r.id);
          c.classList.add('is-done');
          c.querySelectorAll('input, button').forEach(x => { x.disabled = true; });
        } catch (e) {
          toast(`${nameOf(r)} : ${e.message}`, 'error');
          if (finished.size) { try { await onDone?.(); } catch (_) {} }
          return false;
        }
      }
      toast(payloads.length > 1 ? `${payloads.length} impressions enregistrées` : 'Impression enregistrée');
      try { await onDone?.(); } catch (e) { toast(e.message, 'error'); }
    },
  });
}

/* ── Corriger une impression terminée (poids retenus, notes) ────── */
export function openCorrectDialog({ run, onDone }) {
  const editable = run.result !== 'annule';
  return openDialog({
    title: "Corriger l'impression",
    confirmLabel: 'Enregistrer',
    build(body) {
      body.innerHTML = `
        <p class="muted">${escapeHtml(`${run.part_name || 'Sans nom'} × ${run.quantity}`)}${run.project_code ? ' · ' + escapeHtml(run.project_code) : ''}
          · le résultat ne se modifie pas : supprimez l'impression et refaites-la si besoin.</p>
        ${editable ? `<div class="corr-fils">${run.filaments.map(f => `
          <label class="fw" data-fid="${f.filament_id}">
            ${swatch(store.filamentsById.get(f.filament_id)?.color_hex)}
            <span class="fw-name">${escapeHtml(f.name || filamentLabel(store.filamentsById.get(f.filament_id)))}</span>
            <span class="fw-plan">prévu ${formatWeight(Number(f.planned_g)) || '0 g'}</span>
            <input type="text" inputmode="decimal" data-w value="${f.weight_g === null || f.weight_g === undefined ? '' : String(Number(f.weight_g)).replace('.', ',')}"
              aria-label="Poids retenu de ${escapeHtml(f.name || 'la bobine')} en grammes">
            <span>g</span>
          </label>`).join('')}</div>` : ''}
        <label class="field"><span>Notes</span><textarea rows="3" data-k="notes">${escapeHtml(run.notes || '')}</textarea></label>`;
    },
    async onConfirm(body) {
      const payload = { notes: body.querySelector('[data-k=notes]').value.trim() };
      if (editable) {
        const weights = [];
        for (const w of body.querySelectorAll('.fw')) {
          const g = parseWeight(w.querySelector('[data-w]').value);
          if (Number.isNaN(g)) { toast('Poids non reconnu', 'error'); return false; }
          if (g !== null) weights.push({ filament_id: +w.dataset.fid, weight_g: g });
        }
        if (weights.length) payload.weights = weights;
      }
      try { await api.put(`runs/${run.id}`, payload); }
      catch (e) { toast(e.message, 'error'); return false; }
      toast('Impression corrigée');
      try { await onDone?.(); } catch (e) { toast(e.message, 'error'); }
    },
  });
}
