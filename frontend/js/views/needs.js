import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../ui.js';
import { PROJECT_STATUS, formatWeight, escapeHtml, filamentLabel, swatch } from '../format.js';

// ── Besoins de filament sur plusieurs projets ─────────────────────
// Règles (identiques à la synthèse d'un projet) : seules les pièces non imprimées comptent,
// poids unitaire × quantité, chaque filament d'une pièce multicolore compte pour sa bobine.
// La marge de sécurité (Paramètres) majore les besoins.

const SEL_KEY  = 'prepflow_needs_selection';
const MODE_KEY = 'prepflow_needs_mode';
const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
const clean = s => String(s ?? '').trim().replace(/\s+/g, ' ');
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch (_) { return fallback; }
}
function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }

// Estimation du nombre de bobines à acheter
function spoolsToBuy(deficit, unit) {
  if (!(deficit > 0)) return '';
  const u = unit > 0 ? unit : 1000;
  const n = Math.ceil(deficit / u);
  return `${n} bobine${n > 1 ? 's' : ''} de ${formatWeight(u)}`;
}

/**
 * Calcule les groupes.
 *  mode 'spool' : une ligne par bobine choisie ; les besoins sans bobine forment le bloc « intents »
 *  mode 'ref'   : une ligne par matière + couleur ; stock = toutes les bobines actives de cette référence ;
 *                 les besoins sans bobine y sont fondus
 */
function compute(projects, mode, marginPct) {
  const factor = 1 + (marginPct || 0) / 100;
  const groups = new Map();
  const intents = new Map();
  const unassigned = { need: 0, projects: new Map() };

  const addProject = (g, p, grams) => {
    const k = p.code || p.name;
    g.projects.set(k, { name: p.name, grams: (g.projects.get(k)?.grams || 0) + grams });
  };
  const refKey = (material, color) => 'r:' + norm(material) + '|' + norm(color);
  const ensureRef = (material, color) => {
    const k = refKey(material, color);
    if (!groups.has(k)) {
      groups.set(k, { key: k, kind: 'ref', material: clean(material), color: clean(color),
        need: 0, projects: new Map(), brands: new Set(), hex: null, spools: [] });
    }
    return groups.get(k);
  };

  for (const p of projects) {
    for (const part of p.parts) {
      if (part.status === 'imprime') continue;
      const qty = part.quantity || 0;
      const fils = part.filaments || [];
      for (const f of fils) {
        const w = Number(f.weight_g) || 0;
        if (!(w > 0) || !qty) continue;
        const grams = w * qty * factor;
        const spool = f.filament_id ? store.filamentsById.get(f.filament_id) : null;
        const material = f.material || (fils.length === 1 ? part.material : null) || spool?.material;
        const color = f.color_name || (fils.length === 1 ? part.color_name : null) || spool?.color_name;

        if (spool && mode === 'spool') {
          const k = 'f:' + spool.id;
          if (!groups.has(k)) groups.set(k, { key: k, kind: 'spool', spool, need: 0, projects: new Map() });
          const g = groups.get(k); g.need += grams; addProject(g, p, grams);
        } else if (spool || norm(material) || norm(color)) {
          if (mode === 'ref') {
            const g = ensureRef(spool ? spool.material : material, spool ? spool.color_name : color);
            g.need += grams; addProject(g, p, grams);
          } else {
            const k = refKey(material, color);
            if (!intents.has(k)) intents.set(k, { key: k, material: clean(material), color: clean(color), need: 0, projects: new Map() });
            const g = intents.get(k); g.need += grams; addProject(g, p, grams);
          }
        } else {
          unassigned.need += grams; addProject(unassigned, p, grams);
        }
      }
    }
  }

  const active = store.filaments.filter(f => !f.archived);
  const matching = (material, color) => active.filter(s =>
    (!norm(material) || norm(s.material) === norm(material)) && (!norm(color) || norm(s.color_name) === norm(color)));

  // Stock et manque
  for (const g of groups.values()) {
    if (g.kind === 'spool') {
      g.stock = g.spool.weight_remaining !== null ? Number(g.spool.weight_remaining) : 0;
      g.unit = Number(g.spool.weight_total) || 1000;
    } else {
      g.spools = matching(g.material, g.color);
      g.stock = g.spools.reduce((s, x) => s + (Number(x.weight_remaining) || 0), 0);
      g.spools.forEach(x => x.brand && g.brands.add(clean(x.brand)));
      g.hex = g.spools[0]?.color_hex || store.filaments.find(x => norm(x.color_name) === norm(g.color))?.color_hex || null;
      const units = g.spools.map(x => Number(x.weight_total)).filter(Boolean);
      g.unit = units.length ? Math.max(...units) : 1000;
    }
    g.balance = g.stock - g.need;
    g.deficit = Math.max(0, -g.balance);
  }

  // Besoins sans bobine (mode bobine) : comparés au stock « libre » des bobines de même matière / couleur
  const spoolNeeds = new Map();
  for (const g of groups.values()) if (g.kind === 'spool') spoolNeeds.set(g.spool.id, g.need);
  for (const g of intents.values()) {
    const ss = matching(g.material, g.color);
    g.matchCount = ss.length;
    g.free = Math.max(0, ss.reduce((s, x) => s + Math.max(0, (Number(x.weight_remaining) || 0) - (spoolNeeds.get(x.id) || 0)), 0));
    g.deficit = Math.max(0, g.need - g.free);
    g.hex = ss[0]?.color_hex || store.filaments.find(x => norm(x.color_name) === norm(g.color))?.color_hex || null;
    const units = ss.map(x => Number(x.weight_total)).filter(Boolean);
    g.unit = units.length ? Math.max(...units) : 1000;
  }

  const byDeficit = (a, b) => (b.deficit > 0) - (a.deficit > 0) || b.deficit - a.deficit || b.need - a.need;
  return {
    rows: [...groups.values()].sort(byDeficit),
    intents: [...intents.values()].sort(byDeficit),
    unassigned,
  };
}

const projectsCell = g => {
  const list = [...g.projects.entries()].sort((a, b) => collator.compare(a[0], b[0]));
  const tip = list.map(([code, v]) => `${code} ${v.name} : ${formatWeight(v.grams)}`).join('\n');
  return `<span class="has-tip cell-code" title="${escapeHtml(tip)}">${escapeHtml(list.map(([c]) => c).join(', '))}</span>`;
};

export async function renderNeeds(el) {
  document.title = 'Besoins — PrepFlow';
  const [projectsAll, settings] = await Promise.all([api.get('projects'), api.get('settings')]);
  const margin = parseInt(settings.needs_margin, 10) || 0;

  // Sélection : mémorisée, sinon projets en préparation et en cours
  let selected = new Set(readJSON(SEL_KEY, null) ?? projectsAll.filter(p => ['preparation', 'en_cours'].includes(p.status)).map(p => p.id));
  selected = new Set([...selected].filter(id => projectsAll.some(p => p.id === id)));
  let mode = readJSON(MODE_KEY, 'spool') === 'ref' ? 'ref' : 'spool';
  let last = null;   // dernier calcul (export CSV)

  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Besoins</h1>
      <div class="page-actions">
        <div class="segmented" role="group" aria-label="Regroupement">
          <button type="button" data-mode="spool">Par bobine</button>
          <button type="button" data-mode="ref">Par référence</button>
        </div>
        <button class="btn" id="needs-refresh" title="Relire le stock dans FilaFlow">Actualiser le stock</button>
        <button class="btn" id="needs-csv">Exporter CSV</button>
      </div>
    </div>
    <p class="page-sub">Filament nécessaire pour les pièces non imprimées des projets cochés, marge de sécurité de
      <strong>${margin} %</strong> comprise (<a href="#/parametres">modifier</a>), comparé au stock pesé dans FilaFlow.</p>
    <div class="needs-layout">
      <aside class="needs-projects" aria-label="Projets pris en compte">
        <div class="needs-quick">
          <button type="button" class="link-btn" data-pick="all">Tous</button>
          <button type="button" class="link-btn" data-pick="none">Aucun</button>
          <button type="button" class="link-btn" data-pick="active">En préparation et en cours</button>
        </div>
        <div class="needs-list">
          ${projectsAll.length ? projectsAll.map(p => `
            <label class="needs-item">
              <input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
              <span class="cell-code">${escapeHtml(p.code || '')}</span>
              <span class="needs-name">${escapeHtml(p.name)}</span>
              <span class="pill pill-${p.status}">${PROJECT_STATUS[p.status]}</span>
            </label>`).join('') : '<p class="muted">Aucun projet.</p>'}
        </div>
      </aside>
      <section class="needs-result" id="needs-result" aria-live="polite"></section>
    </div>`;

  const result = el.querySelector('#needs-result');
  let cache = new Map();          // projets déjà chargés (id → projet avec pièces)

  const updateModeButtons = () => el.querySelectorAll('[data-mode]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  });

  async function refresh() {
    const ids = [...selected];
    writeJSON(SEL_KEY, ids);
    if (!ids.length) { result.innerHTML = '<p class="muted">Cochez au moins un projet.</p>'; last = null; return; }
    const missing = ids.filter(id => !cache.has(id));
    if (missing.length) {
      result.innerHTML = '<p class="loading">Calcul…</p>';
      const loaded = await api.get('needs?ids=' + missing.join(','));
      loaded.forEach(p => cache.set(p.id, p));
    }
    const projects = ids.map(id => cache.get(id)).filter(Boolean);
    last = compute(projects, mode, margin);
    draw(last, projects.length);
  }

  function draw(r, nProjects) {
    const short = r.rows.filter(g => g.deficit > 0).length + r.intents.filter(g => g.deficit > 0).length;
    const totalNeed = r.rows.reduce((s, g) => s + g.need, 0) + r.intents.reduce((s, g) => s + g.need, 0) + r.unassigned.need;
    const totalDeficit = r.rows.reduce((s, g) => s + g.deficit, 0) + r.intents.reduce((s, g) => s + g.deficit, 0);

    const nameCell = g => g.kind === 'spool'
      ? `${swatch(g.spool.color_hex)}<span class="spool-name">${escapeHtml(filamentLabel(g.spool))}</span>
         <div class="needs-sub">${escapeHtml([g.spool.material, g.spool.brand].filter(Boolean).join(' · '))}${g.spool.archived ? ' · archivée' : ''}</div>`
      : `${swatch(g.hex)}<span class="spool-name">${escapeHtml([g.material, g.color].filter(Boolean).join(' ') || 'Sans matière ni couleur')}</span>
         <div class="needs-sub">${g.spools.length ? `${g.spools.length} bobine${g.spools.length > 1 ? 's' : ''} en stock${g.brands.size ? ' · ' + escapeHtml([...g.brands].join(', ')) : ''}` : 'aucune bobine en stock'}</div>`;

    const rowHtml = g => `
      <tr class="${g.deficit > 0 ? 'is-short' : ''}">
        <td>${nameCell(g)}</td>
        <td class="num">${formatWeight(g.need)}</td>
        <td class="num">${formatWeight(g.stock) || '0 g'}</td>
        <td class="num ${g.balance < 0 ? 'neg' : 'pos'}">${g.balance < 0 ? '−' : ''}${formatWeight(Math.abs(g.balance)) || '0 g'}</td>
        <td class="num">${g.deficit > 0 ? `<strong>${formatWeight(g.deficit)}</strong><div class="needs-sub">${spoolsToBuy(g.deficit, g.unit)}</div>` : '<span class="ok">—</span>'}</td>
        <td>${projectsCell(g)}</td>
      </tr>`;

    const head = `<thead><tr><th>${mode === 'spool' ? 'Bobine' : 'Référence (matière + couleur)'}</th>
      <th class="num">Besoin</th><th class="num">Stock</th><th class="num">Solde</th><th class="num">À commander</th><th>Projets</th></tr></thead>`;

    result.innerHTML = `
      <div class="needs-summary ${short ? 'has-short' : ''}">
        ${short
          ? `<strong>${short} ${mode === 'spool' ? 'ligne' : 'référence'}${short > 1 ? 's' : ''} à commander</strong> · ${formatWeight(totalDeficit)} manquants`
          : '<strong>Le stock suffit</strong> pour les projets cochés'}
        <span class="muted"> · ${nProjects} projet${nProjects > 1 ? 's' : ''} · besoin total ${formatWeight(totalNeed) || '0 g'}</span>
      </div>
      ${r.rows.length ? `<div class="table-wrap"><table class="list-table needs-table">${head}
        <tbody>${r.rows.map(rowHtml).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${formatWeight(r.rows.reduce((s, g) => s + g.need, 0))}</td><td></td><td></td>
          <td class="num">${formatWeight(r.rows.reduce((s, g) => s + g.deficit, 0)) || '—'}</td><td></td></tr></tfoot>
      </table></div>` : '<p class="muted">Aucune bobine choisie dans ces projets.</p>'}
      ${r.intents.length ? `
        <h2 class="panel-title needs-block-title">À choisir ou à acheter</h2>
        <p class="panel-sub">Filament souhaité (matière / couleur) sans bobine choisie. Le stock « libre » est ce qui reste sur les bobines de
          même matière et couleur une fois leurs propres besoins déduits.</p>
        <div class="table-wrap"><table class="list-table needs-table">
          <thead><tr><th>Matière + couleur</th><th class="num">Besoin</th><th class="num">Stock libre</th><th class="num">À commander</th><th>Projets</th></tr></thead>
          <tbody>${r.intents.map(g => `
            <tr class="${g.deficit > 0 ? 'is-short' : ''}">
              <td>${swatch(g.hex)}<span class="spool-name">${escapeHtml([g.material, g.color].filter(Boolean).join(' '))}</span>
                <div class="needs-sub">${g.matchCount ? `${g.matchCount} bobine${g.matchCount > 1 ? 's' : ''} correspondante${g.matchCount > 1 ? 's' : ''}` : 'aucune bobine correspondante'}</div></td>
              <td class="num">${formatWeight(g.need)}</td>
              <td class="num">${formatWeight(g.free) || '0 g'}</td>
              <td class="num">${g.deficit > 0 ? `<strong>${formatWeight(g.deficit)}</strong><div class="needs-sub">${spoolsToBuy(g.deficit, g.unit)}</div>` : '<span class="ok">—</span>'}</td>
              <td>${projectsCell(g)}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${r.unassigned.need ? `<p class="version-warn">${formatWeight(r.unassigned.need)} de filament sans bobine, matière ni couleur
        (${escapeHtml([...r.unassigned.projects.keys()].join(', '))}) : non pris en compte dans les commandes.</p>` : ''}`;
  }

  function exportCsv() {
    if (!last) return toast('Rien à exporter', 'error');
    const num = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Type', 'Bobine / référence', 'Matière', 'Couleur', 'Marque', 'N° bobine',
      'Besoin (g)', 'Stock (g)', 'Solde (g)', 'À commander (g)', 'Estimation', 'Projets'].map(q).join(';')];
    for (const g of last.rows) {
      const s = g.spool;
      lines.push([
        g.kind === 'spool' ? 'Bobine' : 'Référence',
        g.kind === 'spool' ? s.name : [g.material, g.color].filter(Boolean).join(' '),
        g.kind === 'spool' ? s.material : g.material,
        g.kind === 'spool' ? s.color_name : g.color,
        g.kind === 'spool' ? s.brand : [...g.brands].join(', '),
        g.kind === 'spool' ? s.spool_number : '',
      ].map(q).concat([num(g.need), num(g.stock), num(g.balance), num(g.deficit)],
        [q(spoolsToBuy(g.deficit, g.unit)), q([...g.projects.keys()].join(', '))]).join(';'));
    }
    for (const g of last.intents) {
      lines.push([q('Sans bobine'), q([g.material, g.color].filter(Boolean).join(' ')), q(g.material), q(g.color), q(''), q(''),
        num(g.need), num(g.free), num(g.free - g.need), num(g.deficit), q(spoolsToBuy(g.deficit, g.unit)),
        q([...g.projects.keys()].join(', '))].join(';'));
    }
    // Séparateur « ; » et BOM UTF-8 : ouverture directe dans Excel en français
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `prepflow-besoins-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Événements
  el.querySelectorAll('.needs-item input').forEach(cb => cb.addEventListener('change', () => {
    cb.checked ? selected.add(+cb.value) : selected.delete(+cb.value);
    refresh().catch(e => toast(e.message, 'error'));
  }));
  el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
    const pick = b.dataset.pick;
    selected = new Set(pick === 'all' ? projectsAll.map(p => p.id)
      : pick === 'none' ? [] : projectsAll.filter(p => ['preparation', 'en_cours'].includes(p.status)).map(p => p.id));
    el.querySelectorAll('.needs-item input').forEach(cb => { cb.checked = selected.has(+cb.value); });
    refresh().catch(e => toast(e.message, 'error'));
  }));
  el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode; writeJSON(MODE_KEY, mode); updateModeButtons();
    refresh().catch(e => toast(e.message, 'error'));
  }));
  el.querySelector('#needs-refresh').addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const data = await store.loadFilaments({ refresh: true });
      cache = new Map();
      await refresh();
      toast(data.online ? 'Stock relu depuis FilaFlow' : 'FilaFlow ne répond pas : dernière copie utilisée', data.online ? 'info' : 'error');
    } catch (err) { toast(err.message, 'error'); }
    finally { e.target.disabled = false; }
  });
  el.querySelector('#needs-csv').addEventListener('click', exportCsv);

  updateModeButtons();
  await refresh();
}
