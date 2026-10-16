// ── modules/navetta.js ────────────────────────────────────────────────────────
// Ruolo MOVIMENTATORE (ex "autista"):
//  • Un unico tab "In corso" che unifica coda e presi in carico.
//    - Missioni da prendere (stato 'richiesta')
//      → pulsante GIALLO "Prendi in carico".
//    - Elementi già presi da lui ('in_transito' col suo id)
//      → la card resta al suo posto, il pulsante diventa VERDE
//        "Conferma consegna".
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

  // Presi in carico (propri; l'admin li vede tutti)
  const tkMiss = st.missioni.filter(m => m.stato === 'in_transito' && (isAdmin || m.navettaId === u.uid))
    .map(m => ({ ...m, _kind: 'missione', _avail: false }));

  // Un'unica lista: prima le missioni LINEA BLU, poi tutto il resto; a parità
  // ordinata per anzianità. Prendere un elemento non lo sposta di posizione
  // (la card "rimane" dov'era), perché lineaBlu e createdAt non cambiano.
  const lista = avMiss.concat(tkMiss)
    .sort((a, b) => ((b.lineaBlu || b.lineaRossa) ? 1 : 0) - ((a.lineaBlu || a.lineaRossa) ? 1 : 0)
                 || tsVal(a.createdAt) - tsVal(b.createdAt));

  // Statistiche
  const statsEl = document.getElementById('incorso-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="statCard orange"><div class="val">${avMiss.length}</div><div class="lbl">Da prendere</div></div>
      <div class="statCard green"><div class="val">${tkMiss.length}</div><div class="lbl">In carico</div></div>`;
  }

  if (!lista.length) { el.innerHTML = '<div class="emptyState">Nulla in corso. 👍</div>'; return; }
  el.innerHTML = lista.map(_card).join('');
}

function _card(item) {
  let statoBadge, actionBtn, meta;
  if (item._avail) {
    // Da prendere → pulsante GIALLO
    statoBadge = `<span class="mStatoBadge richiesta">In coda</span>`;
    meta = `⏱ in coda da ${fmtDur(item.createdAt)}`;
    actionBtn = `<button class="btnOrange" onclick="prendiMissione('${item.id}')">🚚 Prendi in carico</button>`;
  } else {
    // Preso in carico → pulsante VERDE
    statoBadge = `<span class="mStatoBadge in_transito">In transito</span>`;
    meta = `Preso in carico da ${fmtDur(item.presaInCaricoAt)}${item.navettaNome ? ' · ' + esc(item.navettaNome) : ''}`;
    actionBtn = `<button class="btnGreen" onclick="confermaMissione('${item.id}')">✅ Conferma consegna</button>`;
  }

  const blu = !!item.lineaBlu;
  const badgeBlu = blu
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#2563eb;color:#fff;letter-spacing:.3px">🔵 LINEA BLU</span>'
    : '';

  const badgeRossa = item.lineaRossa
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#dc2626;color:#fff;letter-spacing:.3px">🔴 LINEA ROSSA</span>'
    : '';

  const badgeVuoto = item.vuoto
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#16a34a;color:#fff;letter-spacing:.3px">🟢 VUOTO</span>'
    : '';

  return `
    <div class="mCard pieno"${blu ? ' style="border-left:4px solid #2563eb;"' : item.lineaRossa ? ' style="border-left:4px solid #dc2626;"' : ''}>
      <div class="mHead">
        ${item.codice ? `<span style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;letter-spacing:.5px;color:var(--muted)">${esc(item.codice)}</span>` : ''}
        <span class="mElemento">${esc(item.elementoCodice)}</span>
        ${badgeBlu}
        ${badgeRossa}
        ${badgeVuoto}
        ${statoBadge}
      </div>
      <div class="mRoute"><span class="mLoc">${esc(item.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(item.destinazioneNome)}</span></div>
      ${item.note ? `<div class="mMeta" style="color:var(--text2);font-size:13px;white-space:pre-wrap">📝 ${esc(item.note)}</div>` : ''}
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
    if (m) await window.logHistory({ action: 'Preso in carico', codice: m.codice || null, elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Missione presa in carico.', 'success');
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
    if (m) await window.logHistory({ action: 'Consegna completata', codice: m.codice || null, elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Consegna confermata.', 'success');
  } catch (e) { showToast(e.message || 'Errore', 'error'); }
};
