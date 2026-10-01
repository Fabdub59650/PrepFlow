// Formats d'affichage et analyse des saisies

export const PART_STATUS = {
  a_trancher: 'À trancher',
  pret:       'Prêt',
  en_cours:   'En cours',
  imprime:    'Imprimé',
};

export const PROJECT_STATUS = {
  preparation: 'En préparation',
  en_cours:    'En cours',
  termine:     'Terminé',
  archive:     'Archivé',
};

/**
 * Analyse un temps saisi à la main. Formats acceptés :
 *   « 1h23 », « 1 h 23 », « 1h23m45s », « 45m », « 30s », « 2h »
 *   « 1:23 » (h:mm), « 1:23:45 » (h:mm:ss)
 *   « 83 » : un nombre seul est lu en minutes
 * Renvoie un nombre de secondes, null si vide, NaN si illisible.
 */
export function parseDuration(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toLowerCase().replace(/,/g, '.');
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);

  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const [, h, m, sec] = colon;
    return (+h) * 3600 + (+m) * 60 + (+(sec || 0));
  }

  // Suite de nombres avec unités : « 1h23 », « 1 h 23 min », « 1h23m45s », « 30s »
  // Un nombre sans unité après des heures compte en minutes, après des minutes en secondes.
  const tokenRe = /(\d+(?:\.\d+)?)\s*(heures?|hr|h|minutes?|min|mn|m|secondes?|sec|s)?/g;
  const rest = s.replace(tokenRe, '').trim();
  if (rest) return NaN;
  let total = 0, prev = null, t;
  while ((t = tokenRe.exec(s)) !== null) {
    const n = parseFloat(t[1]);
    let unit = t[2] ? t[2][0] : null;          // h | m | s
    if (!unit) unit = prev === 'h' ? 'm' : prev === 'm' ? 's' : null;
    if (!unit) return NaN;
    total += unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
    prev = unit;
  }
  if (prev) return Math.round(total);
  return NaN;
}

/** 5400 → « 1 h 30 » ; 1500 → « 25 min » ; 45 → « 45 s » */
export function formatDuration(seconds, { empty = '' } = {}) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return empty;
  const total = Math.round(seconds);
  if (total === 0) return '0 min';
  if (total < 60) return `${total} s`;
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.round((total % 3600) / 60);
  const hh = h + (m === 60 ? 1 : 0);
  const mm = m === 60 ? 0 : m;
  if (days) return `${days} j ${hh} h${mm ? ' ' + String(mm).padStart(2, '0') : ''}`;
  if (hh) return `${hh} h ${String(mm).padStart(2, '0')}`;
  return `${mm} min`;
}

/** Valeur pré-remplie dans l'éditeur de temps : « 1h30 », « 25m » */
export function durationToInput(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (!s) return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
  return (h ? `${h}h` : '') + `${h ? String(m).padStart(2, '0') : m}m${String(s).padStart(2, '0')}s`;
}

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Poids en grammes, en kg au-delà de 1 kg */
export function formatWeight(g, { empty = '' } = {}) {
  if (g === null || g === undefined || Number.isNaN(g)) return empty;
  if (Math.abs(g) >= 1000) return `${nf1.format(g / 1000)} kg`;
  return `${g < 10 ? nf1.format(g) : nf0.format(g)} g`;
}

export function formatMoney(v, { empty = '' } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return empty;
  return eur.format(v);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Nom lisible d'un filament du cache FilaFlow : « Nom (n° de bobine) · étiquette » */
export function filamentLabel(f) {
  if (!f) return 'Filament inconnu';
  let label = f.name || [f.material, f.color_name].filter(Boolean).join(' ') || `Filament ${f.id}`;
  if (f.spool_number && String(f.spool_number).trim()) label += ` (${String(f.spool_number).trim()})`;
  if (f.spool_label && String(f.spool_label).trim()) label += ` · ${String(f.spool_label).trim()}`;
  return label;
}

export function swatch(hex) {
  const c = /^#[0-9a-f]{3,8}$/i.test(hex || '') ? hex : 'transparent';
  return `<span class="swatch" style="--swatch:${c}"></span>`;
}
