// ── modules/navetta.js ────────────────────────────────────────────────────────
// Ruolo AUTISTA (navetta):
//  • Coda unica: pieni da consegnare (missioni 'richiesta') + vuoti da riportare
//    (rientri 'da_rientrare'). La navetta seleziona cosa svolgere — nessuna
//    assegnazione automatica.
//  • In corso: ciò che ha preso in carico ('in_transito' con navettaId = suo) →
//    conferma consegna/rientro.
//
// La presa in carico usa una transazione: garantisce che l'elemento sia ancora
// disponibile ed evita che due navette prendano la stessa missione.

import {
  doc, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDur, tsVal } from '../shared-utils.js';

let _getState, _getUser;

export function initNavetta({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

// ── CODA UNICA ───────────────────────────────────────────────────────────────
export function renderCoda() {
  const el = document.getElementById('coda-list');
  if (!el) return;
  const st = _getState();

  const pieni = st.missioni
    .filter(m => m.stato === 'richiesta')
    .map(m => ({ ...m, _kind: 'missione', _ts: tsVal(m.createdAt) }));
  const vuoti = st.rientri
    .filter(r => r.stato === 'da_rientrare')
    .map(r => ({ ...r, _kind: 'rientro', _ts: tsVal(r.createdAt) }));

  const coda = pieni.concat(vuoti).sort((a, b) => a._ts - b._ts); // più vecchie in cima

  // Statistiche in cima
  const statsEl = document.getElementById('coda-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="statCard orange"><div class="val">${pieni.length}</div><div class="lbl">Pieni da consegnare</div></div>
      <div class="statCard blue"><div class="val">${vuoti.length}</div><div class="lbl">Vuoti da riportare</div></div>`;
  }

  if (!coda.length) { el.innerHTML = '<div class="emptyState">Nessuna missione in coda. 👍</div>'; return; }
  el.innerHTML = coda.map(_cardCoda).join('');
}

function _cardCoda(item) {
  const isPieno = item._kind === 'missione';
  const tipoBadge = isPieno
    ? '<span class="mTipoBadge pieno">Pieno</span>'
    : '<span class="mTipoBadge vuoto">Vuoto</span>';
  const fn = isPieno ? 'prendiMissione' : 'prendiRientro';
  return `
    <div class="mCard ${isPieno ? 'pieno' : 'vuoto'}">
      <div class="mHead">
        <span class="mElemento">${esc(item.elementoCodice)}</span>
        ${tipoBadge}
        <span class="mStatoBadge ${isPieno ? 'richiesta' : 'da_rientrare'}">In coda</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(item.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(item.destinazioneNome)}</span></div>
      <div class="mMeta">⏱ in coda da ${fmtDur(item.createdAt)}</div>
      <div class="mActions">
        <button class="btnGreen" onclick="${fn}('${item.id}')">🚚 Prendi in carico</button>
      </div>
    </div>`;
}

// ── IN CORSO ─────────────────────────────────────────────────────────────────
export function renderInCorso() {
  const el = document.getElementById('incorso-list');
  if (!el) return;
  const st = _getState();
  const u = _getUser();

  const pieni = st.missioni
    .filter(m => m.stato === 'in_transito' && m.navettaId === u.uid)
    .map(m => ({ ...m, _kind: 'missione', _ts: tsVal(m.presaInCaricoAt) }));
  const vuoti = st.rientri
    .filter(r => r.stato === 'in_transito' && r.navettaId === u.uid)
    .map(r => ({ ...r, _kind: 'rientro', _ts: tsVal(r.presaInCaricoAt) }));

  const inCorso = pieni.concat(vuoti).sort((a, b) => a._ts - b._ts);

  if (!inCorso.length) { el.innerHTML = '<div class="emptyState">Nessuna missione in corso. Prendine una dalla coda.</div>'; return; }
  el.innerHTML = inCorso.map(_cardInCorso).join('');
}

function _cardInCorso(item) {
  const isPieno = item._kind === 'missione';
  const fn = isPieno ? 'confermaMissione' : 'confermaRientro';
  const label = isPieno ? '✅ Conferma consegna' : '✅ Conferma rientro';
  return `
    <div class="mCard ${isPieno ? 'pieno' : 'vuoto'}">
      <div class="mHead">
        <span class="mElemento">${esc(item.elementoCodice)}</span>
        <span class="mTipoBadge ${isPieno ? 'pieno' : 'vuoto'}">${isPieno ? 'Pieno' : 'Vuoto'}</span>
        <span class="mStatoBadge in_transito">In transito</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(item.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(item.destinazioneNome)}</span></div>
      <div class="mMeta">Preso in carico da ${fmtDur(item.presaInCaricoAt)}</div>
      <div class="mActions">
        <button class="btnGreen" onclick="${fn}('${item.id}')">${label}</button>
      </div>
    </div>`;
}

// ── PRESA IN CARICO (transazione: evita doppie assegnazioni) ──────────────────
async function _prendi(coll, id, statoAtteso) {
  const u = _getUser();
  const ref = doc(window.db, coll, id);
  await runTransaction(window.db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Elemento non più presente');
    if (snap.data().stato !== statoAtteso) throw new Error('Già preso da un altro');
    tx.update(ref, {
      stato: 'in_transito',
      navettaId: u.uid,
      navettaNome: u.name || u.email,
      presaInCaricoAt: serverTimestamp(),
    });
  });
}

window.prendiMissione = async function (id) {
  const m = _getState().missioni.find(x => x.id === id);
  try {
    await _prendi('missioni', id, 'richiesta');
    if (m) await window.logHistory({ action: 'Pieno preso in carico', elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Missione presa in carico.', 'success');
  } catch (e) { showToast(e.message || 'Errore', 'error'); }
};

window.prendiRientro = async function (id) {
  const r = _getState().rientri.find(x => x.id === id);
  try {
    await _prendi('rientri', id, 'da_rientrare');
    if (r) await window.logHistory({ action: 'Vuoto preso in carico', elemento: r.elementoCodice, origine: r.origineNome, destinazione: r.destinazioneNome });
    showToast('Rientro preso in carico.', 'success');
  } catch (e) { showToast(e.message || 'Errore', 'error'); }
};

// ── CONFERMA FINE MISSIONE ────────────────────────────────────────────────────
async function _conferma(coll, id, statoAtteso, statoFinale, campoData) {
  const u = _getUser();
  const ref = doc(window.db, coll, id);
  await runTransaction(window.db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Elemento non più presente');
    const d = snap.data();
    if (d.stato !== statoAtteso) throw new Error('Stato non valido');
    if (d.navettaId !== u.uid) throw new Error('Non è la tua missione');
    tx.update(ref, { stato: statoFinale, [campoData]: serverTimestamp() });
  });
}

window.confermaMissione = async function (id) {
  const m = _getState().missioni.find(x => x.id === id);
  try {
    await _conferma('missioni', id, 'in_transito', 'consegnata', 'consegnataAt');
    if (m) await window.logHistory({ action: 'Consegna completata', elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Consegna confermata.', 'success');
  } catch (e) { showToast(e.message || 'Errore', 'error'); }
};

window.confermaRientro = async function (id) {
  const r = _getState().rientri.find(x => x.id === id);
  try {
    await _conferma('rientri', id, 'in_transito', 'rientrato', 'rientratoAt');
    if (r) await window.logHistory({ action: 'Rientro completato', elemento: r.elementoCodice, origine: r.origineNome, destinazione: r.destinazioneNome });
    showToast('Rientro confermato.', 'success');
  } catch (e) { showToast(e.message || 'Errore', 'error'); }
};
