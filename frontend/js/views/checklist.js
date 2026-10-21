import { api } from '../api.js';
import { escapeHtml } from '../format.js';

// Fiche de contrôle imprimable : liste à plat des pièces d'un projet, à cocher
// et compter à la main en fin de projet. Route : #/projet/12/controle

function todayFr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
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
    return `<tr>
      <td class="ck-num">${i + 1}</td>
      <td class="ck-name">${escapeHtml(name)}${showFile ? `<span class="ck-file">${escapeHtml(file)}</span>` : ''}</td>
      <td class="ck-qty">${Number(p.quantity) || 0}</td>
      <td class="ck-box"><span class="ck-square" aria-hidden="true"></span></td>
      <td class="ck-count"></td>
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
          <th class="ck-box">Présent</th><th class="ck-count">Qté comptée</th><th class="ck-note">Remarque</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="ck-foot">
        <div class="ck-totals">
          <span>Total attendu : <strong>${totalQty}</strong></span>
          <span>Total compté : <span class="ck-blank"></span></span>
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
