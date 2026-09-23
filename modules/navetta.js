// ── modules/navetta.js ────────────────────────────────────────────────────────
// Ruolo MOVIMENTATORE (ex "autista"):
//  • Un unico tab "In corso" che unifica coda e presi in carico.
//    - Elementi da prendere (missioni 'richiesta' + rientri 'da_rientrare')
//      → pulsante GIALLO "Prendi in carico".
//    - Elementi già presi da lui ('in_transito' col suo id)
//      → la card resta al suo posto, il pulsante diventa VERDE
//        "Conferma consegna/rientro".
//    Nessuna assegnazione automatica: il movimentatore sceglie.
//
// L'AMMINISTRATORE vede lo stesso tab, con TUTTI gli 'in_transito' (non solo i
// propri), per supervisione, e può confermarli.
//
// La presa in carico e la conferma usano transazioni: niente doppie assegnazioni.

import {
  doc, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDur, tsVal } from '../shared-utils.js';

let _getState, _getUser;

export function initNavetta({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

// ── TAB UNICO "IN CORSO" (coda + presi in carico) ─────────────────────────────
export function renderInCorso() {
  const el = document.getElementById('incorso-list');
  if (!el) return;
  const st = _getState();
  const u = _getUser();
  const isAdmin = u.role === 'amministratore';

  // Da prendere
  const avMiss = st.missioni.filter(m => m.stato === 'richiesta')
    .map(m => ({ ...m, _kind: 'missione', _avail: true }));
  const avRient = st.rientri.filter(r => r.stato === 'da_rientrare')
    .map(r => ({ ...r, _kind: 'rientro', _avail: true }));

  // Presi in carico (propri; l'admin li vede tutti)
  const tkMiss = st.missioni.filter(m => m.stato === 'in_transito' && (isAdmin || m.navettaId === u.uid))
    .map(m => ({ ...m, _kind: 'missione', _avail: false }));
  const tkRient = st.rientri.filter(r => r.stato === 'in_transito' && (isAdmin || r.navettaId === u.uid))
    .map(r => ({ ...r, _kind: 'rientro', _avail: false }));

  // Un'unica lista ordinata per anzianità: prendere un elemento non lo sposta
  // di posizione (la card "rimane" dov'era).
  const lista = avMiss.concat(avRient, tkMiss, tkRient)
    .sort((a, b) => tsVal(a.createdAt) - tsVal(b.createdAt));

  // Statistiche
  const statsEl = document.getElementById('incorso-stats');
  if (statsEl) {
    const pieniCoda = avMiss.length;
    const vuotiCoda = avRient.length;
    const inCarico  = tkMiss.length + tkRient.length;
    statsEl.innerHTML = `
      <div class="statCard orange"><div class="val">${pieniCoda}</div><div class="lbl">Pieni da prendere</div></div>
      <div class="statCard blue"><div class="val">${vuotiCoda}</div><div class="lbl">Vuoti da prendere</div></div>
      <div class="statCard green"><div class="val">${inCarico}</div><div class="lbl">In carico</div></div>`;
  }

  if (!lista.length) { el.innerHTML = '<div class="emptyState">Nulla in corso. 👍</div>'; return; }
  el.innerHTML = lista.map(_card).join('');
}

function _card(item) {
  const isPieno = item._kind === 'missione';
  const tipoBadge = isPieno
    ? '<span class="mTipoBadge pieno">Pieno</span>'
    : '<span class="mTipoBadge vuoto">Vuoto</span>';

  let statoBadge, actionBtn, meta;
  if (item._avail) {
    // Da prendere → pulsante GIALLO
    statoBadge = `<span class="mStatoBadge ${isPieno ? 'richiesta' : 'da_rientrare'}">In coda</span>`;
    meta = `⏱ in coda da ${fmtDur(item.createdAt)}`;
    const fn = isPieno ? 'prendiMissione' : 'prendiRientro';
    actionBtn = `<button class="btnOrange" onclick="${fn}('${item.id}')">🚚 Prendi in carico</button>`;
  } else {
    // Preso in carico → pulsante VERDE
    statoBadge = `<span class="mStatoBadge in_transito">In transito</span>`;
    meta = `Preso in carico da ${fmtDur(item.presaInCaricoAt)}${item.navettaNome ? ' · ' + esc(item.navettaNome) : ''}`;
    const fn = isPieno ? 'confermaMissione' : 'confermaRientro';
    const label = isPieno ? '✅ Conferma consegna' : '✅ Conferma rientro';
    actionBtn = `<button class="btnGreen" onclick="${fn}('${item.id}')">${label}</button>`;
  }

  return `
    <div class="mCard ${isPieno ? 'pieno' : 'vuoto'}">
      <div class="mHead">
        <span class="mElemento">${esc(item.elementoCodice)}</span>
        ${tipoBadge}
        ${statoBadge}
      </div>
      <div class="mRoute"><span class="mLoc">${esc(item.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(item.destinazioneNome)}</span></div>
      <div class="mMeta">${meta}</div>
      <div class="mActions">${actionBtn}</div>
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
  const isAdmin = u.role === 'amministratore';
  const ref = doc(window.db, coll, id);
  await runTransaction(window.db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Elemento non più presente');
    const d = snap.data();
    if (d.stato !== statoAtteso) throw new Error('Stato non valido');
    if (d.navettaId !== u.uid && !isAdmin) throw new Error('Non è la tua missione');
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
