// Page Atelier (v1.25.0) : lancer et terminer les impressions depuis l'écran tactile 7" (1024×600).
// Mêmes routes que la page Production (runs/start, runs/:id/finish, batches/:id/finish) : seul l'écran change.
import { api } from './api.js';
import { store } from './store.js';
import { toast } from './ui.js';
import { initTheme } from './theme.js';
import { overdueWarning } from './maintenance.js';
import { formatDuration, formatWeight, escapeHtml, filamentLabel, swatch, spoolStock, calibK } from './format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const round2 = n => Math.round(n * 100) / 100;
const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// Veille de la page : écran presque noir après N secondes sans toucher (?veille=120 pour changer, 0 pour désactiver)
const IDLE_S = (() => {
  const v = new URLSearchParams(location.search).get('veille');
  return v === null ? 90 : Math.max(0, parseInt(v, 10) || 0);
})();
const PAGE_LOADED = Date.now();

const S = { running: [], projects: [], loadedAt: Date.now(), version: null, outdated: false, offline: false };

/* ══ Données ═══════════════════════════════════════════════════════ */

async function refresh({ quiet = false } = {}) {
  try {
    const d = await api.get('atelier');
    S.running = d.running;
    S.projects = d.projects;
    S.loadedAt = Date.now();
    if (S.version && d.version && S.version !== d.version) S.outdated = true;
    S.version = d.version || S.version;
    S.offline = false;
  } catch (e) {
    S.offline = true;
    if (!quiet) toast(e.message, 'error');
  }
  $('#at-offline').hidden = !S.offline;
  drawRunning();
  drawReady();
}

const elapsedOf = r => (Number(r.elapsed_s) || 0) + (Date.now() - S.loadedAt) / 1000;

function groupRuns(list) {
  const m = new Map();
  for (const r of list) {
    const k = r.batch_id || `r${r.id}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.values()];
}

// Durée prévue d'une impression ou d'un plateau (null si inconnue)
const plannedOf = runs => Number(runs.length > 1 ? runs[0].batch_planned_time_s : runs[0].planned_time_s) || null;

const runTitle = runs => runs.length === 1
  ? `${runs[0].part_name || 'Sans nom'} ×${runs[0].quantity}`
  : `${runs.slice(0, 2).map(r => `${r.part_name || 'Sans nom'} ×${r.quantity}`).join(', ')}${runs.length > 2 ? ` +${runs.length - 2}` : ''}`;

/* ══ Feuilles plein écran ══════════════════════════════════════════ */

const sheets = [];

function openSheet({ title, sub = '', small = false }) {
  const root = h(`<div class="at-sheet${small ? ' at-sheet-small' : ''}" role="dialog" aria-modal="true">
    <div class="at-sheet-card">
      <div class="at-sheet-top"><span class="at-sheet-title"></span><span class="at-sheet-sub"></span>
        <button type="button" class="at-icon-btn at-sheet-x" aria-label="Fermer">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="at-sheet-body"></div>
      <div class="at-sheet-foot" hidden></div>
    </div></div>`);
  $('.at-sheet-title', root).textContent = title;
  $('.at-sheet-sub', root).textContent = sub;
  const sh = { root, body: $('.at-sheet-body', root), foot: $('.at-sheet-foot', root), closed: false, listeners: [] };
  sh.close = () => {
    if (sh.closed) return;
    sh.closed = true; root.remove();
    sheets.splice(sheets.indexOf(sh), 1);
    sh.listeners.forEach(fn => fn());
  };
  sh.onClose = fn => sh.listeners.push(fn);
  sh.setFoot = html => { sh.foot.innerHTML = html; sh.foot.hidden = !html; return sh.foot; };
  $('.at-sheet-x', root).addEventListener('click', sh.close);
  sheets.push(sh);
  document.body.appendChild(root);
  return sh;
}
const closeAllSheets = () => [...sheets].forEach(s => s.close());

/* ══ Pavé numérique ════════════════════════════════════════════════ */

function keypad({ decimal = false, maxLen = 8, onChange = () => {} } = {}) {
  const root = h(`<div class="kp-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? ',' : '', '0', '⌫']
    .map(k => `<button type="button" data-k="${k}" ${k ? '' : 'tabindex="-1" aria-hidden="true"'}>${k}</button>`).join('')}</div>`);
  let value = '', fresh = false;
  root.addEventListener('click', e => {
    const k = e.target.closest('button[data-k]')?.dataset.k;
    if (!k) return;
    if (k === '⌫') { value = value.slice(0, -1); fresh = false; }
    else if (k === ',') { if (fresh) { value = ''; fresh = false; } if (!value.includes(',')) value = (value || '0') + ','; }
    else {
      if (fresh) { value = ''; fresh = false; }      // le premier chiffre remplace la valeur proposée
      if (value.length < maxLen) value = (value === '0' ? '' : value) + k;
    }
    onChange(value);
  });
  return {
    root,
    get value() { return value; },
    set(v, { replaceOnType = false } = {}) { value = String(v ?? '').replace('.', ','); fresh = replaceOnType && value !== ''; onChange(value); },
  };
}

/** Saisie d'un nombre au pavé. Renvoie le nombre, ou null si annulé. */
function askNumber({ title, unit = '', initial = '', decimal = false, max = null }) {
  return new Promise(resolve => {
    let result = null;
    const sh = openSheet({ title, small: true });
    sh.body.innerHTML = `<div class="kp">
      <div class="kp-display"><span data-val></span><span class="kp-unit">${escapeHtml(unit)}</span></div>
      <div class="kp-hint" data-hint></div><div data-pad></div></div>`;
    const val = $('[data-val]', sh.body), hint = $('[data-hint]', sh.body);
    const parse = v => Number(String(v).replace(',', '.'));
    const pad = keypad({
      decimal, maxLen: decimal ? 7 : 3,
      onChange: v => {
        val.textContent = v || '0';
        const n = parse(v);
        const bad = max !== null && v !== '' && n > max;
        hint.textContent = bad ? `Maximum ${max}` : '';
        hint.classList.toggle('is-bad', bad);
        ok.disabled = v === '' || Number.isNaN(n) || bad;
      },
    });
    $('[data-pad]', sh.body).replaceWith(pad.root);
    sh.setFoot(`<button type="button" class="at-btn" data-cancel>Annuler</button><button type="button" class="at-btn at-btn-primary" data-ok>OK</button>`);
    const ok = $('[data-ok]', sh.foot);
    $('[data-cancel]', sh.foot).addEventListener('click', sh.close);
    ok.addEventListener('click', () => { result = parse(pad.value); sh.close(); });
    sh.onClose(() => resolve(result));
    pad.set(initial, { replaceOnType: true });
  });
}

/* ══ Choix d'une bobine ════════════════════════════════════════════ */

/** Liste des bobines (même matière et couleur en premier). Renvoie la bobine choisie ou null. */
function pickSpool({ title, sub = '', material = null, color = null, exclude = [] }) {
  return new Promise(resolve => {
    const all = store.filaments.filter(f => !f.archived && !exclude.includes(f.id));
    if (!all.length) { toast('Aucune bobine disponible (stock FilaFlow vide ou injoignable)', 'error'); resolve(null); return; }
    let picked = null;
    const sh = openSheet({ title, sub });
    sh.onClose(() => resolve(picked));
    const mats = [...new Set(all.map(f => f.material).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    let filter = material ? (mats.find(m => norm(m) === norm(material)) || '') : '';
    sh.body.innerHTML = '<div class="at-chips" data-chips></div><div class="at-spools" data-list></div>';
    const rank = f => (material && norm(f.material) === norm(material) ? 0 : 2) + (color && norm(f.color_name) === norm(color) ? 0 : 1);
    const near = f => (material || color) && rank(f) === 0;

    const draw = () => {
      $('[data-chips]', sh.body).innerHTML = ['', ...mats].map(m =>
        `<button type="button" class="at-btn ${m === filter ? 'on' : ''}" data-mat="${escapeHtml(m)}">${escapeHtml(m || 'Toutes')}</button>`).join('');
      const list = all.filter(f => !filter || f.material === filter)
        .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'fr', { numeric: true }));
      $('[data-list]', sh.body).innerHTML = list.length ? list.map(f => {
        const st = spoolStock(f);
        return `<button type="button" class="at-spool ${near(f) ? 'is-near' : ''}" data-id="${f.id}">
          ${swatch(f.color_hex)}
          <span><span class="at-spool-name">${escapeHtml(filamentLabel(f))}</span>
            <span class="at-spool-meta">${escapeHtml([f.material, f.color_name].filter(Boolean).join(' · '))}</span></span>
          <span class="at-spool-stock">${escapeHtml(st.text || '?')}${st.estimated ? ' <small>estimé</small>' : `<small>${escapeHtml(st.age || '')}</small>`}</span>
        </button>`;
      }).join('') : '<p class="at-empty">Aucune bobine pour ce filtre.</p>';
    };
    sh.body.addEventListener('click', e => {
      const m = e.target.closest('[data-mat]');
      if (m) { filter = m.dataset.mat; draw(); return; }
      const s = e.target.closest('[data-id]');
      if (s) { picked = store.filamentsById.get(+s.dataset.id) || null; sh.close(); }
    });
    draw();
  });
}

/* ══ Relais de bobine ══════════════════════════════════════════════ */

const filName = f => f.name
  ? `${f.name}${f.spool_number && String(f.spool_number).trim() ? ` (${String(f.spool_number).trim()})` : ''}`
  : filamentLabel(store.filamentsById.get(f.filament_id));

/**
 * La bobine vidée prend son reste estimé (modifiable), la nouvelle prend le reste du poids de la pièce.
 * pct : part réalisée de la pièce (100 si réussie). Renvoie { from, to, g, fromName, toName } ou null.
 */
function openRelay({ run, pct, current }) {
  return new Promise(resolve => {
    let out = null;
    const fils = run.filaments;
    const st = { from: current?.from ?? fils[0].filament_id, g: current ? current.g : null, to: current?.to ?? null, toName: current?.toName ?? '' };
    const sh = openSheet({ title: 'Bobine changée', sub: `${run.part_name || 'Sans nom'} × ${run.quantity}` });
    sh.onClose(() => resolve(out));
    const line = () => fils.find(f => f.filament_id === st.from);
    const total = () => round2(Number(line().planned_g) * pct / 100);
    const est = () => {
      const v = spoolStock(store.filamentsById.get(st.from)).value;
      return v === null ? null : round2(Math.min(v, total()));
    };
    const eff = () => (st.g !== null ? st.g : est());
    const valid = () => st.to && eff() !== null && eff() >= 0 && eff() < total();

    sh.setFoot(`<button type="button" class="at-btn" data-cancel>Annuler</button><button type="button" class="at-btn at-btn-primary" data-ok disabled>Valider</button>`);
    $('[data-cancel]', sh.foot).addEventListener('click', sh.close);
    $('[data-ok]', sh.foot).addEventListener('click', () => {
      out = { from: st.from, to: st.to, g: eff(), fromName: filName(line()), toName: st.toName };
      sh.close();
    });

    const draw = () => {
      const g = eff(), t = total();
      let sum = '', bad = false;
      if (g === null) { sum = 'Reste de la bobine vidée inconnu : indiquez sa part.'; }
      else if (g >= t) { bad = true; sum = `${filName(line())} couvre déjà ${formatWeight(t) || '0 g'} : pas de relais. Réduisez sa part si elle s'est vidée avant.`; }
      else if (!st.to) sum = 'Choisissez la nouvelle bobine.';
      else sum = `${filName(line())} : ${formatWeight(g) || '0 g'} · ${st.toName} : ${formatWeight(round2(t - g)) || '0 g'}`;
      sh.body.innerHTML = `<div class="rl">
        <div class="rl-sec"><span class="rl-label">Bobine vidée</span>
          ${fils.length > 1
            ? `<div class="rl-chips">${fils.map(f => `<button type="button" class="at-btn ${f.filament_id === st.from ? 'on' : ''}" data-from="${f.filament_id}">${escapeHtml(filName(f))}</button>`).join('')}</div>`
            : `<strong>${escapeHtml(filName(fils[0]))}</strong>`}</div>
        <div class="rl-sec"><span class="rl-label">Part de la bobine vidée</span>
          <button type="button" class="at-btn" data-g>${g === null ? 'Indiquer…' : escapeHtml(formatWeight(g) || '0 g')}${st.g === null && g !== null ? ' (reste estimé)' : ''}</button></div>
        <div class="rl-sec"><span class="rl-label">Remplacée par</span>
          <button type="button" class="at-btn" data-to>${st.to ? escapeHtml(st.toName) : 'Choisir la nouvelle bobine…'}</button></div>
        <p class="rl-sum ${bad ? 'is-bad' : ''}">${escapeHtml(sum)}</p></div>`;
      $('[data-ok]', sh.foot).disabled = !valid();
    };
    sh.body.addEventListener('click', async e => {
      const f = e.target.closest('[data-from]');
      if (f) { st.from = +f.dataset.from; st.g = null; draw(); return; }
      if (e.target.closest('[data-g]')) {
        const n = await askNumber({ title: 'Part de la bobine vidée', unit: 'g', initial: eff() ?? '', decimal: true });
        if (n !== null) { st.g = round2(n); draw(); }
        return;
      }
      if (e.target.closest('[data-to]')) {
        const from = store.filamentsById.get(st.from);
        const f2 = await pickSpool({ title: 'Nouvelle bobine', material: from?.material, color: from?.color_name, exclude: fils.map(x => x.filament_id) });
        if (f2) { st.to = f2.id; st.toName = filamentLabel(f2); draw(); }
      }
    });
    draw();
  });
}

/* ══ Terminer ══════════════════════════════════════════════════════ */

const PCTS = [10, 25, 50, 75, 90];

function runPanel(run, { compact = false } = {}) {
  const st = { result: 'ok', pct: null, relay: null };
  const label = `${run.part_name || 'Sans nom'} ×${run.quantity}`;
  const root = h(`<div class="rp${compact ? ' is-compact' : ''}"></div>`);
  const pctNow = () => (st.result === 'ok' ? 100 : st.result === 'rate' ? (st.pct ?? 0) : 0);

  const render = () => {
    const custom = st.pct !== null && !PCTS.includes(st.pct);
    root.innerHTML = `
      <div class="rp-head"><strong>${escapeHtml(label)}</strong>
        <span class="muted">${escapeHtml([run.project_code, run.printer_name].filter(Boolean).join(' · '))}</span></div>
      <div class="rp-res">${[['ok', '✔ Réussie'], ['rate', '✖ Ratée'], ['annule', 'Annulée']]
        .map(([v, l]) => `<button type="button" class="at-btn ${st.result === v ? 'on' : ''}" data-res="${v}">${l}</button>`).join('')}</div>
      ${st.result === 'rate' ? `<div class="rp-pct"><span>Réalisé :</span>
        ${PCTS.map(n => `<button type="button" class="at-btn ${st.pct === n ? 'on' : ''}" data-pct="${n}">${n} %</button>`).join('')}
        <button type="button" class="at-btn ${custom ? 'on' : ''}" data-pct="other">${custom ? st.pct + ' %' : 'Autre…'}</button></div>` : ''}
      ${st.result !== 'annule' ? (st.relay
        ? `<div class="rp-relay"><span class="rp-relay-sum">Relais : ${escapeHtml(st.relay.fromName)} ${escapeHtml(formatWeight(st.relay.g) || '0 g')} → ${escapeHtml(st.relay.toName)}</span>
            <button type="button" class="at-btn at-btn-sm" data-relay>Modifier</button>
            <button type="button" class="at-btn at-btn-sm at-btn-ghost" data-relay-clear>Retirer</button></div>`
        : `<div class="rp-relay"><button type="button" class="at-btn at-btn-ghost" data-relay>J'ai changé de bobine</button></div>`) : ''}`;
  };

  root.addEventListener('click', async e => {
    const res = e.target.closest('[data-res]');
    if (res) {
      st.result = res.dataset.res;
      if (st.result === 'annule') st.relay = null;
      render(); return;
    }
    const pct = e.target.closest('[data-pct]');
    if (pct) {
      if (pct.dataset.pct === 'other') {
        const n = await askNumber({ title: 'Pourcentage réalisé', unit: '%', initial: st.pct ?? '', max: 99 });
        if (n !== null) st.pct = Math.round(n);
      } else st.pct = +pct.dataset.pct;
      render(); return;
    }
    if (e.target.closest('[data-relay-clear]')) { st.relay = null; render(); return; }
    if (e.target.closest('[data-relay]')) {
      if (st.result === 'rate' && st.pct === null) { toast("Choisissez d'abord le pourcentage réalisé", 'error'); return; }
      const r = await openRelay({ run, pct: pctNow(), current: st.relay });
      if (r) st.relay = r;
      render();
    }
  });

  render();
  return {
    el: root, run, label, done: false,
    setResult(v) { st.result = v; if (v === 'annule') st.relay = null; render(); },
    markDone() { this.done = true; root.classList.add('is-done'); },
    payload() {
      if (st.result === 'rate' && st.pct === null) return { error: `${label} : choisissez le pourcentage réalisé` };
      const body = { result: st.result };
      if (st.result === 'rate') body.progress_pct = st.pct;
      if (st.relay && st.result !== 'annule') {
        const line = run.filaments.find(f => f.filament_id === st.relay.from);
        const total = round2(Number(line.planned_g) * pctNow() / 100);
        if (st.relay.g >= total) return { error: `${label} : la bobine vidée couvre déjà tout le poids, pas de relais` };
        body.relay = { from_filament_id: st.relay.from, to_filament_id: st.relay.to, from_g: st.relay.g };
      }
      return { body };
    },
  };
}

function openFinish(runs) {
  const many = runs.length > 1;
  const first = runs[0];
  const sh = openSheet({
    title: many ? `Terminer le plateau · ${plural(runs.length, 'pièce')}` : "Terminer l'impression",
    sub: `${first.printer_name || ''} · lancée depuis ${formatDuration(elapsedOf(first)) || '0 min'}`,
  });
  sh.body.classList.add('at-finish-body');
  const panels = runs.map(r => runPanel(r, { compact: many }));
  if (many) {
    const all = h(`<div class="at-all"><span class="muted">Pour tout le plateau :</span>
      <button type="button" class="at-btn at-btn-sm" data-all="ok">✔ Tout réussi</button>
      <button type="button" class="at-btn at-btn-sm" data-all="annule">Tout annulé</button>
      <span class="muted">puis ajustez pièce par pièce si besoin</span></div>`);
    all.addEventListener('click', e => {
      const b = e.target.closest('[data-all]');
      if (b) panels.filter(p => !p.done).forEach(p => p.setResult(b.dataset.all));
    });
    sh.body.appendChild(all);
  }
  panels.forEach(p => sh.body.appendChild(p.el));

  sh.setFoot(`<button type="button" class="at-btn" data-cancel>Annuler</button><button type="button" class="at-btn at-btn-primary" data-save>Enregistrer</button>`);
  $('[data-cancel]', sh.foot).addEventListener('click', sh.close);
  const save = $('[data-save]', sh.foot);
  save.addEventListener('click', async () => {
    const todo = panels.filter(p => !p.done);
    const items = [];
    for (const p of todo) {
      const r = p.payload();
      if (r.error) { toast(r.error, 'error'); return; }
      items.push({ p, body: r.body });
    }
    save.disabled = true;
    try {
      const first = JSON.stringify(items[0].body);
      const wholeBatch = many && todo.length === runs.length && runs.every(r => r.batch_id && r.batch_id === runs[0].batch_id);
      if (wholeBatch && items.every(i => JSON.stringify(i.body) === first) && !items.some(i => i.body.relay)) {
        await api.post(`batches/${runs[0].batch_id}/finish`, items[0].body);       // même résultat pour tout le plateau
      } else {
        for (const { p, body } of items) {
          try { await api.post(`runs/${p.run.id}/finish`, body); p.markDone(); }
          catch (e) {
            toast(`${p.label} : ${e.message}`, 'error');
            await refresh({ quiet: true });
            save.disabled = false;
            return;
          }
        }
      }
      toast(items.length > 1 ? `${items.length} impressions enregistrées` : 'Impression enregistrée');
      sh.close();
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
      save.disabled = false;
    }
  });
}

/* ══ Lancer ════════════════════════════════════════════════════════ */

const groupLabel = g => [g.material, g.color_name].filter(Boolean).join(' ') || 'Sans matière ni couleur';

async function openProject(id) {
  let data;
  try {
    [data] = await Promise.all([api.get(`atelier/projects/${id}`), store.loadFilaments().catch(() => {})]);
  } catch (e) { toast(e.message, 'error'); return; }

  const sh = openSheet({ title: 'Lancer', sub: [data.project.code, data.project.name].filter(Boolean).join(' · ') });
  const sel = new Set(), qty = new Map(), seen = new Set();
  let printerId = null, maint = null;
  const byId = () => new Map(data.parts.map(p => [p.id, p]));

  // Sélection de départ : les pièces prêtes avec un reste à imprimer ; les pièces devenues lançables ensuite (bobine choisie) s'ajoutent
  const seed = () => {
    for (const p of data.parts) {
      if (!qty.has(p.id)) qty.set(p.id, Math.max(1, p.remaining));
      if (p.launchable && !seen.has(p.id)) {
        seen.add(p.id);
        if (p.status !== 'a_trancher' && p.remaining > 0) sel.add(p.id);
      }
    }
    if (printerId === null) {
      const map = byId();
      const shared = new Set([...sel].map(i => map.get(i).printer_id));
      const only = shared.size === 1 ? [...shared][0] : null;
      if (only && store.printers.some(p => p.id === only && p.active)) printerId = only;
    }
  };

  sh.body.innerHTML = `<div class="at-split">
    <div class="at-pane">
      <div class="at-pane-head"><span data-count></span><button type="button" class="at-link" data-all>Tout / rien</button></div>
      <div data-banner></div>
      <div class="at-parts" data-parts></div>
    </div>
    <aside class="at-pane at-pane-right">
      <div class="at-pane-head">Imprimante</div>
      <div class="at-printers" data-printers></div>
      <p class="at-maint" data-maint hidden></p>
      <div class="at-needs" data-needs></div>
      <button type="button" class="at-btn at-btn-ok at-launch" data-launch disabled>Lancer</button>
    </aside></div>`;
  const list = $('[data-parts]', sh.body);

  const drawBanner = () => {
    $('[data-banner]', sh.body).innerHTML = data.groups.length ? `<div class="at-banner"><strong>Bobines à choisir</strong>
      ${data.groups.map((g, i) => `<div class="at-grp"><span>${escapeHtml(groupLabel(g))} · ${plural(g.parts, 'pièce')}</span>
        <button type="button" class="at-btn at-btn-sm" data-grp="${i}">Choisir</button></div>`).join('')}</div>` : '';
  };

  const partTags = p => {
    const t = [];
    if (p.status === 'a_trancher') t.push('<span class="at-tag at-tag-warn">À trancher</span>');
    if (p.running_qty > 0) t.push(`<span class="at-tag at-tag-warn">${p.running_qty} en cours</span>`);
    if (p.done_qty >= p.quantity && p.running_qty === 0) t.push('<span class="at-tag at-tag-ok">Imprimée · réimpression</span>');
    else if (p.done_qty > 0) t.push(`<span class="at-tag">déjà ${p.done_qty}/${p.quantity}</span>`);
    return t.join('');
  };

  const drawParts = () => {
    const keep = list.scrollTop;
    list.innerHTML = data.parts.length ? data.parts.map(p => {
      const dis = !p.launchable;
      const reason = !dis ? '' : p.needs_spools ? 'Bobine à choisir' : 'Filament non renseigné : à compléter sur le PC';
      return `<div class="at-part ${sel.has(p.id) ? 'is-on' : ''} ${dis ? 'is-disabled' : ''}" data-id="${p.id}">
        <span class="at-tick" aria-hidden="true"></span>
        <div><div class="at-part-name">${escapeHtml(p.name || 'Sans nom')}${p.quantity > 1 ? ` <span class="muted">× ${p.quantity}</span>` : ''}</div>
          <div class="at-part-meta">${p.filaments.map(f => swatch(store.filamentsById.get(f.filament_id)?.color_hex)).join('')}
            ${p.print_time_s ? `<span>${escapeHtml(formatDuration(p.print_time_s))}</span>` : ''}
            ${dis ? `<span class="at-tag at-tag-warn">${escapeHtml(reason)}</span>` : ''}${partTags(p)}</div></div>
        <div class="at-qty" ${dis ? 'hidden' : ''}><button type="button" data-dec aria-label="Moins">−</button><output>${qty.get(p.id)}</output><button type="button" data-inc aria-label="Plus">+</button></div>
      </div>`;
    }).join('') : '<p class="at-empty"><strong>Aucune pièce</strong>Ajoutez les pièces dans PrepFlow, sur le PC.</p>';
    list.scrollTop = keep;
    $('[data-count]', sh.body).textContent = `${sel.size} sur ${plural(data.parts.length, 'pièce')}`;
  };

  const printers = () => store.printers.filter(p => p.active);
  const drawPrinters = () => {
    $('[data-printers]', sh.body).innerHTML = printers().length
      ? printers().map(p => `<button type="button" class="at-btn ${p.id === printerId ? 'is-on' : ''}" data-pid="${p.id}">${escapeHtml(p.name)}</button>`).join('')
      : '<p class="at-empty">Aucune imprimante active : à régler dans PrepFlow.</p>';
    const box = $('[data-maint]', sh.body);
    const txt = maint && printerId ? overdueWarning(maint, printerId) : '';
    box.hidden = !txt; box.innerHTML = txt;
  };

  // Besoin en filament par bobine, comparé au reste estimé (moins ce qui est déjà réservé par d'autres impressions)
  const drawNeeds = () => {
    const map = byId(), need = new Map();
    for (const id of sel) {
      const p = map.get(id);
      for (const f of p.filaments) {
        if (!f.filament_id) continue;
        need.set(f.filament_id, (need.get(f.filament_id) || 0) + (Number(f.weight_g) || 0) * qty.get(id) * calibK(store.filamentsById.get(f.filament_id)));
      }
    }
    let anyShort = false, allKnown = need.size > 0;
    const lines = [...need.entries()].map(([fid, g]) => {
      const f = store.filamentsById.get(fid);
      const st = spoolStock(f);
      const avail = st.value === null ? null : st.value - (Number(f?.reserved_g) || 0);
      if (avail === null) allKnown = false;
      const short = avail !== null && g > avail;
      if (short) anyShort = true;
      return `<div class="at-need ${short ? 'is-short' : ''}">${swatch(f?.color_hex)}<span class="at-need-name">${escapeHtml(filamentLabel(f))}</span>
          <span class="at-need-g">${escapeHtml(formatWeight(round2(g)) || '0 g')}</span></div>
        ${short ? `<div class="at-need-note">manque ${escapeHtml(formatWeight(round2(g - avail)))} (${escapeHtml(st.text)} dispo., ${escapeHtml(st.age)}). Si la bobine se vide : « J'ai changé de bobine » à la fin.</div>` : ''}`;
    });
    $('[data-needs]', sh.body).innerHTML = lines.join('')
      + (need.size && !anyShort && allKnown ? '<div class="at-need" style="color:var(--success)">✓ Stock suffisant</div>' : '');
  };

  const drawLaunch = () => {
    const b = $('[data-launch]', sh.body), n = sel.size;
    b.disabled = !n || !printerId;
    b.textContent = !n ? 'Choisir des pièces' : !printerId ? "Choisir l'imprimante" : n > 1 ? `Lancer ${n} pièces ensemble` : 'Lancer la pièce';
  };
  const drawAll = () => { drawBanner(); drawParts(); drawPrinters(); drawNeeds(); drawLaunch(); };
  const afterChange = () => { drawParts(); drawNeeds(); drawLaunch(); };

  list.addEventListener('click', e => {
    const row = e.target.closest('.at-part');
    if (!row) return;
    const id = +row.dataset.id, p = byId().get(id);
    if (e.target.closest('[data-dec]')) { qty.set(id, Math.max(1, qty.get(id) - 1)); sel.add(id); }
    else if (e.target.closest('[data-inc]')) { qty.set(id, Math.min(99, qty.get(id) + 1)); sel.add(id); }
    else if (!p.launchable) {
      toast(p.needs_spools ? "Choisissez d'abord la bobine (encadré orange)" : 'Filament non renseigné : à compléter dans PrepFlow, sur le PC', 'info');
      return;
    } else if (sel.has(id)) sel.delete(id); else sel.add(id);
    afterChange();
  });
  $('[data-all]', sh.body).addEventListener('click', () => {
    const ready = data.parts.filter(p => p.launchable);
    if (sel.size >= ready.length) sel.clear(); else ready.forEach(p => sel.add(p.id));
    afterChange();
  });
  $('[data-banner]', sh.body).addEventListener('click', async e => {
    const b = e.target.closest('[data-grp]');
    if (!b) return;
    const g = data.groups[+b.dataset.grp];
    const f = await pickSpool({ title: `Bobine · ${groupLabel(g)}`, sub: plural(g.parts, 'pièce'), material: g.material, color: g.color_name });
    if (!f || sh.closed) return;
    try {
      const r = await api.post(`projects/${id}/assign-spools`, { assignments: [{ material: g.material, color_name: g.color_name, filament_id: f.id }] });
      toast(`${plural(r.lines, 'ligne')} de filament affectée${r.lines > 1 ? 's' : ''}`);
      data = await api.get(`atelier/projects/${id}`);
      seed(); drawAll();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-printers]', sh.body).addEventListener('click', e => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    printerId = +b.dataset.pid;
    drawPrinters(); drawLaunch();
  });
  const launch = $('[data-launch]', sh.body);
  launch.addEventListener('click', async () => {
    if (!sel.size || !printerId) return;
    launch.disabled = true;
    try {
      const items = [...sel].map(pid => ({ part_id: pid, quantity: qty.get(pid) }));
      await api.post('runs/start', { printer_id: printerId, items });
      toast(items.length > 1 ? `Lancement groupé : ${plural(items.length, 'pièce')}` : 'Impression lancée');
      sh.close();
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
      drawLaunch();
    }
  });

  seed();
  drawAll();
  api.get('maintenance').then(m => { maint = m; if (!sh.closed) drawPrinters(); }).catch(() => {});
}

/* ══ Recherche par code ════════════════════════════════════════════ */

const digitsOf = c => String(c || '').replace(/\D/g, '');

function openCodeSearch() {
  const sh = openSheet({ title: 'Chercher par code' });
  sh.body.innerHTML = `<div class="at-codesearch">
    <div class="kp"><div class="kp-display"><span class="kp-prefix">P</span><span data-val></span></div>
      <div class="kp-hint">Chiffres du code, par exemple 261001</div><div data-pad></div></div>
    <div class="at-results" data-results></div></div>`;
  const results = $('[data-results]', sh.body);
  const drawResults = digits => {
    let list;
    if (digits) {
      list = S.projects.filter(p => digitsOf(p.code).includes(digits))
        .sort((a, b) => (digitsOf(b.code).startsWith(digits) ? 1 : 0) - (digitsOf(a.code).startsWith(digits) ? 1 : 0));
    } else list = S.projects.filter(p => p.todo_parts > 0);
    list = list.slice(0, 8);
    results.innerHTML = list.length ? list.map(projectButton).join('')
      : `<p class="at-empty"><strong>Aucun projet</strong>Aucun code ne contient « ${escapeHtml(digits)} ».</p>`;
  };
  const pad = keypad({ maxLen: 6, onChange: v => { $('[data-val]', sh.body).textContent = v; drawResults(v); } });
  $('[data-pad]', sh.body).replaceWith(pad.root);
  results.addEventListener('click', e => {
    const b = e.target.closest('[data-project]');
    if (!b) return;
    sh.close();
    openProject(+b.dataset.project);
  });
  drawResults('');
}

/* ══ Écran principal ═══════════════════════════════════════════════ */

function projectButton(p) {
  const todo = p.todo_parts > 0;
  return `<button type="button" class="at-proj" data-project="${p.id}">
    <span class="at-code">${escapeHtml(p.code || '')}</span>
    <span class="at-proj-name">${escapeHtml(p.name || '')}</span>
    <span class="at-proj-meta">
      <span>${todo ? `${plural(p.todo_pieces, 'pièce')} à lancer${Number(p.todo_time_s) ? ' · ' + escapeHtml(formatDuration(Number(p.todo_time_s))) : ''}` : 'rien à lancer'}</span>
      ${p.status === 'en_cours' ? '<span class="at-tag at-tag-warn">en cours</span>' : ''}
      ${p.status === 'termine' ? '<span class="at-tag at-tag-ok">terminé</span>' : ''}
      ${p.needs_spools > 0 ? '<span class="at-tag at-tag-warn">bobines à choisir</span>' : ''}
    </span>
  </button>`;
}

let cards = [], runSig = null, readySig = null;

function drawRunning() {
  const box = $('#at-running');
  $('#at-running-count').textContent = S.running.length || '';
  const sig = JSON.stringify(S.running.map(r => [r.id, r.batch_id]));
  if (sig === runSig) { tickElapsed(); return; }          // rien n'a changé : on ne reconstruit pas (garde la position de défilement)
  runSig = sig;
  cards = [];
  if (!S.running.length) {
    box.innerHTML = `<div class="at-empty"><strong>Aucune impression en cours</strong>Lancez-en une depuis la colonne de droite.</div>`;
    return;
  }
  box.innerHTML = '';
  for (const runs of groupRuns(S.running)) {
    const first = runs[0], planned = plannedOf(runs);
    const codes = [...new Set(runs.map(r => r.project_code).filter(Boolean))];
    const el = h(`<article class="at-run">
      <div class="at-run-head"><span class="at-printer">${escapeHtml(first.printer_name || 'Sans imprimante')}</span>
        ${runs.length > 1 ? `<span class="at-chip">Plateau · ${plural(runs.length, 'pièce')}</span>` : ''}
        ${codes.map(c => `<span class="at-code">${escapeHtml(c)}</span>`).join('')}</div>
      <div class="at-run-parts">${escapeHtml(runTitle(runs))}</div>
      <div class="at-run-time"><span class="at-elapsed"></span>
        ${planned ? `<span class="muted">sur ${escapeHtml(formatDuration(planned))}</span><span class="at-left"></span>` : ''}</div>
      ${planned ? '<div class="at-bar"><i></i></div>' : ''}
      <button type="button" class="at-btn at-btn-primary">■ Terminer</button>
    </article>`);
    $('.at-btn', el).addEventListener('click', () => openFinish(runs));
    box.appendChild(el);
    cards.push({ runs, planned, el, elapsedEl: $('.at-elapsed', el), leftEl: $('.at-left', el), barWrap: $('.at-bar', el), bar: $('.at-bar i', el) });
  }
  tickElapsed();
}

function drawReady() {
  const box = $('#at-ready');
  const list = S.projects.filter(p => p.todo_parts > 0).slice(0, 40);
  const sig = JSON.stringify(list.map(p => [p.id, p.todo_parts, p.todo_pieces, p.todo_time_s, p.needs_spools, p.status]));
  if (sig === readySig) return;
  readySig = sig;
  box.innerHTML = list.length ? list.map(projectButton).join('')
    : `<div class="at-empty"><strong>Rien à lancer</strong>Préparez un projet dans PrepFlow, ou cherchez-le par son code.</div>`;
}

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Durée écoulée, reste à imprimer et barre de progression : mis à jour sans rien reconstruire
function tickElapsed() {
  for (const c of cards) {
    const el = elapsedOf(c.runs[0]);
    c.elapsedEl.textContent = formatDuration(el) || '0 min';
    if (!c.planned) continue;
    const left = c.planned - el;
    c.leftEl.textContent = left >= 0 ? `reste ${formatDuration(left) || '0 min'}` : `dépassé de ${formatDuration(-left) || '0 min'}`;
    c.leftEl.classList.toggle('is-late', left < 0);
    c.barWrap.classList.toggle('is-late', left < 0);
    c.bar.style.width = `${Math.min(100, 100 * el / c.planned)}%`;
  }
  $('#at-clock').textContent = hhmm(new Date());
  if (!veille.hidden) drawVeille();
}

/* ══ Menu ══════════════════════════════════════════════════════════ */

$('#at-menu').addEventListener('click', () => {
  const sh = openSheet({ title: 'Menu', small: true });
  sh.body.innerHTML = `<div class="at-menu-list">
    <button type="button" class="at-btn" data-go="./">Ouvrir PrepFlow complet</button>
    <button type="button" class="at-btn" data-go="/">Ouvrir FilaFlow</button>
    <button type="button" class="at-btn" data-go="reload">Recharger la page</button></div>
    <p class="at-ver">PrepFlow ${escapeHtml(S.version ? 'v' + S.version : '')}</p>`;
  sh.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]')?.dataset.go;
    if (!go) return;
    if (go === 'reload') location.reload(); else location.href = go;
  });
});
$('#at-code').addEventListener('click', openCodeSearch);
$('#at-ready').addEventListener('click', e => {
  const b = e.target.closest('[data-project]');
  if (b) openProject(+b.dataset.project);
});

/* ══ Veille ════════════════════════════════════════════════════════ */

const veille = $('#at-veille');
let lastActive = Date.now(), swallowUntil = 0;

function drawVeille() {
  const d = new Date();
  const lines = groupRuns(S.running).map(runs => {
    const planned = plannedOf(runs), el = elapsedOf(runs[0]);
    const left = planned ? planned - el : null;
    return `<div class="at-v-run"><strong>${escapeHtml(runs[0].printer_name || '')}</strong><span>${escapeHtml(runTitle(runs))}</span>
      <span class="${left !== null && left < 0 ? 'late' : ''}">${left === null ? escapeHtml(formatDuration(el) || '0 min')
        : left >= 0 ? `reste ${escapeHtml(formatDuration(left) || '0 min')}` : `dépassé de ${escapeHtml(formatDuration(-left) || '0 min')}`}</span></div>`;
  });
  veille.innerHTML = `<div class="at-v-clock">${hhmm(d)}</div>
    <div class="at-v-date">${escapeHtml(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    <div class="at-v-runs">${lines.join('') || '<span>Aucune impression en cours</span>'}</div>
    <div class="at-v-hint">Touchez l'écran pour réveiller</div>`;
}

function enterVeille() {
  closeAllSheets();
  drawVeille();
  veille.hidden = false;
  // Une mise à jour de PrepFlow ou une page ouverte depuis longtemps : on recharge pendant que personne ne touche
  if (S.outdated || Date.now() - PAGE_LOADED > 12 * 3600 * 1000) setTimeout(() => location.reload(), 500);
}

// Le toucher qui réveille l'écran (ou l'écran physique) ne déclenche rien d'autre
document.addEventListener('pointerdown', e => {
  lastActive = Date.now();
  if (!veille.hidden) {
    veille.hidden = true;
    swallowUntil = Date.now() + 500;
    e.preventDefault(); e.stopPropagation();
  }
}, true);
document.addEventListener('click', e => {
  if (Date.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); }
}, true);
['touchmove', 'wheel', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));

/* ══ Démarrage ═════════════════════════════════════════════════════ */

async function init() {
  initTheme();
  await Promise.all([store.loadPrinters().catch(() => {}), store.loadFilaments().catch(() => {}), refresh()]);
  setInterval(tickElapsed, 10_000);
  setInterval(() => { if (!document.hidden) refresh({ quiet: true }); }, 12_000);
  setInterval(() => { if (!sheets.length) store.loadFilaments().catch(() => {}); }, 60_000);
  if (IDLE_S) setInterval(() => { if (veille.hidden && Date.now() - lastActive > IDLE_S * 1000) enterVeille(); }, 5_000);
}
init();
