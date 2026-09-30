import { api } from '../api.js';
import { toast, promptDialog } from '../ui.js';
import { PROJECT_STATUS, formatDuration, formatWeight, escapeHtml } from '../format.js';

let showArchived = false;

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
  if (!projects.length) {
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Aucun projet pour l'instant</p>
        <p>Un projet regroupe les pièces à imprimer, avec leur filament, leur temps et leur poids.</p>
        <button class="btn btn-primary" data-new>Créer le premier projet</button>
      </div>`;
  } else {
    body.innerHTML = `
      <div class="table-wrap">
      <table class="list-table">
        <thead><tr>
          <th>Projet</th><th>Statut</th><th class="num">Pièces</th>
          <th class="num">Temps total</th><th class="num">Poids total</th><th>Avancement</th>
        </tr></thead>
        <tbody>
        ${projects.map(p => {
          const pct = p.pieces_count ? Math.round(100 * p.pieces_done / p.pieces_count) : 0;
          return `<tr data-id="${p.id}">
            <td><a href="#/projet/${p.id}" class="row-link">${escapeHtml(p.name)}</a></td>
            <td><span class="pill pill-${p.status}">${PROJECT_STATUS[p.status]}</span></td>
            <td class="num">${p.pieces_count}</td>
            <td class="num">${p.total_time_s ? formatDuration(p.total_time_s) : '—'}</td>
            <td class="num">${p.total_weight_g ? formatWeight(p.total_weight_g) : '—'}</td>
            <td><div class="progress" title="${p.pieces_done} / ${p.pieces_count} pièces imprimées">
                  <div class="progress-bar" style="width:${pct}%"></div></div>
                <span class="progress-label">${p.pieces_done} / ${p.pieces_count}</span></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      </div>`;
    body.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        location.hash = `#/projet/${tr.dataset.id}`;
      });
    });
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
