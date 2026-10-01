// Pastille « mise à jour disponible » sur le lien Paramètres
import { api } from './api.js';

export function setUpdateBadge(on) {
  const link = document.querySelector('.nav-link[data-nav="settings"]');
  if (!link) return;
  link.classList.toggle('has-update', !!on);
  link.title = on ? 'Une nouvelle version de PrepFlow est disponible' : '';
}

// Au chargement : état connu, vérification GitHub si la dernière date de plus de 6 h
export function initUpdateBadge() {
  api.get('updater/status?auto=1').then(s => setUpdateBadge(s.is_newer)).catch(() => {});
}
