// ── modules/disimballi.js ────────────────────────────────────────────────────
// Tab DISIMBALLI: elenco delle missioni COMPLETATE con la spunta "Disimballo".
// Per ognuna: elemento, punto in cui è stata confermata la consegna, ora di conferma,
// punto di provenienza (origine) ed eventuali note.

import { esc, tsVal } from '../shared-utils.js';

const _dt = v => {
  const t = tsVal(v);
  return t ? new Date(t) : null;
};
const _data = d => d ? d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const _ora = d => d ? d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }) : '—';

export function renderDisimballi() {
  const body = document.getElementById('dis-body');
  if (!body) return;
  const st = window.getAppState?.();
  const righe = (st?.missioni || [])
    .filter(m => m.disimballo && m.stato === 'consegnata')
    .sort((a, b) => tsVal(b.consegnataAt) - tsVal(a.consegnataAt));

  const cnt = document.getElementById('dis-count');
  if (cnt) cnt.textContent = righe.length + (righe.length === 1 ? ' missione completata' : ' missioni completate');

  if (!righe.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">Nessun disimballo completato.</td></tr>';
    return;
  }
  body.innerHTML = righe.map(m => {
    const c = _dt(m.consegnataAt);
    return `<tr>
      <td>${_data(c)}</td>
      <td><b>${_ora(c)}</b></td>
      <td>${esc(m.codice || '—')}</td>
      <td>${esc(m.elementoCodice || '—')}</td>
      <td>${esc(m.consegnaPuntoNome || m.destinazioneNome || '—')}</td>
      <td>${esc(m.origineNome || '—')}</td>
      <td>${m.note ? esc(m.note) : '<span style="color:var(--muted)">—</span>'}</td>
    </tr>`;
  }).join('');
}
