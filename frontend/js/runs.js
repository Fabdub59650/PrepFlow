// Suivi de production : fenêtres « Lancer » et « Terminer », utilisées par la vue projet et la page Production
import { api } from './api.js';
import { store } from './store.js';
import { toast, openDialog } from './ui.js';
import { overdueWarning } from './maintenance.js';
import { formatDuration, formatWeight, escapeHtml, filamentLabel, swatch, spoolStock, calibK, RUN_RESULT } from './format.js';

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
        <p class="start-relay-hint" data-relay-hint hidden>Si une bobine se vide en cours d'impression, utilisez « J'ai changé de bobine » à la fin : la consommation sera répartie entre les deux bobines.</p>
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
            need.set(f.filament_id, (need.get(f.filament_id) || 0) + (Number(f.weight_g) || 0) * qty * calibK(store.filamentsById.get(f.filament_id)));
          }
        }
        let anyShort = false;
        body.querySelector('[data-needs]').innerHTML = [...need.entries()].map(([fid, g]) => {
          const f = store.filamentsById.get(fid);
          const st = spoolStock(f);
          const avail = st.value === null ? null : st.value - (Number(f?.reserved_g) || 0);
          const short = avail !== null && g > avail;
          if (short) anyShort = true;
          return `<div class="need-line ${short ? 'is-short' : ''}">
            ${swatch(f?.color_hex)}<span class="need-name">${escapeHtml(filamentLabel(f))}</span>
            <span class="need-g">${formatWeight(round2(g)) || '0 g'}</span>
            <span class="need-stock" title="${escapeHtml(st.title)}">${avail === null ? 'stock inconnu'
              : short ? `manque ${formatWeight(round2(g - avail))} (${st.text} dispo., ${st.age})` : `${st.text}${st.estimated ? ' estimé' : ''} dispo.`}</span>
          </div>`;
        }).join('');
        body.querySelector('[data-relay-hint]').hidden = !anyShort;
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
            <span class="fw-name">${escapeHtml(lineSpool(f))}</span>
            <span class="fw-plan">prévu ${formatWeight(Number(f.planned_g)) || '0 g'}</span>
            <input type="text" inputmode="decimal" data-w aria-label="Poids retenu de ${escapeHtml(f.name || 'la bobine')} en grammes">
            <span>g</span>
          </label>`).join('')}
      </div>
      <div class="relay" data-relay-wrap>
        <div><button type="button" class="btn btn-sm" data-relay-toggle>J'ai changé de bobine</button></div>
        <div class="relay-box" data-relay-box hidden>
          <p class="relay-help">La bobine vidée prend son reste estimé (modifiable), la nouvelle bobine prend le reste du poids de la pièce.</p>
          <label class="relay-row"><span>Bobine vidée</span>
            <select class="select" data-relay-from ${r.filaments.length === 1 ? 'disabled' : ''} aria-label="Bobine vidée">
              ${r.filaments.map(f => `<option value="${f.filament_id}">${escapeHtml(lineSpool(f))}</option>`).join('')}
            </select></label>
          <label class="relay-row"><span>Remplacée par</span>
            <select class="select" data-relay-to aria-label="Nouvelle bobine"></select></label>
          <label class="relay-row"><span>Part de la bobine vidée</span>
            <span class="relay-g"><input type="text" inputmode="decimal" data-relay-g aria-label="Part de la bobine vidée en grammes"> g</span></label>
          <p class="relay-sum" data-relay-sum></p>
        </div>
      </div>
    </div>`;

  // Poids retenu d'une bobine de l'impression d'après la carte : valeur saisie, sinon prévu × % réalisé
  const lineTotal = (c, run, fid) => {
    const result = c.querySelector('input[type=radio]:checked').value;
    const pct = result === 'ok' ? 100 : (parseInt(c.querySelector('[data-pct]').value, 10) || 0);
    const f = run.filaments.find(x => x.filament_id === fid);
    const typed = parseWeight(c.querySelector(`.fw[data-fid="${fid}"] [data-w]`).value);
    return typed !== null && !Number.isNaN(typed) ? typed : round2(Number(f.planned_g) * pct / 100);
  };
  // Part de la bobine vidée : valeur saisie, sinon son reste estimé (plafonné au poids de la pièce) ; null si inconnue
  const relayShare = (c, run) => {
    const from = +c.querySelector('[data-relay-from]').value;
    const total = lineTotal(c, run, from);
    const typed = parseWeight(c.querySelector('[data-relay-g]').value);
    if (Number.isNaN(typed)) return { from, total, g: NaN };
    if (typed !== null) return { from, total, g: typed };
    const st = spoolStock(store.filamentsById.get(from));
    return { from, total, g: st.value === null ? null : round2(Math.min(st.value, total)) };
  };
  // Nouvelle bobine : actives et pas déjà sur l'impression, la même matière puis la même couleur en premier
  const fillRelayTargets = (c, run) => {
    const from = store.filamentsById.get(+c.querySelector('[data-relay-from]').value);
    const rank = f => (from && f.material === from.material ? 0 : 2) + (from && f.color_name === from.color_name ? 0 : 1);
    const list = store.filaments
      .filter(f => !f.archived && !run.filaments.some(x => x.filament_id === f.id))
      .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'fr'));
    const sel = c.querySelector('[data-relay-to]');
    const keep = sel.value;
    sel.innerHTML = '<option value="">Choisir…</option>' + list.map(f => {
      const st = spoolStock(f);
      return `<option value="${f.id}">${escapeHtml(filamentLabel(f))}${st.value !== null ? ` — ${st.text}` : ''}</option>`;
    }).join('');
    if (keep && list.some(f => String(f.id) === keep)) sel.value = keep;
  };

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
        <details class="start-time" data-end-box>
          <summary>Heure de fin ou durée (si l'impression est déjà terminée)</summary>
          <div class="end-mode">
            <label><input type="radio" name="end-mode" value="heure" checked> Heure de fin</label>
            <label><input type="radio" name="end-mode" value="duree"> Durée</label>
          </div>
          <input type="datetime-local" class="select" data-k="ended" aria-label="Heure de fin">
          <div class="end-dur" data-end-dur hidden>
            <input type="number" class="select" min="0" max="999" step="1" data-k="dur-h" placeholder="0" aria-label="Heures"> h
            <input type="number" class="select" min="0" max="59" step="1" data-k="dur-m" placeholder="0" aria-label="Minutes"> min
          </div>
          <p class="muted end-hint" data-end-hint hidden></p>
        </details>`;
      // Heure de fin ou durée : la durée est convertie en heure de fin à partir du début de chaque impression
      const endBox = body.querySelector('[data-end-box]');
      const endHint = () => {
        const h = body.querySelector('[data-end-hint]');
        const mode = endBox.querySelector('input[name=end-mode]:checked').value;
        const mins = durationMinutes(body);
        if (mode !== 'duree' || !mins) { h.hidden = true; return; }
        const ends = [...new Set(runs.filter(r => !finished.has(r.id)).map(r => addMinutes(r.started_at, mins)))];
        h.hidden = false;
        h.textContent = ends.length === 1 ? `Fin enregistrée : ${fmtLocal(ends[0])}` : `Fin enregistrée pour chaque impression : début + ${mins} min`;
      };
      endBox.addEventListener('change', e => {
        if (e.target.name === 'end-mode') {
          const duree = e.target.value === 'duree';
          endBox.querySelector('[data-k=ended]').hidden = duree;
          endBox.querySelector('[data-end-dur]').hidden = !duree;
        }
        endHint();
      });
      endBox.addEventListener('input', endHint);

      // Affichage selon le résultat : % réalisé pour un raté, poids par défaut en grisé, rien pour un annulé
      const sync = c => {
        const result = c.querySelector('input[type=radio]:checked').value;
        c.querySelector('[data-pct-box]').hidden = result !== 'rate';
        c.querySelector('[data-weights]').hidden = result === 'annule';
        c.querySelector('[data-relay-wrap]').hidden = result === 'annule';
        const pct = result === 'ok' ? 100 : (parseInt(c.querySelector('[data-pct]').value, 10) || 0);
        const run = runs.find(x => x.id === +c.dataset.id);
        c.querySelectorAll('.fw').forEach(w => {
          const f = run.filaments.find(x => x.filament_id === +w.dataset.fid);
          w.querySelector('[data-w]').placeholder = formatWeight(round2(Number(f.planned_g) * pct / 100)).replace(' g', '') || '0';
        });
        syncRelay(c, run);
      };
      // Relais de bobine : part de la bobine vidée préremplie, et répartition affichée en direct
      const syncRelay = (c, run) => {
        const box = c.querySelector('[data-relay-box]');
        if (box.hidden) return;
        const { from, total, g } = relayShare(c, run);
        const gInput = c.querySelector('[data-relay-g]');
        gInput.placeholder = g === null || Number.isNaN(g) ? '' : formatWeight(Math.min(g, total)).replace(' g', '') || '0';
        const sum = c.querySelector('[data-relay-sum]');
        const to = store.filamentsById.get(+c.querySelector('[data-relay-to]').value);
        const fromName = filamentLabel(store.filamentsById.get(from));
        sum.classList.remove('is-bad');
        if (Number.isNaN(g)) sum.textContent = 'Poids non reconnu';
        else if (g === null) sum.textContent = "Reste de la bobine vidée inconnu : indiquez sa part.";
        else if (g >= total) {
          sum.classList.add('is-bad');
          sum.textContent = `${fromName} couvre déjà ${formatWeight(total) || '0 g'} : pas de relais. Réduisez sa part si elle s'est vidée avant.`;
        } else if (!to) sum.textContent = 'Choisissez la nouvelle bobine.';
        else sum.textContent = `${fromName} : ${formatWeight(g) || '0 g'} · ${filamentLabel(to)} : ${formatWeight(round2(total - g)) || '0 g'}`;
      };
      body.querySelectorAll('.finish-run').forEach(c => {
        const run = runs.find(x => x.id === +c.dataset.id);
        fillRelayTargets(c, run);
        sync(c);
        c.addEventListener('change', e => {
          if (e.target.matches('[data-relay-from]')) fillRelayTargets(c, run);
          sync(c);
        });
        c.addEventListener('input', e => { if (e.target.matches('[data-pct], [data-w], [data-relay-g]')) sync(c); });
        c.querySelector('[data-relay-toggle]').addEventListener('click', ev => {
          const box = c.querySelector('[data-relay-box]');
          box.hidden = !box.hidden;
          ev.currentTarget.textContent = box.hidden ? "J'ai changé de bobine" : 'Annuler le relais';
          sync(c);
        });
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
      const byDuration = body.querySelector('input[name=end-mode]:checked').value === 'duree';
      const ended = byDuration ? undefined : (body.querySelector('[data-k=ended]').value || undefined);
      const durMin = byDuration ? durationMinutes(body) : 0;
      // Validation de toutes les cartes avant d'enregistrer la première
      const payloads = [];
      for (const r of runs) {
        if (finished.has(r.id)) continue;
        const c = body.querySelector(`.finish-run[data-id="${r.id}"]`);
        const result = c.querySelector('input[type=radio]:checked').value;
        const payload = { result, ended_at: durMin ? addMinutes(r.started_at, durMin) : ended };
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
          if (!c.querySelector('[data-relay-box]').hidden) {
            const to = parseInt(c.querySelector('[data-relay-to]').value, 10);
            if (!to) { toast(`${nameOf(r)} : choisissez la bobine qui a pris le relais`, 'error'); return false; }
            const { from, total, g } = relayShare(c, r);
            if (Number.isNaN(g)) { toast(`${nameOf(r)} : poids de la bobine vidée non reconnu`, 'error'); return false; }
            if (g === null) { toast(`${nameOf(r)} : indiquez la part de la bobine vidée`, 'error'); return false; }
            if (g >= total) { toast(`${nameOf(r)} : la bobine vidée couvre déjà tout le poids, pas de relais`, 'error'); return false; }
            payload.relay = { from_filament_id: from, to_filament_id: to, from_g: g };
          }
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

/* ── Heure de fin saisie en durée ───────────────────────────────── */
// Durée saisie (h + min) en minutes, 0 si vide
function durationMinutes(body) {
  const h = parseInt(body.querySelector('[data-k=dur-h]').value, 10) || 0;
  const m = parseInt(body.querySelector('[data-k=dur-m]').value, 10) || 0;
  return Math.max(0, h * 60 + m);
}
// « AAAA-MM-JJ HH:MM:SS » + n minutes, en heure murale (sans fuseau), au format attendu par le serveur
function addMinutes(dt, mins) {
  const m = String(dt).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + mins));
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function fmtLocal(dt) {
  const m = String(dt).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  return `${m[3]}/${m[2]}/${m[1]} à ${m[4]}`;
}

// Nom de la bobine d'une ligne d'impression, avec son n° entre parenthèses
function lineSpool(f) {
  const c = store.filamentsById.get(f.filament_id);
  if (c) return filamentLabel(c);
  const n = f.spool_number && String(f.spool_number).trim();
  return (f.name || 'Filament inconnu') + (n ? ` (${n})` : '');
}

/* ── Corriger une impression (bobines, poids retenus, notes) ────── */
export function openCorrectDialog({ run, onDone }) {
  const finishedRun = run.state === 'termine';
  const weightsEditable = finishedRun && run.result !== 'annule';
  const used = new Set(run.filaments.map(f => f.filament_id));
  // Bobines proposées pour une ligne : actives et pas déjà sur l'impression ; la même matière puis la même couleur en premier
  const optionsFor = f => {
    const cur = store.filamentsById.get(f.filament_id);
    const rank = x => (cur && x.material === cur.material ? 0 : 2) + (cur && x.color_name === cur.color_name ? 0 : 1);
    const list = store.filaments.filter(x => !x.archived && !used.has(x.id)).sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'fr'));
    const label = x => { const st = spoolStock(x); return `${escapeHtml(filamentLabel(x))}${st.value !== null ? ` — ${escapeHtml(st.text)}` : ''}`; };
    return `<option value="${f.filament_id}" selected>${cur ? label(cur) : escapeHtml(f.name || 'Bobine ' + f.filament_id)}</option>`
      + list.map(x => `<option value="${x.id}">${label(x)}</option>`).join('');
  };
  return openDialog({
    title: "Corriger l'impression",
    confirmLabel: 'Enregistrer',
    wide: true,
    build(body) {
      body.innerHTML = `
        <p class="muted">${escapeHtml(`${run.part_name || 'Sans nom'} × ${run.quantity}`)}${run.project_code ? ' · ' + escapeHtml(run.project_code) : ''}
          · le résultat ne se modifie pas : supprimez l'impression et refaites-la si besoin.</p>
        <div class="corr-fils">${run.filaments.map(f => `
          <div class="corr-line" data-fid="${f.filament_id}">
            <label class="fw ${weightsEditable ? '' : 'fw-nowt'}" data-fid="${f.filament_id}">
              ${swatch(store.filamentsById.get(f.filament_id)?.color_hex)}
              <select class="select" data-swap aria-label="Bobine utilisée">${optionsFor(f)}</select>
              <span class="fw-plan">prévu ${formatWeight(Number(f.planned_g)) || '0 g'}</span>
              ${weightsEditable ? `<input type="text" inputmode="decimal" data-w value="${f.weight_g === null || f.weight_g === undefined ? '' : String(Number(f.weight_g)).replace('.', ',')}"
                aria-label="Poids retenu de ${escapeHtml(f.name || 'la bobine')} en grammes"><span>g</span>` : ''}
            </label>
            <p class="fw-warn" data-warn hidden></p>
          </div>`).join('')}</div>
        <p class="muted corr-hint">Une erreur de bobine au lancement se corrige ici : la consommation suit la bobine choisie, le stock estimé des deux bobines se met à jour.</p>
        <label class="field"><span>Notes</span><textarea rows="3" data-k="notes">${escapeHtml(run.notes || '')}</textarea></label>`;
      // Avertissement si la matière change
      body.querySelectorAll('[data-swap]').forEach(sel => sel.addEventListener('change', () => {
        const line = sel.closest('.corr-line');
        const from = store.filamentsById.get(+line.dataset.fid), to = store.filamentsById.get(+sel.value);
        const warn = line.querySelector('[data-warn]');
        const diff = from && to && +sel.value !== +line.dataset.fid && from.material !== to.material;
        warn.hidden = !diff;
        if (diff) warn.textContent = `Attention : la matière change (${from.material || '?'} → ${to.material || '?'}).`;
      }));
    },
    async onConfirm(body) {
      const payload = { notes: body.querySelector('[data-k=notes]').value.trim() };
      if (weightsEditable) {
        const weights = [];
        for (const w of body.querySelectorAll('.fw')) {
          const g = parseWeight(w.querySelector('[data-w]').value);
          if (Number.isNaN(g)) { toast('Poids non reconnu', 'error'); return false; }
          if (g !== null) weights.push({ filament_id: +w.dataset.fid, weight_g: g });
        }
        if (weights.length) payload.weights = weights;
      }
      const swaps = [];
      for (const sel of body.querySelectorAll('[data-swap]')) {
        const from = +sel.closest('.corr-line').dataset.fid;
        if (+sel.value !== from) swaps.push({ from_filament_id: from, to_filament_id: +sel.value });
      }
      if (swaps.length) payload.swaps = swaps;
      try { await api.put(`runs/${run.id}`, payload); }
      catch (e) { toast(e.message, 'error'); return false; }
      toast(swaps.length ? 'Impression corrigée, bobine changée' : 'Impression corrigée');
      try { await onDone?.(); } catch (e) { toast(e.message, 'error'); }
    },
  });
}
