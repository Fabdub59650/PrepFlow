import { api } from '../api.js';
import { toast } from '../ui.js';
import { applyColorMode } from '../theme.js';

const MODES = [
  ['',            'Atelier sombre (par défaut)'],
  ['light',       'Toujours clair'],
  ['dark',        'Toujours sombre'],
  ['auto-system', 'Suivre le thème du système'],
  ['auto-time',   "Selon l'heure"],
];

const hours = selected => Array.from({ length: 24 }, (_, h) =>
  `<option value="${h}" ${String(h) === String(selected) ? 'selected' : ''}>${h} h</option>`).join('');

export async function renderSettings(el) {
  document.title = 'Paramètres — PrepFlow';
  const s = await api.get('settings');

  el.innerHTML = `
    <div class="page-head"><h1 class="page-title">Paramètres</h1></div>
    <section class="settings-section" aria-labelledby="appearance-title">
      <h2 class="panel-title" id="appearance-title">Apparence</h2>
      <p class="panel-sub">Le bouton en haut à droite bascule directement entre clair et sombre, et remplace le mode choisi ici.</p>
      <div class="settings-row">
        <label class="field">
          <span>Mode d'affichage</span>
          <select class="select" id="color-mode">
            ${MODES.map(([v, l]) => `<option value="${v}" ${v === (s.color_mode || '') ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <div class="field hours-field" id="hours" ${s.color_mode === 'auto-time' ? '' : 'hidden'}>
          <span>Sombre</span>
          <div class="hours-inputs">
            <label>de <select class="select" id="dark-from" aria-label="Début du mode sombre">${hours(s.dark_from)}</select></label>
            <label>à <select class="select" id="dark-to" aria-label="Fin du mode sombre">${hours(s.dark_to)}</select></label>
          </div>
        </div>
      </div>
    </section>`;

  const modeSel = el.querySelector('#color-mode');
  const fromSel = el.querySelector('#dark-from');
  const toSel   = el.querySelector('#dark-to');
  const hoursEl = el.querySelector('#hours');

  const save = async body => {
    try {
      const saved = await api.put('settings', body);
      applyColorMode(saved.color_mode, saved.dark_from, saved.dark_to);
      toast('Réglage enregistré');
    } catch (e) { toast(e.message, 'error'); }
  };

  modeSel.addEventListener('change', () => {
    hoursEl.hidden = modeSel.value !== 'auto-time';
    save({ color_mode: modeSel.value });
  });
  fromSel.addEventListener('change', () => save({ dark_from: fromSel.value }));
  toSel.addEventListener('change', () => save({ dark_to: toSel.value }));

  // Le bouton de la barre du haut change le mode : garder la liste à jour
  const onToggle = e => {
    modeSel.value = e.detail.mode;
    hoursEl.hidden = true;
  };
  document.addEventListener('prepflow:color-mode', onToggle);
  return () => document.removeEventListener('prepflow:color-mode', onToggle);
}

