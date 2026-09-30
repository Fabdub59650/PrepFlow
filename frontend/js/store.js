import { api } from './api.js';

// État partagé entre les vues
export const store = {
  printers: [],
  filaments: [],             // copie FilaFlow (actifs + archivés)
  filamentsById: new Map(),
  filaflowOnline: null,
  filaflowSyncedAt: null,

  async loadPrinters() {
    this.printers = await api.get('printers');
    return this.printers;
  },

  async loadFilaments({ refresh = false } = {}) {
    const data = await api.get('filaments' + (refresh ? '?refresh=1' : ''));
    this.filaments = data.filaments;
    this.filamentsById = new Map(data.filaments.map(f => [f.id, f]));
    this.filaflowOnline = data.online;
    this.filaflowSyncedAt = data.synced_at;
    renderFilaflowStatus(data);
    return data;
  },
};

function renderFilaflowStatus(data) {
  const el = document.getElementById('filaflow-status');
  if (!el) return;
  el.classList.toggle('is-online', !!data.online);
  el.classList.toggle('is-offline', !data.online);
  const label = el.querySelector('.status-label');
  if (data.online) {
    label.textContent = 'Stock FilaFlow à jour';
    el.title = `${data.filaments.filter(f => !f.archived).length} bobines actives`;
  } else {
    label.textContent = data.synced_at ? 'Stock FilaFlow : dernière copie' : 'FilaFlow injoignable';
    el.title = (data.error || 'FilaFlow ne répond pas')
      + (data.synced_at ? ` — copie du ${data.synced_at}` : '');
  }
}
