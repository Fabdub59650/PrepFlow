// Paramètres › Calibration : écart entre le poids prévu et la consommation mesurée par les pesées FilaFlow
import { api } from './api.js';
import { escapeHtml, formatWeight, formatDate, swatch } from './format.js';

const coefText = k => (k === null || k === undefined ? '—' : `× ${String(k).replace('.', ',')}`);
const pctText = k => (k === null || k === undefined ? '' : `${k >= 1 ? '+' : '−'}${Math.abs(Math.round((k - 1) * 100))} %`);

export async function mountCalibration(box) {
  let c;
  try { c = await api.get('calibration'); }
  catch (e) { box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; return; }
  const th = c.thresholds;
  if (!c.spools.length) {
    box.innerHTML = `<p class="muted">Pas encore de mesure : il faut au moins deux pesées d'une même bobine dans FilaFlow
      avec des impressions terminées dans PrepFlow entre les deux.</p>`;
    return;
  }
  const o = c.overall;
  const summary = o.k !== null
    ? `Sur l'ensemble : <b>${coefText(o.k)}</b> (${pctText(o.k)}), soit ${formatWeight(o.measured_g)} mesurés pour ${formatWeight(o.planned_g)} prévus,
       sur ${o.intervals} intervalle${o.intervals > 1 ? 's' : ''} entre pesées.`
    : 'Aucun intervalle exploitable pour le moment.';
  const levelText = r => (r.level ? `par ${r.level}` : `données insuffisantes`);
  box.innerHTML = `
    <p class="calib-summary">${summary}</p>
    <div class="table-wrap"><table class="mini-table calib-table">
      <thead><tr><th>Bobine</th><th class="num">Intervalles</th><th class="num">Prévu</th><th class="num">Mesuré</th>
        <th class="num">Coefficient</th><th>Retenu</th></tr></thead>
      <tbody>${c.spools.map(r => `
        <tr>
          <td>${swatch(r.color_hex)} ${escapeHtml(r.name || '')}${r.spool_number ? ` <span class="muted">(${escapeHtml(r.spool_number)})</span>` : ''}</td>
          <td class="num">${r.own.intervals}${r.excluded ? ` <span class="muted" title="Intervalles écartés (voir le détail)">+${r.excluded} écartés</span>` : ''}</td>
          <td class="num">${r.own.planned_g ? formatWeight(r.own.planned_g) : '—'}</td>
          <td class="num">${r.own.measured_g ? formatWeight(r.own.measured_g) : '—'}</td>
          <td class="num">${coefText(r.own.k)}</td>
          <td>${r.k !== null ? `<b>${coefText(r.k)}</b> <span class="muted">${levelText(r)}${r.clamped ? ` · plafonné à ${coefText(r.k_applied)}` : ''}</span>`
              : `<span class="muted">${levelText(r)}</span>`}</td>
        </tr>
        <tr class="calib-detail"><td colspan="6"><details><summary>Détail des pesées</summary>
          <ul>${r.recent.map(i => `<li class="${i.ok ? '' : 'is-skipped'}">${formatDate(i.from)} → ${formatDate(i.to)} :
            ${formatWeight(i.measured_g)} mesurés, ${i.planned_g ? formatWeight(i.planned_g) : '0 g'} prévus (${i.runs} impression${i.runs > 1 ? 's' : ''})
            ${i.ok ? '' : `<span class="muted">— écarté : ${escapeHtml(i.reason)}</span>`}</li>`).join('')}</ul></details></td></tr>`).join('')}
      </tbody></table></div>
    <p class="panel-sub">Un coefficient n'est retenu qu'à partir de ${th.min_intervals} intervalles et ${formatWeight(th.min_planned_g)} prévus ;
      sinon on prend celui du même filament (matière + couleur), puis de la même matière. Le coefficient retenu est plafonné
      entre ${coefText(th.clamp[0])} et ${coefText(th.clamp[1])}. Seuls les poids jamais corrigés à la main sont ajustés ; la case ci-dessus l'active ou le coupe.</p>`;
}
