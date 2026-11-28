// Impression libre (v1.51.0) : calibration ou test hors projet, monocouleur. Lancée depuis la page Production.
import { api } from './api.js';
import { store } from './store.js';
import { toast, openDialog } from './ui.js';
import { overdueWarning } from './maintenance.js';
import { updateRunsBadge } from './runs.js';
import { formatWeight, escapeHtml, filamentLabel, swatch, spoolStock, calibK, FREE_KIND } from './format.js';

const uniq = list => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
const options = (values, first) => `<option value="">${first}</option>`
  + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

export async function openFreePrintDialog({ onDone } = {}) {
  try { await Promise.all([store.loadPrinters(), store.loadFilaments()]); }
  catch (e) { toast(e.message, 'error'); return null; }
  const spools = store.filaments.filter(f => !f.archived);
  const printers = store.printers.filter(p => p.active);

  return openDialog({
    title: 'Impression libre',
    confirmLabel: 'Lancer',
    wide: true,
    build(body) {
      body.innerHTML = `<div class="free-form">
        <p class="dialog-help">Calibration ou test, hors projet. Une seule bobine ; poids et durée tels que le slicer les annonce.</p>
        <label class="field"><span>Nom</span>
          <input type="text" class="select" data-k="name" maxlength="150" placeholder="Tour de température PLA noir" autocomplete="off"></label>
        <label class="field"><span>Type</span>
          <select class="select" data-k="kind">
            ${Object.entries(FREE_KIND).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select></label>
        <p class="start-skip" data-slicer hidden>Poids et durée d'un autre slicer : ce test ne sert ni à la calibration par bobine
          (l'intervalle entre les deux pesées est écarté) ni à l'écart de durée prévue / réelle.</p>
        <label class="field"><span>Imprimante</span>
          <select class="select" data-k="printer">
            <option value="">Choisir…</option>
            ${printers.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select></label>
        <p class="start-skip maint-warn" data-maint hidden></p>
        <div class="free-grid">
          <label class="field"><span>Matière</span><select class="select" data-k="material">${options(uniq(spools.map(f => f.material)), 'Toutes')}</select></label>
          <label class="field"><span>Couleur</span><select class="select" data-k="color"></select></label>
        </div>
        <label class="field"><span>Bobine</span><select class="select" data-k="spool"></select></label>
        <div class="free-grid">
          <label class="field"><span>Poids prévu (g)</span><input type="text" inputmode="decimal" class="select" data-k="weight" autocomplete="off"></label>
          <div class="field"><span>Durée prévue (facultatif)</span>
            <span class="end-dur">
              <input type="number" class="select" min="0" max="999" step="1" data-k="h" placeholder="0" aria-label="Heures"> h
              <input type="number" class="select" min="0" max="59" step="1" data-k="m" placeholder="0" aria-label="Minutes"> min
            </span></div>
        </div>
        <div class="start-needs" data-needs></div>
        <details class="start-time">
          <summary>Heure de début (si l'impression est déjà lancée)</summary>
          <input type="datetime-local" class="select" data-k="started" aria-label="Heure de début">
        </details></div>`;

      const q = k => body.querySelector(`[data-k=${k}]`);
      const inMaterial = () => spools.filter(f => !q('material').value || f.material === q('material').value);

      const drawColors = () => {
        const keep = q('color').value, colors = uniq(inMaterial().map(f => f.color_name));
        q('color').innerHTML = options(colors, 'Toutes');
        if (colors.includes(keep)) q('color').value = keep;
      };
      const drawSpools = () => {
        const keep = q('spool').value;
        const list = inMaterial().filter(f => !q('color').value || f.color_name === q('color').value)
          .sort((a, b) => filamentLabel(a).localeCompare(filamentLabel(b), 'fr'));
        q('spool').innerHTML = '<option value="">Choisir…</option>' + list.map(f => {
          const st = spoolStock(f);
          return `<option value="${f.id}">${escapeHtml(filamentLabel(f))}${st.value !== null ? ` — ${escapeHtml(st.text)}` : ''}</option>`;
        }).join('');
        if (list.some(f => String(f.id) === keep)) q('spool').value = keep;
        else if (list.length === 1) q('spool').value = String(list[0].id);
      };
      // Poids prévu comparé au reste de la bobine (moins ce que réservent les impressions en cours)
      const drawNeeds = () => {
        const f = store.filamentsById.get(+q('spool').value);
        const g = Number(q('weight').value.trim().replace(',', '.'));
        const box = body.querySelector('[data-needs]');
        if (!f) { box.innerHTML = ''; return; }
        const st = spoolStock(f);
        const avail = st.value === null ? null : st.value - (Number(f.reserved_g) || 0);
        const need = g > 0 ? g * calibK(f) : 0;
        const short = avail !== null && need > avail;
        box.innerHTML = `<div class="need-line ${short ? 'is-short' : ''}">
          ${swatch(f.color_hex)}<span class="need-name">${escapeHtml(filamentLabel(f))}</span>
          <span class="need-g">${need ? formatWeight(Math.round(need * 100) / 100) : ''}</span>
          <span class="need-stock" title="${escapeHtml(st.title)}">${avail === null ? 'stock inconnu'
            : short ? `manque ${formatWeight(Math.round((need - avail) * 100) / 100)} (${escapeHtml(st.text)} dispo.)`
            : `${escapeHtml(st.text)}${st.estimated ? ' estimé' : ''} dispo.`}</span></div>`;
      };

      q('material').addEventListener('change', () => { drawColors(); drawSpools(); drawNeeds(); });
      q('color').addEventListener('change', () => { drawSpools(); drawNeeds(); });
      q('spool').addEventListener('change', drawNeeds);
      q('weight').addEventListener('input', drawNeeds);
      q('kind').addEventListener('change', () => { body.querySelector('[data-slicer]').hidden = q('kind').value !== 'slicer'; });
      drawColors(); drawSpools(); drawNeeds();

      // Imprimantes occupées grisées (le serveur vérifie aussi) et rappel d'une maintenance dépassée
      api.get('runs?state=en_cours').then(running => {
        if (!body.isConnected) return;
        const sel = q('printer');
        for (const opt of sel.options) {
          const r = running.find(x => x.printer_id === +opt.value);
          if (!r) continue;
          opt.disabled = true;
          opt.textContent += ` — occupée (${[r.project_code, r.part_name].filter(Boolean).join(' · ')})`;
        }
        if (sel.selectedOptions[0]?.disabled) sel.value = '';
        sel.dispatchEvent(new Event('change'));
      }).catch(() => {});
      let maint = null;
      const drawMaint = () => {
        const box = body.querySelector('[data-maint]');
        const txt = maint ? overdueWarning(maint, parseInt(q('printer').value, 10)) : '';
        box.hidden = !txt; box.innerHTML = txt;
      };
      q('printer').addEventListener('change', drawMaint);
      api.get('maintenance').then(m => { maint = m; drawMaint(); }).catch(() => {});
    },
    async onConfirm(body) {
      const q = k => body.querySelector(`[data-k=${k}]`);
      const stop = (msg, k) => { toast(msg, 'error'); q(k).focus(); return false; };
      const name = q('name').value.trim();
      if (!name) return stop('Donnez un nom à cette impression', 'name');
      if (!q('printer').value) return stop('Choisissez une imprimante', 'printer');
      if (!q('spool').value) return stop('Choisissez une bobine', 'spool');
      const weight = Number(q('weight').value.trim().replace(',', '.').replace(/\s*g$/i, ''));
      if (!(weight > 0)) return stop('Indiquez le poids prévu, en grammes', 'weight');
      const seconds = ((parseInt(q('h').value, 10) || 0) * 60 + (parseInt(q('m').value, 10) || 0)) * 60;
      await api.post('runs/free', {
        name, kind: q('kind').value, printer_id: +q('printer').value, filament_id: +q('spool').value,
        weight_g: weight, time_s: seconds > 0 ? seconds : undefined, started_at: q('started').value || undefined,
      });
      toast('Impression libre lancée');
      updateRunsBadge();
      try { await onDone?.(); } catch (e) { toast(e.message, 'error'); }
    },
  });
}
