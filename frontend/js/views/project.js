import { api } from '../api.js';
import { store } from '../store.js';
import { toast, confirmDialog, openDialog } from '../ui.js';
import {
  PART_STATUS, PROJECT_STATUS, parseDuration, formatDuration, durationToInput,
  formatWeight, formatMoney, formatDate, escapeHtml, filamentLabel, swatch,
} from '../format.js';
import { derivePart, summarize } from '../summary.js';

/* ── Données d'une ligne ───────────────────────────────────────── */

// Ajoute à la pièce les champs calculés affichés dans le tableau
function toRow(part) {
  const d = derivePart(part, store.filamentsById);
  const first = part.filaments[0] || null;
  return {
    ...part,
    filament_id: part.filaments.length <= 1 ? (first ? first.filament_id : null) : '__multi',
    unit_weight: d.unit_weight,
    total_weight: d.total_weight,
    total_time: d.total_time,
    cost: d.cost,
    cost_complete: d.cost_complete,
  };
}

const fromRow = row => ({ ...row }); // les champs calculés sont ignorés par l'API

/* ── Éditeurs de cellule ───────────────────────────────────────── */

// Champ texte libre avec analyse de la saisie (temps, poids décimal à virgule)
function parsedEditor(parse, toInput) {
  return function (cell, onRendered, success, cancel) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-input';
    input.value = toInput(cell.getValue());
    onRendered(() => { input.focus(); input.select(); });
    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      const v = parse(input.value);
      if (Number.isNaN(v)) {
        toast(`Saisie non reconnue : « ${input.value} »`, 'error');
        cancel();
      } else success(v);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { finished = true; cancel(); }
    });
    return input;
  };
}

const parseWeight = s => {
  const t = String(s ?? '').trim().replace(',', '.').replace(/\s*g$/i, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const weightToInput = v => (v === null || v === undefined ? '' : String(v).replace('.', ','));

// Comparaison des noms de couleur : sans tenir compte des majuscules ni des espaces en trop
const normColor = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');

const matches = (f, material, color) =>
  (!normColor(material) || normColor(f.material) === normColor(material)) &&
  (!normColor(color) || normColor(f.color_name) === normColor(color));

function filamentOptions(currentIds = [], color = null, material = null) {
  // Bobines actives de la matière et de la couleur choisies (filtres facultatifs)
  // + celles déjà utilisées (même archivées) pour ne pas les perdre
  return store.filaments
    .filter(f => currentIds.includes(f.id) || (!f.archived && matches(f, material, color)))
    .map(f => ({ label: filamentLabel(f), value: f.id, f }));
}

// Valeurs distinctes d'un champ des bobines actives, avec le nombre de bobines.
// Écritures différentes d'une même valeur (« PLA », « pla ») regroupées ;
// celle qui commence par une majuscule est préférée.
function distinctValues(field, filaments, current) {
  const byKey = new Map();
  for (const f of filaments) {
    const k = normColor(f[field]);
    if (!k) continue;
    const label = f[field].trim().replace(/\s+/g, ' ');
    if (!byKey.has(k)) byKey.set(k, { label, hex: f.color_hex, count: 0 });
    const entry = byKey.get(k);
    if (entry.label[0] === entry.label[0].toLocaleLowerCase('fr') && label[0] !== label[0].toLocaleLowerCase('fr')) entry.label = label;
    entry.count++;
  }
  if (current && !byKey.has(normColor(current))) byKey.set(normColor(current), { label: current, hex: null, count: 0 });
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function materialOptions(current) {
  const list = distinctValues('material', store.filaments.filter(f => !f.archived), current);
  return [{ label: 'Aucune (toutes les matières)', value: '' },
    ...list.map(x => ({ label: x.label, value: x.label, count: x.count }))];
}

function materialItemFormatter(label, value, item) {
  if (!value) return `<span class="muted">${escapeHtml(label)}</span>`;
  const n = item.count;
  return `<span class="opt-color"><span>${escapeHtml(label)}</span>`
    + `<span class="opt-stock">${n ? `${n} bobine${n > 1 ? 's' : ''}` : 'aucune bobine'}</span></span>`;
}

// Couleurs distinctes des bobines actives (champ « nom couleur » de FilaFlow),
// limitées à la matière choisie s'il y en a une
function colorOptions(current, material = null) {
  const pool = store.filaments.filter(f => !f.archived && matches(f, material, null));
  const list = distinctValues('color_name', pool, current);
  return [{ label: 'Aucune (toutes les bobines)', value: '' },
    ...list.map(x => ({ label: x.label, value: x.label, hex: x.hex, count: x.count }))];
}

function colorItemFormatter(label, value, item) {
  if (!value) return `<span class="muted">${escapeHtml(label)}</span>`;
  const n = item.count;
  return `<span class="opt-color">${swatch(item.hex)}<span>${escapeHtml(label)}</span>`
    + `<span class="opt-stock">${n ? `${n} bobine${n > 1 ? 's' : ''}` : 'aucune bobine'}</span></span>`;
}

// Pastille d'une couleur : celle d'une bobine portant ce nom de couleur
function colorHex(name) {
  const k = normColor(name);
  const f = k && store.filaments.find(x => normColor(x.color_name) === k);
  return f ? f.color_hex : null;
}

function filamentItemFormatter(label, value, item) {
  const f = item.f;
  if (!f) return escapeHtml(label);
  const stock = f.weight_remaining !== null ? formatWeight(Number(f.weight_remaining)) : '';
  return `<span class="opt-filament">${swatch(f.color_hex)}<span class="opt-name">${escapeHtml(label)}</span>`
    + `<span class="opt-meta">${escapeHtml(f.brand || '')}${f.archived ? ' (archivée)' : ''}</span>`
    + `<span class="opt-stock">${stock}</span></span>`;
}

/* ── Formatteurs ───────────────────────────────────────────────── */

function formatFilamentCell(cell) {
  const row = cell.getRow().getData();
  const fils = row.filaments || [];
  if (!fils.length) return '<span class="muted">Choisir…</span>';
  if (fils.length > 1) {
    return `<span class="multi">${fils.map(f => swatch(store.filamentsById.get(f.filament_id)?.color_hex || colorHex(f.color_name))).join('')}`
      + `<span>${fils.length} filaments</span></span>`;
  }
  const f = store.filamentsById.get(fils[0].filament_id);
  if (!f) return fils[0].filament_id ? '<span class="muted">Filament inconnu</span>' : '<span class="muted">Choisir…</span>';
  return `${swatch(f.color_hex)}<span class="cell-filament">${escapeHtml(filamentLabel(f))}</span>`
    + (f.archived ? ' <span class="tag">archivée</span>' : '');
}

const fmtStatus = cell =>
  `<span class="pill pill-${cell.getValue()}">${PART_STATUS[cell.getValue()] || ''}</span>`;

/* ── Tri d'affichage par les en-têtes ──────────────────────────── */
// L'ordre manuel (sort_order, glisser-déposer) n'est pas modifié par le tri :
// trier ne fait que réordonner l'affichage. « Garder cet ordre » l'enregistre.

const sortCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const PART_STATUS_ORDER = { a_trancher: 0, pret: 1, en_cours: 2, imprime: 3 };
const firstFil = r => (r.filaments && r.filaments[0]) ? store.filamentsById.get(r.filaments[0].filament_id) : null;

const PART_SORTS = {
  name:         { label: 'Pièce',       text: true, get: r => r.name },
  file_name:    { label: 'Fichier',     text: true, get: r => r.file_name },
  quantity:     { label: 'Qté',                     get: r => r.quantity },
  printer_id:   { label: 'Imprimante',  text: true, get: r => store.printers.find(p => p.id === r.printer_id)?.name },
  material:     { label: 'Matière',     text: true, get: r => r.material || firstFil(r)?.material || (r.filaments || []).find(f => f.material)?.material },
  color_name:   { label: 'Couleur',     text: true, get: r => r.color_name || firstFil(r)?.color_name || (r.filaments || []).find(f => f.color_name)?.color_name },
  filament_id:  { label: 'Filament',    text: true, get: r => { const f = firstFil(r); return f ? filamentLabel(f) : null; } },
  unit_weight:  { label: 'Poids unit.',             get: r => r.unit_weight },
  print_time_s: { label: 'Temps unit.',             get: r => r.print_time_s },
  total_weight: { label: 'Poids total',             get: r => r.total_weight },
  total_time:   { label: 'Temps total',             get: r => r.total_time },
  cost:         { label: 'Coût',                    get: r => r.cost },
  status:       { label: 'Statut',                  get: r => PART_STATUS_ORDER[r.status] },
  notes:        { label: 'Notes',       text: true, get: r => r.notes },
};

const isEmptySortValue = v => v === null || v === undefined || (typeof v === 'string' && !v.trim());

function sortParts(rows, sort) {
  if (!sort || !PART_SORTS[sort.field]) {
    return [...rows].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  }
  const def = PART_SORTS[sort.field];
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = def.get(a), vb = def.get(b);
    const ea = isEmptySortValue(va), eb = isEmptySortValue(vb);
    if (ea || eb) return ea && eb ? (a.sort_order - b.sort_order) : (ea ? 1 : -1);   // vides toujours en fin
    const cmp = def.text ? sortCollator.compare(String(va), String(vb)) : (va - vb);
    return (cmp * dir) || (a.sort_order - b.sort_order);
  });
}

/* ── Vue ───────────────────────────────────────────────────────── */

// En-tête fixe : classe is-stuck quand il colle sous la barre du haut,
// et hauteur exposée (--head-h) pour placer la barre d'outils du tableau juste dessous
function initStickyHead(root, head) {
  const sentinel = root.querySelector('.sticky-sentinel');
  if (!head || !sentinel) return () => {};
  const io = new IntersectionObserver(([e]) => head.classList.toggle('is-stuck', !e.isIntersecting),
    { rootMargin: '-56px 0px 0px 0px' });
  io.observe(sentinel);
  // Hauteur réelle (bordure comprise) mesurée à chaque changement de taille de l'en-tête
  const ro = new ResizeObserver(() => root.style.setProperty('--head-h', head.getBoundingClientRect().height + 'px'));
  ro.observe(head);
  return () => { io.disconnect(); ro.disconnect(); };
}

// Hauteur maximale du tableau : en-tête + 10 lignes + ligne de totaux
const GRID_ROW_H = 39, GRID_HEADER_H = 36, GRID_FOOTER_H = 40;
const GRID_MAX_HEIGHT = (GRID_HEADER_H + 10 * GRID_ROW_H + GRID_FOOTER_H + 2) + 'px';

export async function renderProject(el, id) {
  const project = await api.get(`projects/${id}`);
  document.title = `${project.code ? project.code + ' · ' : ''}${project.name} — PrepFlow`;

  el.innerHTML = `
    <div class="sticky-sentinel" aria-hidden="true"></div>
    <div class="project-head">
      <a href="#/" class="back-link">Projets</a>
      <div class="project-title-row">
        ${project.code ? `<span class="project-code" title="Code du projet, à utiliser comme nom de dossier">
          <span id="project-code">${escapeHtml(project.code)}</span>
          <button type="button" class="icon-btn" id="copy-code" aria-label="Copier le code ${escapeHtml(project.code)}" title="Copier le code">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="9" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-6A1.5 1.5 0 0 0 4 4.5v8A1.5 1.5 0 0 0 5.5 14H7"/></svg>
          </button></span>` : ''}
        <input class="project-name" id="project-name" value="${escapeHtml(project.name)}" aria-label="Nom du projet" maxlength="150">
        <div class="page-actions">
          <select id="project-status" class="select" aria-label="Statut du projet">
            ${Object.entries(PROJECT_STATUS).map(([k, v]) =>
              `<option value="${k}" ${k === project.status ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <button class="btn" id="refresh-stock" title="Relire le stock dans FilaFlow">Actualiser le stock</button>
          <button class="btn btn-ghost-danger" id="delete-project">Supprimer le projet</button>
        </div>
      </div>
      <p class="project-dates">Créé le ${formatDate(project.created_at, { withTime: true })}
        ${project.updated_at && project.updated_at !== project.created_at ? ` · modifié le ${formatDate(project.updated_at, { withTime: true })}` : ''}</p>
      <details class="project-notes" ${project.notes ? 'open' : ''}>
        <summary>Notes du projet</summary>
        <textarea id="project-notes" rows="3" placeholder="Contexte, contraintes, idées…">${escapeHtml(project.notes || '')}</textarea>
      </details>
    </div>

    <div id="stock-alert"></div>
    <section class="figures" id="figures" aria-label="Totaux du projet"></section>

    <div class="grid-sticky">
    <div class="grid-toolbar">
      <button class="btn btn-primary" id="add-part">Ajouter une pièce</button>
      <button class="btn" id="replace-spool" title="Remplacer une bobine par une autre dans tout le projet">Remplacer une bobine</button>
      <label class="filter-box"><span class="sr-only">Filtrer les pièces par bobine</span>
        <select class="select" id="spool-filter" aria-label="Filtrer les pièces par bobine"></select></label>
      <span class="filter-status" id="filter-status" hidden></span>
      <span class="hint" id="grid-hint">Cliquez une cellule pour la modifier, un en-tête pour trier. Temps : « 1h25 », « 45m » ou « 1:25 ». Glissez la poignée pour réordonner.</span>
      <span class="sort-bar" id="sort-bar" hidden></span>
    </div>
    <div class="bulk-bar" id="bulk-bar" hidden></div>
    </div>
    <div id="parts-grid" class="parts-grid"></div>

    <section class="panels">
      <div class="panel">
        <h2 class="panel-title">Bobines nécessaires</h2>
        <p class="panel-sub">Besoin des pièces non imprimées, comparé au poids restant pesé dans FilaFlow.</p>
        <div id="spools"></div>
      </div>
      <div class="panel">
        <h2 class="panel-title">Temps par imprimante</h2>
        <div id="printers-load"></div>
      </div>
    </section>`;

  /* En-tête fixe : compacté une fois collé sous la barre du haut */
  const stopSticky = initStickyHead(el, el.querySelector('.project-head'));

  /* Copie du code projet (nom de dossier) */
  el.querySelector('#copy-code')?.addEventListener('click', async () => {
    const code = project.code;
    try {
      await navigator.clipboard.writeText(code);
    } catch (_) {
      // Secours si le presse-papiers n'est pas accessible
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (__) {}
      ta.remove();
    }
    toast(`Code ${code} copié`);
  });

  /* En-tête du projet */
  const saveProject = async body => {
    try { await api.put(`projects/${id}`, body); }
    catch (e) { toast(e.message, 'error'); }
  };
  const nameInput = el.querySelector('#project-name');
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (!v) { nameInput.value = project.name; return; }
    project.name = v;
    document.title = `${project.code ? project.code + ' · ' : ''}${v} — PrepFlow`;
    saveProject({ name: v });
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });
  el.querySelector('#project-status').addEventListener('change', e => saveProject({ status: e.target.value }));
  el.querySelector('#project-notes').addEventListener('change', e => saveProject({ notes: e.target.value }));
  el.querySelector('#delete-project').addEventListener('click', async () => {
    const ok = await confirmDialog('Supprimer le projet',
      `« ${project.name} » et ses ${project.parts.length} pièces seront supprimés définitivement.`);
    if (!ok) return;
    try { await api.del(`projects/${id}`); location.hash = '#/'; toast('Projet supprimé'); }
    catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#refresh-stock').addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const data = await store.loadFilaments({ refresh: true });
      table.getRows().forEach(r => r.update(toRow(r.getData())));
      table.getRows().forEach(r => r.reformat());
      refreshSummary();
      toast(data.online ? 'Stock relu depuis FilaFlow' : 'FilaFlow ne répond pas : dernière copie utilisée',
        data.online ? 'info' : 'error');
    } catch (err) { toast(err.message, 'error'); }
    finally { e.target.disabled = false; }
  });

  /* Sélection de pièces (modification en lot) */
  const selectedIds = new Set();

  /* Tri mémorisé pour ce projet */
  const sortKey = `prepflow_parts_sort_${id}`;
  let partsSort = null;
  try {
    const s = JSON.parse(localStorage.getItem(sortKey) || 'null');
    if (s && PART_SORTS[s.field] && (s.dir === 'asc' || s.dir === 'desc')) partsSort = s;
  } catch (_) {}

  /* Tableau des pièces */
  const printerOptions = cell => {
    const current = cell.getValue();
    return [{ label: 'Aucune', value: '' },
      ...store.printers
        .filter(p => p.active || p.id === current)
        .map(p => ({ label: p.name, value: p.id }))];
  };

  const table = new Tabulator(el.querySelector('#parts-grid'), {
    data: sortParts(project.parts.map(toRow), partsSort),
    index: 'id',
    layout: 'fitColumns',
    // Au-delà de 10 pièces, le tableau défile à l'intérieur (en-tête et totaux restent visibles)
    maxHeight: GRID_MAX_HEIGHT,
    movableRows: true,
    placeholder: 'Aucune pièce. Ajoutez la première avec le bouton ci-dessus.',
    columnDefaults: { headerSort: false, resizable: true, vertAlign: 'middle' },
    editTriggerEvent: 'click',
    columns: [
      { field: '_sel', width: 34, minWidth: 34, resizable: false, frozen: true, hozAlign: 'center', headerHozAlign: 'center',
        titleFormatter: () => '<input type="checkbox" class="sel-all" aria-label="Tout sélectionner">',
        headerClick: e => { e.stopPropagation(); toggleAll(); },
        formatter: c => `<input type="checkbox" class="sel-row" aria-label="Sélectionner la pièce" ${selectedIds.has(c.getRow().getData().id) ? 'checked' : ''}>`,
        cellClick: (e, c) => toggleRow(c.getRow()) },
      { rowHandle: true, field: '_handle', formatter: 'handle', width: 28, minWidth: 28, resizable: false, frozen: true },
      { title: 'Pièce', field: 'name', editor: 'input', minWidth: 100, widthGrow: 2, frozen: true,
        // Total : nombre de lignes (la colonne Qté donne le nombre de pièces à imprimer)
        // (calcul maison : le « count » de Tabulator ignore les pièces sans nom)
        bottomCalc: values => values.length,
        bottomCalcFormatter: c => { const n = c.getValue() || 0; return `${n} élément${n > 1 ? 's' : ''}`; },
        formatter: c => c.getValue() ? escapeHtml(c.getValue()) : '<span class="muted">Sans nom</span>' },
      { title: 'Fichier', field: 'file_name', editor: 'input', minWidth: 60, widthGrow: 1.4,
        formatter: c => c.getValue() ? `<span class="cell-file">${escapeHtml(c.getValue())}</span>` : '' },
      { title: 'Qté', field: 'quantity', editor: 'number', editorParams: { min: 1, step: 1 },
        hozAlign: 'right', width: 56, bottomCalc: 'sum' },
      { title: 'Imprimante', field: 'printer_id', editor: 'list', minWidth: 108, widthGrow: 1.2,
        editorParams: { valuesLookup: printerOptions },
        formatter: c => {
          const p = store.printers.find(x => x.id === c.getValue());
          return p ? escapeHtml(p.name) : '<span class="muted">Aucune</span>';
        } },
      { title: 'Matière', field: 'material', minWidth: 78, widthGrow: 0.8,
        editor: 'list',
        editable: c => (c.getRow().getData().filaments || []).length <= 1,
        editorParams: {
          valuesLookup: c => materialOptions(c.getValue()),
          autocomplete: true, listOnEmpty: true, allowEmpty: true, clearable: true, freetext: true,
          itemFormatter: materialItemFormatter,
          elementAttributes: { placeholder: 'Rechercher une matière…' },
          maxWidth: 280,
        },
        formatter: c => {
          const fils = c.getRow().getData().filaments || [];
          if (fils.length > 1) {
            const mats = distinctValues('material', fils.map(f => ({
              material: store.filamentsById.get(f.filament_id)?.material || f.material,
            })));
            return mats.length ? escapeHtml(mats.map(m => m.label).join(', ')) : '<span class="muted">—</span>';
          }
          if (c.getValue()) return escapeHtml(c.getValue());
          // Pièces saisies avant la v1.3.0 : matière de la bobine choisie
          const f = fils[0] && store.filamentsById.get(fils[0].filament_id);
          return f && normColor(f.material) ? escapeHtml(f.material.trim()) : '<span class="muted">—</span>';
        },
        cellClick: (e, c) => {
          if ((c.getRow().getData().filaments || []).length > 1) openFilamentsDialog(c.getRow());
        } },
      { title: 'Couleur', field: 'color_name', minWidth: 86, widthGrow: 1,
        editor: 'list',
        editable: c => (c.getRow().getData().filaments || []).length <= 1,
        editorParams: {
          valuesLookup: c => colorOptions(c.getValue(), c.getRow().getData().material),
          autocomplete: true, listOnEmpty: true, allowEmpty: true, clearable: true, freetext: true,
          itemFormatter: colorItemFormatter,
          elementAttributes: { placeholder: 'Rechercher une couleur…' },
          maxWidth: 300,
        },
        formatter: c => {
          const r = c.getRow().getData();
          const fils = r.filaments || [];
          if (fils.length > 1) {
            return `<span class="multi">${fils.map(f => swatch(store.filamentsById.get(f.filament_id)?.color_hex || colorHex(f.color_name))).join('')}</span>`;
          }
          const f = fils[0] && store.filamentsById.get(fils[0].filament_id);
          // Pièces saisies avant la v1.2.0 : afficher la couleur de la bobine choisie
          if (!c.getValue()) {
            return f && normColor(f.color_name)
              ? `${swatch(f.color_hex)}${escapeHtml(f.color_name.trim())}`
              : '<span class="muted">—</span>';
          }
          return `${swatch(f ? f.color_hex : colorHex(c.getValue()))}${escapeHtml(c.getValue())}`;
        },
        cellClick: (e, c) => {
          if ((c.getRow().getData().filaments || []).length > 1) openFilamentsDialog(c.getRow());
        } },
      { title: 'Filament', field: 'filament_id', minWidth: 150, widthGrow: 2.2,
        editor: 'list',
        editable: c => (c.getRow().getData().filaments || []).length <= 1,
        editorParams: {
          valuesLookup: c => filamentOptions(
            (c.getRow().getData().filaments || []).map(f => f.filament_id).filter(Boolean),
            c.getRow().getData().color_name, c.getRow().getData().material),
          autocomplete: true, listOnEmpty: true, allowEmpty: true, clearable: true,
          itemFormatter: filamentItemFormatter,
          placeholderEmpty: 'Aucune bobine trouvée',
          elementAttributes: { placeholder: 'Rechercher une bobine…' },
          maxWidth: 420,
        },
        formatter: formatFilamentCell,
        cellClick: (e, c) => {
          if ((c.getRow().getData().filaments || []).length > 1) openFilamentsDialog(c.getRow());
        } },
      { title: 'Poids unit.', field: 'unit_weight', hozAlign: 'right', width: 90,
        editor: parsedEditor(parseWeight, weightToInput),
        editable: c => (c.getRow().getData().filaments || []).length <= 1,
        cellClick: (e, c) => {
          if ((c.getRow().getData().filaments || []).length > 1) openFilamentsDialog(c.getRow());
        },
        formatter: c => c.getValue() === null ? '<span class="muted">—</span>' : formatWeight(c.getValue()) },
      { title: 'Temps unit.', field: 'print_time_s', hozAlign: 'right', width: 100,
        editor: parsedEditor(parseDuration, durationToInput),
        formatter: c => c.getValue() === null ? '<span class="muted">—</span>' : formatDuration(c.getValue()) },
      { title: 'Poids total', field: 'total_weight', hozAlign: 'right', width: 92, cssClass: 'col-calc',
        formatter: c => formatWeight(c.getValue(), { empty: '' }),
        bottomCalc: 'sum', bottomCalcFormatter: c => formatWeight(c.getValue()) },
      { title: 'Temps total', field: 'total_time', hozAlign: 'right', width: 96, cssClass: 'col-calc',
        formatter: c => formatDuration(c.getValue()),
        bottomCalc: 'sum', bottomCalcFormatter: c => formatDuration(c.getValue()) },
      { title: 'Coût', field: 'cost', hozAlign: 'right', width: 80, cssClass: 'col-calc',
        formatter: c => {
          const r = c.getRow().getData();
          if (c.getValue() === null) return '';
          if (!r.cost_complete && !c.getValue()) return '<span class="muted">—</span><span class="warn-mark" title="Prix manquant pour une bobine dans FilaFlow">*</span>';
          return formatMoney(c.getValue()) + (r.cost_complete ? '' : '<span class="warn-mark" title="Prix manquant pour une bobine dans FilaFlow">*</span>');
        },
        bottomCalc: 'sum', bottomCalcFormatter: c => formatMoney(c.getValue()) },
      { title: 'Statut', field: 'status', editor: 'list', width: 108,
        editorParams: { values: Object.entries(PART_STATUS).map(([value, label]) => ({ label, value })) },
        formatter: fmtStatus },
      { title: 'Notes', field: 'notes', editor: 'textarea', minWidth: 50, widthGrow: 1,
        formatter: c => c.getValue() ? `<span class="cell-notes" title="${escapeHtml(c.getValue())}">${escapeHtml(c.getValue())}</span>` : '' },
      { title: '', field: '_actions', width: 70, minWidth: 70, resizable: false, hozAlign: 'right', cssClass: 'col-actions', frozen: true,
        formatter: () => `
          <button class="icon-btn" data-action="filaments" title="Plusieurs filaments (multicolore)" aria-label="Gérer les filaments">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="10" r="4.5"/><circle cx="13" cy="10" r="4.5"/></svg></button>
          <button class="icon-btn icon-btn-danger" data-action="delete" title="Supprimer la pièce" aria-label="Supprimer la pièce">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg></button>`,
        cellClick: async (e, c) => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const row = c.getRow();
          if (btn.dataset.action === 'filaments') openFilamentsDialog(row);
          if (btn.dataset.action === 'delete') {
            const name = row.getData().name || 'Sans nom';
            if (!await confirmDialog('Supprimer la pièce', `La pièce « ${name} » sera supprimée du projet.`)) return;
            try { await api.del(`parts/${row.getData().id}`); await row.delete(); table.recalc(); refreshSummary(); }
            catch (err) { toast(err.message, 'error'); }
          }
        } },
    ],
  });

  // Enregistrement d'une cellule modifiée
  table.on('cellEdited', async cell => {
    const field = cell.getField();
    const row = cell.getRow();
    const data = row.getData();
    let value = cell.getValue();
    if (value === cell.getOldValue()) return;
    let body;
    switch (field) {
      case 'filament_id': {
        const w = data.filaments[0] ? data.filaments[0].weight_g : null;
        value = value === '' || value === undefined ? null : value;
        body = { filaments: value === null && w === null ? [] : [{ filament_id: value, weight_g: w }] };
        // La couleur suit la bobine choisie
        const f = value !== null ? store.filamentsById.get(value) : null;
        if (f && normColor(f.color_name)) body.color_name = f.color_name;
        if (f && normColor(f.material)) body.material = f.material;
        break;
      }
      case 'material': {
        value = value === '' || value === undefined || value === null ? null : String(value).trim() || null;
        body = { material: value };
        // Bobine d'une autre matière : on la retire, le poids est conservé ; la couleur reste
        const cur = data.filaments[0];
        const f = cur && cur.filament_id ? store.filamentsById.get(cur.filament_id) : null;
        if (value !== null && f && normColor(f.material) !== normColor(value)) {
          body.filaments = cur.weight_g === null ? [] : [{ filament_id: null, weight_g: cur.weight_g }];
          toast(`Bobine retirée : « ${filamentLabel(f)} » n'est pas en ${value}`);
        }
        break;
      }
      case 'color_name': {
        value = value === '' || value === undefined || value === null ? null : String(value).trim() || null;
        body = { color_name: value };
        // Bobine d'une autre couleur : on la retire, le poids est conservé
        const cur = data.filaments[0];
        const f = cur && cur.filament_id ? store.filamentsById.get(cur.filament_id) : null;
        if (value !== null && f && normColor(f.color_name) !== normColor(value)) {
          body.filaments = cur.weight_g === null ? [] : [{ filament_id: null, weight_g: cur.weight_g }];
          toast(`Bobine retirée : « ${filamentLabel(f)} » n'est pas de couleur ${value}`);
        }
        break;
      }
      case 'unit_weight': {
        const fid = data.filaments[0] ? data.filaments[0].filament_id : null;
        body = { filaments: value === null && fid === null ? [] : [{ filament_id: fid, weight_g: value }] };
        break;
      }
      case 'printer_id':
        body = { printer_id: value === '' ? null : value };
        break;
      default:
        body = { [field]: value };
    }
    row.getElement().classList.add('is-saving');
    try {
      const saved = await api.put(`parts/${data.id}`, body);
      await row.update(toRow(saved));
      row.reformat();
      refreshSummary();
    } catch (e) {
      toast(e.message, 'error');
      cell.restoreOldValue();
    } finally {
      row.getElement()?.classList.remove('is-saving');
    }
  });

  table.on('rowMoved', async () => {
    const ids = table.getRows().map(r => r.getData().id);
    table.getRows().forEach((r, i) => { r.getData().sort_order = i + 1; });
    try { await api.post(`projects/${id}/parts/reorder`, { ids }); }
    catch (e) { toast(e.message, 'error'); }
  });

  el.querySelector('#add-part').addEventListener('click', async () => {
    try {
      // La nouvelle pièce reprend l'imprimante de la dernière ligne
      const rows = table.getData();
      const last = rows[rows.length - 1];
      const part = await api.post(`projects/${id}/parts`, last?.printer_id ? { printer_id: last.printer_id } : {});
      // La nouvelle pièce n'a pas de bobine : un filtre actif la masquerait
      if (spoolFilter) { setSpoolFilter(''); toast('Filtre retiré pour afficher la nouvelle pièce'); }
      const row = await table.addRow(toRow(part));
      table.recalc();          // totaux du pied (nombre d'éléments, quantités)
      refreshSummary();
      await table.scrollToRow(row, 'bottom', false).catch(() => {});
      row.getCell('name').edit(true);
    } catch (e) { toast(e.message, 'error'); }
  });

  /* Fenêtre « plusieurs filaments » */
  function openFilamentsDialog(row) {
    const data = row.getData();
    const blank = () => ({ filament_id: null, material: null, color_name: null, weight_g: null });
    // Matière et couleur de chaque ligne : celles enregistrées, sinon celles de la bobine,
    // sinon (pièce à une seule ligne) celles de la pièce
    let lines = data.filaments.length
      ? data.filaments.map(f => {
          const fil = store.filamentsById.get(f.filament_id);
          return {
            filament_id: f.filament_id,
            weight_g: f.weight_g,
            material: f.material || fil?.material?.trim() || (data.filaments.length === 1 ? data.material : null) || null,
            color_name: f.color_name || fil?.color_name?.trim() || (data.filaments.length === 1 ? data.color_name : null) || null,
          };
        })
      : [{ ...blank(), material: data.material || null, color_name: data.color_name || null }];

    const optionTags = (opts, selected, firstLabel) =>
      `<option value="">${firstLabel}</option>` + opts.filter(o => o.value).map(o =>
        `<option value="${escapeHtml(o.value)}" ${normColor(o.value) === normColor(selected) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');

    openDialog({
      title: `Filaments de « ${data.name || 'Sans nom'} »`,
      wide: true,
      build(body) {
        const draw = () => {
          const total = lines.reduce((s, l) => s + (Number(l.weight_g) || 0), 0);
          body.innerHTML = `
            <p class="dialog-help">Poids pour une pièce, par filament, tel qu'indiqué par Elegoo Slicer.
              La matière et la couleur filtrent les bobines proposées sur la même ligne.</p>
            <div class="fil-head" aria-hidden="true"><span></span><span>Matière</span><span>Couleur</span><span>Bobine</span><span>Poids</span><span></span></div>
            <div class="fil-lines">
              ${lines.map((l, i) => {
                const fil = store.filamentsById.get(l.filament_id);
                const fils = filamentOptions(l.filament_id ? [l.filament_id] : [], l.color_name, l.material);
                return `
                <div class="fil-line" data-i="${i}">
                  ${swatch(fil ? fil.color_hex : colorHex(l.color_name))}
                  <select class="select" data-k="material" aria-label="Matière ${i + 1}">
                    ${optionTags(materialOptions(l.material), l.material, 'Toutes')}
                  </select>
                  <select class="select" data-k="color_name" aria-label="Couleur ${i + 1}">
                    ${optionTags(colorOptions(l.color_name, l.material), l.color_name, 'Toutes')}
                  </select>
                  <select class="select" data-k="filament_id" aria-label="Bobine ${i + 1}">
                    <option value="">${fils.length ? 'Choisir une bobine…' : 'Aucune bobine'}</option>
                    ${fils.map(o => `<option value="${o.value}" ${o.value === l.filament_id ? 'selected' : ''}>${escapeHtml(o.label)}${o.f.archived ? ' (archivée)' : ''}</option>`).join('')}
                  </select>
                  <label class="weight-input"><input type="text" inputmode="decimal" data-k="weight_g"
                    value="${escapeHtml(weightToInput(l.weight_g))}" aria-label="Poids ${i + 1} en grammes"><span>g</span></label>
                  <button type="button" class="icon-btn icon-btn-danger" data-remove="${i}" aria-label="Retirer ce filament">
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
                </div>`;
              }).join('')}
            </div>
            <div class="fil-foot">
              <button type="button" class="btn" data-add>Ajouter un filament</button>
              <span class="fil-total">Total par pièce : <strong>${formatWeight(total, { empty: '0 g' }) || '0 g'}</strong></span>
            </div>`;

          body.querySelectorAll('.fil-line').forEach(line => {
            const i = +line.dataset.i;
            const l = lines[i];
            // Même règle que dans le tableau : une bobine incompatible est retirée, le poids reste
            const dropIfMismatch = () => {
              const fil = store.filamentsById.get(l.filament_id);
              if (fil && !matches(fil, l.material, l.color_name)) l.filament_id = null;
            };
            line.querySelector('[data-k=material]').addEventListener('change', e => {
              l.material = e.target.value || null; dropIfMismatch(); draw();
            });
            line.querySelector('[data-k=color_name]').addEventListener('change', e => {
              l.color_name = e.target.value || null; dropIfMismatch(); draw();
            });
            line.querySelector('[data-k=filament_id]').addEventListener('change', e => {
              l.filament_id = e.target.value ? +e.target.value : null;
              const fil = store.filamentsById.get(l.filament_id);
              if (fil && normColor(fil.material)) l.material = fil.material.trim();
              if (fil && normColor(fil.color_name)) l.color_name = fil.color_name.trim();
              draw();
            });
            line.querySelector('[data-k=weight_g]').addEventListener('change', e => {
              const v = parseWeight(e.target.value);
              if (Number.isNaN(v)) { toast('Poids non reconnu', 'error'); e.target.value = weightToInput(l.weight_g); return; }
              l.weight_g = v; draw();
            });
          });
          body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
            lines.splice(+b.dataset.remove, 1);
            if (!lines.length) lines.push(blank());
            draw();
          }));
          body.querySelector('[data-add]').addEventListener('click', () => {
            lines.push(blank()); draw();
            body.querySelector('.fil-line:last-child select').focus();
          });
        };
        draw();
      },
      async onConfirm(body) {
        // Relire les poids en cours de saisie (champ non encore validé)
        body.querySelectorAll('.fil-line').forEach(line => {
          const v = parseWeight(line.querySelector('[data-k=weight_g]').value);
          if (!Number.isNaN(v)) lines[+line.dataset.i].weight_g = v;
        });
        const clean = lines.filter(l =>
          l.filament_id !== null || l.weight_g !== null || l.material !== null || l.color_name !== null);
        const payload = { filaments: clean };
        // Une seule ligne : la pièce redevient « simple », ses colonnes Matière / Couleur suivent la ligne
        if (clean.length === 1) {
          payload.material = clean[0].material;
          payload.color_name = clean[0].color_name;
        }
        const saved = await api.put(`parts/${data.id}`, payload);
        await row.update(toRow(saved));
        row.reformat();
        refreshSummary();
      },
    });
  }

  /* Synthèses */
  function refreshSummary() {
    drawSpoolFilter();
    const parts = table.getData().map(fromRow);
    const s = summarize(parts, store.filamentsById, store.printers);

    const alert = el.querySelector('#stock-alert');
    alert.innerHTML = s.short.length ? `
      <div class="alert alert-danger" role="alert">
        <strong>${s.short.length === 1 ? 'Une bobine ne suffit pas' : `${s.short.length} bobines ne suffisent pas`} pour finir ce projet :</strong>
        ${s.short.map(b => `${escapeHtml(filamentLabel(b.info))} (manque ${formatWeight(-b.margin)})`).join(', ')}.
      </div>` : '';

    const missing = [];
    if (s.missing_time) missing.push(`${s.missing_time} sans temps`);
    if (s.missing_weight) missing.push(`${s.missing_weight} sans poids`);
    el.querySelector('#figures').innerHTML = `
      <div class="figure">
        <span class="figure-label">Temps restant</span>
        <span class="figure-value">${formatDuration(s.time_left) || '0 min'}</span>
        <span class="figure-sub">sur ${formatDuration(s.time_total) || '0 min'} au total</span>
      </div>
      <div class="figure">
        <span class="figure-label">Filament restant à consommer</span>
        <span class="figure-value">${formatWeight(s.weight_left) || '0 g'}</span>
        <span class="figure-sub">sur ${formatWeight(s.weight_total) || '0 g'} au total</span>
      </div>
      <div class="figure">
        <span class="figure-label">Coût matière</span>
        <span class="figure-value">${formatMoney(s.cost_total)}</span>
        <span class="figure-sub">${s.cost_complete ? 'prix des bobines FilaFlow' : 'incomplet : prix manquant dans FilaFlow'}</span>
      </div>
      <div class="figure">
        <span class="figure-label">Pièces imprimées</span>
        <span class="figure-value">${s.pieces_done} / ${s.pieces}</span>
        <span class="figure-sub">${missing.length ? `lignes incomplètes : ${missing.join(', ')}` : 'toutes les lignes sont renseignées'}</span>
      </div>`;

    // Bobines : jauge stock vs besoin
    // Ordre : bobines insuffisantes, puis celles à consommer, puis celles déjà utilisées
    const rank = b => (b.sufficient === false ? 0 : b.needed ? 1 : 2);
    const spools = [...s.byFilament.values()].sort((a, b) => rank(a) - rank(b) || b.needed - a.needed);
    el.querySelector('#spools').innerHTML = spools.length ? spools.map(b => {
      const f = b.info;
      if (b.stock === null) {
        return `<div class="spool"><div class="spool-head">${swatch(f?.color_hex)}<span class="spool-name">${escapeHtml(filamentLabel(f))}</span>
          <span class="spool-state muted">stock inconnu</span></div></div>`;
      }
      if (!b.needed) {
        return `<div class="spool is-done"><div class="spool-head">${swatch(f?.color_hex)}<span class="spool-name">${escapeHtml(filamentLabel(f))}</span>
          <span class="spool-state">pièces déjà imprimées</span></div></div>`;
      }
      const scale = Math.max(b.stock, b.needed, 1);
      const needPct = Math.min(100, 100 * b.needed / scale);
      const stockPct = 100 * b.stock / scale;
      const state = b.sufficient
        ? `<span class="spool-state ok">reste ${formatWeight(b.margin) || '0 g'} après</span>`
        : `<span class="spool-state short">manque ${formatWeight(-b.margin)}</span>`;
      return `
        <div class="spool ${b.sufficient ? '' : 'is-short'}">
          <div class="spool-head">${swatch(f?.color_hex)}<span class="spool-name">${escapeHtml(filamentLabel(f))}</span>${state}</div>
          <div class="gauge" role="img" aria-label="Besoin ${formatWeight(b.needed)} pour un stock de ${formatWeight(b.stock)}">
            <div class="gauge-stock" style="width:${stockPct}%"></div>
            <div class="gauge-need" style="width:${needPct}%"></div>
          </div>
          <div class="spool-foot"><span>Besoin ${formatWeight(b.needed) || '0 g'}</span><span>Stock ${formatWeight(b.stock) || '0 g'}</span></div>
        </div>`;
    }).join('') : '<p class="muted">Aucun filament choisi pour l\'instant.</p>';

    const load = [...s.byPrinter.values()].filter(p => p.pieces);
    el.querySelector('#printers-load').innerHTML = load.length ? `
      <table class="mini-table">
        <thead><tr><th>Imprimante</th><th class="num">Pièces restantes</th><th class="num">Temps restant</th><th class="num">Total</th></tr></thead>
        <tbody>${load.map(p => `<tr>
          <td>${p.printer_id ? escapeHtml(p.name) : '<span class="muted">Sans imprimante</span>'}</td>
          <td class="num">${p.pieces_left}</td>
          <td class="num"><strong>${formatDuration(p.time_left) || '0 min'}</strong></td>
          <td class="num">${formatDuration(p.time_total) || '0 min'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Aucune pièce pour l\'instant.</p>';
  }

  /* Tri par les en-têtes : croissant → décroissant → ordre manuel */
  function applySort({ keepScroll = true } = {}) {
    const holder = el.querySelector('#parts-grid .tabulator-tableholder');
    const top = holder ? holder.scrollTop : 0;
    table.replaceData(sortParts(table.getData(), partsSort)).then(() => {
      if (keepScroll && holder) holder.scrollTop = top;
      table.recalc();
    });
    if (partsSort) table.hideColumn('_handle'); else table.showColumn('_handle');
    table.getColumns().forEach(c => {
      const f = c.getField();
      const elc = c.getElement();
      elc.classList.toggle('pf-sort-asc', !!partsSort && partsSort.field === f && partsSort.dir === 'asc');
      elc.classList.toggle('pf-sort-desc', !!partsSort && partsSort.field === f && partsSort.dir === 'desc');
      elc.setAttribute('aria-sort', partsSort && partsSort.field === f ? (partsSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const bar = el.querySelector('#sort-bar');
    const hint = el.querySelector('#grid-hint');
    if (partsSort) {
      bar.hidden = false; hint.hidden = true;
      bar.innerHTML = `Trié par <strong>${PART_SORTS[partsSort.field].label}</strong> ${partsSort.dir === 'asc' ? '▲' : '▼'}
        <button type="button" class="link-btn" data-sort-reset>Revenir à l'ordre manuel</button>
        <button type="button" class="link-btn" data-sort-keep title="Enregistrer cet ordre comme nouvel ordre manuel">Garder cet ordre</button>`;
      bar.querySelector('[data-sort-reset]').addEventListener('click', () => setPartsSort(null));
      bar.querySelector('[data-sort-keep]').addEventListener('click', keepSortedOrder);
    } else {
      bar.hidden = true; hint.hidden = false; bar.innerHTML = '';
    }
  }

  function setPartsSort(s) {
    partsSort = s;
    try { s ? localStorage.setItem(sortKey, JSON.stringify(s)) : localStorage.removeItem(sortKey); } catch (_) {}
    applySort();
  }

  async function keepSortedOrder() {
    const rows = table.getData();
    try {
      await api.post(`projects/${id}/parts/reorder`, { ids: rows.map(r => r.id) });
      rows.forEach((r, i) => { r.sort_order = i + 1; });
      toast('Ordre enregistré comme ordre manuel');
      setPartsSort(null);
    } catch (e) { toast(e.message, 'error'); }
  }

  table.on('headerClick', (e, column) => {
    const field = column.getField();
    if (!PART_SORTS[field] || e.target.closest('.tabulator-col-resize-handle')) return;
    if (!partsSort || partsSort.field !== field) setPartsSort({ field, dir: 'asc' });
    else if (partsSort.dir === 'asc') setPartsSort({ field, dir: 'desc' });
    else setPartsSort(null);
  });

  table.on('tableBuilt', () => {
    table.getColumns().forEach(c => { if (PART_SORTS[c.getField()]) c.getElement().classList.add('pf-sortable'); });
    applySort({ keepScroll: false });
  });
  table.on('tableBuilt', refreshSummary);

  /* ── Filtre par bobine ───────────────────────────────────────── */
  // '' = toutes ; 'none' = pièces sans bobine choisie ; sinon id de bobine. Non mémorisé.
  let spoolFilter = '';
  const usesSpool = (r, f) => f === 'none'
    ? !(r.filaments || []).some(x => x.filament_id)
    : (r.filaments || []).some(x => String(x.filament_id) === f);

  function drawSpoolFilter() {
    const sel = el.querySelector('#spool-filter');
    if (!sel) return;
    const rows = table.getData();
    const counts = new Map();
    let none = 0;
    for (const r of rows) {
      const ids = new Set((r.filaments || []).map(x => x.filament_id).filter(Boolean));
      if (!ids.size) none++;
      ids.forEach(fid => counts.set(fid, (counts.get(fid) || 0) + 1));
    }
    if (spoolFilter && spoolFilter !== 'none' && !counts.has(+spoolFilter)) counts.set(+spoolFilter, 0);
    const spools = [...counts.entries()]
      .map(([fid, n]) => ({ fid, n, label: filamentLabel(store.filamentsById.get(fid)) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    const plural = n => `${n} pièce${n > 1 ? 's' : ''}`;
    sel.innerHTML = `<option value="">Filtrer : toutes les bobines</option>`
      + spools.map(s => `<option value="${s.fid}" ${String(s.fid) === spoolFilter ? 'selected' : ''}>${escapeHtml(s.label)} · ${plural(s.n)}</option>`).join('')
      + `<option value="none" ${spoolFilter === 'none' ? 'selected' : ''}>Sans bobine choisie · ${plural(none)}</option>`;
    sel.classList.toggle('is-active', !!spoolFilter);
    drawFilterStatus();
  }

  function drawFilterStatus() {
    const st = el.querySelector('#filter-status');
    if (!st) return;
    if (!spoolFilter) { st.hidden = true; st.innerHTML = ''; return; }
    const shown = table.getRows('active').length, total = table.getRows().length;
    st.hidden = false;
    st.innerHTML = `Filtré : <strong>${shown}</strong> élément${shown > 1 ? 's' : ''} sur ${total}
      <button type="button" class="link-btn" data-filter-clear>Retirer le filtre</button>`;
    st.querySelector('[data-filter-clear]').addEventListener('click', () => setSpoolFilter(''));
  }

  function setSpoolFilter(value) {
    spoolFilter = value || '';
    if (spoolFilter) table.setFilter(r => usesSpool(r, spoolFilter));
    else table.clearFilter();
    // Une pièce masquée ne reste pas sélectionnée : la modification en lot ne doit pas la toucher
    const visible = new Set(table.getRows('active').map(r => r.getData().id));
    [...selectedIds].forEach(sid => { if (!visible.has(sid)) selectedIds.delete(sid); });
    table.getRows().forEach(r => r.reformat());
    table.recalc();
    drawSpoolFilter();
    syncSelectionUi();
  }

  el.querySelector('#spool-filter').addEventListener('change', e => setSpoolFilter(e.target.value));
  // Après une modification (bobine changée…), le filtre est réévalué
  table.on('dataChanged', () => { if (spoolFilter) table.refreshFilter(); });
  table.on('dataFiltered', () => setTimeout(drawFilterStatus, 0));

  /* ── Modification en lot ─────────────────────────────────────── */
  function syncSelectionUi() {
    // Ne garder que les pièces encore présentes
    const present = new Set(table.getData().map(r => r.id));
    [...selectedIds].forEach(sid => { if (!present.has(sid)) selectedIds.delete(sid); });
    const visibleCount = table.getRows('active').length;
    const all = el.querySelector('#parts-grid .sel-all');
    if (all) {
      all.checked = visibleCount > 0 && selectedIds.size === visibleCount;
      all.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleCount;
    }
    drawBulkBar();
  }
  function toggleRow(row) {
    const rid = row.getData().id;
    selectedIds.has(rid) ? selectedIds.delete(rid) : selectedIds.add(rid);
    row.reformat();
    syncSelectionUi();
  }
  function toggleAll() {
    const rows = table.getRows('active');      // pièces visibles (filtre)
    const selectAll = selectedIds.size < rows.length;
    selectedIds.clear();
    if (selectAll) rows.forEach(r => selectedIds.add(r.getData().id));
    rows.forEach(r => r.reformat());
    syncSelectionUi();
  }

  function drawBulkBar() {
    const bar = el.querySelector('#bulk-bar');
    if (!selectedIds.size) { bar.hidden = true; bar.innerHTML = ''; return; }
    const rows = table.getData().filter(r => selectedIds.has(r.id));
    const multi = rows.filter(r => (r.filaments || []).length > 1).length;
    const n = rows.length;
    const opts = filamentOptions([]).map(o =>
      `<option value="${o.value}">${escapeHtml(o.label)}${o.f.weight_remaining !== null ? ' · ' + formatWeight(Number(o.f.weight_remaining)) : ''}</option>`).join('');
    bar.hidden = false;
    bar.innerHTML = `
      <strong>${n} pièce${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}</strong>
      <label>Bobine <select class="select" data-bulk="filament_id"><option value="">— inchangée —</option>${opts}</select></label>
      <label>Imprimante <select class="select" data-bulk="printer_id"><option value="">— inchangée —</option>
        <option value="__none">Aucune</option>
        ${store.printers.filter(p => p.active).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label>
      <label>Statut <select class="select" data-bulk="status"><option value="">— inchangé —</option>
        ${Object.entries(PART_STATUS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <button type="button" class="btn btn-primary btn-sm" data-bulk-apply>Appliquer</button>
      <button type="button" class="link-btn" data-bulk-clear>Désélectionner</button>
      ${multi ? `<span class="bulk-note">${multi} pièce${multi > 1 ? 's' : ''} multicolore${multi > 1 ? 's' : ''} : bobine non modifiée (utilisez « Remplacer une bobine »)</span>` : ''}`;
    bar.querySelector('[data-bulk-clear]').addEventListener('click', () => {
      selectedIds.clear(); table.getRows().forEach(r => r.reformat()); syncSelectionUi();
    });
    bar.querySelector('[data-bulk-apply]').addEventListener('click', applyBulk);
  }

  async function applyBulk() {
    const bar = el.querySelector('#bulk-bar');
    const v = k => bar.querySelector(`[data-bulk="${k}"]`).value;
    const set = {};
    if (v('filament_id')) set.filament_id = +v('filament_id');
    if (v('printer_id')) set.printer_id = v('printer_id') === '__none' ? null : +v('printer_id');
    if (v('status')) set.status = v('status');
    if (!Object.keys(set).length) return toast('Choisissez au moins une modification', 'error');
    try {
      const r = await api.post(`projects/${id}/parts/bulk`, { part_ids: [...selectedIds], set });
      await applyUpdatedParts(r.parts);
      const done = r.parts.length;
      toast(`${done} pièce${done > 1 ? 's' : ''} modifiée${done > 1 ? 's' : ''}`
        + (set.filament_id && r.skipped_multicolor.length ? ` (bobine inchangée sur ${r.skipped_multicolor.length} multicolore${r.skipped_multicolor.length > 1 ? 's' : ''})` : ''));
      selectedIds.clear();
      table.getRows().forEach(row => row.reformat());
      syncSelectionUi();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function applyUpdatedParts(parts) {
    for (const p of parts) {
      const row = table.getRow(p.id);
      if (row) { await row.update(toRow(p)); row.reformat(); }
    }
    table.recalc();
    refreshSummary();
  }

  /* Remplacer une bobine par une autre dans tout le projet */
  el.querySelector('#replace-spool').addEventListener('click', () => {
    const rows = table.getData();
    const usage = new Map();       // bobine → { pièces, dont imprimées }
    for (const r of rows) {
      for (const f of r.filaments || []) {
        if (!f.filament_id) continue;
        const u = usage.get(f.filament_id) || { parts: new Set(), printed: new Set() };
        u.parts.add(r.id); if (r.status === 'imprime') u.printed.add(r.id);
        usage.set(f.filament_id, u);
      }
    }
    if (!usage.size) return toast('Aucune bobine choisie dans ce projet', 'error');
    const fromOpts = [...usage.entries()]
      .map(([fid, u]) => ({ fid, u, f: store.filamentsById.get(fid) }))
      .sort((a, b) => filamentLabel(a.f).localeCompare(filamentLabel(b.f), 'fr'));
    let material = '', color = '';

    openDialog({
      title: 'Remplacer une bobine',
      confirmLabel: 'Remplacer',
      wide: true,
      build(body) {
        const draw = () => {
          const fromVal = body.querySelector('[data-k=from]')?.value || String(fromOpts[0].fid);
          const toVal = body.querySelector('[data-k=to]')?.value || '';
          const include = body.querySelector('[data-k=printed]')?.checked || false;
          const targets = filamentOptions([], color || null, material || null).filter(o => String(o.value) !== fromVal);
          const u = usage.get(+fromVal);
          const concerned = include ? u.parts.size : u.parts.size - u.printed.size;
          body.innerHTML = `
            <p class="dialog-help">Toutes les pièces du projet qui utilisent la bobine passent sur la nouvelle, y compris les lignes des
              pièces multicolores. Les poids sont conservés ; la matière et la couleur suivent la nouvelle bobine.</p>
            <div class="replace-grid">
              <label class="field"><span>Bobine à remplacer</span>
                <select class="select" data-k="from">${fromOpts.map(o => `<option value="${o.fid}" ${String(o.fid) === fromVal ? 'selected' : ''}>${escapeHtml(filamentLabel(o.f))} · ${o.u.parts.size} pièce${o.u.parts.size > 1 ? 's' : ''}</option>`).join('')}</select></label>
              <label class="field"><span>Matière</span>
                <select class="select" data-k="material"><option value="">Toutes</option>${materialOptions(material).filter(o => o.value).map(o => `<option value="${escapeHtml(o.value)}" ${normColor(o.value) === normColor(material) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>
              <label class="field"><span>Couleur</span>
                <select class="select" data-k="color"><option value="">Toutes</option>${colorOptions(color, material || null).filter(o => o.value).map(o => `<option value="${escapeHtml(o.value)}" ${normColor(o.value) === normColor(color) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>
              <label class="field"><span>Nouvelle bobine</span>
                <select class="select" data-k="to"><option value="">${targets.length ? 'Choisir…' : 'Aucune bobine'}</option>${targets.map(o => `<option value="${o.value}" ${String(o.value) === toVal ? 'selected' : ''}>${escapeHtml(o.label)}${o.f.weight_remaining !== null ? ' · ' + formatWeight(Number(o.f.weight_remaining)) : ''}</option>`).join('')}</select></label>
            </div>
            <label class="toggle replace-printed"><input type="checkbox" data-k="printed" ${include ? 'checked' : ''}>
              Inclure les pièces déjà imprimées${u.printed.size ? ` (${u.printed.size})` : ''}</label>
            <p class="replace-count"><strong>${concerned}</strong> pièce${concerned > 1 ? 's' : ''} concernée${concerned > 1 ? 's' : ''}</p>`;
          body.querySelector('[data-k=from]').addEventListener('change', draw);
          body.querySelector('[data-k=printed]').addEventListener('change', draw);
          body.querySelector('[data-k=to]').addEventListener('change', () => {});
          body.querySelector('[data-k=material]').addEventListener('change', e => { material = e.target.value; draw(); });
          body.querySelector('[data-k=color]').addEventListener('change', e => { color = e.target.value; draw(); });
        };
        draw();
      },
      async onConfirm(body) {
        const from = +body.querySelector('[data-k=from]').value;
        const to = +body.querySelector('[data-k=to]').value;
        if (!to) { toast('Choisissez la nouvelle bobine', 'error'); return false; }
        const r = await api.post(`projects/${id}/replace-spool`, {
          from, to, include_printed: body.querySelector('[data-k=printed]').checked });
        await applyUpdatedParts(r.parts);
        const n = r.parts.length;
        toast(n ? `Bobine remplacée sur ${n} pièce${n > 1 ? 's' : ''}` : 'Aucune pièce à modifier');
      },
    });
  });

  return () => { stopSticky(); table.destroy(); };
}
