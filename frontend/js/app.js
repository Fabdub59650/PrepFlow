import { api } from './api.js';
import { toast } from './ui.js';
import { renderProjects } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderPrinters } from './views/printers.js';
import { renderSettings } from './views/settings.js';
import { store } from './store.js';
import { initTheme } from './theme.js';

// Routes : #/  #/projet/12  #/imprimantes
const routes = [
  { re: /^#?\/?$/,               view: renderProjects, nav: 'projects' },
  { re: /^#\/projet\/(\d+)$/,    view: renderProject,  nav: 'projects' },
  { re: /^#\/imprimantes$/,      view: renderPrinters, nav: 'printers' },
  { re: /^#\/parametres$/,       view: renderSettings, nav: 'settings' },
];

let currentCleanup = null;

async function route() {
  const hash = location.hash || '#/';
  const match = routes.map(r => ({ r, m: hash.match(r.re) })).find(x => x.m);
  const content = document.getElementById('content');
  if (currentCleanup) { try { currentCleanup(); } catch (_) {} currentCleanup = null; }

  document.querySelectorAll('.nav-link').forEach(a =>
    a.classList.toggle('active', !!match && a.dataset.nav === match.r.nav));

  if (!match) { location.hash = '#/'; return; }
  content.innerHTML = '<p class="loading">Chargement…</p>';
  try {
    currentCleanup = await match.r.view(content, ...match.m.slice(1)) || null;
  } catch (e) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = e.message;
    content.appendChild(p);
    toast(e.message, 'error');
  }
}

async function init() {
  initTheme();
  try {
    const meta = await api.get('meta');
    document.getElementById('app-version').textContent = 'v' + meta.version;
  } catch (_) {}
  await Promise.all([
    store.loadPrinters().catch(e => toast(e.message, 'error')),
    store.loadFilaments().catch(e => toast(e.message, 'error')),
  ]);
  window.addEventListener('hashchange', route);
  route();
}

init();
