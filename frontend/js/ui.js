// Petits composants d'interface partagés : notifications, fenêtres de dialogue
import { escapeHtml } from './format.js';

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

/**
 * Fenêtre modale basée sur <dialog>.
 * build(body) remplit le corps ; onConfirm() renvoie false pour garder la fenêtre ouverte.
 */
export function openDialog({ title, confirmLabel = 'Enregistrer', danger = false, build, onConfirm, wide = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog' + (wide ? ' dialog-wide' : '');
  dlg.innerHTML = `
    <form method="dialog" class="dialog-form">
      <h2 class="dialog-title">${escapeHtml(title)}</h2>
      <div class="dialog-body"></div>
      <div class="dialog-actions">
        <button type="button" class="btn" data-cancel>Annuler</button>
        <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmLabel)}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const body = dlg.querySelector('.dialog-body');
  build?.(body);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-cancel]').addEventListener('click', close);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const submit = dlg.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const keep = await onConfirm?.(body);
      if (keep !== false) close();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  dlg.showModal();
  body.querySelector('input, select, textarea')?.focus();
  return dlg;
}

export function confirmDialog(title, message, confirmLabel = 'Supprimer') {
  return new Promise(resolve => {
    let done = false;
    const dlg = openDialog({
      title, confirmLabel, danger: true,
      build: b => { b.innerHTML = `<p>${escapeHtml(message)}</p>`; },
      onConfirm: () => { done = true; resolve(true); },
    });
    dlg.addEventListener('close', () => { if (!done) resolve(false); });
  });
}

export function promptDialog(title, label, value = '', confirmLabel = 'Créer') {
  return new Promise(resolve => {
    let done = false;
    const dlg = openDialog({
      title, confirmLabel,
      build: b => {
        b.innerHTML = `<label class="field"><span>${escapeHtml(label)}</span>
          <input type="text" name="value" required maxlength="150" value="${escapeHtml(value)}"></label>`;
      },
      onConfirm: b => {
        const v = b.querySelector('input').value.trim();
        if (!v) return false;
        done = true; resolve(v);
      },
    });
    dlg.addEventListener('close', () => { if (!done) resolve(null); });
  });
}
