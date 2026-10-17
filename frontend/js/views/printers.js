import { api } from '../api.js';
import { store } from '../store.js';
import { toast, confirmDialog, promptDialog, openDialog } from '../ui.js';
import { escapeHtml, formatMoney, formatDate } from '../format.js';
import { dueText, updateMaintBadge } from '../maintenance.js';

const comma = v => String(v).replace('.', ',');
const hoursText = h => `${comma(Math.round(h * 10) / 10)} h`;
const parseNum = s => { const t = String(s ?? '').trim().replace(',', '.'); return t === '' ? null : Number(t); };

export async function renderPrinters(el) {
  document.title = 'Imprimantes — PrepFlow';
  const printers = await store.loadPrinters();
  let maint = await api.get('maintenance').catch(() => ({ printers: [], overdue_total: 0 }));
  const open = new Set();                         // imprimantes dont le détail de maintenance est ouvert
  const mOf = pid => maint.printers.find(x => x.printer_id === pid);

  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Imprimantes</h1>
      <div class="page-actions"><button class="btn btn-primary" id="add-printer">Ajouter une imprimante</button></div>
    </div>
    <p class="page-sub">La puissance moyenne et l'usure servent au calcul du coût de revient des projets. La maintenance se suit
      aux heures d'impression (durées réelles des impressions terminées) et/ou au calendrier.
      Une imprimante désactivée n'est plus proposée dans les tableaux, mais reste affichée sur les pièces qui l'utilisent.</p>
    <div class="table-wrap">
    <table class="list-table printers-table">
      <thead><tr><th>Nom</th><th>Proposée</th><th class="num" title="Puissance électrique moyenne pendant l'impression">Puissance moy. (W)</th><th class="num" title="Usure : buse, courroies, plateau…">Usure (€/h)</th><th class="num" title="Heures déjà faites avant PrepFlow + impressions terminées">Heures</th><th>Maintenance</th><th class="num">Pièces</th><th></th></tr></thead>
      <tbody id="printers-body"></tbody>
    </table>
    </div>`;

  const body = el.querySelector('#printers-body');

  function maintCell(pid) {
    const m = mOf(pid);
    if (!m || !m.tasks.length) return '<span class="muted">aucune tâche</span>';
    const n = m.next;
    const cls = n.state === 'overdue' ? 'is-overdue' : n.state === 'soon' ? 'is-soon' : 'is-ok';
    return `<span class="maint-pill ${cls}" title="${escapeHtml(n.task)}">${escapeHtml(n.task)} · ${escapeHtml(dueText(m.tasks.find(t => t.name === n.task)))}</span>${m.overdue > 1 ? ` <span class="muted">+${m.overdue - 1}</span>` : ''}`;
  }

  function rowHtml(p) {
    const m = mOf(p.id);
    return `
      <tr data-id="${p.id}">
        <td><input class="inline-input" value="${escapeHtml(p.name)}" data-k="name" aria-label="Nom de l'imprimante" maxlength="100"></td>
        <td><label class="toggle"><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}> ${p.active ? 'Oui' : 'Non'}</label></td>
        <td class="num"><input class="inline-input num-input" inputmode="numeric" data-k="power_w" value="${p.power_w ?? ''}" placeholder="—" aria-label="Puissance moyenne en watts"></td>
        <td class="num"><input class="inline-input num-input" inputmode="decimal" data-k="wear_eur_h" value="${p.wear_eur_h !== null && p.wear_eur_h !== undefined ? comma(Number(p.wear_eur_h)) : ''}" placeholder="—" aria-label="Usure en euros par heure"></td>
        <td class="num">${m ? hoursText(m.hours) : '—'}</td>
        <td><button type="button" class="btn btn-sm btn-ghost maint-toggle" data-maint-toggle aria-expanded="${open.has(p.id)}">${maintCell(p.id)} <span aria-hidden="true">${open.has(p.id) ? '▴' : '▾'}</span></button></td>
        <td class="num">${p.parts_count}</td>
        <td class="num"><button class="btn btn-ghost-danger btn-sm" data-delete>Supprimer</button></td>
      </tr>
      ${open.has(p.id) ? `<tr class="maint-row" data-maint-for="${p.id}"><td colspan="8">${detailHtml(p, m)}</td></tr>` : ''}`;
  }

  function detailHtml(p, m) {
    if (!m) return '<p class="muted">Maintenance indisponible.</p>';
    return `
      <div class="maint-detail">
        <div class="maint-head">
          <label class="field maint-base"><span>Heures déjà faites avant PrepFlow</span>
            <input type="text" inputmode="decimal" data-base value="${comma(m.base_hours)}" aria-label="Heures déjà faites avant PrepFlow"></label>
          <span class="muted">Total actuel : <strong>${hoursText(m.hours)}</strong>${m.cost_per_hour !== null ? ` · coût réel d'entretien ${formatMoney(m.cost_per_hour)} / h (${formatMoney(m.cost_total)} au total)` : ''}</span>
        </div>
        ${m.tasks.length ? `<table class="mini-table maint-tasks">
          <thead><tr><th>Tâche</th><th>Intervalle</th><th>Dernière fois</th><th>Échéance</th><th></th></tr></thead>
          <tbody>${m.tasks.map(t => `<tr data-task="${t.id}">
            <td>${escapeHtml(t.name)}</td>
            <td>${[t.interval_hours ? `${t.interval_hours} h` : '', t.interval_days ? `${t.interval_days} j` : ''].filter(Boolean).join(' ou ')}</td>
            <td>${t.last_at ? `${formatDate(t.last_at)} <span class="muted">à ${hoursText(t.last_hours)}</span>` : '<span class="muted">jamais</span>'}</td>
            <td><span class="maint-pill ${t.state === 'overdue' ? 'is-overdue' : t.state === 'soon' ? 'is-soon' : 'is-ok'}">${escapeHtml(dueText(t))}</span></td>
            <td class="num nowrap">
              <button type="button" class="btn btn-sm btn-primary" data-done>Fait</button>
              <button type="button" class="icon-btn" data-edit title="Modifier la tâche" aria-label="Modifier la tâche">
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 16l1-4 8-8 3 3-8 8-4 1z"/></svg></button>
              <button type="button" class="icon-btn icon-btn-danger" data-del-task title="Supprimer la tâche" aria-label="Supprimer la tâche">
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg></button>
            </td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune tâche pour cette imprimante.</p>'}
        <div class="maint-actions">
          <button type="button" class="btn btn-sm" data-add-task>Ajouter une tâche</button>
          <button type="button" class="btn btn-sm" data-defaults>Ajouter les tâches types</button>
        </div>
        ${m.history.length ? `<h3 class="waste-title">Historique</h3>
          <table class="mini-table"><tbody>${m.history.map(h => `<tr data-log="${h.id}">
            <td class="nowrap">${formatDate(h.done_at, { withTime: true })}</td><td>${escapeHtml(h.task)}</td>
            <td class="num">${hoursText(h.printer_hours)}</td>
            <td>${h.note ? escapeHtml(h.note) : ''}</td>
            <td class="num">${h.cost !== null ? formatMoney(h.cost) : ''}</td>
            <td class="num"><button type="button" class="icon-btn icon-btn-danger" data-del-log title="Retirer cette entrée" aria-label="Retirer cette entrée">
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 5l10 10M15 5L5 15"/></svg></button></td></tr>`).join('')}</tbody></table>` : ''}
      </div>`;
  }

  async function reloadMaint() {
    maint = await api.get('maintenance');
    draw();
    updateMaintBadge();
  }
  const apply = async (promise, msg) => {
    try { maint = await promise; draw(); updateMaintBadge(); if (msg) toast(msg); }
    catch (e) { toast(e.message, 'error'); return false; }
    return true;
  };

  /* Fenêtres */
  function taskDialog(printerId, task = null) {
    return openDialog({
      title: task ? 'Modifier la tâche' : 'Nouvelle tâche de maintenance',
      confirmLabel: task ? 'Enregistrer' : 'Ajouter',
      build(b) {
        b.innerHTML = `
          <label class="field"><span>Nom</span><input type="text" data-k="name" maxlength="100" value="${escapeHtml(task?.name || '')}" placeholder="Nettoyage de la buse"></label>
          <div class="settings-row">
            <label class="field"><span>Toutes les (heures d'impression)</span><input type="text" inputmode="numeric" data-k="h" value="${task?.interval_hours ?? ''}" placeholder="100"></label>
            <label class="field"><span>ou tous les (jours)</span><input type="text" inputmode="numeric" data-k="d" value="${task?.interval_days ?? ''}" placeholder="180"></label>
          </div>
          <p class="dialog-help">Indiquez l'un des deux ou les deux : la première échéance atteinte compte.</p>`;
      },
      async onConfirm(b) {
        const body = { name: b.querySelector('[data-k=name]').value.trim(),
          interval_hours: b.querySelector('[data-k=h]').value.trim() || null,
          interval_days: b.querySelector('[data-k=d]').value.trim() || null };
        const done = await apply(task ? api.put(`maintenance/tasks/${task.id}`, body) : api.post(`printers/${printerId}/maintenance/tasks`, body),
          task ? 'Tâche modifiée' : 'Tâche ajoutée');
        return done;
      },
    });
  }

  function doneDialog(task) {
    return openDialog({
      title: `Fait : ${task.name}`,
      confirmLabel: 'Enregistrer',
      build(b) {
        b.innerHTML = `
          <p class="dialog-help">Le compteur de cette tâche repart de zéro à partir de maintenant.</p>
          <label class="field"><span>Note (facultatif)</span><textarea rows="2" data-k="note" placeholder="Buse remplacée, courroie retendue…"></textarea></label>
          <label class="field"><span>Coût des pièces changées (facultatif)</span>
            <span class="input-suffix"><input type="text" inputmode="decimal" data-k="cost" placeholder="12,50"><span>€</span></span></label>
          <details class="start-time"><summary>Date (si c'était avant)</summary>
            <input type="datetime-local" class="select" data-k="at" aria-label="Date de la maintenance"></details>`;
      },
      async onConfirm(b) {
        const body = { note: b.querySelector('[data-k=note]').value.trim() || undefined,
          cost: b.querySelector('[data-k=cost]').value.trim() || undefined,
          done_at: b.querySelector('[data-k=at]').value || undefined };
        return apply(api.post(`maintenance/tasks/${task.id}/done`, body), 'Maintenance enregistrée');
      },
    });
  }

  /* Dessin et événements */
  function draw() {
    body.innerHTML = printers.map(rowHtml).join('');
    body.querySelectorAll('tr[data-id]').forEach(tr => {
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
      for (const k of ['power_w', 'wear_eur_h']) {
        const inp = tr.querySelector(`[data-k=${k}]`);
        const show = () => { inp.value = p[k] === null || p[k] === undefined ? '' : comma(Number(p[k])); };
        inp.addEventListener('change', async () => {
          const n = parseNum(inp.value);
          if (n !== null && (!Number.isFinite(n) || n < 0)) { toast('Valeur invalide', 'error'); show(); return; }
          try { const saved = await api.put(`printers/${pid}`, { [k]: n }); p[k] = saved[k]; show(); toast('Enregistré'); store.loadPrinters(); }
          catch (e) { toast(e.message, 'error'); show(); }
        });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      }
      tr.querySelector('[data-k=active]').addEventListener('change', async e => {
        try {
          await api.put(`printers/${pid}`, { active: e.target.checked });
          e.target.parentElement.lastChild.textContent = e.target.checked ? ' Oui' : ' Non';
          p.active = e.target.checked ? 1 : 0;
          store.loadPrinters();
        } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
      });
      tr.querySelector('[data-maint-toggle]').addEventListener('click', () => {
        open.has(pid) ? open.delete(pid) : open.add(pid);
        draw();
      });
      tr.querySelector('[data-delete]').addEventListener('click', async () => {
        const msg = p.parts_count
          ? `${p.parts_count} pièce(s) utilisent « ${p.name} ». Elles passeront à « Aucune imprimante ».`
          : `« ${p.name} » sera supprimée.`;
        if (!await confirmDialog("Supprimer l'imprimante", `${msg} Ses tâches de maintenance et leur historique seront supprimés aussi.`)) return;
        try { await api.del(`printers/${pid}`); renderPrinters(el); updateMaintBadge(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });

    body.querySelectorAll('tr.maint-row').forEach(tr => {
      const pid = +tr.dataset.maintFor;
      const m = mOf(pid);
      const base = tr.querySelector('[data-base]');
      base?.addEventListener('change', async () => {
        const n = parseNum(base.value);
        if (n === null || !Number.isFinite(n) || n < 0) { toast('Heures invalides', 'error'); base.value = comma(m.base_hours); return; }
        try { await api.put(`printers/${pid}`, { base_hours: n }); await reloadMaint(); toast('Enregistré'); }
        catch (e) { toast(e.message, 'error'); base.value = comma(m.base_hours); }
      });
      base?.addEventListener('keydown', e => { if (e.key === 'Enter') base.blur(); });
      tr.querySelector('[data-add-task]')?.addEventListener('click', () => taskDialog(pid));
      tr.querySelector('[data-defaults]')?.addEventListener('click', () =>
        apply(api.post(`printers/${pid}/maintenance/defaults`, {}), 'Tâches types ajoutées'));
      tr.querySelectorAll('tr[data-task]').forEach(row => {
        const t = m.tasks.find(x => x.id === +row.dataset.task);
        row.querySelector('[data-done]').addEventListener('click', () => doneDialog(t));
        row.querySelector('[data-edit]').addEventListener('click', () => taskDialog(pid, t));
        row.querySelector('[data-del-task]').addEventListener('click', async () => {
          if (!await confirmDialog('Supprimer la tâche', `« ${t.name} » et son historique seront supprimés.`)) return;
          apply(api.del(`maintenance/tasks/${t.id}`), 'Tâche supprimée');
        });
      });
      tr.querySelectorAll('tr[data-log]').forEach(row => {
        row.querySelector('[data-del-log]').addEventListener('click', async () => {
          if (!await confirmDialog("Retirer l'entrée", 'Cette entrée de l’historique sera retirée ; le compteur de la tâche reprendra la précédente.', 'Retirer')) return;
          apply(api.del(`maintenance/log/${row.dataset.log}`), 'Entrée retirée');
        });
      });
    });
  }

  el.querySelector('#add-printer').addEventListener('click', async () => {
    const name = await promptDialog('Nouvelle imprimante', 'Nom', '', 'Ajouter');
    if (!name) return;
    try { await api.post('printers', { name }); renderPrinters(el); }
    catch (e) { toast(e.message, 'error'); }
  });

  draw();
}
