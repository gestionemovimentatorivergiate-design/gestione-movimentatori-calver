// ── modules/disimballi.js ────────────────────────────────────────────────────
// Tab DISIMBALLI: missioni COMPLETATE (consegnate) con la spunta "Disimballo".
//  • In alto i disimballi DA FARE, in basso quelli FATTI.
//  • Un disimballo è FATTO quando l'utente clicca la spunta a destra della riga e risponde SÌ
//    a "Disimballo completato?": la missione riceve disimballoFatto + l'ora di disimballo.
//  • I FATTI mostrano solo gli ultimi 24 ore (i più vecchi si vedono nel tab Storico).
//  • Filtri: Elemento, Punto di origine, Punto di conferma, Giorno e Ora (della conferma consegna).

import { doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { esc, tsVal, showToast } from '../shared-utils.js';

const _dt = v => { const t = tsVal(v); return t ? new Date(t) : null; };
const FMT = { timeZone: 'Europe/Rome' };
const _data = d => d ? d.toLocaleDateString('it-IT', { ...FMT, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const _ora = d => d ? d.toLocaleTimeString('it-IT', { ...FMT, hour: '2-digit', minute: '2-digit' }) : '—';
const _giorno = d => d ? d.toLocaleDateString('sv-SE', FMT) : '';                                      // aaaa-mm-gg
const _hh = d => d ? d.toLocaleTimeString('it-IT', { ...FMT, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2) : '';
const _puntoConferma = m => m.consegnaPuntoNome || m.destinazioneNome || '';
const _tuttiIds = ['dis-f-el', 'dis-f-or', 'dis-f-pc', 'dis-f-gg', 'dis-f-hh'];

export function renderDisimballi() {
  const body = document.getElementById('dis-body');
  if (!body) return;
  const st = window.getAppState?.();
  const tutti = (st?.missioni || []).filter(m => m.disimballo && m.stato === 'consegnata');

  // Filtri a tendina: valori presenti nei disimballi, mantenendo la scelta
  const fill = (id, vals, label) => {
    const sel = document.getElementById(id);
    if (!sel) return '';
    const cur = sel.value;
    const list = [...new Set(vals.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'it', { numeric: true }));
    sel.innerHTML = `<option value="">${label}</option>` + list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (list.includes(cur)) sel.value = cur;
    return sel.value;
  };
  const fEl = fill('dis-f-el', tutti.map(m => m.elementoCodice), 'Tutti');
  const fOr = fill('dis-f-or', tutti.map(m => m.origineNome), 'Tutti');
  const fPc = fill('dis-f-pc', tutti.map(_puntoConferma), 'Tutti');
  const fGg = document.getElementById('dis-f-gg')?.value || '';
  const fHh = document.getElementById('dis-f-hh')?.value || '';

  const passa = m => {
    const c = _dt(m.consegnataAt);
    return (!fEl || m.elementoCodice === fEl) && (!fOr || m.origineNome === fOr) && (!fPc || _puntoConferma(m) === fPc) &&
      (!fGg || _giorno(c) === fGg) && (!fHh || _hh(c) === fHh);
  };
  const filtrati = tutti.filter(passa);
  const fattoAt = m => (m.disimballoFattoAt ? tsVal(m.disimballoFattoAt) : Date.now());   // scrittura in corso → adesso
  const limite = Date.now() - 24 * 3600 * 1000;

  const daFare = filtrati.filter(m => !m.disimballoFatto)
    .sort((a, b) => tsVal(a.consegnataAt) - tsVal(b.consegnataAt));                       // il più vecchio in cima
  const fatti = filtrati.filter(m => m.disimballoFatto && fattoAt(m) >= limite)
    .sort((a, b) => fattoAt(b) - fattoAt(a));
  const fattiTot = tutti.filter(m => m.disimballoFatto).length;

  const nota = m => m.note ? esc(m.note) : '<span style="color:var(--muted)">—</span>';
  const comuni = m => {
    const c = _dt(m.consegnataAt);
    return `<td>${_data(c)}</td><td><b>${_ora(c)}</b></td><td>${esc(m.codice || '—')}</td><td>${esc(m.elementoCodice || '—')}</td>` +
      `<td>${esc(_puntoConferma(m) || '—')}</td><td>${esc(m.origineNome || '—')}</td><td>${nota(m)}</td>`;
  };

  const cD = document.getElementById('dis-count-da');
  if (cD) cD.textContent = `(${daFare.length})`;
  body.innerHTML = daFare.length ? daFare.map(m => `<tr>${comuni(m)}
      <td style="text-align:center;width:70px"><button type="button" class="disSpunta" data-id="${esc(m.id)}" title="Segna come disimballato" aria-label="Disimballo completato"
        style="width:34px;height:34px;border:2.5px solid #16a34a;border-radius:8px;background:#fff;cursor:pointer;padding:0;font-size:22px;line-height:1;color:#16a34a"></button></td></tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">Nessun disimballo da fare.</td></tr>';

  const cF = document.getElementById('dis-count-fatti');
  if (cF) cF.textContent = `(${fatti.length}) — ultime 24 ore` + (fattiTot > fatti.length ? '; i più vecchi sono nel tab Storico' : '');
  const bf = document.getElementById('dis-body-fatti');
  if (bf) bf.innerHTML = fatti.length ? fatti.map(m => `<tr>${comuni(m)}
      <td><b>${_ora(_dt(m.disimballoFattoAt) || new Date())}</b> <span style="font-size:11px;color:var(--muted)">${_data(_dt(m.disimballoFattoAt) || new Date())}</span></td></tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">Nessun disimballo fatto nelle ultime 24 ore.</td></tr>';
}

window.renderDisimballi = renderDisimballi;
// Click sulla spunta: listener unico sulla pagina (resta valido anche quando la tabella si ridisegna)
document.addEventListener('click', e => {
  const b = e.target.closest?.('.disSpunta');
  if (b) window.completaDisimballo(b.dataset.id);
});
window.resetFiltriDisimballi = function () {
  _tuttiIds.forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  renderDisimballi();
};

// Domanda Sì/No: si chiude solo con uno dei due pulsanti
function _chiediFatto(m) {
  return new Promise(resolve => {
    document.getElementById('modalDisimballoFatto')?.remove();
    const ov = document.createElement('div');
    ov.className = 'modalOverlay open';
    ov.id = 'modalDisimballoFatto';
    ov.innerHTML = `<div class="modalBox">
      <h3>📦 Disimballo</h3>
      <div style="font-size:13px;color:var(--muted)">${esc(m.codice || '')}${m.elementoCodice ? ' · ' + esc(m.elementoCodice) : ''}</div>
      <div style="font-size:18px;font-weight:800;margin:8px 0 16px">Disimballo completato?</div>
      <div class="modalActions">
        <button class="btnRed" id="dis-no">NO</button>
        <button class="btnGreen" id="dis-si">SÌ</button>
      </div></div>`;
    document.body.appendChild(ov);
    const fine = v => { ov.remove(); resolve(v); };
    document.getElementById('dis-no').onclick = () => fine(false);
    document.getElementById('dis-si').onclick = () => fine(true);
  });
}

let _inCorso = false;
window.completaDisimballo = async function (id) {
  if (_inCorso) return;
  const st = window.getAppState?.();
  const m = st?.missioni.find(x => x.id === id);
  if (!m) { showToast('Missione non trovata, ricarica la pagina.', 'error'); return; }
  if (m.disimballoFatto) return;
  if (!(await _chiediFatto(m))) return;
  _inCorso = true;
  try {
    const u = window.currentUser || {};
    const ref = doc(window.db, 'missioni', id);
    await runTransaction(window.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Missione non trovata.');
      const cur = snap.data();
      if (!cur.disimballo || cur.stato !== 'consegnata') throw new Error('La missione non è un disimballo completato.');
      if (cur.disimballoFatto) throw new Error('Disimballo già segnato come fatto.');
      tx.update(ref, {
        disimballoFatto: true, disimballoFattoAt: serverTimestamp(),
        disimballoFattoDaUid: u.uid || null, disimballoFattoDaNome: u.name || u.email || null,
      });
    });
    await window.logHistory({
      action: 'Disimballo completato', codice: m.codice || null, elemento: m.elementoCodice,
      origine: m.origineNome, destinazione: m.destinazioneNome, disimballo: true,
      dettaglio: 'Disimballo completato',
    });
    showToast('Disimballo registrato.', 'success');
  } catch (e) {
    showToast('Errore: ' + (e.message || e), 'error');
  } finally {
    _inCorso = false;
    renderDisimballi();
  }
};
