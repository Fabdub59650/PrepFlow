// Image d'un projet : adresse, réduction côté navigateur, fenêtre d'ajout (fichier, glisser-déposer, Ctrl+V)
import { api } from './api.js';
import { openDialog, toast } from './ui.js';
import { escapeHtml } from './format.js';

const MAX_SIDE = 900;      // plus grand côté, en pixels
const QUALITY = 0.85;

/** Adresse de l'image d'un projet (null si le projet n'en a pas). `version` change à chaque remplacement. */
export const photoUrl = p => (p && p.photo_v ? `api/projects/${Number(p.id)}/photo?v=${Number(p.photo_v)}` : null);

/** Vignette HTML (ou '' sans image) */
export const photoThumb = (p, cls = 'proj-thumb') => {
  const u = photoUrl(p);
  return u ? `<img class="${cls}" src="${u}" alt="" loading="lazy" decoding="async">` : '';
};

/** Fichier ou presse-papiers (PNG, JPEG, WebP…) → data URL JPEG réduite, fond blanc (les captures transparentes ne noircissent pas) */
export async function toJpegDataUrl(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Ce fichier n'est pas une image lisible"));
      i.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', QUALITY);
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Fenêtre « Image du projet » : choisir un fichier, glisser une image, ou coller une capture (Ctrl+V).
 * onDone(photo_v | null) après enregistrement (null = image retirée).
 */
export function openPhotoDialog({ project, onDone }) {
  let pending = null;                       // data URL en attente d'enregistrement
  let removed = false;
  const current = photoUrl(project);
  const onPaste = async e => {
    const f = [...(e.clipboardData?.items || [])].find(it => it.type.startsWith('image/'))?.getAsFile();
    if (!f) return;
    e.preventDefault();
    await take(f);
  };
  let draw = () => {};
  async function take(file) {
    try { pending = await toJpegDataUrl(file); removed = false; draw(); }
    catch (err) { toast(err.message, 'error'); }
  }
  const dlg = openDialog({
    title: current ? "Changer l'image du projet" : "Ajouter une image au projet",
    confirmLabel: 'Enregistrer',
    build(body) {
      body.innerHTML = `
        <p class="dialog-help">Une image par projet : capture du slicer, image du modèle… Elle est réduite automatiquement.</p>
        <div class="photo-drop" data-drop tabindex="0">
          <div class="photo-preview" data-preview></div>
          <p class="photo-hint"><strong>Collez</strong> une capture (Ctrl+V), <strong>glissez</strong> une image ici, ou</p>
          <button type="button" class="btn" data-pick>Choisir un fichier…</button>
          <input type="file" accept="image/*" data-file hidden>
        </div>
        ${current ? '<button type="button" class="link-btn" data-photo-remove>Retirer l\'image</button>' : ''}`;
      const prev = body.querySelector('[data-preview]');
      draw = () => {
        const src = pending || (removed ? null : current);
        prev.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="Aperçu de l'image">` : '';
        prev.hidden = !src;
      };
      draw();
      const file = body.querySelector('[data-file]'), drop = body.querySelector('[data-drop]');
      body.querySelector('[data-pick]').addEventListener('click', () => file.click());
      file.addEventListener('change', () => { if (file.files[0]) take(file.files[0]); });
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', e => { const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/')); if (f) take(f); });
      body.querySelector('[data-photo-remove]')?.addEventListener('click', () => { pending = null; removed = true; draw(); });
      document.addEventListener('paste', onPaste);
    },
    async onConfirm() {
      if (pending) {
        const r = await api.put(`projects/${project.id}/photo`, { image: pending });
        await onDone?.(r.photo_v);
      } else if (removed) {
        await api.del(`projects/${project.id}/photo`);
        await onDone?.(null);
      } else return false;                 // rien à enregistrer : on garde la fenêtre ouverte
    },
  });
  // Nettoyage de l'écouteur à la fermeture (dialog retiré du document)
  const obs = new MutationObserver(() => { if (!dlg.isConnected) { document.removeEventListener('paste', onPaste); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  return dlg;
}
