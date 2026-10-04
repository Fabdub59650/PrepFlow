import { api } from '../api.js';
import { toast } from '../ui.js';
import { applyColorMode } from '../theme.js';
import { escapeHtml } from '../format.js';
import { openDialog } from '../ui.js';
import { setUpdateBadge } from '../updates.js';

const MODES = [
  ['',            'Atelier sombre (par défaut)'],
  ['light',       'Toujours clair'],
  ['dark',        'Toujours sombre'],
  ['auto-system', 'Suivre le thème du système'],
  ['auto-time',   "Selon l'heure"],
];

const hours = selected => Array.from({ length: 24 }, (_, h) =>
  `<option value="${h}" ${String(h) === String(selected) ? 'selected' : ''}>${h} h</option>`).join('');

export async function renderSettings(el) {
  document.title = 'Paramètres — PrepFlow';
  const s = await api.get('settings');

  el.innerHTML = `
    <div class="page-head"><h1 class="page-title">Paramètres</h1></div>
    <section class="settings-section" aria-labelledby="appearance-title">
      <h2 class="panel-title" id="appearance-title">Apparence</h2>
      <p class="panel-sub">Le bouton en haut à droite bascule directement entre clair et sombre, et remplace le mode choisi ici.</p>
      <div class="settings-row">
        <label class="field">
          <span>Mode d'affichage</span>
          <select class="select" id="color-mode">
            ${MODES.map(([v, l]) => `<option value="${v}" ${v === (s.color_mode || '') ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <div class="field hours-field" id="hours" ${s.color_mode === 'auto-time' ? '' : 'hidden'}>
          <span>Sombre</span>
          <div class="hours-inputs">
            <label>de <select class="select" id="dark-from" aria-label="Début du mode sombre">${hours(s.dark_from)}</select></label>
            <label>à <select class="select" id="dark-to" aria-label="Fin du mode sombre">${hours(s.dark_to)}</select></label>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="needs-title">
      <h2 class="panel-title" id="needs-title">Calcul des besoins</h2>
      <p class="panel-sub">Marge ajoutée aux besoins de filament de la page Besoins, pour couvrir les purges et les impressions ratées.</p>
      <div class="settings-row">
        <label class="field">
          <span>Marge de sécurité</span>
          <span class="input-suffix"><input type="number" id="needs-margin" min="0" max="100" step="1" value="${escapeHtml(s.needs_margin ?? '10')}"><span>%</span></span>
        </label>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="version-title">
      <h2 class="panel-title" id="version-title">Version</h2>
      <p class="panel-sub">Comparée au dernier tag publié sur GitHub (Fabdub59650/prepflow).</p>
      <div id="version-box" class="version-box"><p class="muted">Lecture…</p></div>
    </section>`;

  const modeSel = el.querySelector('#color-mode');
  const fromSel = el.querySelector('#dark-from');
  const toSel   = el.querySelector('#dark-to');
  const hoursEl = el.querySelector('#hours');

  const save = async body => {
    try {
      const saved = await api.put('settings', body);
      applyColorMode(saved.color_mode, saved.dark_from, saved.dark_to);
      toast('Réglage enregistré');
    } catch (e) { toast(e.message, 'error'); }
  };

  modeSel.addEventListener('change', () => {
    hoursEl.hidden = modeSel.value !== 'auto-time';
    save({ color_mode: modeSel.value });
  });
  fromSel.addEventListener('change', () => save({ dark_from: fromSel.value }));
  toSel.addEventListener('change', () => save({ dark_to: toSel.value }));

  // Le bouton de la barre du haut change le mode : garder la liste à jour
  const onToggle = e => {
    modeSel.value = e.detail.mode;
    hoursEl.hidden = true;
  };
  document.addEventListener('prepflow:color-mode', onToggle);

  const marginInput = el.querySelector('#needs-margin');
  marginInput.addEventListener('change', async () => {
    const v = parseInt(marginInput.value, 10);
    if (!Number.isFinite(v) || v < 0 || v > 100) { toast('Marge entre 0 et 100 %', 'error'); marginInput.value = s.needs_margin ?? '10'; return; }
    try { const saved = await api.put('settings', { needs_margin: String(v) }); s.needs_margin = saved.needs_margin; toast('Réglage enregistré'); }
    catch (e) { toast(e.message, 'error'); }
  });

  const stopVersion = initVersionSection(el.querySelector('#version-box'));
  return () => {
    document.removeEventListener('prepflow:color-mode', onToggle);
    stopVersion();
  };
}


/* ── Section Version ─────────────────────────────────────────── */

// Notes du CHANGELOG (Markdown simple) en HTML : titres « ## » et listes « - »
function renderNotes(md) {
  if (!md) return '<p class="muted">Pas de notes pour cette version.</p>';
  const out = [];
  let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^##\s+(.*)/);
    const li = line.match(/^-\s+(.*)/);
    if (!li && inList && !/^\s{2,}\S/.test(line)) { out.push('</ul>'); inList = false; }
    if (h) out.push(`<h3 class="notes-title">${escapeHtml(h[1])}</h3>`);
    else if (li) { if (!inList) { out.push('<ul class="notes-list">'); inList = true; } out.push(`<li>${escapeHtml(li[1])}`); }
    else if (/^\s{2,}\S/.test(line) && inList) out.push(' ' + escapeHtml(line.trim()));
    else if (line.trim() && !/^#\s/.test(line)) out.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

const fmtDate = iso => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';

function initVersionSection(box) {
  let stopped = false;
  let timer = null;

  const draw = (info, { error = null } = {}) => {
    const upToDate = info.latest_version && !info.is_newer;
    box.innerHTML = `
      <dl class="version-grid">
        <dt>Installée</dt><dd><strong>v${escapeHtml(info.current_version || '?')}</strong></dd>
        <dt>Sur GitHub</dt><dd>${info.latest_version ? 'v' + escapeHtml(info.latest_version) : '<span class="muted">non vérifiée</span>'}
          ${info.checked_at ? `<span class="muted"> · vérifiée le ${fmtDate(info.checked_at)}</span>` : ''}</dd>
      </dl>
      ${error ? `<p class="version-error">${escapeHtml(error)}</p>` : ''}
      ${upToDate && !error ? '<p class="version-ok">PrepFlow est à jour.</p>' : ''}
      ${info.is_newer ? `
        <div class="update-card">
          <p class="update-title">Nouvelle version disponible : v${escapeHtml(info.latest_version)}</p>
          <div class="notes">${renderNotes(info.notes)}</div>
          ${info.infra_changes && info.infra_changes.length ? `<p class="version-warn">Cette version modifie aussi le ${escapeHtml(info.infra_changes.join(' et le '))} :
            après la mise à jour, lancez <code>sudo bash scripts/patch.sh</code> sur le Pi.</p>` : ''}
        </div>` : ''}
      <div class="version-actions">
        <button type="button" class="btn" data-check>Vérifier</button>
        ${info.is_newer ? `<button type="button" class="btn btn-primary" data-update>Mettre à jour vers v${escapeHtml(info.latest_version)}</button>` : ''}
      </div>`;
    box.querySelector('[data-check]').addEventListener('click', doCheck);
    box.querySelector('[data-update]')?.addEventListener('click', () => confirmUpdate(info));
  };

  const doCheck = async () => {
    const btn = box.querySelector('[data-check]');
    btn.disabled = true; btn.textContent = 'Vérification…';
    try {
      const info = await api.get('updater/check');
      setUpdateBadge(info.is_newer);
      draw(info);
    } catch (e) {
      const st = await api.get('updater/status').catch(() => ({}));
      draw(st, { error: e.message });
    }
  };

  const confirmUpdate = info => {
    openDialog({
      title: `Mettre à jour vers v${info.latest_version}`,
      confirmLabel: 'Mettre à jour',
      build: b => {
        b.innerHTML = `<p>PrepFlow va télécharger la version depuis GitHub, l'installer puis redémarrer.
          La page se rechargera automatiquement. Comptez une à deux minutes.</p>`;
      },
      onConfirm: async () => {
        await api.post('updater/update', { version: info.latest_version });
        follow(info.latest_version);
      },
    });
  };

  // Suivi de la mise à jour, puis attente du redémarrage
  const follow = target => {
    const show = (text, kind = '') => {
      box.innerHTML = `<p class="update-progress ${kind}">${escapeHtml(text)}</p>`;
    };
    show('Mise à jour lancée…');
    let restarting = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        if (!restarting) {
          const p = await api.get('updater/progress');
          if (p.state === 'error') { show('Échec : ' + p.error + '. Rien n\'a été redémarré ; sur le Pi : sudo bash scripts/patch.sh', 'version-error'); return; }
          if (p.state === 'restarting') restarting = true;
          show(p.step ? p.step + '…' : 'Mise à jour en cours…');
        } else {
          const meta = await api.get('meta');
          if (meta.version === target) {
            show(`PrepFlow v${target} installé. Rechargement…`, 'version-ok');
            setTimeout(() => location.reload(), 1200);
            return;
          }
        }
      } catch (_) {
        restarting = true;
        show('Redémarrage de PrepFlow…');
      }
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        show('Le redémarrage prend plus longtemps que prévu. Vérifiez sur le Pi : sudo journalctl -u prepflow -n 50', 'version-error');
        return;
      }
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 800);
  };

  api.get('updater/status?auto=1')
    .then(info => {
      if (stopped) return;
      setUpdateBadge(info.is_newer);
      if (info.progress && (info.progress.state === 'running' || info.progress.state === 'restarting')) follow(info.progress.version);
      else draw(info);
    })
    .catch(e => draw({}, { error: e.message }));

  return () => { stopped = true; clearTimeout(timer); };
}
