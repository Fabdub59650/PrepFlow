import { api } from '../api.js';
import { store } from '../store.js';
import { escapeHtml, swatch, formatDate } from '../format.js';
import { photoThumb } from '../photo.js';
import { partColors } from './checklist.js';
import qrcode from '../../vendor/qrcode/qrcode.mjs';

// Étiquette de boîte (#/projet/12/etiquette) : format A6 paysage (148 × 105 mm) imprimé sur une feuille A4,
// à découper. Code, nom, image, nombre de pièces, matières/couleurs, liste des pièces et QR code vers le projet.

const MAX_LINES = 12;     // au-delà, « + N autres »

/** Adresse de base de PrepFlow pour les QR : réglage Paramètres, sinon adresse utilisée dans le navigateur */
export function qrBase(settings) {
  const set = (settings && settings.qr_base_url || '').trim();
  if (set) return set.endsWith('/') ? set : set + '/';
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

const partName = p => (p.name || '').trim() || (p.file_name || '').trim() || 'Pièce sans nom';

export async function renderLabel(el, id) {
  const [project, settings] = await Promise.all([api.get(`projects/${id}`), api.get('settings')]);
  const parts = project.parts || [];
  document.title = `Étiquette — ${project.code ? project.code + ' · ' : ''}${project.name}`;

  const total = parts.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
  // Couleurs distinctes de tout le projet (nom + pastille)
  const seen = new Map();
  for (const p of parts) for (const c of partColors(p)) {
    const key = c.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, c);
  }
  const mats = [...new Set(parts.flatMap(p => [p.material, ...(p.filaments || []).map(f => f.material)])
    .map(m => (m || '').trim()).filter(Boolean))];

  const base = qrBase(settings);
  const url = `${base}#/projet/${Number(project.id)}`;
  const shown = parts.slice(0, MAX_LINES);
  const more = parts.length - shown.length;

  el.innerHTML = `
    <div class="ck-toolbar no-print">
      <a href="#/projet/${Number(id)}" class="back-link">Retour au projet</a>
      <button type="button" class="btn btn-primary" id="lb-print">Imprimer l'étiquette</button>
      <span class="hint">Format A6 paysage sur une feuille A4 : découpez le long du trait pointillé. Dans la fenêtre d'impression, désactivez « En-têtes et pieds de page ». Le QR code ouvre <strong>${escapeHtml(url)}</strong> (adresse modifiable dans <a href="#/parametres">Paramètres</a>).</span>
    </div>
    <article class="lb-card">
      <div class="lb-main">
        ${project.code ? `<div class="lb-code">${escapeHtml(project.code)}</div>` : ''}
        <h1 class="lb-name">${escapeHtml(project.name)}</h1>
        <p class="lb-count"><strong>${total}</strong> pièce${total > 1 ? 's' : ''} · ${parts.length} ligne${parts.length > 1 ? 's' : ''}</p>
        ${(project.themes || []).length ? `<p class="lb-themes">${project.themes.map(t => `<span class="lb-theme">${escapeHtml(t.name)}</span>`).join('')}</p>` : ''}
        ${(seen.size || mats.length) ? `<p class="lb-colors">${mats.length ? `<span class="lb-mat">${escapeHtml(mats.join(' · '))}</span>` : ''}${[...seen.values()].map(c => `<span class="lb-color">${swatch(c.hex)}${escapeHtml(c.name)}</span>`).join('')}</p>` : ''}
        ${parts.length ? `<ul class="lb-parts">${shown.map(p => `<li><span class="lb-q">${Number(p.quantity) || 0} ×</span> ${escapeHtml(partName(p))}</li>`).join('')}${more > 0 ? `<li class="lb-more">+ ${more} autre${more > 1 ? 's' : ''}</li>` : ''}</ul>` : ''}
      </div>
      <div class="lb-side">
        <div class="lb-qr" aria-label="QR code du projet">${qrSvg(url)}</div>
        <p class="lb-url">${escapeHtml(url.replace(/^https?:\/\//, ''))}</p>
        ${photoThumb(project, 'lb-photo')}
        <p class="lb-date">Créé le ${formatDate(project.created_at)}</p>
      </div>
    </article>`;

  el.querySelector('#lb-print').addEventListener('click', () => window.print());
  return () => { document.title = 'PrepFlow'; };
}
