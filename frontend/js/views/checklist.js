import { api } from '../api.js';
import { store } from '../store.js';
import { escapeHtml, swatch, formatDate } from '../format.js';
import { toast, confirmDialog } from '../ui.js';

// Contrôle des pièces d'un projet en fin de projet. Deux vues :
//  - à l'écran (#/projet/12/controle) : liste à plat, une ligne par pièce, compteur « 3 / 4 »,
//    enregistrée au fil de l'eau (téléphone, tablette ou PC) ;
//  - sur papier (#/projet/12/controle/papier) : fiche A4 à imprimer, qui reprend l'état du contrôle.

function todayFr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// Couleur(s) d'une pièce : une seule couleur, ou une par filament pour une pièce multicolore.
// Ordre de repli : couleur saisie sur la ligne, puis couleur de la bobine choisie dans FilaFlow.
export function partColors(p) {
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

// Case « Présent » du papier : vide si pas encore vérifiée, ✓ si complète, « n / total » sinon
function paperBox(p) {
  const q = Number(p.quantity) || 0;
  if (p.check_qty === null || p.check_qty === undefined) return '<span class="ck-square" aria-hidden="true"></span>';
  const n = Math.min(Number(p.check_qty), q);
  return n >= q ? '<span class="ck-square ck-square-ok" aria-label="Présent">✓</span>' : `<span class="ck-partial">${n} / ${q}</span>`;
}

export async function renderChecklistPaper(el, id) {
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
      <td class="ck-box">${paperBox(p)}</td>
      <td class="ck-note">${escapeHtml(p.check_note || '')}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="ck-toolbar no-print">
      <a href="#/projet/${Number(id)}" class="back-link">Retour au projet</a>
      <a href="#/projet/${Number(id)}/controle" class="btn">Contrôler à l'écran</a>
      <button type="button" class="btn btn-primary" id="ck-print">Imprimer la fiche</button>
      <span class="hint">Format A4. Les lignes déjà contrôlées à l'écran sont reprises. Dans la fenêtre d'impression, désactivez « En-têtes et pieds de page » pour un rendu propre.</span>
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
          <span>Date du contrôle : ${project.check_done_at ? `<strong>${formatDate(project.check_done_at)}</strong>` : '<span class="ck-blank"></span>'}</span>
          <span>Contrôlé par / signature : <span class="ck-blank ck-blank-long"></span></span>
        </div>
      </footer>` : '<p class="ck-empty">Ce projet ne contient aucune pièce.</p>'}
    </article>`;

  el.querySelector('#ck-print').addEventListener('click', () => window.print());

  return () => { document.title = 'PrepFlow'; };
}


// ── Vue à l'écran ──────────────────────────────────────────────────────────────────────────────
const partName = p => (p.name || '').trim() || (p.file_name || '').trim() || 'Pièce sans nom';
const qtyOf = p => Number(p.quantity) || 0;
// État d'une ligne : pending (pas vérifiée), ok (complète), partial (comptée mais incomplète)
function stateOf(p) {
  if (p.check_qty === null || p.check_qty === undefined) return 'pending';
  return Math.min(Number(p.check_qty), qtyOf(p)) >= qtyOf(p) ? 'ok' : 'partial';
}

export async function renderChecklist(el, id) {
  const project = await api.get(`projects/${id}`);
  const parts = project.parts || [];
  document.title = `Contrôle — ${project.code ? project.code + ' · ' : ''}${project.name}`;
  let onlyRemaining = false;
  let wakeLock = null;

  // Garde l'écran allumé pendant le contrôle quand le navigateur le permet
  const askWake = async () => {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && !wakeLock) askWake(); };
  askWake();
  document.addEventListener('visibilitychange', onVisible);

  const rowHtml = (p, i) => {
    const q = qtyOf(p), st = stateOf(p);
    const n = st === 'pending' ? null : Math.min(Number(p.check_qty), q);
    const file = (p.file_name || '').trim();
    const colors = partColors(p);
    const colorHtml = colors.length
      ? colors.map(c => `<span class="ck-color">${swatch(c.hex)}${escapeHtml(c.name)}</span>`).join('')
      : '';
    const showNote = st === 'partial' || !!p.check_note;
    return `<li class="cs-row is-${st}" data-id="${p.id}">
      <button type="button" class="cs-main" data-act="toggle" aria-label="${escapeHtml(partName(p))} : tout présent">
        <span class="cs-tick" aria-hidden="true">${st === 'ok' ? '✓' : (i + 1)}</span>
        <span class="cs-info">
          <span class="cs-name">${escapeHtml(partName(p))}</span>
          ${file && file !== partName(p) ? `<span class="ck-file">${escapeHtml(file)}</span>` : ''}
          ${colorHtml ? `<span class="cs-colors">${colorHtml}</span>` : ''}
        </span>
      </button>
      <div class="cs-count" role="group" aria-label="Quantité comptée">
        <button type="button" class="cs-step" data-act="minus" aria-label="Moins une pièce" ${n === null || n <= 0 ? 'disabled' : ''}>−</button>
        <span class="cs-qty"><strong>${n === null ? '–' : n}</strong> / ${q}</span>
        <button type="button" class="cs-step" data-act="plus" aria-label="Plus une pièce" ${n !== null && n >= q ? 'disabled' : ''}>+</button>
      </div>
      <div class="cs-notebox">
        ${showNote
          ? `<input class="cs-note" data-act="note" maxlength="255" placeholder="Remarque (ex. 1 cassée)" value="${escapeHtml(p.check_note || '')}" aria-label="Remarque">`
          : `<button type="button" class="cs-addnote" data-act="addnote">+ remarque</button>`}
      </div>
    </li>`;
  };

  const stats = () => {
    const total = parts.length;
    const totalQty = parts.reduce((s, p) => s + qtyOf(p), 0);
    const lines = parts.filter(p => stateOf(p) !== 'pending').length;
    const pieces = parts.reduce((s, p) => s + (stateOf(p) === 'pending' ? 0 : Math.min(Number(p.check_qty), qtyOf(p))), 0);
    const complete = parts.filter(p => stateOf(p) === 'ok').length;
    const partial = parts.filter(p => stateOf(p) === 'partial').length;
    return { total, totalQty, lines, pieces, complete, partial, pending: total - lines };
  };

  const statusText = () => {
    const s = stats();
    if (project.check_done_at) {
      return s.complete === s.total
        ? `Contrôle terminé le ${formatDate(project.check_done_at, { withTime: true })} : tout est présent.`
        : `Contrôle terminé le ${formatDate(project.check_done_at, { withTime: true })} : ${s.total - s.complete} ligne${s.total - s.complete > 1 ? 's' : ''} incomplète${s.total - s.complete > 1 ? 's' : ''}.`;
    }
    return s.lines ? 'Contrôle en cours' : 'Contrôle pas encore commencé';
  };

  const render = () => {
    const s = stats();
    const shown = parts.map((p, i) => ({ p, i })).filter(({ p }) => !onlyRemaining || stateOf(p) !== 'ok');
    const pct = s.total ? Math.round((s.lines / s.total) * 100) : 0;
    const allOk = s.total > 0 && s.complete === s.total;
    el.innerHTML = `
      <div class="ck-toolbar no-print">
        <a href="#/projet/${Number(id)}" class="back-link">Retour au projet</a>
        <a href="#/projet/${Number(id)}/controle/papier" class="btn">Version papier</a>
      </div>
      <section class="cs">
        <header class="cs-head">
          <h1 class="cs-title">Contrôle des pièces</h1>
          <div class="ck-meta">
            ${project.code ? `<span class="ck-code">${escapeHtml(project.code)}</span>` : ''}
            <span class="cs-project">${escapeHtml(project.name)}</span>
          </div>
          <p class="cs-status ${project.check_done_at ? (allOk ? 'is-done' : 'is-warn') : ''}" id="cs-status">${statusText()}</p>
        </header>
        ${parts.length ? `
        <div class="cs-bar">
          <div class="cs-bar-top">
            <span class="cs-bar-text"><strong>${s.lines} / ${s.total}</strong> ligne${s.total > 1 ? 's' : ''} · <strong>${s.pieces} / ${s.totalQty}</strong> pièce${s.totalQty > 1 ? 's' : ''}</span>
            <label class="cs-filter"><input type="checkbox" id="cs-only" ${onlyRemaining ? 'checked' : ''}> Reste à vérifier</label>
          </div>
          <div class="cs-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${s.total}" aria-valuenow="${s.lines}"><span style="width:${pct}%"></span></div>
          ${s.partial ? `<span class="cs-warn">${s.partial} ligne${s.partial > 1 ? 's' : ''} incomplète${s.partial > 1 ? 's' : ''}</span>` : ''}
        </div>
        <ul class="cs-list" id="cs-list">
          ${shown.length ? shown.map(({ p, i }) => rowHtml(p, i)).join('') : '<li class="cs-allok">Tout est vérifié et complet.</li>'}
        </ul>
        <footer class="cs-actions">
          <button type="button" class="btn btn-primary" id="cs-finish">Terminer le contrôle</button>
          ${allOk && !['termine', 'archive'].includes(project.status)
            ? '<button type="button" class="btn" id="cs-project-done">Marquer le projet terminé</button>' : ''}
          <button type="button" class="btn btn-ghost-danger" id="cs-reset" ${s.lines || project.check_done_at ? '' : 'disabled'}>Recommencer</button>
        </footer>` : '<p class="ck-empty">Ce projet ne contient aucune pièce.</p>'}
      </section>`;
    bind();
  };

  // Enregistre une ligne : mise à jour immédiate de l'écran, annulée si le serveur refuse
  const save = async (part, qty, note) => {
    const before = { q: part.check_qty, n: part.check_note, d: project.check_done_at };
    part.check_qty = qty; part.check_note = note; project.check_done_at = null;
    render();
    try {
      await api.put(`parts/${part.id}/check`, { qty, note });
    } catch (e) {
      part.check_qty = before.q; part.check_note = before.n; project.check_done_at = before.d;
      render();
      toast(e.message, 'error');
    }
  };

  function bind() {
    el.querySelector('#cs-only')?.addEventListener('change', e => { onlyRemaining = e.target.checked; render(); });

    el.querySelector('#cs-list')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      const row = e.target.closest('.cs-row');
      if (!btn || !row || btn.tagName === 'INPUT') return;
      const part = parts.find(p => p.id === Number(row.dataset.id));
      if (!part) return;
      const q = qtyOf(part), st = stateOf(part);
      const cur = st === 'pending' ? 0 : Math.min(Number(part.check_qty), q);
      const act = btn.dataset.act;
      if (act === 'toggle') save(part, st === 'ok' ? null : q, part.check_note);     // tap : tout présent / à vérifier
      else if (act === 'plus') save(part, Math.min(q, cur + 1), part.check_note);
      else if (act === 'minus') save(part, Math.max(0, cur - 1), part.check_note);
      else if (act === 'addnote') {
        btn.outerHTML = '<input class="cs-note" data-act="note" maxlength="255" placeholder="Remarque (ex. 1 cassée)" aria-label="Remarque">';
        row.querySelector('.cs-note')?.focus();
      }
    });

    el.querySelector('#cs-list')?.addEventListener('change', e => {
      if (!e.target.matches('.cs-note')) return;
      const part = parts.find(p => p.id === Number(e.target.closest('.cs-row').dataset.id));
      const val = e.target.value.trim() || null;
      if (part && val !== (part.check_note || null)) save(part, part.check_qty ?? null, val);
    });

    el.querySelector('#cs-finish')?.addEventListener('click', async () => {
      const s = stats();
      const open = s.total - s.complete;
      if (open > 0) {
        const msg = `${open} ligne${open > 1 ? 's ne sont pas vérifiées ou sont' : ' n\'est pas vérifiée ou est'} incomplète${open > 1 ? 's' : ''}. Terminer quand même le contrôle ?`;
        if (!await confirmDialog('Terminer le contrôle', msg, 'Terminer quand même')) return;
      }
      try {
        const r = await api.post(`projects/${id}/check/finish`);
        project.check_done_at = r.check_done_at;
        toast('Contrôle terminé', 'success');
        render();
      } catch (e) { toast(e.message, 'error'); }
    });

    el.querySelector('#cs-reset')?.addEventListener('click', async () => {
      if (!await confirmDialog('Recommencer le contrôle', 'Toutes les cases, quantités et remarques de ce projet seront effacées.', 'Recommencer')) return;
      try {
        await api.post(`projects/${id}/check/reset`);
        parts.forEach(p => { p.check_qty = null; p.check_note = null; });
        project.check_done_at = null;
        render();
      } catch (e) { toast(e.message, 'error'); }
    });

    el.querySelector('#cs-project-done')?.addEventListener('click', async () => {
      try {
        await api.put(`projects/${id}`, { status: 'termine' });
        project.status = 'termine';
        toast('Projet marqué terminé', 'success');
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  render();

  return () => {
    document.title = 'PrepFlow';
    document.removeEventListener('visibilitychange', onVisible);
    try { wakeLock && wakeLock.release(); } catch (_) {}
  };
}
