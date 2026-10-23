// Dupliquer un projet (v1.23.0) : nom de la copie, puis choix facultatif des bobines par matière + couleur
import { api } from './api.js';
import { store } from './store.js';
import { toast, openDialog } from './ui.js';
import { escapeHtml, filamentLabel, spoolStock, swatch } from './format.js';

const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');

const spoolOption = f => {
  const st = spoolStock(f);
  return `<option value="${f.id}">${escapeHtml(filamentLabel(f))}${st.text ? ' · ' + escapeHtml(st.text) + (st.age ? ' (' + escapeHtml(st.age) + ')' : '') : ''}</option>`;
};

function chooseSpools(project, groups) {
  const active = store.filaments.filter(f => !f.archived);
  const label = g => [g.material, g.color_name].filter(Boolean).join(' ') || 'Sans matière ni couleur';
  const dlg = openDialog({
    title: 'Choisir les bobines',
    confirmLabel: 'Affecter les bobines',
    wide: true,
    build(body) {
      body.innerHTML = `
        <p class="dialog-help">Le projet « ${escapeHtml(project.name)} » (${escapeHtml(project.code || '')}) est créé. Les pièces gardent leur matière et leur couleur,
          mais aucune bobine : choisissez maintenant parmi les bobines disponibles, ou plus tard (Annuler) dans le tableau ou avec « Remplacer une bobine ».</p>
        <div class="dup-spools">${groups.map((g, i) => {
          const same = active.filter(f => (!norm(g.material) || norm(f.material) === norm(g.material))
            && (!norm(g.color_name) || norm(f.color_name) === norm(g.color_name)));
          const sameIds = new Set(same.map(f => f.id));
          const others = active.filter(f => !sameIds.has(f.id));
          const hex = same.length ? same[0].color_hex : null;
          return `<label class="field dup-row"><span>${swatch(hex)}<strong>${escapeHtml(label(g))}</strong>
              <small class="muted"> · ${g.parts} pièce${g.parts > 1 ? 's' : ''}</small></span>
            <select class="select" data-i="${i}">
              <option value="">${same.length ? 'Plus tard' : 'Aucune bobine de cette couleur — plus tard'}</option>
              ${same.map(spoolOption).join('')}
              ${others.length ? `<optgroup label="Autres bobines">${others.map(spoolOption).join('')}</optgroup>` : ''}
            </select></label>`;
        }).join('')}</div>`;
    },
    async onConfirm(body) {
      const assignments = [...body.querySelectorAll('select[data-i]')]
        .filter(s => s.value)
        .map(s => ({ material: groups[+s.dataset.i].material, color_name: groups[+s.dataset.i].color_name, filament_id: +s.value }));
      if (!assignments.length) { toast('Aucune bobine choisie : à faire plus tard', 'info'); return; }
      const r = await api.post(`projects/${project.id}/assign-spools`, { assignments });
      toast(`${r.lines} ligne${r.lines > 1 ? 's' : ''} de filament affectée${r.lines > 1 ? 's' : ''}`);
    },
  });
  // Quelle que soit l'issue (Affecter ou Annuler), on ouvre le nouveau projet
  dlg.addEventListener('close', () => { location.hash = `#/projet/${project.id}`; });
}

/** Ouvre la fenêtre « Dupliquer le projet » ; à la fin, affiche le nouveau projet. */
export function openDuplicateDialog({ id, name }) {
  openDialog({
    title: 'Dupliquer le projet',
    confirmLabel: 'Dupliquer',
    build(body) {
      body.innerHTML = `
        <label class="field"><span>Nom du nouveau projet</span>
          <input type="text" data-k="name" maxlength="150" value="${escapeHtml(`${name} (copie)`)}"></label>
        <p class="dialog-help dup-help"><strong>Copié :</strong> pièces (quantités, fichiers, poids, temps, notes), matière et couleur de chaque filament,
          thèmes, lien, notes et réglages de marge.<br>
          <strong>Non copié :</strong> l'historique d'impressions, l'imprimante, les bobines choisies et l'avancement (toutes les pièces repartent à « Prêt »).
          Un nouveau code de projet est attribué.</p>`;
      body.querySelector('[data-k=name]').select();
    },
    async onConfirm(body) {
      const n = body.querySelector('[data-k=name]').value.trim();
      if (!n) { toast('Le nom du projet est obligatoire', 'error'); return false; }
      const r = await api.post(`projects/${id}/duplicate`, { name: n });
      await store.loadFilaments().catch(() => {});
      toast(`Projet dupliqué : ${r.project.code || ''} ${r.project.name}`.trim());
      if (r.groups.length) setTimeout(() => chooseSpools(r.project, r.groups), 0);
      else location.hash = `#/projet/${r.project.id}`;
    },
  });
}
