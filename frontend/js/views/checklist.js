import { api } from '../api.js';
import { store } from '../store.js';
import { escapeHtml, swatch } from '../format.js';

// Fiche de contrôle imprimable : liste à plat des pièces d'un projet, à cocher
// et compter à la main en fin de projet. Route : #/projet/12/controle

function todayFr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// Couleur(s) d'une pièce : une seule couleur, ou une par filament pour une pièce multicolore.
// Ordre de repli : couleur saisie sur la ligne, puis couleur de la bobine choisie dans FilaFlow.
function partColors(p) {
  const fils = p.filaments || [];
  const info = f => (f && f.filament_id != null) ? store.filamentsById.get(f.filament_id) : null;
  const one = (f, fallback) => {
    const spool = info(f);
    const name = ((f && f.color_name) || fallback || (spool && spool.color_name) || '').trim();
    return name ? { name, hex: spool ? spool.color_hex : null } : null;
  };
  const list = fils.length > 1
    ? fils.map(f => one(f, null))
    : [one(fils[0], p.color_name)];
  if (fils.length <= 1 && !list[0] && p.color_name && p.color_name.trim()) list[0] = { name: p.color_name.trim(), hex: null };
  return list.filter(Boolean);
}

export async function renderChecklist(el, id) {
  const project = await api.get(`projects/${id}`);
  const parts = project.parts || [];
  const title = `Fiche de contrôle — ${project.code ? project.code + ' · ' : ''}${project.name}`;
  document.title = title;                       // devient le nom proposé à l'enregistrement en PDF

  const totalQty = parts.reduce((s, p) => s + (Number(p.quantity) || 0), 0);

  const rows = parts.map((p, i) => {
    const name = (p.name || '').trim() || (p.file_name || '').trim() || 'Pièce sans nom';
    const file = (p.file_name || '').trim();
    const showFile = file && file !== name;
    const colors = partColors(p);
    const colorCell = colors.length
      ? colors.map(c => `<span class="ck-color">${swatch(c.hex)}${escapeHtml(c.name)}</span>`).join('')
      : '<span class="ck-none">—</span>';
    return `<tr>
      <td class="ck-num">${i + 1}</td>
      <td class="ck-name">${escapeHtml(name)}${showFile ? `<span class="ck-file">${escapeHtml(file)}</span>` : ''}</td>
      <td class="ck-qty">${Number(p.quantity) || 0}</td>
      <td class="ck-colors">${colorCell}</td>
      <td class="ck-box"><span class="ck-square" aria-hidden="true"></span></td>
      <td class="ck-note"></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="ck-toolbar no-print">
      <a href="#/projet/${Number(id)}" class="back-link">Retour au projet</a>
      <button type="button" class="btn btn-primary" id="ck-print">Imprimer la fiche</button>
      <span class="hint">Format A4. Dans la fenêtre d'impression, désactivez « En-têtes et pieds de page » pour un rendu propre.</span>
    </div>
    <article class="ck-sheet">
      <header class="ck-head">
        <h1 class="ck-title">Fiche de contrôle</h1>
        <div class="ck-meta">
          ${project.code ? `<span class="ck-code">${escapeHtml(project.code)}</span>` : ''}
          <span class="ck-project">${escapeHtml(project.name)}</span>
        </div>
        <p class="ck-sub">Éditée le ${todayFr()} · ${parts.length} ligne${parts.length > 1 ? 's' : ''} · ${totalQty} pièce${totalQty > 1 ? 's' : ''} attendue${totalQty > 1 ? 's' : ''}</p>
      </header>
      ${parts.length ? `
      <table class="ck-table">
        <thead><tr>
          <th class="ck-num">N°</th><th class="ck-name">Pièce</th><th class="ck-qty">Qté attendue</th>
          <th class="ck-colors">Couleur</th><th class="ck-box">Présent</th><th class="ck-note">Remarque</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="ck-foot">
        <div class="ck-totals">
          <span>Total attendu : <strong>${totalQty}</strong> pièce${totalQty > 1 ? 's' : ''}</span>
        </div>
        <div class="ck-sign">
          <span>Date du contrôle : <span class="ck-blank"></span></span>
          <span>Contrôlé par / signature : <span class="ck-blank ck-blank-long"></span></span>
        </div>
      </footer>` : '<p class="ck-empty">Ce projet ne contient aucune pièce.</p>'}
    </article>`;

  el.querySelector('#ck-print').addEventListener('click', () => window.print());

  return () => { document.title = 'PrepFlow'; };
}
