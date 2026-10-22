// Page Production : impressions en cours et historique
import { api } from '../api.js';
import { store } from '../store.js';
import { toast, confirmDialog } from '../ui.js';
import { RUN_RESULT, formatDuration, formatWeight, formatMoney, formatDate, escapeHtml, filamentLabel, swatch } from '../format.js';
import { openFinishDialog, openCorrectDialog, updateRunsBadge } from '../runs.js';

const sum = (list, k) => list.reduce((s, x) => s + (Number(x[k]) || 0), 0);

const resultLabel = r => r.result === 'rate'
  ? `Ratée ${r.progress_pct ?? 0} %` : (RUN_RESULT[r.result] || '');

export async function renderProduction(el) {
  document.title = 'Production — PrepFlow';
  let active = [], history = [];
  let loadedAt = Date.now();
  const HIST_MAX = 1000, PAGE = 25;
  const store_ = {
    get(k, d) { try { return localStorage.getItem('prod_' + k) || d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('prod_' + k, v); } catch (_) {} },
  };
  const filter = { project: '', result: '', search: '', period: store_.get('period', '30'), view: store_.get('view', 'liste') };
  if (!['0', '30', '90', '365'].includes(filter.period)) filter.period = '30';
  if (!['liste', 'projet'].includes(filter.view)) filter.view = 'liste';
  let shown = PAGE;
  const openProjects = new Set();   // blocs « Par projet » dépliés par l'utilisateur
  let projectsInit = false;

  async function load() {
    [active, history] = await Promise.all([api.get('runs?state=en_cours'),
      api.get(`runs?state=termine&limit=${HIST_MAX}${+filter.period ? '&days=' + filter.period : ''}`)]);
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
    <section class="prod-section" id="waste-section">
      <div class="prod-head">
        <h2 class="panel-title">Gâchis</h2>
        <label class="sr-only" for="waste-days">Période</label>
        <select class="select" id="waste-days">
          <option value="30">30 derniers jours</option>
          <option value="90">90 derniers jours</option>
          <option value="365">12 derniers mois</option>
          <option value="0">Depuis le début</option>
        </select>
      </div>
      <p class="panel-sub">Filament, temps machine et argent perdus sur les impressions ratées (consommation proratisée au % réalisé).</p>
      <div id="waste"></div>
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
        <label class="sr-only" for="f-period">Période</label>
        <select class="select" id="f-period">
          <option value="30">30 derniers jours</option>
          <option value="90">3 derniers mois</option>
          <option value="365">12 derniers mois</option>
          <option value="0">Depuis le début</option>
        </select>
        <label class="sr-only" for="f-search">Recherche</label>
        <input class="select" type="search" id="f-search" placeholder="Rechercher une pièce, un projet, une note…" autocomplete="off">
        <div class="seg" role="group" aria-label="Affichage">
          <button type="button" class="seg-btn" data-view="liste">Liste</button>
          <button type="button" class="seg-btn" data-view="projet">Par projet</button>
        </div>
        <span class="hint" id="history-count"></span>
      </div>
      <div id="history"></div>
    </section>`;

  /* ── Gâchis ───────────────────────────────────────────────────── */
  let wasteDays = 90;
  async function drawWaste() {
    const box = el.querySelector('#waste');
    let w;
    try { w = await api.get(`runs/waste?days=${wasteDays}`); }
    catch (e) { box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; return; }
    const t = w.totals;
    if (!t.runs) { box.innerHTML = '<div class="empty-state"><p class="empty-title">Pas encore de données</p><p>Les impressions terminées de la période apparaîtront ici.</p></div>'; return; }
    const table = (title, rows, first) => `
      <div class="waste-block"><h3 class="waste-title">${title}</h3>
      ${rows.length ? `<table class="mini-table"><thead><tr><th>${first}</th><th class="num">Ratées</th><th class="num">Filament</th><th class="num">Temps</th><th class="num">Coût</th></tr></thead>
        <tbody>${rows.slice(0, 8).map(g => `<tr><td>${escapeHtml(g.label)}</td>
          <td class="num">${g.failed}${g.runs ? ` / ${g.runs}` : ''}</td>
          <td class="num"><strong>${formatWeight(g.grams_lost) || '0 g'}</strong></td>
          <td class="num">${g.seconds_lost ? formatDuration(g.seconds_lost) : '—'}</td>
          <td class="num">${g.cost_lost ? formatMoney(g.cost_lost) : '—'}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Aucune impression ratée.</p>'}</div>`;
    box.innerHTML = `
      <div class="figures">
        <div class="figure"><span class="figure-label">Impressions ratées</span>
          <span class="figure-value">${t.failed} / ${t.runs}</span><span class="figure-sub">${String(t.fail_pct).replace('.', ',')} % des impressions</span></div>
        <div class="figure"><span class="figure-label">Filament perdu</span>
          <span class="figure-value">${formatWeight(t.grams_lost) || '0 g'}</span>
          <span class="figure-sub">${t.grams_used ? String(Math.round(1000 * t.grams_lost / t.grams_used) / 10).replace('.', ',') : 0} % du filament consommé</span></div>
        <div class="figure"><span class="figure-label">Temps perdu</span>
          <span class="figure-value">${formatDuration(t.seconds_lost) || '0 min'}</span>
          <span class="figure-sub">temps machine sur les ratées</span></div>
        <div class="figure"><span class="figure-label">Coût matière perdu</span>
          <span class="figure-value">${formatMoney(t.cost_lost)}</span>
          <span class="figure-sub">${t.cost_complete ? 'prix des bobines FilaFlow' : 'incomplet : prix manquant dans FilaFlow'}</span></div>
      </div>
      <div class="waste-grid">
        ${table('Par imprimante', w.by_printer, 'Imprimante')}
        ${table('Par bobine', w.by_filament, 'Bobine')}
        ${table('Par projet', w.by_project, 'Projet')}
        ${table('Par mois', w.by_month, 'Mois')}
      </div>
      <p class="hint">Le temps d'un lancement groupé est réparti à parts égales entre ses pièces.</p>`;
  }
  el.querySelector('#waste-days').value = String(wasteDays);
  el.querySelector('#waste-days').addEventListener('change', e => { wasteDays = parseInt(e.target.value, 10); drawWaste(); });

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

  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function matches(r) {
    if (filter.project && String(r.project_id) !== String(filter.project)) return false;
    if (filter.result && r.result !== filter.result) return false;
    const q = norm(filter.search).trim();
    if (!q) return true;
    const hay = norm([r.part_name, r.file_name, r.project_name, r.project_code, r.printer_name, r.notes].join(' '));
    return q.split(/\s+/).every(w => hay.includes(w));
  }

  function rowHtml(r) {
    const used = sum(r.filaments, 'weight_g'), plan = sum(r.filaments, 'planned_g');
    const detail = r.filaments.map(f => `${f.name || filamentLabel(store.filamentsById.get(f.filament_id))} : ${formatWeight(Number(f.weight_g)) || '0 g'} sur ${formatWeight(Number(f.planned_g)) || '0 g'} prévus`).join('\n');
    return `<tr>
      <td class="nowrap">${formatDate(r.ended_at, { withTime: true })}</td>
      <td><a href="#/projet/${r.project_id}" class="cell-code">${escapeHtml(r.project_code || '')}</a></td>
      <td>${escapeHtml(r.part_name || 'Sans nom')} × ${r.quantity}${r.batch_id ? ' <span class="tag" title="Lancée avec d’autres pièces sur le même plateau : la durée réelle est celle du plateau">groupé</span>' : ''}${r.filaments.some(f => Number(f.relay)) ? ' <span class="tag" title="Une bobine s’est vidée en cours d’impression : la consommation est répartie entre les deux bobines (part de la première estimée)">relais</span>' : ''}</td>
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
  }

  const tableHtml = rows => `<div class="table-wrap"><table class="list-table prod-table">
    <thead><tr><th>Fin</th><th>Projet</th><th>Pièce</th><th>Imprimante</th><th>Résultat</th>
      <th class="num">Temps</th><th class="num">Filament</th><th>Notes</th><th></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;

  // Durée réelle d'un lancement groupé : celle du plateau, répartie entre les pièces du lot (comme dans Gâchis)
  function realSeconds(rows) {
    const per = new Map();
    for (const r of history) if (r.batch_id) per.set(r.batch_id, (per.get(r.batch_id) || 0) + 1);
    return rows.reduce((s, r) => s + (Number(r.duration_s) || 0) / (r.batch_id ? (per.get(r.batch_id) || 1) : 1), 0);
  }

  function projectGroups(rows) {
    const map = new Map();
    for (const r of rows) {   // rows est déjà trié du plus récent au plus ancien
      if (!map.has(r.project_id)) map.set(r.project_id, { id: r.project_id, code: r.project_code, name: r.project_name, rows: [] });
      map.get(r.project_id).rows.push(r);
    }
    return [...map.values()];
  }

  function groupHtml(g, open) {
    const used = g.rows.reduce((s, r) => s + sum(r.filaments, 'weight_g'), 0);
    const plan = g.rows.reduce((s, r) => s + sum(r.filaments, 'planned_g'), 0);
    const failed = g.rows.filter(r => r.result === 'rate').length;
    const real = realSeconds(g.rows);
    const planned = g.rows.reduce((s, r) => s + (Number(r.planned_time_s) || 0), 0);
    const diff = used - plan;
    const diffTxt = plan ? ` (${diff >= 0 ? '+' : '−'}${formatWeight(Math.abs(diff)) || '0 g'} vs prévu)` : '';
    return `<details class="prod-group" data-project="${g.id}"${open ? ' open' : ''}>
      <summary><span class="cell-code">${escapeHtml(g.code || '')}</span> <strong>${escapeHtml(g.name || '')}</strong>
        <span class="prod-group-info">${g.rows.length} impression${g.rows.length > 1 ? 's' : ''}${failed ? ` · ${failed} ratée${failed > 1 ? 's' : ''}` : ''}
        · ${formatDuration(real) || '0 min'}${planned ? ` (prévu ${formatDuration(planned)})` : ''}
        · ${formatWeight(used) || '0 g'}${diffTxt}</span></summary>
      ${tableHtml(g.rows)}
    </details>`;
  }

  function drawHistory() {
    drawFilters();
    el.querySelector('#f-period').value = filter.period;
    const se = el.querySelector('#f-search'); if (se.value !== filter.search && document.activeElement !== se) se.value = filter.search;
    el.querySelectorAll('.seg-btn').forEach(b => {
      const on = b.dataset.view === filter.view;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    const rows = history.filter(matches);
    const box = el.querySelector('#history');
    const cap = history.length >= HIST_MAX ? ` (${HIST_MAX} plus récentes de la période)` : '';
    const counter = el.querySelector('#history-count');
    if (!rows.length) {
      counter.textContent = '';
      const filtered = filter.project || filter.result || filter.search.trim();
      box.innerHTML = `<div class="empty-state"><p class="empty-title">${history.length || filtered ? 'Aucune impression pour ce filtre' : (+filter.period ? 'Aucune impression sur cette période' : "Pas encore d'historique")}</p>
        ${history.length || +filter.period ? '' : '<p>Les impressions terminées apparaîtront ici.</p>'}</div>`;
      return;
    }

    if (filter.view === 'projet') {
      const groups = projectGroups(rows);
      if (!projectsInit) { openProjects.add(groups[0].id); projectsInit = true; }   // le plus récent est déplié au départ
      counter.textContent = `${rows.length} impression${rows.length > 1 ? 's' : ''} · ${groups.length} projet${groups.length > 1 ? 's' : ''}${cap}`;
      box.innerHTML = groups.map(g => groupHtml(g, openProjects.has(g.id))).join('');
      box.querySelectorAll('details.prod-group').forEach(d => d.addEventListener('toggle', () => {
        const id = +d.dataset.project; d.open ? openProjects.add(id) : openProjects.delete(id);
      }));
    } else {
      const part = rows.slice(0, shown);
      counter.textContent = `${part.length} sur ${rows.length} impression${rows.length > 1 ? 's' : ''}${cap}`;
      box.innerHTML = tableHtml(part) + (rows.length > part.length
        ? `<div class="prod-more"><button type="button" class="btn" id="more">Afficher ${Math.min(PAGE, rows.length - part.length)} de plus</button>
           <span class="hint">${rows.length - part.length} restante${rows.length - part.length > 1 ? 's' : ''}</span></div>` : '');
      box.querySelector('#more')?.addEventListener('click', () => { shown += PAGE; drawHistory(); });
    }

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

  el.querySelector('#f-project').addEventListener('change', e => { filter.project = e.target.value; shown = PAGE; drawHistory(); });
  el.querySelector('#f-result').addEventListener('change', e => { filter.result = e.target.value; shown = PAGE; drawHistory(); });
  el.querySelector('#f-period').addEventListener('change', async e => {
    filter.period = e.target.value; store_.set('period', filter.period); shown = PAGE;
    try { await load(); drawHistory(); } catch (err) { toast(err.message, 'error'); }
  });
  let searchTimer;
  el.querySelector('#f-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.search = e.target.value; shown = PAGE; drawHistory(); }, 200);
  });
  el.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    filter.view = b.dataset.view; store_.set('view', filter.view); drawHistory();
  }));

  async function reloadAll() {
    await load();
    await store.loadFilaments().catch(() => {});
    drawRunning();
    drawHistory();
    drawWaste();
    updateRunsBadge();
  }

  drawRunning();
  drawHistory();
  drawWaste();
  return () => clearInterval(tick);
}
