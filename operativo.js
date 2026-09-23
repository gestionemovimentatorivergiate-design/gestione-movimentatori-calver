// ── modules/operativo.js ──────────────────────────────────────────────────────
// Ruolo OPERATIVO:
//  1) crea la missione (pieno: magazzino → linea)
//  2) dichiara il vuoto sulle consegne arrivate → genera il rientro (linea → magazzino)
//  3) annulla le proprie missioni/rientri ancora IN ATTESA (mai in transito)
//
// missioni/{id} : elemento + origine/destinazione + stato
//    stato: richiesta → in_transito → consegnata   (+ annullata da 'richiesta')
//    vuotoId: riferimento al rientro generato (null finché non dichiarato)
// rientri/{id}  : il vuoto, collegato da missioneId ↔ missioni.vuotoId
//    stato: da_rientrare → in_transito → rientrato  (+ annullato da 'da_rientrare')

import {
  collection, doc, addDoc, updateDoc, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDate } from '../shared-utils.js';

let _getState, _getUser;

export function initOperativo({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

// ── NUOVA MISSIONE ────────────────────────────────────────────────────────────
export function renderNuovaMissione() {
  const st = _getState();
  const elSel = document.getElementById('nm-elemento');
  const orSel = document.getElementById('nm-origine');
  const deSel = document.getElementById('nm-destinazione');
  if (!elSel) return;

  const keep = (sel) => sel.value;
  const vEl = keep(elSel), vOr = keep(orSel), vDe = keep(deSel);

  const elementi = st.elementi.filter(e => e.attivo !== false);
  const magazzini = st.ubicazioni.filter(u => u.attivo !== false && u.tipo === 'magazzino');
  const linee     = st.ubicazioni.filter(u => u.attivo !== false && u.tipo === 'linea');

  elSel.innerHTML = '<option value="">— seleziona —</option>' +
    elementi.map(e => `<option value="${e.id}">${esc(e.codice)}${e.descrizione ? ' · ' + esc(e.descrizione) : ''}</option>`).join('');
  orSel.innerHTML = '<option value="">— seleziona —</option>' +
    magazzini.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');
  deSel.innerHTML = '<option value="">— seleziona —</option>' +
    linee.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');

  // Ripristina selezione precedente se ancora valida
  elSel.value = vEl; orSel.value = vOr; deSel.value = vDe;
}

window.creaMissione = async function () {
  const u = _getUser();
  const st = _getState();
  const elId = document.getElementById('nm-elemento').value;
  const orId = document.getElementById('nm-origine').value;
  const deId = document.getElementById('nm-destinazione').value;
  if (!elId || !orId || !deId) { showToast('Seleziona elemento, origine e destinazione.', 'error'); return; }

  const elemento = st.elementi.find(e => e.id === elId);
  const origine = st.ubicazioni.find(x => x.id === orId);
  const destinazione = st.ubicazioni.find(x => x.id === deId);
  if (!elemento || !origine || !destinazione) { showToast('Dati non validi, riprova.', 'error'); return; }

  const btn = document.getElementById('nm-btn');
  btn.disabled = true; btn.textContent = '⏳ Creazione…';
  try {
    await addDoc(collection(window.db, 'missioni'), {
      elementoId: elId, elementoCodice: elemento.codice,
      origineId: orId, origineNome: origine.nome,
      destinazioneId: deId, destinazioneNome: destinazione.nome,
      stato: 'richiesta',
      navettaId: null, navettaNome: null,
      ownerUid: u.uid, ownerNome: u.name || u.email,
      vuotoId: null,
      createdAt: serverTimestamp(), presaInCaricoAt: null, consegnataAt: null,
    });
    await window.logHistory({
      action: 'Missione creata', elemento: elemento.codice,
      origine: origine.nome, destinazione: destinazione.nome,
    });
    showToast(`Missione creata: ${elemento.codice} → ${destinazione.nome}`, 'success');
    // Reset selezioni
    document.getElementById('nm-elemento').value = '';
    document.getElementById('nm-origine').value = '';
    document.getElementById('nm-destinazione').value = '';
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Crea missione';
  }
};

// ── LE MIE MISSIONI ─────────────────────────────────────────────────────────
export function renderMieMissioni() {
  const el = document.getElementById('mie-list');
  if (!el) return;
  const st = _getState();
  const u = _getUser();

  // 1) Consegne da dichiarare vuoto (qualsiasi operativo può dichiarare)
  const daVuoto = st.missioni
    .filter(m => m.stato === 'consegnata' && !m.vuotoId)
    .sort((a, b) => (a.consegnataAt?.toDate?.() || 0) - (b.consegnataAt?.toDate?.() || 0));

  // 2) Mie missioni ancora in attesa (annullabili)
  const mieRichieste = st.missioni.filter(m => m.stato === 'richiesta' && m.ownerUid === u.uid);

  // 3) Miei rientri ancora in attesa (annullabili)
  const mieiRientri = st.rientri.filter(r => r.stato === 'da_rientrare' && r.ownerUid === u.uid);

  let html = '';

  html += `<div class="groupTitle">Da dichiarare vuoto (${daVuoto.length})</div>`;
  html += daVuoto.length
    ? daVuoto.map(_cardDaVuoto).join('')
    : '<div class="emptyState">Nessuna consegna in attesa di dichiarazione vuoto.</div>';

  if (mieRichieste.length) {
    html += `<div class="groupTitle">Mie missioni in attesa (${mieRichieste.length})</div>`;
    html += mieRichieste.map(_cardMissioneAttesa).join('');
  }
  if (mieiRientri.length) {
    html += `<div class="groupTitle">Miei vuoti in attesa (${mieiRientri.length})</div>`;
    html += mieiRientri.map(_cardRientroAttesa).join('');
  }

  el.innerHTML = html;
}

function _cardDaVuoto(m) {
  return `
    <div class="mCard pieno">
      <div class="mHead">
        <span class="mElemento">${esc(m.elementoCodice)}</span>
        <span class="mStatoBadge consegnata">Consegnata</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(m.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(m.destinazioneNome)}</span></div>
      <div class="mMeta">Consegnata: ${fmtDate(m.consegnataAt)}${m.navettaNome ? ' · da ' + esc(m.navettaNome) : ''}</div>
      <div class="mActions">
        <button class="btnOrange" onclick="dichiaraVuoto('${m.id}')">🟢 Dichiara vuoto</button>
      </div>
    </div>`;
}

function _cardMissioneAttesa(m) {
  return `
    <div class="mCard pieno">
      <div class="mHead">
        <span class="mElemento">${esc(m.elementoCodice)}</span>
        <span class="mStatoBadge richiesta">In attesa</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(m.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(m.destinazioneNome)}</span></div>
      <div class="mMeta">Creata: ${fmtDate(m.createdAt)}</div>
      <div class="mActions">
        <button class="btnGray" onclick="annullaMissione('${m.id}')">✕ Annulla</button>
      </div>
    </div>`;
}

function _cardRientroAttesa(r) {
  return `
    <div class="mCard vuoto">
      <div class="mHead">
        <span class="mElemento">${esc(r.elementoCodice)}</span>
        <span class="mTipoBadge vuoto">Vuoto</span>
        <span class="mStatoBadge da_rientrare">Da rientrare</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(r.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(r.destinazioneNome)}</span></div>
      <div class="mMeta">Dichiarato: ${fmtDate(r.createdAt)}</div>
      <div class="mActions">
        <button class="btnGray" onclick="annullaRientro('${r.id}')">✕ Annulla</button>
      </div>
    </div>`;
}

// ── AZIONE: dichiara vuoto → crea rientro + collega la missione ───────────────
window.dichiaraVuoto = async function (missioneId) {
  const u = _getUser();
  const m = _getState().missioni.find(x => x.id === missioneId);
  if (!m) { showToast('Missione non trovata.', 'error'); return; }
  if (m.stato !== 'consegnata' || m.vuotoId) { showToast('Missione non più disponibile.', 'error'); return; }

  try {
    const batch = writeBatch(window.db);
    const rientroRef = doc(collection(window.db, 'rientri'));
    batch.set(rientroRef, {
      missioneId: m.id,
      elementoId: m.elementoId, elementoCodice: m.elementoCodice,
      // Rientro = percorso inverso: dalla linea (dest della missione) al magazzino (origine)
      origineId: m.destinazioneId, origineNome: m.destinazioneNome,
      destinazioneId: m.origineId, destinazioneNome: m.origineNome,
      stato: 'da_rientrare',
      navettaId: null, navettaNome: null,
      ownerUid: u.uid, ownerNome: u.name || u.email,
      createdAt: serverTimestamp(), presaInCaricoAt: null, rientratoAt: null,
    });
    batch.update(doc(window.db, 'missioni', m.id), { vuotoId: rientroRef.id });
    await batch.commit();
    await window.logHistory({
      action: 'Vuoto dichiarato', elemento: m.elementoCodice,
      origine: m.destinazioneNome, destinazione: m.origineNome,
    });
    showToast(`Vuoto dichiarato: ${m.elementoCodice} rientra a ${m.origineNome}`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
};

// ── AZIONE: annulla missione (solo 'richiesta', owner o admin) ────────────────
window.annullaMissione = async function (id) {
  const u = _getUser();
  const m = _getState().missioni.find(x => x.id === id);
  if (!m) return;
  if (m.stato !== 'richiesta') { showToast('Annullabile solo finché è in attesa.', 'error'); return; }
  if (m.ownerUid !== u.uid && u.role !== 'amministratore') { showToast('Puoi annullare solo le tue missioni.', 'error'); return; }
  if (!confirm(`Annullare la missione ${m.elementoCodice} → ${m.destinazioneNome}?`)) return;
  try {
    await updateDoc(doc(window.db, 'missioni', id), { stato: 'annullata', annullataAt: serverTimestamp() });
    await window.logHistory({ action: 'Missione annullata', elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Missione annullata.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ── AZIONE: annulla rientro (solo 'da_rientrare', owner o admin) ──────────────
// Sblocca la missione collegata (vuotoId = null) così il vuoto può essere ridichiarato.
window.annullaRientro = async function (id) {
  const u = _getUser();
  const r = _getState().rientri.find(x => x.id === id);
  if (!r) return;
  if (r.stato !== 'da_rientrare') { showToast('Annullabile solo finché è in attesa.', 'error'); return; }
  if (r.ownerUid !== u.uid && u.role !== 'amministratore') { showToast('Puoi annullare solo i tuoi vuoti.', 'error'); return; }
  if (!confirm(`Annullare il rientro vuoto di ${r.elementoCodice}?`)) return;
  try {
    const batch = writeBatch(window.db);
    batch.update(doc(window.db, 'rientri', id), { stato: 'annullato', annullatoAt: serverTimestamp() });
    if (r.missioneId) batch.update(doc(window.db, 'missioni', r.missioneId), { vuotoId: null });
    await batch.commit();
    await window.logHistory({ action: 'Vuoto annullato', elemento: r.elementoCodice, origine: r.origineNome, destinazione: r.destinazioneNome });
    showToast('Rientro vuoto annullato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};
