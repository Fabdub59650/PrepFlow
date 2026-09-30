// Mode clair / sombre — même fonctionnement que FilaFlow.
// color_mode : ''            Atelier sombre (par défaut)
//              'light'       Toujours clair
//              'dark'        Toujours sombre
//              'auto-system' Suivre le thème du système
//              'auto-time'   Selon l'heure (sombre de dark_from à dark_to)
import { api } from './api.js';

const STORAGE_KEY = 'prepflow_scheme';   // dernier rendu, appliqué avant l'affichage (index.html)
const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"></path></svg>';

export const theme = {
  mode: '',
  darkFrom: '20',
  darkTo: '7',
};

let timer = null;
let mq = null;
let mqHandler = null;

function setScheme(scheme) {
  const root = document.documentElement;
  root.setAttribute('data-color-scheme', scheme);
  try { localStorage.setItem(STORAGE_KEY, scheme); } catch (_) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', scheme === 'light' ? '#ECEAE5' : '#141517');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const label = scheme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

export function isDarkHour(hour, from, to) {
  const f = parseInt(from, 10), t = parseInt(to, 10);
  const df = Number.isFinite(f) ? f : 20, dt = Number.isFinite(t) ? t : 7;
  if (df === dt) return false;
  return df > dt ? (hour >= df || hour < dt) : (hour >= df && hour < dt);
}

export function applyColorMode(mode, darkFrom = theme.darkFrom, darkTo = theme.darkTo) {
  theme.mode = mode || '';
  theme.darkFrom = String(darkFrom ?? '20');
  theme.darkTo = String(darkTo ?? '7');

  if (timer) { clearInterval(timer); timer = null; }
  if (mq && mqHandler) { mq.removeEventListener('change', mqHandler); mq = mqHandler = null; }

  if (theme.mode === 'light') setScheme('light');
  else if (theme.mode === 'auto-system') {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mqHandler = e => setScheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', mqHandler);
    setScheme(mq.matches ? 'dark' : 'light');
  } else if (theme.mode === 'auto-time') {
    const check = () => setScheme(isDarkHour(new Date().getHours(), theme.darkFrom, theme.darkTo) ? 'dark' : 'light');
    check();
    timer = setInterval(check, 60_000);
  } else setScheme('dark');   // '' ou 'dark' : graphite
}

/** Bouton de la barre du haut : force clair ou sombre (remplace un mode automatique) */
export async function toggleScheme() {
  const next = document.documentElement.getAttribute('data-color-scheme') === 'light' ? 'dark' : 'light';
  applyColorMode(next);
  try { await api.put('settings', { color_mode: next }); } catch (_) {}
  document.dispatchEvent(new CustomEvent('prepflow:color-mode', { detail: { mode: next } }));
}

export async function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = ICON;
    btn.addEventListener('click', toggleScheme);
  }
  // Rendu provisoire depuis le navigateur, puis réglage en base
  applyColorMode(document.documentElement.getAttribute('data-color-scheme') === 'light' ? 'light' : '');
  try {
    const s = await api.get('settings');
    applyColorMode(s.color_mode, s.dark_from, s.dark_to);
  } catch (_) {}
}
