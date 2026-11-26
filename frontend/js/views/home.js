// Page Accueil (v1.50.0) : ce qu'il y a à faire, en lecture seule. Chaque ligne mène à la page où agir.
import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../ui.js';
import { formatDuration, formatWeight, endTimeLabel, escapeHtml, filamentLabel, swatch, spoolsToWeigh, weighAge } from '../format.js';
import { dueText, updateMaintBadge } from '../maintenance.js';
import { updateRunsBadge } from '../runs.js';
import { photoThumb } from '../photo.js';

const FILAFLOW = '/';   // FilaFlow est à la racine du même serveur
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const empty = text => `<p class="home-empty muted">${escapeHtml(text)}</p>`;
const failed = what => `<p class="home-empty home-warn">${escapeHtml(what)}</p>`;

/* ── Imprimantes ───────────────────────────────────────────────── */

// État d'une imprimante d'après ses impressions en cours (un lancement groupé = un seul travail)
function jobOf(runs, loadedAt) {
  if (!runs.length) return { state: 'free' };
  const first = runs[0];
  const jobs = new Set(runs.map(r => r.batch_id || `run-${r.id}`)).size;
  const title = runs.length === 1
    ? `${first.part_name || 'Sans nom'} × ${first.quantity}`
    : (jobs === 1 ? `Plateau de ${runs.length} pièces` : `${runs.length} impressions en cours`);
  const planned = jobs === 1 ? Number(runs.length === 1 ? first.planned_time_s : first.batch_planned_time_s) || null : null;
  const elapsed = (first.elapsed_s || 0) + (Date.now() - loadedAt) / 1000;
  if (!planned) return { state: 'busy', title, detail: `en cours depuis ${formatDuration(elapsed) || '0 min'} · durée prévue inconnue` };
  const left = planned - elapsed;
  const progress = Math.min(100, 100 * elapsed / planned);
  return left > 0
    ? { state: 'busy', title, progress, detail: `<strong>Fin prévue ${endTimeLabel(left)}</strong> · reste ${formatDuration(left) || '0 min'}` }
    : { state: 'done', title, progress, detail: `Heure de fin prévue atteinte (${endTimeLabel(0, new Date(Date.now() + left * 1000))})` };
}

const STATE = { free: 'Libre', busy: 'En cours', done: 'À terminer', unknown: 'État inconnu' };

function printerCard(name, job, late) {
  const body = job.state === 'free' ? '<p class="home-job">Prête à lancer</p>'
    : job.state === 'unknown' ? '<p class="home-job muted">Impressions illisibles</p>'
    : `<p class="home-job">${escapeHtml(job.title)}</p><p class="home-job-detail muted">${job.detail}</p>
       ${job.progress === undefined ? '' : `<div class="progress-line"><div class="progress-bar" style="width:${job.progress}%"></div></div>`}`;
  return `<article class="home-printer is-${job.state}">
    <a class="home-printer-main" href="#/production">
      <span class="home-printer-head"><strong>${escapeHtml(name)}</strong><span class="home-state is-${job.state}">${STATE[job.state]}</span></span>
      ${body}
    </a>
    ${late.map(t => `<a class="home-maint" href="#/imprimantes"><span>Maintenance : ${escapeHtml(t.name)}</span><span>${escapeHtml(dueText(t))}</span></a>`).join('')}
  </article>`;
}

function printersHtml(runs, maint, loadedAt) {
  const lateOf = id => maint?.printers.find(p => p.printer_id === id)?.tasks.filter(t => t.state === 'overdue') || [];
  const cards = [], counts = { free: 0, busy: 0, done: 0, unknown: 0 };
  // Imprimantes actives, plus une inactive si elle a encore une impression en cours
  const list = store.printers.filter(p => p.active || runs?.some(r => r.printer_id === p.id));
  for (const p of list) {
    const job = runs ? jobOf(runs.filter(r => r.printer_id === p.id), loadedAt) : { state: 'unknown' };
    counts[job.state]++;
    cards.push(printerCard(p.name, job, lateOf(p.id)));
  }
  const orphans = (runs || []).filter(r => !list.some(p => p.id === r.printer_id));
  if (orphans.length) {
    const job = jobOf(orphans, loadedAt);
    counts[job.state]++;
    cards.push(printerCard('Sans imprimante', job, []));
  }
  const summary = [counts.free && plural(counts.free, 'libre'), counts.busy && `${counts.busy} en cours`,
    counts.done && `${counts.done} à terminer`].filter(Boolean).join(' · ');
  return {
    summary,
    html: (maint ? '' : failed('Maintenance illisible : les tâches en retard ne sont pas affichées.'))
      + (cards.length ? `<div class="home-printers">${cards.join('')}</div>` : empty('Aucune imprimante active.')),
  };
}

/* ── Projets en cours ──────────────────────────────────────────── */

function projectRow(p) {
  const total = Number(p.pieces_count) || 0, done = Number(p.pieces_done) || 0;
  const time = Number(p.remaining_time_s) || 0, untimed = Number(p.remaining_untimed) || 0;
  const timeText = time ? formatDuration(time) : (untimed ? '—' : (total && done >= total ? 'Tout imprimé' : '—'));
  const note = untimed ? `<span class="home-warn">${plural(untimed, 'pièce')} sans temps</span>` : (time ? 'restant' : '');
  return `<a class="home-project" href="#/projet/${p.id}">
    <span class="home-thumb">${photoThumb(p)}</span>
    <span class="home-project-name"><span class="cell-code">${escapeHtml(p.code || '')}</span><span>${escapeHtml(p.name)}</span></span>
    <span class="home-progress"><span class="muted">${done} / ${total} ${total > 1 ? 'pièces imprimées' : 'pièce imprimée'}</span>
      <span class="progress-line"><span class="progress-bar" style="width:${total ? Math.round(100 * done / total) : 0}%"></span></span></span>
    <span class="home-time"><strong>${timeText}</strong><small class="muted">${note}</small></span>
  </a>`;
}

/* ── Bobines ───────────────────────────────────────────────────── */

const spoolRow = (hex, label, value, sub, tag = '') => `<li><a class="home-spool" href="${FILAFLOW}" title="Ouvrir FilaFlow">
  ${swatch(hex)}<span class="home-spool-name">${escapeHtml(label)} ${tag}</span>
  <span class="home-spool-val"><strong>${escapeHtml(value)}</strong><small class="muted">${escapeHtml(sub)}</small></span></a></li>`;

export async function renderHome(el) {
  document.title = 'Accueil — PrepFlow';
  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Accueil</h1>
      <div class="page-actions"><span class="hint" id="home-time"></span><button type="button" class="btn" id="home-refresh">Actualiser</button></div>
    </div>
    <section class="home-section">
      <h2 class="panel-title">Imprimantes <span class="home-count" id="home-printers-count"></span></h2>
      <div id="home-printers"></div>
    </section>
    <section class="home-panel">
      <h2 class="panel-title">Projets en cours <span class="home-count" id="home-projects-count"></span></h2>
      <div id="home-projects"></div>
    </section>
    <div class="home-columns">
      <section class="home-panel">
        <h2 class="panel-title">Bobines à peser <span class="home-count" id="home-weigh-count"></span></h2>
        <div id="home-weigh"></div>
      </section>
      <section class="home-panel">
        <h2 class="panel-title">Stock faible <span class="home-count" id="home-low-count"></span></h2>
        <div id="home-low"></div>
      </section>
    </div>`;

  let alive = true;
  const $ = id => el.querySelector('#' + id);
  const put = (id, html, count = '') => { $(`home-${id}`).innerHTML = html; $(`home-${id}-count`).textContent = count; };
  // Chaque source est lue séparément : si l'une échoue, les autres blocs restent affichés
  const safe = promise => promise.catch(() => null);

  async function draw({ refresh = false } = {}) {
    // Le stock est relu en premier : « à peser » et « stock faible » partent des mêmes pesées
    const stock = await safe(store.loadFilaments({ refresh }));
    const [, runs, maint, projects, settings, low] = await Promise.all([
      safe(store.loadPrinters()), safe(api.get('runs?state=en_cours')), safe(api.get('maintenance')),
      safe(api.get('projects')), safe(api.get('settings')), safe(api.get('filaments/low-stock')),
    ]);
    if (!alive) return;
    const loadedAt = Date.now();

    const pr = printersHtml(runs, maint, loadedAt);
    put('printers', pr.html, pr.summary);

    if (!projects) put('projects', failed('Projets illisibles.'));
    else {
      const current = projects.filter(p => p.status === 'en_cours');
      put('projects', current.length ? current.map(projectRow).join('') : empty('Aucun projet en cours.'), current.length || '');
    }

    const cfg = { grams: Number(settings?.weigh_alert_g ?? 150), days: Number(settings?.weigh_alert_days ?? 14) };
    const weigh = stock ? spoolsToWeigh(store.filaments, cfg) : [];
    if (!stock) put('weigh', failed('Stock illisible.'));
    else {
      const note = stock.online ? '' : failed('FilaFlow ne répond pas : liste établie sur la dernière copie connue du stock.');
      put('weigh', note + (weigh.length ? `<ul class="home-spools">${weigh.map(({ filament: f, used }) =>
        spoolRow(f.color_hex, filamentLabel(f), `${formatWeight(Math.round(used))} consommés`, weighAge(f.last_weighed_at))).join('')}</ul>`
        : empty('Aucune bobine à peser.')), weigh.length || '');
    }

    if (!low || !low.available) put('low', failed(`Stock faible indisponible : ${low?.error || 'PrepFlow ne répond pas'}.`));
    else if (!low.threshold) put('low', empty('L’alerte « stock bas » est désactivée dans FilaFlow.'));
    else {
      const toWeigh = new Set(weigh.map(w => w.filament.id));
      put('low', low.items.length ? `<ul class="home-spools">${low.items.map(i => spoolRow(i.color_hex,
        filamentLabel(store.filamentsById.get(i.id) || i), formatWeight(Math.round(i.weight_remaining)), `${i.pct} % restant`,
        toWeigh.has(i.id) ? '<span class="tag home-tag">À peser</span>' : '')).join('')}</ul>`
        : empty(`Aucune bobine sous ${low.threshold} %.`), low.items.length || '');
    }

    const now = new Date();
    $('home-time').textContent = `Relevé à ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  $('home-refresh').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await draw({ refresh: true }); updateRunsBadge(); updateMaintBadge(); }
    catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });

  await draw({ refresh: true });
  return () => { alive = false; };
}
