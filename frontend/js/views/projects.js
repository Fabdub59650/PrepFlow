import { api } from '../api.js';
import { toast, promptDialog } from '../ui.js';
import { PROJECT_STATUS, formatDuration, formatWeight, formatDate, escapeHtml } from '../format.js';
import { themeChipsHtml } from '../themes.js';

let showArchived = false;

// ── Tri par les en-têtes (mémorisé dans le navigateur) ─────────────
const SORT_KEY = 'prepflow_projects_sort';
const STATUS_ORDER = { preparation: 0, en_cours: 1, termine: 2, archive: 3 };
const progress = p => (p.pieces_count ? p.pieces_done / p.pieces_count : null);
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const COLUMNS = [
  { key: 'code',     label: 'Code',        value: p => p.code, text: true },
  { key: 'name',     label: 'Projet',      value: p => p.name, text: true },
  { key: 'themes',   label: 'Thèmes',      sortable: false },
  { key: 'status',   label: 'Statut',      value: p => STATUS_ORDER[p.status] },
  { key: 'created',  label: 'Créé le',     value: p => (p.created_at ? new Date(String(p.created_at).replace(' ', 'T')).getTime() : null), num: true },
  { key: 'pieces',   label: 'Pièces',      value: p => p.pieces_count, num: true },
  { key: 'spools',   label: 'Bobines',     value: p => p.spools_count, num: true },
  { key: 'time',     label: 'Temps total', value: p => p.total_time_s, num: true },
  { key: 'weight',   label: 'Poids total', value: p => p.total_weight_g, num: true },
  { key: 'progress', label: 'Avancement',  value: progress },
];

function readSort() {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    if (s && COLUMNS.some(c => c.key === s.key) && (s.dir === 'asc' || s.dir === 'desc')) return s;
  } catch (_) {}
  return null;     // ordre du serveur : en cours d'abord, puis les plus récents
}
function writeSort(s) {
  try { s ? localStorage.setItem(SORT_KEY, JSON.stringify(s)) : localStorage.removeItem(SORT_KEY); } catch (_) {}
}

// ── Filtre par thèmes (identifiants, mémorisé dans le navigateur) ──
const THEME_KEY = 'prepflow_projects_themes';
function readThemeFilter() {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_KEY) || '[]');
    return Array.isArray(v) ? v.filter(Number.isInteger) : [];
  } catch (_) { return []; }
}
function writeThemeFilter(set) {
  try { set.size ? localStorage.setItem(THEME_KEY, JSON.stringify([...set])) : localStorage.removeItem(THEME_KEY); } catch (_) {}
}

function sortProjects(list, sort) {
  if (!sort) return list;
  const col = COLUMNS.find(c => c.key === sort.key);
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    // Valeurs absentes (avancement d'un projet vide…) toujours en fin de liste
    if (va === null || va === undefined) return (vb === null || vb === undefined) ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    const cmp = col.text ? collator.compare(va, vb) : va - vb;
    return cmp * dir || collator.compare(a.name, b.name);
  });
}

export async function renderProjects(el) {
  document.title = 'Projets — PrepFlow';
  const projects = await api.get('projects' + (showArchived ? '?archived=1' : ''));

  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Projets</h1>
      <div class="page-actions">
        <label class="toggle"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}> Afficher les archivés</label>
        <button class="btn btn-primary" id="new-project">Nouveau projet</button>
      </div>
    </div>
    <div id="projects-body"></div>`;

  const body = el.querySelector('#projects-body');
  let sort = readSort();

  // Thèmes présents dans les projets affichés, avec leur nombre de projets
  const themeMap = new Map();
  for (const p of projects) for (const t of p.themes || []) {
    if (!themeMap.has(t.id)) themeMap.set(t.id, { ...t, count: 0 });
    themeMap.get(t.id).count++;
  }
  const themeList = [...themeMap.values()].sort((a, b) => collator.compare(a.name, b.name));
  // Un thème qui n'existe plus (ou dont les projets sont archivés) est retiré du filtre mémorisé
  const selected = new Set(readThemeFilter().filter(id => themeMap.has(id)));

  const drawTable = () => {
    // Filtre « ET » : le projet doit porter tous les thèmes sélectionnés
    const visible = projects.filter(p => [...selected].every(id => (p.themes || []).some(t => t.id === id)));
    const rows = sortProjects(visible, sort);
    const th = c => {
      if (c.sortable === false) return `<th>${c.label}</th>`;
      const active = sort && sort.key === c.key;
      const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      return `<th class="${c.num ? 'num' : ''}" aria-sort="${aria}">
        <button type="button" class="th-sort ${active ? 'is-active' : ''}" data-sort="${c.key}">
          ${c.label}<span class="sort-arrow" aria-hidden="true">${arrow}</span></button></th>`;
    };
    const filterBar = themeList.length ? `
      <div class="theme-filter" role="group" aria-label="Filtrer par thème">
        <span class="theme-label">Thèmes</span>
        ${themeList.map(t => `<button type="button" class="theme-chip is-btn ${selected.has(t.id) ? 'is-active' : ''}"
          data-theme-toggle="${t.id}" aria-pressed="${selected.has(t.id)}">${escapeHtml(t.name)}<span class="theme-count">${t.count}</span></button>`).join('')}
        ${selected.size ? '<button type="button" class="link-btn" id="clear-themes">Effacer le filtre</button>' : ''}
      </div>` : '';
    body.innerHTML = filterBar + (!rows.length ? `
      <div class="empty-state">
        <p>Aucun projet ne porte ${selected.size > 1 ? 'tous ces thèmes' : 'ce thème'}.</p>
      </div>` : `
      <div class="table-wrap">
      <table class="list-table">
        <thead><tr>${COLUMNS.map(th).join('')}</tr></thead>
        <tbody>
        ${rows.map(p => {
          const pct = p.pieces_count ? Math.round(100 * p.pieces_done / p.pieces_count) : 0;
          return `<tr data-id="${p.id}">
            <td class="cell-code">${escapeHtml(p.code || '—')}</td>
            <td><a href="#/projet/${p.id}" class="row-link">${escapeHtml(p.name)}</a></td>
            <td class="cell-themes">${themeChipsHtml(p.themes || [], selected)}</td>
            <td><span class="pill pill-${p.status}">${PROJECT_STATUS[p.status]}</span></td>
            <td class="num" title="${escapeHtml(formatDate(p.created_at, { withTime: true }))}">${formatDate(p.created_at) || '—'}</td>
            <td class="num">${p.pieces_count}</td>
            <td class="num">${p.spools_count
              ? `<span class="has-tip" title="${escapeHtml(p.spools_names || '')}">${p.spools_count}</span>` : '—'}</td>
            <td class="num">${p.total_time_s ? formatDuration(p.total_time_s) : '—'}</td>
            <td class="num">${p.total_weight_g ? formatWeight(p.total_weight_g) : '—'}</td>
            <td><div class="progress" title="${p.pieces_done} / ${p.pieces_count} pièces imprimées">
                  <div class="progress-bar" style="width:${pct}%"></div></div>
                <span class="progress-label">${p.pieces_done} / ${p.pieces_count}</span></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      </div>`) + (sort ? '<button type="button" class="link-btn" id="reset-sort">Revenir à l\'ordre par défaut</button>' : '');

    body.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('a, button')) return;
        location.hash = `#/projet/${tr.dataset.id}`;
      });
    });
    body.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      // 1er clic : croissant (décroissant pour l'avancement), 2e clic : inverse
      const first = key === 'progress' ? 'desc' : 'asc';
      sort = sort && sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: first };
      writeSort(sort);
      drawTable();
    }));
    body.querySelectorAll('[data-theme-toggle]').forEach(btn => btn.addEventListener('click', () => {
      const id = Number(btn.dataset.themeToggle);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      writeThemeFilter(selected);
      drawTable();
    }));
    body.querySelector('#clear-themes')?.addEventListener('click', () => {
      selected.clear(); writeThemeFilter(selected); drawTable();
    });
    body.querySelector('#reset-sort')?.addEventListener('click', () => {
      sort = null; writeSort(null); drawTable();
    });
  };

  if (!projects.length) {
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Aucun projet pour l'instant</p>
        <p>Un projet regroupe les pièces à imprimer, avec leur filament, leur temps et leur poids.</p>
        <button class="btn btn-primary" data-new>Créer le premier projet</button>
      </div>`;
  } else {
    drawTable();
  }

  const create = async () => {
    const name = await promptDialog('Nouveau projet', 'Nom du projet');
    if (!name) return;
    try {
      const p = await api.post('projects', { name });
      location.hash = `#/projet/${p.id}`;
    } catch (e) { toast(e.message, 'error'); }
  };
  el.querySelector('#new-project').addEventListener('click', create);
  el.querySelector('[data-new]')?.addEventListener('click', create);
  el.querySelector('#show-archived').addEventListener('change', e => {
    showArchived = e.target.checked;
    renderProjects(el);
  });
}
