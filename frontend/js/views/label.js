import { api } from '../api.js';
import { store } from '../store.js';
import { escapeHtml, swatch, formatDate } from '../format.js';
import { photoThumb } from '../photo.js';
import { partColors } from './checklist.js';
import qrcode from '../../vendor/qrcode/qrcode.mjs';

// Étiquette de boîte (#/projet/12/etiquette) : 128 × 105 mm par défaut (réglable dans Paramètres), imprimée sur une feuille A4,
// à découper. Code, nom, thèmes, matières/couleurs, nombre total de pièces, image et QR code vers le projet.

const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

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
  // Dimensions (mm), réglables dans Paramètres
  const W = clampInt(settings.label_w_mm, 70, 200, 128), H = clampInt(settings.label_h_mm, 50, 270, 105);
  // Colonne de droite : image en haut (la plus grande possible), QR code plus petit en dessous
  const sideW = W >= 110 ? 46 : 34;
  const qrMm = H >= 90 ? 30 : H >= 70 ? 26 : 22;

  el.innerHTML = `
    <div class="ck-toolbar no-print">
      <a href="#/projet/${Number(id)}" class="back-link">Retour au projet</a>
      <button type="button" class="btn btn-primary" id="lb-print">Imprimer l'étiquette</button>
      <span class="hint">${W} × ${H} mm sur une feuille A4 : découpez le long du trait pointillé. Dans la fenêtre d'impression, désactivez « En-têtes et pieds de page ». Le QR code ouvre <strong>${escapeHtml(url)}</strong> (adresse et dimensions modifiables dans <a href="#/parametres">Paramètres</a>).</span>
    </div>
    <article class="lb-card" style="--lb-w:${W}mm;--lb-h:${H}mm;--lb-side:${sideW}mm;--lb-qr:${qrMm}mm">
      <div class="lb-main">
        ${project.code ? `<div class="lb-code">${escapeHtml(project.code)}</div>` : ''}
        <h1 class="lb-name">${escapeHtml(project.name)}</h1>
        ${(project.themes || []).length ? `<p class="lb-themes">${project.themes.map(t => `<span class="lb-theme">${escapeHtml(t.name)}</span>`).join('')}</p>` : ''}
        ${(seen.size || mats.length) ? `<p class="lb-colors">${mats.length ? `<span class="lb-mat">${escapeHtml(mats.join(' · '))}</span>` : ''}${[...seen.values()].map(c => `<span class="lb-color">${swatch(c.hex)}${escapeHtml(c.name)}</span>`).join('')}</p>` : ''}
        <p class="lb-count"><strong>${total}</strong> pièce${total > 1 ? 's' : ''}</p>
        <p class="lb-date">Créé le ${formatDate(project.created_at)}</p>
      </div>
      <div class="lb-side">
        ${photoThumb(project, 'lb-photo')}
        <div class="lb-qr" aria-label="QR code du projet">${qrSvg(url)}</div>
        <p class="lb-url">${escapeHtml(url.replace(/^https?:\/\//, ''))}</p>
      </div>
    </article>`;

  el.querySelector('#lb-print').addEventListener('click', () => window.print());
  return () => { document.title = 'PrepFlow'; };
}
