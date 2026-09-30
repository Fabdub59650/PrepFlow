import { api } from '../api.js';
import { store } from '../store.js';
import { toast, confirmDialog, promptDialog } from '../ui.js';
import { escapeHtml } from '../format.js';

export async function renderPrinters(el) {
  document.title = 'Imprimantes — PrepFlow';
  const printers = await store.loadPrinters();

  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Imprimantes</h1>
      <div class="page-actions"><button class="btn btn-primary" id="add-printer">Ajouter une imprimante</button></div>
    </div>
    <p class="page-sub">Une imprimante désactivée n'est plus proposée dans les tableaux, mais reste affichée sur les pièces qui l'utilisent.</p>
    <div class="table-wrap">
    <table class="list-table printers-table">
      <thead><tr><th>Nom</th><th>Proposée</th><th class="num">Pièces</th><th></th></tr></thead>
      <tbody>
        ${printers.map(p => `
          <tr data-id="${p.id}">
            <td><input class="inline-input" value="${escapeHtml(p.name)}" data-k="name" aria-label="Nom de l'imprimante" maxlength="100"></td>
            <td><label class="toggle"><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}> ${p.active ? 'Oui' : 'Non'}</label></td>
            <td class="num">${p.parts_count}</td>
            <td class="num"><button class="btn btn-ghost-danger btn-sm" data-delete>Supprimer</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;

  el.querySelectorAll('tbody tr').forEach(tr => {
    const pid = +tr.dataset.id;
    const p = printers.find(x => x.id === pid);
    const name = tr.querySelector('[data-k=name]');
    name.addEventListener('change', async () => {
      const v = name.value.trim();
      if (!v) { name.value = p.name; return; }
      try { await api.put(`printers/${pid}`, { name: v }); p.name = v; toast('Imprimante renommée'); }
      catch (e) { toast(e.message, 'error'); name.value = p.name; }
    });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
    tr.querySelector('[data-k=active]').addEventListener('change', async e => {
      try {
        await api.put(`printers/${pid}`, { active: e.target.checked });
        e.target.parentElement.lastChild.textContent = e.target.checked ? ' Oui' : ' Non';
        store.loadPrinters();
      } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
    });
    tr.querySelector('[data-delete]').addEventListener('click', async () => {
      const msg = p.parts_count
        ? `${p.parts_count} pièce(s) utilisent « ${p.name} ». Elles passeront à « Aucune imprimante ».`
        : `« ${p.name} » sera supprimée.`;
      if (!await confirmDialog("Supprimer l'imprimante", msg)) return;
      try { await api.del(`printers/${pid}`); renderPrinters(el); }
      catch (e) { toast(e.message, 'error'); }
    });
  });

  el.querySelector('#add-printer').addEventListener('click', async () => {
    const name = await promptDialog('Nouvelle imprimante', 'Nom', '', 'Ajouter');
    if (!name) return;
    try { await api.post('printers', { name }); renderPrinters(el); }
    catch (e) { toast(e.message, 'error'); }
  });
}
