// Lien avec ModelFlow (lecture seule) : l'autre application répond sous /modelflow/ (même adresse, via Nginx).
// PrepFlow n'y écrit jamais ; le serveur PrepFlow garde dans le projet une copie du code et du nom.
import { toast, openDialog } from './ui.js';
import { escapeHtml } from './format.js';

const BASE = '/modelflow/';
const api = async path => {
  let res;
  try { res = await fetch(BASE + 'api/' + path, { signal: AbortSignal.timeout(4000) }); }
  catch (_) { throw new Error('ModelFlow ne répond pas.'); }
  if (!res.ok) throw new Error(`ModelFlow a répondu ${res.status}.`);
  return res.json();
};

export const modelflowHref = id => `${BASE}#/modele/${Number(id)}`;
export const modelPhotoUrl = m => (m && m.photo_v ? `${BASE}api/models/${m.id}/photo?v=${m.photo_v}` : null);
export const listModels = () => api('models');
export const getModel = id => api(`models/${Number(id)}`);

/** Chemin complet du dossier d'un modèle : racine de stockage de ModelFlow + sous-dossier */
export async function modelFolderPath(model) {
  const s = await api('settings');
  const root = String(s.storage_root || '').trim().replace(/\/+$/, '');
  const f = String(model.folder || '').trim();
  if (!f) return '';
  if (/^(\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(f)) return f;
  return root ? `${root}/${f}` : f;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (__) {}
    ta.remove();
    return ok;
  }
}

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STATUS = { catalogue: 'Catalogué', a_imprimer: 'À imprimer', imprime: 'Imprimé' };

/** Fenêtre de choix d'un modèle (recherche par code ou par nom). Renvoie le modèle choisi, ou null. */
export function pickModel(currentId) {
  return new Promise(resolve => {
    let done = false, models = [];
    const dlg = openDialog({
      title: 'Choisir un modèle',
      wide: true,
      build: body => {
        body.innerHTML = `
          <input type="search" class="search" name="q" placeholder="Code (M0012) ou nom du modèle…" aria-label="Rechercher un modèle" autocomplete="off">
          <div class="mpick-list" role="listbox" aria-label="Modèles"><p class="muted">Chargement…</p></div>`;
        const list = body.querySelector('.mpick-list');
        const q = body.querySelector('[name=q]');
        const draw = () => {
          const words = fold(q.value).split(/\s+/).filter(Boolean);
          const rows = models.filter(m => {
            const h = fold(`${m.code} ${m.name} ${(m.themes || []).map(t => t.name).join(' ')}`);
            return words.every(w => h.includes(w) || (/^m?\d+$/.test(w) && Number(w.replace(/^m/, '')) === m.id));
          });
          list.innerHTML = rows.length ? rows.slice(0, 80).map(m => {
            const img = modelPhotoUrl(m);
            return `<button type="button" class="mpick-row ${m.id === currentId ? 'is-current' : ''}" data-id="${m.id}" role="option">
              ${img ? `<img src="${img}" alt="" loading="lazy">` : '<span class="mpick-ph"></span>'}
              <span class="mpick-code">${escapeHtml(m.code)}</span>
              <span class="mpick-name">${escapeHtml(m.name)}</span>
              <span class="mpick-st">${escapeHtml(STATUS[m.status] || '')}</span>
            </button>`;
          }).join('') : '<p class="muted">Aucun modèle trouvé.</p>';
        };
        q.addEventListener('input', draw);
        list.addEventListener('click', e => {
          const b = e.target.closest('[data-id]');
          if (!b) return;
          done = true; resolve(models.find(m => m.id === Number(b.dataset.id)) || null);
          dlg.close(); dlg.remove();
        });
        listModels().then(rows => { models = rows; draw(); })
          .catch(err => { list.innerHTML = `<p class="muted">${escapeHtml(err.message)} Vérifiez que ModelFlow tourne sur le Pi.</p>`; });
      },
      onConfirm: () => {},
    });
    // Rien à enregistrer : seul un clic sur un modèle le choisit, « Annuler » ferme
    dlg.querySelector('[type=submit]').remove();
    dlg.addEventListener('close', () => { if (!done) resolve(null); });
  });
}
