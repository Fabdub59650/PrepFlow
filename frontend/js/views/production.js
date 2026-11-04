// Page Production : impressions en cours et historique
import { api } from '../api.js';
import { store } from '../store.js';
import { toast, confirmDialog, openDialog } from '../ui.js';
import { RUN_RESULT, formatDuration, endTimeLabel, formatWeight, formatMoney, formatDate, escapeHtml, filamentLabel, swatch, spoolsToWeigh, weighAge } from '../format.js';
import { openFinishDialog, openCorrectDialog, updateRunsBadge } from '../runs.js';
import { openPlateauPicker } from '../plateau.js';

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
  let weighCfg = { grams: 150, days: 14 };
  try {
    const st = await api.get('settings');
    weighCfg = { grams: Number(st.weigh_alert_g ?? 150), days: Number(st.weigh_alert_days ?? 14) };
  } catch (_) {}
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
    <div class="seg prod-tabs" role="tablist">
      <button type="button" class="seg-btn" role="tab" data-tab="prints">Impressions</button>
      <button type="button" class="seg-btn" role="tab" data-tab="stats">Statistiques</button>
    </div>
    <div id="tab-prints">
    <div id="weigh-box"></div>
    <section class="prod-section">
      <div class="prod-head">
        <h2 class="panel-title">En cours <span class="count-chip" id="running-count"></span></h2>
        <button type="button" class="btn btn-sm" id="plateau-btn" title="Lancer ensemble des pièces « Prêt » de plusieurs projets">＋ Plateau multi-projets</button>
      </div>
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
    </section>
    </div>
    <div id="tab-stats" hidden>
      <section class="prod-section">
        <div class="prod-head">
          <h2 class="panel-title">Statistiques</h2>
          <label class="sr-only" for="stats-days">Période</label>
          <select class="select" id="stats-days">
            <option value="30">30 derniers jours</option>
            <option value="90">90 derniers jours</option>
            <option value="365">12 derniers mois</option>
            <option value="0">Depuis le début</option>
          </select>
        </div>
        <p class="panel-sub">Activité de vos imprimantes et pièces produites. Un lancement groupé compte pour une seule impression.</p>
        <div id="stats"></div>
      </section>
    </div>`;

  /* ── Statistiques ─────────────────────────────────────────────── */
  let statsDays = parseInt(store_.get('stats_days', '30'), 10);
  if (![0, 30, 90, 365].includes(statsDays)) statsDays = 30;
  let tab = store_.get('tab', 'prints');
  if (!['prints', 'stats'].includes(tab)) tab = 'prints';
  const pct = v => String(Math.round(v * 10) / 10).replace('.', ',') + ' %';
  const weekLabel = k => {
    const d = new Date(k + 'T00:00:00');
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const wk = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
    return `S${wk} · ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const gapText = (plan, real) => {
    if (!plan) return '—';
    const g = Math.round(1000 * (real - plan) / plan) / 10;
    return (g > 0 ? '+' : '') + String(g).replace('.', ',') + ' %';
  };
  const mondayOf = str => {
    const d = new Date(String(str).replace(' ', 'T'));
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  // Durée en heures seules (« 147 h 21 ») : plus simple à comparer qu'en jours + heures
  const hm = sec => {
    sec = Math.round(sec || 0);
    if (sec < 3600) return formatDuration(sec) || '0 min';
    return `${Math.floor(sec / 3600)} h ${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}`;
  };
  // Détail d'une ligne de tableau : liste des impressions qui la composent
  function openDrill(kind, id, label, units) {
    const match = {
      printer: u => String(u.printer_id) === String(id),
      project: u => u.parts.some(q => String(q.project_id) === String(id)),
      theme: u => u.parts.some(q => q.theme_ids.some(t => String(t) === String(id))),
      week: u => mondayOf(u.ended_at) === id,
    }[kind];
    const rows = units.filter(match);
    const secs = rows.reduce((n, u) => n + (u.real_s || 0), 0);
    const cmp = rows.filter(u => !u.failed && u.real_s !== null && u.plan_s !== null && u.plan_s > 0);
    const gap = cmp.length ? gapText(cmp.reduce((n, u) => n + u.plan_s, 0), cmp.reduce((n, u) => n + u.real_s, 0)) : '—';
    const MAX = 200;
    const dlg = openDialog({
      title: label, wide: true,
      build(body) {
        body.innerHTML = `<p class="muted">${rows.length} impression${rows.length > 1 ? 's' : ''} · ${hm(secs)} · écart ${gap}${rows.length > MAX ? ` · les ${MAX} plus récentes sont affichées` : ''}</p>
          <div class="drill-scroll"><table class="mini-table drill-table"><thead><tr><th>Date</th><th>Pièces</th><th>Imprimante</th><th class="num">Prévu</th><th class="num">Réel</th><th class="num">Écart</th><th>Résultat</th></tr></thead><tbody>
          ${rows.slice(0, MAX).map(u => `<tr>
            <td>${escapeHtml(formatDate(u.ended_at))}</td>
            <td>${u.parts.map(q => `<div><a href="#/projet/${q.project_id}" class="cell-code" data-close>${escapeHtml(q.project.split(' · ')[0])}</a> ${escapeHtml(q.part || 'Sans nom')} × ${q.quantity}</div>`).join('')}${u.batch ? '<span class="drill-chip">lancement groupé</span>' : ''}</td>
            <td>${escapeHtml(u.printer_name)}</td>
            <td class="num">${u.plan_s !== null ? formatDuration(u.plan_s) : '—'}</td>
            <td class="num">${u.real_s !== null ? formatDuration(u.real_s) : '—'}</td>
            <td class="num">${!u.failed && u.plan_s > 0 && u.real_s !== null ? gapText(u.plan_s, u.real_s) : '—'}</td>
            <td>${u.failed ? '<span class="drill-fail">Ratée</span>' : 'Réussie'}</td></tr>`).join('')}</tbody></table></div>`;
        body.addEventListener('click', e => { if (e.target.closest('[data-close]')) dlg.querySelector('[data-cancel]').click(); });
      },
    });
    dlg.classList.add('drill-dialog');
    dlg.querySelector('[type=submit]').style.display = 'none';
    dlg.querySelector('[data-cancel]').textContent = 'Fermer';
  }
  let statsUnits = [];
  async function drawStats() {
    const box = el.querySelector('#stats');
    let st;
    try { st = await api.get(`runs/stats?days=${statsDays}`); }
    catch (e) { box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; return; }
    statsUnits = st.units || [];
    const t = st.totals;
    if (!t.prints) { box.innerHTML = '<div class="empty-state"><p class="empty-title">Pas encore de données</p><p>Les impressions terminées de la période apparaîtront ici.</p></div>'; return; }
    const bars = (kind, rows, val, fmt) => {
      const max = Math.max(1, ...rows.map(val));
      return rows.map(g => `<tr class="drill" tabindex="0" data-drill="${kind}" data-id="${escapeHtml(String(g.key))}" data-label="${escapeHtml(g.label)}"><td>${escapeHtml(g.label)}</td><td class="bar-cell"><span class="bar" style="width:${Math.round(100 * val(g) / max)}%"></span></td><td class="num">${fmt(g)}</td></tr>`).join('');
    };
    const block = (title, body) => `<div class="waste-block"><h3 class="waste-title">${title}</h3>${body}</div>`;
    const printersTbl = `<table class="mini-table"><thead><tr><th>Imprimante</th><th class="num">Impr.</th><th class="num">Heures</th><th colspan="2">Part des heures</th><th class="num">Écart</th></tr></thead><tbody>
      ${st.by_printer.map(g => `<tr class="drill" tabindex="0" data-drill="printer" data-id="${g.key}" data-label="${escapeHtml(g.label)}"><td>${escapeHtml(g.label)}</td><td class="num">${g.prints}</td><td class="num"><strong>${hm(g.seconds)}</strong></td>
        <td class="bar-cell"><span class="bar" style="width:${Math.round(g.share_pct)}%"></span></td><td class="num">${pct(g.share_pct)}</td><td class="num">${gapText(g.plan_s, g.real_s)}</td></tr>`).join('')}</tbody></table>`;
    const gapCls = (plan, real) => plan > 0 && Math.abs(100 * (real - plan) / plan) > 10 ? ' gap-hi' : '';
    const maxSec = Math.max(1, ...st.by_week.map(g => g.seconds));
    const weeksTbl = `<table class="mini-table week-table"><thead><tr><th>Semaine</th><th class="num">Impr.</th><th class="num">Pièces</th><th class="num">Heures</th><th></th><th class="num">Écart</th><th class="num">Ratées</th></tr></thead><tbody>
      ${st.by_week.slice(0, 26).map(g => `<tr class="drill" tabindex="0" data-drill="week" data-id="${g.key}" data-label="${escapeHtml('Semaine ' + weekLabel(g.key))}"><td>${escapeHtml(weekLabel(g.key))}</td>
        <td class="num">${g.prints}</td><td class="num">${g.pieces}</td><td class="num"><strong>${hm(g.seconds)}</strong></td>
        <td class="bar-cell"><span class="bar" style="width:${Math.round(100 * g.seconds / maxSec)}%"></span></td>
        <td class="num${gapCls(g.plan_s, g.real_s)}">${gapText(g.plan_s, g.real_s)}</td>
        <td class="num">${g.failed ? `<strong>${g.failed}</strong>` : '0'}</td></tr>`).join('')}</tbody></table>`;
    const themesTbl = st.by_theme.length ? `<table class="mini-table"><thead><tr><th>Thème</th><th></th><th class="num">Pièces</th></tr></thead><tbody>
      ${bars('theme', st.by_theme.slice(0, 8), g => g.pieces, g => `${g.pieces}`)}</tbody></table>` : '<p class="muted">Aucun thème sur les projets de la période.</p>';
    const projTbl = `<table class="mini-table"><thead><tr><th>Projet</th><th class="num">Pièces</th><th class="num">Heures</th><th class="num">Écart</th></tr></thead><tbody>
      ${st.by_project.slice(0, 8).map(g => `<tr class="drill" tabindex="0" data-drill="project" data-id="${g.key}" data-label="${escapeHtml(g.label)}"><td>${escapeHtml(g.label)}</td><td class="num"><strong>${g.pieces}</strong></td>
        <td class="num">${hm(g.seconds)}</td><td class="num">${gapText(g.plan_s, g.real_s)}</td></tr>`).join('')}</tbody></table>`;
    const avg = t.prints ? Math.round(t.seconds / t.prints) : 0;
    box.innerHTML = `
      <div class="figures">
        <div class="figure"><span class="figure-label">Impressions</span><span class="figure-value">${t.prints}</span>
          <span class="figure-sub">${t.failed} ratée${t.failed > 1 ? 's' : ''}${t.group_prints ? ` · ${t.group_prints} groupée${t.group_prints > 1 ? 's' : ''}` : ''}</span></div>
        <div class="figure"><span class="figure-label">Pièces produites</span><span class="figure-value">${t.pieces}</span>
          <span class="figure-sub">impressions réussies</span></div>
        <div class="figure"><span class="figure-label">Heures d'impression</span><span class="figure-value">${hm(t.seconds)}</span>
          <span class="figure-sub">${avg ? 'moyenne ' + hm(avg) + ' par impression' : ''}</span></div>
        <div class="figure"><span class="figure-label">Écart prévu / réel</span><span class="figure-value">${gapText(t.plan_s, t.real_s)}</span>
          <span class="figure-sub">${t.timed ? `sur ${t.timed} impression${t.timed > 1 ? 's' : ''} réussie${t.timed > 1 ? 's' : ''}` : 'aucune comparable'}</span></div>
      </div>
      <div class="waste-block evo-wrap"><h3 class="waste-title">Par semaine</h3>${weeksTbl}</div>
      <div class="waste-grid">
        ${block('Par imprimante', printersTbl)}
        ${block('Par projet', projTbl)}
        ${block('Pièces par thème', themesTbl)}
      </div>
      <p class="hint">Part des heures = heures de l'imprimante / heures de toutes les imprimantes. Écart : positif = plus long que prévu.
        ${t.untimed ? `${t.untimed} impression${t.untimed > 1 ? 's' : ''} réussie${t.untimed > 1 ? 's' : ''} sans temps prévu ou sans durée ne ${t.untimed > 1 ? 'sont' : 'est'} pas dans l'écart.` : ''}
        L'écart par projet exclut les lancements groupés. Un projet à plusieurs thèmes compte dans chacun. Cliquez sur une ligne d'un tableau pour voir les impressions concernées.</p>`;
    box.querySelectorAll('tr.drill').forEach(tr => {
      const go = () => openDrill(tr.dataset.drill, tr.dataset.id, tr.dataset.label, statsUnits);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
  function showTab() {
    el.querySelector('#tab-prints').hidden = tab !== 'prints';
    el.querySelector('#tab-stats').hidden = tab !== 'stats';
    el.querySelectorAll('.prod-tabs .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    if (tab === 'stats') drawStats();
  }
  el.querySelectorAll('.prod-tabs .seg-btn').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; store_.set('tab', tab); showTab(); }));
  el.querySelector('#stats-days').value = String(statsDays);
  el.querySelector('#stats-days').addEventListener('change', e => { statsDays = parseInt(e.target.value, 10); store_.set('stats_days', statsDays); drawStats(); });

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

  /* ── Bobines à peser (lecture seule : la pesée se fait dans FilaFlow) ─ */
  function drawWeigh() {
    const box = el.querySelector('#weigh-box');
    const list = spoolsToWeigh(store.filaments, weighCfg);
    if (!list.length) { box.innerHTML = ''; return; }
    const open = box.querySelector('details')?.open;
    box.innerHTML = `<details class="weigh-alert" ${open ? 'open' : ''}><summary>Bobines à peser : ${list.length}</summary>
      <ul>${list.map(({ filament: f, used }) => `<li>${swatch(f.color_hex)}<span class="weigh-name">${escapeHtml(filamentLabel(f))}</span>
        <span class="muted">${escapeHtml(formatWeight(Math.round(used)))} consommés · ${escapeHtml(weighAge(f.last_weighed_at))}</span></li>`).join('')}</ul>
      <p class="hint">Le reste affiché est une estimation : une pesée dans FilaFlow la remet d'aplomb.</p></details>`;
  }

  /* ── En cours ─────────────────────────────────────────────────── */
  const elapsedOf = r => (r.elapsed_s || 0) + (Date.now() - loadedAt) / 1000;

  // « fin prévue 16:40 · reste 1 h 10 » ou « dépassée de 12 min »
  const endText = (r, planned) => {
    const left = planned - elapsedOf(r);
    return left > 0 ? `<strong>fin prévue ${endTimeLabel(left)}</strong> · reste ${formatDuration(left) || '0 min'}`
      : `<strong class="is-late">dépassée de ${formatDuration(-left) || '0 min'}</strong>`;
  };
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
      const planned = Number(solo ? first.planned_time_s : first.batch_planned_time_s) || null;
      return `<article class="run-card" data-ids="${runs.map(r => r.id).join(',')}">
        <header class="run-card-head">
          <strong>${escapeHtml(first.printer_name || 'Sans imprimante')}</strong>
          ${solo ? '' : `<span class="pill pill-pret">Lancement groupé · ${runs.length} pièces</span>`}
          <span class="run-card-time"><span class="elapsed" data-start="${first.id}">${formatDuration(elapsedOf(first)) || '0 min'}</span>
            <span class="muted"> depuis ${formatDate(first.started_at, { withTime: true })}</span></span>
        </header>
        ${planned ? `<div class="progress-line"><div class="progress-bar" data-bar="${first.id}" style="width:${Math.min(100, 100 * elapsedOf(first) / planned)}%"></div></div>
          <p class="run-card-plan muted">Durée prévue ${formatDuration(planned)} · <span class="run-end" data-end="${first.id}">${endText(first, planned)}</span></p>` : ''}
        <ul class="run-lines">${runs.map(r => `
          <li>
            <span class="run-line-name"><a href="#/projet/${r.project_id}" class="cell-code">${escapeHtml(r.project_code || '')}</a>
              ${escapeHtml(r.part_name || 'Sans nom')} × ${r.quantity}</span>
            <span class="run-line-fils">${r.filaments.map(f => `<span class="run-fil">${swatch(store.filamentsById.get(f.filament_id)?.color_hex)}<span>${escapeHtml(f.name ? f.name + (f.spool_number && String(f.spool_number).trim() ? ` (${String(f.spool_number).trim()})` : '') : filamentLabel(store.filamentsById.get(f.filament_id)))}</span><span class="muted">${formatWeight(Number(f.planned_g)) || '0 g'}</span></span>`).join('')}</span>
            <button type="button" class="link-btn" data-correct-run="${r.id}" title="Changer la bobine en cas d'erreur au lancement">Corriger</button>
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
    box.querySelectorAll('[data-correct-run]').forEach(b => b.addEventListener('click', () => {
      const r = active.find(x => x.id === +b.dataset.correctRun);
      if (r) openCorrectDialog({ run: r, onDone: reloadAll });
    }));
  }

  // Durée écoulée mise à jour sans recharger la page
  const tick = setInterval(() => {
    el.querySelectorAll('.elapsed').forEach(span => {
      const r = active.find(x => x.id === +span.dataset.start);
      if (!r) return;
      span.textContent = formatDuration(elapsedOf(r)) || '0 min';
      const bar = el.querySelector(`[data-bar="${r.id}"]`);
      const planned = Number(r.batch_id ? r.batch_planned_time_s : r.planned_time_s) || null;
      if (bar && planned) bar.style.width = Math.min(100, 100 * elapsedOf(r) / planned) + '%';
      const end = el.querySelector(`[data-end="${r.id}"]`);
      if (end && planned) end.innerHTML = endText(r, planned);
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
      <td class="nowrap"><button type="button" class="icon-btn" data-correct="${r.id}" title="Corriger les bobines, les poids ou les notes" aria-label="Corriger cette impression">
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
    el.querySelectorAll('.seg-btn[data-view]').forEach(b => {
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
  el.querySelectorAll('.seg-btn[data-view]').forEach(b => b.addEventListener('click', () => {
    filter.view = b.dataset.view; store_.set('view', filter.view); drawHistory();
  }));

  el.querySelector('#plateau-btn').addEventListener('click', () => openPlateauPicker({ onDone: reloadAll }));

  async function reloadAll() {
    await load();
    await store.loadFilaments().catch(() => {});
    drawWeigh();
    drawRunning();
    drawHistory();
    drawWaste();
    if (tab === 'stats') drawStats();
    updateRunsBadge();
  }

  drawWeigh();
  drawRunning();
  drawHistory();
  drawWaste();
  showTab();
  return () => clearInterval(tick);
}
