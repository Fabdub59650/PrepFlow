// Paramètres › Thèmes : couleur, renommage, fusion, suppression et totaux par thème
import { api } from './api.js';
import { toast, openDialog, confirmDialog } from './ui.js';
import { escapeHtml, formatDuration, formatWeight, formatMoney } from './format.js';
import { THEME_COLORS, colorAttr } from './themes.js';

const TRASH = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6"/></svg>`;

export async function mountThemesAdmin(box) {
  let themes = [];
  let stats = null;    // Map theme_id → totaux, null tant que le calcul n'est pas arrivé
  let statsFailed = false;

  const fillStats = () => {
    box.querySelectorAll('tr[data-id]').forEach(tr => {
      const s = stats && stats.get(Number(tr.dataset.id));
      const set = (k, v) => { const c = tr.querySelector(`[data-stat="${k}"]`); if (c) c.innerHTML = v; };
      if (statsFailed) { ['pieces', 'time', 'weight', 'cost'].forEach(k => set(k, '—')); return; }
      if (!stats) { ['pieces', 'time', 'weight', 'cost'].forEach(k => set(k, '<span class="muted">…</span>')); return; }
      if (!s) { ['pieces', 'time', 'weight', 'cost'].forEach(k => set(k, '—')); return; }
      set('pieces', String(s.pieces));
      set('time', s.time_s ? formatDuration(s.time_s) : '—');
      set('weight', s.weight_g ? formatWeight(s.weight_g) : '—');
      set('cost', s.cost || s.cost_complete
        ? escapeHtml(formatMoney(s.cost)) + (s.cost_complete ? '' : ' <span class="has-tip" title="Calcul incomplet : prix de bobine, puissance, poids ou temps manquants sur certains projets (voir leur page)">*</span>')
        : '—');
    });
  };

  const loadStats = () => {
    api.get('themes/stats')
      .then(list => { stats = new Map(list.map(s => [s.theme_id, s])); statsFailed = false; fillStats(); })
      .catch(() => { statsFailed = true; fillStats(); });
  };

  const draw = () => {
    if (!themes.length) {
      box.innerHTML = `<p class="muted">Aucun thème pour l'instant. Ajoutez-en depuis la page d'un projet (rangée « Thèmes » sous le titre).</p>`;
      return;
    }
    const unused = themes.filter(t => !t.projects_count).length;
    box.innerHTML = `
      <div class="table-wrap">
      <table class="list-table themes-table">
        <thead><tr>
          <th>Couleur</th><th>Nom</th><th class="num">Projets</th><th class="num">Pièces</th>
          <th class="num">Temps</th><th class="num">Poids</th><th class="num">Coût de revient</th><th></th>
        </tr></thead>
        <tbody>
        ${themes.map(t => `<tr data-id="${t.id}">
          <td><span class="theme-dot"${colorAttr(t.color)}></span>
            <select class="select theme-color" aria-label="Couleur du thème ${escapeHtml(t.name)}">
              <option value="">Neutre</option>
              ${THEME_COLORS.map(([k, l]) => `<option value="${k}" ${k === t.color ? 'selected' : ''}>${l}</option>`).join('')}
            </select></td>
          <td><input class="inline-input theme-name" value="${escapeHtml(t.name)}" maxlength="40" aria-label="Nom du thème"></td>
          <td class="num">${t.projects_count || '<span class="muted">0</span>'}</td>
          <td class="num" data-stat="pieces"></td>
          <td class="num" data-stat="time"></td>
          <td class="num" data-stat="weight"></td>
          <td class="num" data-stat="cost"></td>
          <td class="theme-actions">
            <button type="button" class="btn btn-sm" data-merge ${themes.length < 2 ? 'disabled' : ''}>Fusionner…</button>
            <button type="button" class="icon-btn icon-btn-danger" data-delete aria-label="Supprimer le thème ${escapeHtml(t.name)}" title="Supprimer le thème">${TRASH}</button>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <p class="panel-sub theme-note">Totaux sur tous les projets du thème, archivés compris : pièces, temps et poids du tableau,
        coût de revient de la page projet. Un projet qui a plusieurs thèmes compte dans chacun : n'additionnez pas les lignes.</p>
      ${unused ? `<button type="button" class="btn btn-sm" id="cleanup-themes">Supprimer les ${unused} thème${unused > 1 ? 's' : ''} sans projet</button>` : ''}`;
    fillStats();
    wire();
  };

  const reload = async () => {
    themes = await api.get('themes');
    draw();
    loadStats();
  };

  const findTheme = tr => themes.find(t => t.id === Number(tr.dataset.id));

  const wire = () => {
    box.querySelectorAll('tr[data-id]').forEach(tr => {
      const t = findTheme(tr);
      const dot = tr.querySelector('.theme-dot');

      tr.querySelector('.theme-color').addEventListener('change', async e => {
        const color = e.target.value || null;
        try {
          await api.put(`themes/${t.id}`, { color });
          t.color = color;
          color ? dot.setAttribute('data-color', color) : dot.removeAttribute('data-color');
        } catch (err) { toast(err.message, 'error'); e.target.value = t.color || ''; }
      });

      const nameInput = tr.querySelector('.theme-name');
      nameInput.addEventListener('change', async () => {
        const name = nameInput.value.replace(/\s+/g, ' ').trim();
        if (!name || name === t.name) { nameInput.value = t.name; return; }
        try {
          const row = await api.put(`themes/${t.id}`, { name });
          t.name = row.name;
          nameInput.value = row.name;
          toast('Thème renommé');
        } catch (err) { toast(err.message, 'error'); nameInput.value = t.name; }
      });
      nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

      tr.querySelector('[data-merge]').addEventListener('click', () => {
        const others = themes.filter(o => o.id !== t.id);
        openDialog({
          title: `Fusionner « ${t.name} »`, confirmLabel: 'Fusionner',
          build: b => {
            b.innerHTML = `<label class="field"><span>Fusionner dans</span>
              <select class="select" name="into">${others.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select></label>
              <p class="panel-sub" style="margin-top:10px">${t.projects_count
                ? `Les ${t.projects_count} projet${t.projects_count > 1 ? 's' : ''} de « ${escapeHtml(t.name)} » passeront dans le thème choisi, `
                : ''}puis « ${escapeHtml(t.name)} » sera supprimé. Le nom et la couleur du thème choisi sont conservés.</p>`;
          },
          onConfirm: async b => {
            await api.post(`themes/${t.id}/merge`, { into: Number(b.querySelector('[name=into]').value) });
            toast('Thèmes fusionnés');
            await reload();
          },
        });
      });

      tr.querySelector('[data-delete]').addEventListener('click', async () => {
        const n = t.projects_count;
        const ok = await confirmDialog('Supprimer le thème',
          n ? `« ${t.name} » sera retiré des ${n} projet${n > 1 ? 's' : ''} qui le portent. Les projets sont conservés.`
            : `« ${t.name} » sera supprimé.`);
        if (!ok) return;
        try { await api.del(`themes/${t.id}`); toast('Thème supprimé'); await reload(); }
        catch (err) { toast(err.message, 'error'); }
      });
    });

    box.querySelector('#cleanup-themes')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Supprimer les thèmes sans projet',
        'Les thèmes qui ne sont portés par aucun projet seront supprimés (nom et couleur compris).');
      if (!ok) return;
      try { const r = await api.post('themes/cleanup'); toast(`${r.deleted} thème${r.deleted > 1 ? 's' : ''} supprimé${r.deleted > 1 ? 's' : ''}`); await reload(); }
      catch (err) { toast(err.message, 'error'); }
    });
  };

  try { await reload(); }
  catch (e) { box.innerHTML = `<p class="muted">Thèmes indisponibles : ${escapeHtml(e.message)}</p>`; }
}
