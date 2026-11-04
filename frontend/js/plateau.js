// Plateau multi-projets : choisir des pièces « Prêt » de plusieurs projets, puis les lancer ensemble
// avec la fenêtre de lancement habituelle (même imprimante, même heure de départ).
import { api } from './api.js';
import { store } from './store.js';
import { toast, openDialog } from './ui.js';
import { openStartDialog } from './runs.js';
import { escapeHtml, formatDuration, filamentLabel, swatch } from './format.js';

const MAX_GROUP = 50;   // même limite que le serveur
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function openPlateauPicker({ onDone }) {
  let parts;
  try {
    [parts] = await Promise.all([api.get('parts/ready'), store.loadFilaments().catch(() => {}), store.printers.length ? null : store.loadPrinters?.().catch(() => {})]);
  } catch (e) { toast(e.message, 'error'); return null; }
  if (!parts.length) { toast("Aucune pièce au statut « Prêt » dans les projets", 'error'); return null; }

  // Regroupement par projet (ordre du serveur : projets récents d'abord)
  const projects = new Map();
  for (const p of parts) {
    if (!projects.has(p.project_id)) projects.set(p.project_id, { id: p.project_id, code: p.project_code, name: p.project_name, parts: [] });
    projects.get(p.project_id).parts.push(p);
  }
  const byId = new Map(parts.map(p => [p.id, p]));
  // Bobines de la pièce : pastille + nom (n° de bobine), texte brut pour la recherche
  const spoolInfo = p => (p.filaments || []).filter(f => f.filament_id).map(f => {
    const fil = store.filamentsById.get(f.filament_id);
    return { fil, label: fil ? filamentLabel(fil) : [f.material, f.color_name].filter(Boolean).join(' ') };
  });
  let picked = null;

  return openDialog({
    title: 'Plateau multi-projets',
    confirmLabel: 'Continuer',
    wide: true,
    build(body) {
      body.innerHTML = `
        <p class="dialog-help">Cochez des pièces « Prêt » de plusieurs projets : elles partiront ensemble sur une même imprimante.
          Vous réglerez les quantités et l'imprimante à l'étape suivante.</p>
        <input type="search" class="select plateau-search" data-search placeholder="Rechercher un projet ou une pièce…" aria-label="Rechercher">
        <div class="plateau-list" data-list>
          ${[...projects.values()].map(pr => `
            <section class="plateau-project" data-project="${pr.id}">
              <label class="plateau-head"><input type="checkbox" data-all="${pr.id}" ${pr.parts.some(p => p.launchable) ? '' : 'disabled'}>
                <strong>${escapeHtml(pr.code || '')}</strong> <span>${escapeHtml(pr.name || '')}</span>
                <span class="muted">${pr.parts.length} pièce${pr.parts.length > 1 ? 's' : ''} prête${pr.parts.length > 1 ? 's' : ''}</span></label>
              ${pr.parts.map(p => `
                <label class="plateau-part ${p.launchable ? '' : 'is-off'}" data-part="${p.id}" data-text="${escapeHtml(norm([pr.code, pr.name, p.name, p.file_name, ...spoolInfo(p).map(x => x.label), ...(p.filaments || []).flatMap(f => [f.material, f.color_name])].join(' ')))}">
                  <input type="checkbox" data-pick="${p.id}" ${p.launchable ? '' : 'disabled'}>
                  <span class="plateau-name">${escapeHtml(p.name || 'Sans nom')}${spoolInfo(p).length ? `<span class="plateau-spools">${spoolInfo(p).map(x => `<span class="plateau-spool">${swatch(x.fil?.color_hex)}${escapeHtml(x.label)}</span>`).join('')}</span>` : ''}</span>
                  <span class="muted">${p.done_qty ? `déjà ${p.done_qty}/${p.quantity}` : `${p.quantity} à imprimer`}${p.print_time_s ? ` · ${escapeHtml(formatDuration(p.print_time_s))} pièce` : ''}${p.launchable ? '' : ' · bobines à choisir'}</span>
                </label>`).join('')}
            </section>`).join('')}
        </div>
        <p class="plateau-count" data-count aria-live="polite"></p>`;

      const list = body.querySelector('[data-list]');
      const sel = () => [...body.querySelectorAll('[data-pick]:checked')].map(i => byId.get(+i.dataset.pick));
      const redraw = () => {
        const s = sel();
        const projs = new Set(s.map(p => p.project_id)).size;
        const secs = s.reduce((n, p) => n + (Number(p.print_time_s) || 0) * p.remaining, 0);
        body.querySelector('[data-count]').innerHTML = s.length
          ? `<strong>${s.length}</strong> pièce${s.length > 1 ? 's' : ''} de ${projs} projet${projs > 1 ? 's' : ''}${secs ? ` · environ ${escapeHtml(formatDuration(secs))} au total` : ''}${s.length > MAX_GROUP ? ` · <span class="is-late">maximum ${MAX_GROUP} pièces</span>` : ''}`
          : 'Aucune pièce cochée.';
        for (const pr of projects.values()) {   // case du projet : cochée si tout est coché, indéterminée si en partie
          const box = list.querySelector(`[data-all="${pr.id}"]`);
          const ok = pr.parts.filter(p => p.launchable);
          const n = ok.filter(p => list.querySelector(`[data-pick="${p.id}"]`).checked).length;
          box.checked = ok.length > 0 && n === ok.length; box.indeterminate = n > 0 && n < ok.length;
        }
      };
      list.addEventListener('change', e => {
        const all = e.target.closest('[data-all]');
        if (all) {
          const pr = projects.get(+all.dataset.all);
          for (const p of pr.parts) {
            const box = list.querySelector(`[data-pick="${p.id}"]`);
            if (box && !box.disabled && !box.closest('.plateau-part').hidden) box.checked = all.checked;
          }
        }
        redraw();
      });
      body.querySelector('[data-search]').addEventListener('input', e => {
        const q = norm(e.target.value).trim().split(/\s+/).filter(Boolean);
        for (const row of list.querySelectorAll('.plateau-part')) row.hidden = !q.every(w => row.dataset.text.includes(w));
        for (const sec of list.querySelectorAll('.plateau-project')) sec.hidden = ![...sec.querySelectorAll('.plateau-part')].some(r => !r.hidden);
      });
      redraw();
    },
    onConfirm(body) {
      const chosen = [...body.querySelectorAll('[data-pick]:checked')].map(i => byId.get(+i.dataset.pick));
      if (!chosen.length) { toast('Cochez au moins une pièce', 'error'); return false; }
      if (chosen.length > MAX_GROUP) { toast(`Un lancement groupé est limité à ${MAX_GROUP} pièces`, 'error'); return false; }
      picked = chosen;
      // La fenêtre de lancement s'ouvre une fois celle-ci refermée
      setTimeout(() => {
        const runIdx = new Map(chosen.map(p => [p.id, { done: p.done_qty, active: [] }]));
        openStartDialog({ parts: chosen, runIdx, onDone });
      }, 0);
    },
  });
}
