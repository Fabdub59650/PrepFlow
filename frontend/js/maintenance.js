// Maintenance des imprimantes : pastille du menu, avertissement au lancement, libellés d'échéance
import { api } from './api.js';
import { escapeHtml } from './format.js';

/** « dans 42 h », « dans 12 j », « dépassée de 18 h » : la contrainte la plus proche de l'échéance */
export function dueText(t) {
  const parts = [];
  if (t.hours_left !== null && t.hours_left !== undefined) parts.push({ left: t.hours_left, unit: 'h', ratio: t.hours_left / t.interval_hours });
  if (t.days_left !== null && t.days_left !== undefined) parts.push({ left: t.days_left, unit: 'j', ratio: t.days_left / t.interval_days });
  if (!parts.length) return '';
  const w = parts.sort((a, b) => a.ratio - b.ratio)[0];
  const n = Math.abs(Math.round(w.left * 10) / 10).toString().replace('.', ',');
  return w.left < 0 ? `dépassée de ${n} ${w.unit}` : `dans ${n} ${w.unit}`;
}

/** Pastille « Imprimantes » : nombre de tâches dépassées */
export async function updateMaintBadge() {
  try {
    const st = await api.get('maintenance');
    document.querySelectorAll('[data-nav=printers] .nav-badge').forEach(b => {
      b.textContent = st.overdue_total; b.hidden = !st.overdue_total;
    });
  } catch (_) { /* le menu reste tel quel */ }
}

/** Texte d'avertissement HTML pour une imprimante donnée (tâches dépassées), ou '' */
export function overdueWarning(state, printerId) {
  const p = state?.printers?.find(x => x.printer_id === printerId);
  const late = p ? p.tasks.filter(t => t.state === 'overdue') : [];
  if (!late.length) return '';
  return `⚠ ${escapeHtml(p.name)} : ${late.map(t => `${escapeHtml(t.name)} (${dueText(t)})`).join(', ')}.`;
}
