// Page Production : impressions en cours et historique
import { api } from '../api.js';
import { store } from '../store.js';
import { toast, confirmDialog } from '../ui.js';
import { RUN_RESULT, formatDuration, formatWeight, formatDate, escapeHtml, filamentLabel, swatch } from '../format.js';
import { openFinishDialog, openCorrectDialog, updateRunsBadge } from '../runs.js';

const sum = (list, k) => list.reduce((s, x) => s + (Number(x[k]) || 0), 0);

const resultLabel = r => r.result === 'rate'
  ? `Ratée ${r.progress_pct ?? 0} %` : (RUN_RESULT[r.result] || '');

export async function renderProduction(el) {
  document.title = 'Production — PrepFlow';
  let active = [], history = [];
  let loadedAt = Date.now();
  const filter = { project: '', result: '' };

  async function load() {
    [active, history] = await Promise.all([api.get('runs?state=en_cours'), api.get('runs?state=termine&limit=300')]);
    loadedAt = Date.now();
  }
  await load();

  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Production</h1>
    </div>
    <p class="page-sub">Impressions lancées depuis les projets : en cours, puis historique avec le prévu et le réel.
      Le reste estimé des bobines se déduit de ces impressions depuis la dernière pesée.</p>
    <section class="prod-section">
      <h2 class="panel-title">En cours <span class="count-chip" id="running-count"></span></h2>
      <div id="running"></div>
    </section>
    <section class="prod-section">
      <h2 class="panel-title">Historique</h2>
      <div class="prod-filters">
        <label class="sr-only" for="f-project">Projet</label>
        <select class="select" id="f-project"></select>
        <label class="sr-only" for="f-result">Résultat</label>
        <select class="select" id="f-result">
          <option value="">Tous les résultats</option>
          ${Object.entries(RUN_RESULT).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <span class="hint" id="history-count"></span>
      </div>
      <div id="history"></div>
    </section>`;

  /* ── En cours ─────────────────────────────────────────────────── */
  const elapsedOf = r => (r.elapsed_s || 0) + (Date.now() - loadedAt) / 1000;

  function drawRunning() {
    const box = el.querySelector('#running');
    el.querySelector('#running-count').textContent = active.length || '';
    if (!active.length) {
      box.innerHTML = `<div class="empty-state"><p class="empty-title">Aucune impression en cours</p>
        <p>Lancez-en une avec le bouton « ▶ Démarrer » d'une pièce, dans un projet.</p></div>`;
      return;
    }
    // Un lancement groupé = une carte
    const groups = new Map();
    for (const r of active) {
      const key = r.batch_id || `run-${r.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    box.innerHTML = `<div class="run-cards">${[...groups.values()].map(runs => {
      const first = runs[0];
      const solo = runs.length === 1;
      const planned = solo ? first.planned_time_s : null;
      return `<article class="run-card" data-ids="${runs.map(r => r.id).join(',')}">
        <header class="run-card-head">
          <strong>${escapeHtml(first.printer_name || 'Sans imprimante')}</strong>
          ${solo ? '' : `<span class="pill pill-pret">Lancement groupé · ${runs.length} pièces</span>`}
          <span class="run-card-time"><span class="elapsed" data-start="${first.id}">${formatDuration(elapsedOf(first)) || '0 min'}</span>
            <span class="muted"> depuis ${formatDate(first.started_at, { withTime: true })}</span></span>
        </header>
        ${planned ? `<div class="progress-line"><div class="progress-bar" data-bar="${first.id}" style="width:${Math.min(100, 100 * elapsedOf(first) / planned)}%"></div></div>
          <p class="run-card-plan muted">Durée prévue ${formatDuration(planned)}</p>` : ''}
        <ul class="run-lines">${runs.map(r => `
          <li>
            <span class="run-line-name"><a href="#/projet/${r.project_id}" class="cell-code">${escapeHtml(r.project_code || '')}</a>
              ${escapeHtml(r.part_name || 'Sans nom')} × ${r.quantity}</span>
            <span class="run-line-fils">${r.filaments.map(f => `${swatch(store.filamentsById.get(f.filament_id)?.color_hex)}<span class="muted">${formatWeight(Number(f.planned_g)) || '0 g'}</span>`).join(' ')}</span>
            ${solo ? '' : `<button type="button" class="link-btn" data-finish-one="${r.id}">Terminer seule</button>`}
          </li>`).join('')}
        </ul>
        <footer class="run-card-actions">
          <button type="button" class="btn btn-primary btn-sm" data-finish="${runs.map(r => r.id).join(',')}">■ Terminer${solo ? '' : ' le lancement'}</button>
        </footer>
      </article>`;
    }).join('')}</div>`;

    const finish = ids => {
      const runs = active.filter(r => ids.includes(r.id));
      openFinishDialog({ runs, onDone: reloadAll });
    };
    box.querySelectorAll('[data-finish]').forEach(b => b.addEventListener('click', () =>
      finish(b.dataset.finish.split(',').map(Number))));
    box.querySelectorAll('[data-finish-one]').forEach(b => b.addEventListener('click', () =>
      finish([+b.dataset.finishOne])));
  }

  // Durée écoulée mise à jour sans recharger la page
  const tick = setInterval(() => {
    el.querySelectorAll('.elapsed').forEach(span => {
      const r = active.find(x => x.id === +span.dataset.start);
      if (!r) return;
      span.textContent = formatDuration(elapsedOf(r)) || '0 min';
      const bar = el.querySelector(`[data-bar="${r.id}"]`);
      if (bar && r.planned_time_s) bar.style.width = Math.min(100, 100 * elapsedOf(r) / r.planned_time_s) + '%';
    });
  }, 20000);

  /* ── Historique ───────────────────────────────────────────────── */
  function drawFilters() {
    const sel = el.querySelector('#f-project');
    const projects = new Map();
    for (const r of history) if (!projects.has(r.project_id)) projects.set(r.project_id, `${r.project_code ? r.project_code + ' · ' : ''}${r.project_name}`);
    if (filter.project && !projects.has(+filter.project)) filter.project = '';
    sel.innerHTML = `<option value="">Tous les projets</option>`
      + [...projects.entries()].sort((a, b) => b[1].localeCompare(a[1], 'fr'))
        .map(([pid, label]) => `<option value="${pid}" ${String(pid) === String(filter.project) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
    el.querySelector('#f-result').value = filter.result;
  }

  function drawHistory() {
    drawFilters();
    const rows = history.filter(r =>
      (!filter.project || String(r.project_id) === String(filter.project)) &&
      (!filter.result || r.result === filter.result));
    const box = el.querySelector('#history');
    el.querySelector('#history-count').textContent = history.length
      ? `${rows.length} impression${rows.length > 1 ? 's' : ''}${history.length >= 300 ? ' (300 plus récentes)' : ''}` : '';
    if (!rows.length) {
      box.innerHTML = `<div class="empty-state"><p class="empty-title">${history.length ? 'Aucune impression pour ce filtre' : "Pas encore d'historique"}</p>
        ${history.length ? '' : '<p>Les impressions terminées apparaîtront ici.</p>'}</div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="list-table prod-table">
      <thead><tr><th>Fin</th><th>Projet</th><th>Pièce</th><th>Imprimante</th><th>Résultat</th>
        <th class="num">Temps</th><th class="num">Filament</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const used = sum(r.filaments, 'weight_g'), plan = sum(r.filaments, 'planned_g');
        const detail = r.filaments.map(f => `${f.name || filamentLabel(store.filamentsById.get(f.filament_id))} : ${formatWeight(Number(f.weight_g)) || '0 g'} sur ${formatWeight(Number(f.planned_g)) || '0 g'} prévus`).join('\n');
        return `<tr>
          <td class="nowrap">${formatDate(r.ended_at, { withTime: true })}</td>
          <td><a href="#/projet/${r.project_id}" class="cell-code">${escapeHtml(r.project_code || '')}</a></td>
          <td>${escapeHtml(r.part_name || 'Sans nom')} × ${r.quantity}${r.batch_id ? ' <span class="tag" title="Lancée avec d\u2019autres pièces sur le même plateau : la durée réelle est celle du plateau">groupé</span>' : ''}</td>
          <td>${escapeHtml(r.printer_name || '—')}</td>
          <td><span class="pill pill-run-${r.result}">${escapeHtml(resultLabel(r))}</span></td>
          <td class="num"><strong>${formatDuration(r.duration_s) || '—'}</strong>${r.planned_time_s ? `<span class="sub-line">prévu ${formatDuration(r.planned_time_s)}</span>` : ''}</td>
          <td class="num" title="${escapeHtml(detail)}"><strong>${formatWeight(used) || '0 g'}</strong><span class="sub-line">prévu ${formatWeight(plan) || '0 g'}</span></td>
          <td class="cell-notes">${r.notes ? `<span title="${escapeHtml(r.notes)}">${escapeHtml(r.notes)}</span>` : ''}</td>
          <td class="nowrap"><button type="button" class="icon-btn" data-correct="${r.id}" title="Corriger les poids ou les notes" aria-label="Corriger cette impression">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 16l1-4 8-8 3 3-8 8-4 1z"/></svg></button>
            <button type="button" class="icon-btn icon-btn-danger" data-delete="${r.id}" title="Supprimer cette impression" aria-label="Supprimer cette impression">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg></button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

    box.querySelectorAll('[data-correct]').forEach(b => b.addEventListener('click', () => {
      const r = history.find(x => x.id === +b.dataset.correct);
      if (r) openCorrectDialog({ run: r, onDone: reloadAll });
    }));
    box.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
      const r = history.find(x => x.id === +b.dataset.delete);
      if (!r) return;
      if (!await confirmDialog("Supprimer l'impression",
        `« ${r.part_name || 'Sans nom'} × ${r.quantity} » (${resultLabel(r)}) sera retirée de l'historique, et sa consommation ne sera plus décomptée du reste estimé.`)) return;
      try { await api.del(`runs/${r.id}`); await reloadAll(); toast('Impression supprimée'); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  el.querySelector('#f-project').addEventListener('change', e => { filter.project = e.target.value; drawHistory(); });
  el.querySelector('#f-result').addEventListener('change', e => { filter.result = e.target.value; drawHistory(); });

  async function reloadAll() {
    await load();
    await store.loadFilaments().catch(() => {});
    drawRunning();
    drawHistory();
    updateRunsBadge();
  }

  drawRunning();
  drawHistory();
  return () => clearInterval(tick);
}
