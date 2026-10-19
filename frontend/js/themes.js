// Thèmes de projet : pastilles (liste) et éditeur avec autocomplétion (page projet)
import { api } from './api.js';
import { toast } from './ui.js';
import { escapeHtml } from './format.js';

// Même thème à la casse et aux accents près (comme la base : « Noel » = « Noël »)
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
// Palette des thèmes : clé enregistrée en base → libellé (les teintes sont définies dans le CSS)
export const THEME_COLORS = [
  ['rouge', 'Rouge'], ['orange', 'Orange'], ['jaune', 'Jaune'], ['vert', 'Vert'], ['turquoise', 'Turquoise'],
  ['bleu', 'Bleu'], ['violet', 'Violet'], ['rose', 'Rose'], ['gris', 'Gris'],
];
export const colorAttr = c => (c ? ` data-color="${escapeHtml(c)}"` : '');

export const sameTheme = (a, b) => fold(a) === fold(b);

/** Pastilles cliquables (filtre de la liste). `active` : ensemble d'identifiants de thèmes actifs. */
export function themeChipsHtml(themes, active = new Set()) {
  return themes.map(t => `<button type="button" class="theme-chip is-btn ${active.has(t.id) ? 'is-active' : ''}"${colorAttr(t.color)}
    data-theme-toggle="${t.id}" aria-pressed="${active.has(t.id)}"
    title="Filtrer sur le thème « ${escapeHtml(t.name)} »">${escapeHtml(t.name)}</button>`).join('');
}

/**
 * Éditeur de thèmes d'un projet : pastilles avec croix + champ de saisie.
 * Entrée, virgule, ou choix dans la liste ajoute le thème ; un thème inconnu est créé par le serveur.
 */
export function mountThemeEditor(box, project) {
  let themes = [...(project.themes || [])];   // [{ id, name }]
  let known = [];                             // tous les thèmes existants (autocomplétion)
  let busy = false;

  box.innerHTML = `
    <span class="theme-label">Thèmes</span>
    <span class="theme-chips"></span>
    <input type="text" class="theme-input" list="theme-options" maxlength="40" autocomplete="off"
           placeholder="Ajouter un thème…" aria-label="Ajouter un thème">
    <datalist id="theme-options"></datalist>`;
  const chipsEl = box.querySelector('.theme-chips');
  const input = box.querySelector('.theme-input');
  const options = box.querySelector('#theme-options');

  const draw = () => {
    chipsEl.innerHTML = themes.map(t => `<span class="theme-chip"${colorAttr(t.color)}>${escapeHtml(t.name)}<button type="button"
      class="theme-remove" data-remove="${t.id}" aria-label="Retirer le thème ${escapeHtml(t.name)}">×</button></span>`).join('');
    options.innerHTML = known.filter(k => !themes.some(t => t.id === k.id))
      .map(k => `<option value="${escapeHtml(k.name)}"></option>`).join('');
  };

  const refreshKnown = () => api.get('themes').then(list => { known = list; draw(); }).catch(() => {});

  const save = async names => {
    if (busy) return;
    busy = true;
    try {
      const row = await api.put(`projects/${project.id}`, { themes: names });
      themes = row.themes;
      project.themes = themes;
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
      draw();
      refreshKnown();
    }
  };

  const add = raw => {
    const typed = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!typed) return;
    // Graphie du thème existant si le nom ne diffère que par la casse ou les accents
    const name = (known.find(k => sameTheme(k.name, typed)) || { name: typed }).name;
    if (themes.some(t => sameTheme(t.name, name))) return;
    save([...themes.map(t => t.name), name]);
  };

  // Virgule : valide le texte saisi (Entrée et le choix dans la liste passent par « change »,
  // qui reçoit la valeur finale même quand la liste de suggestions est ouverte)
  input.addEventListener('keydown', e => {
    if (e.key === ',') {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      add(v);
    }
  });
  input.addEventListener('change', () => {
    const v = input.value;
    input.value = '';
    add(v);
  });
  chipsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const id = Number(btn.dataset.remove);
    save(themes.filter(t => t.id !== id).map(t => t.name));
  });

  draw();
  refreshKnown();
}
