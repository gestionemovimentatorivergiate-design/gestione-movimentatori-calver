// ── modules/operativo.js ──────────────────────────────────────────────────────
// Ruolo OPERATIVO:
//  1) crea la missione (pieno: magazzino → linea)
//  2) dichiara il vuoto sulle consegne arrivate → genera il rientro (linea → magazzino)
//  3) annulla le proprie missioni/rientri ancora IN ATTESA (mai in transito)
//
// missioni/{id} : elemento + origine/destinazione + stato
//    stato: richiesta → in_transito → consegnata   (+ annullata da 'richiesta')
//    vuotoId: riferimento al rientro generato (null finché non dichiarato)
//    lineaBlu: true se la missione è prioritaria (spunta "Linea Blu"); assente = false
// rientri/{id}  : il vuoto, collegato da missioneId ↔ missioni.vuotoId
//    stato: da_rientrare → in_transito → rientrato  (+ annullato da 'da_rientrare')

import {
  collection, doc, addDoc, updateDoc, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDate, tsVal } from '../shared-utils.js';

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

  // Spunta "Linea Blu": creata una sola volta, subito sopra il pulsante di creazione.
  // Non viene ricreata ai refresh, quindi mantiene lo stato selezionato.
  if (!document.getElementById('nm-lineablu')) {
    const btn = document.getElementById('nm-btn');
    if (btn && btn.parentNode) {
      const wrap = document.createElement('label');
      wrap.id = 'nm-lineablu-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 12px;' +
        'border:1px solid #2563eb55;border-radius:8px;background:#2563eb12;cursor:pointer;' +
        'font-weight:700;user-select:none';
      wrap.innerHTML = '<input type="checkbox" id="nm-lineablu" style="width:20px;height:20px;margin:0;accent-color:#2563eb;cursor:pointer">' +
        '<span>🔵 Linea Blu</span>' +
        '<span id="nm-lineablu-hint" style="font-size:11px;font-weight:500;color:var(--muted);margin-left:auto"></span>';
      btn.parentNode.insertBefore(wrap, btn);
    }
  }
  orSel.onchange = _aggiornaLineaBlu;
  _aggiornaLineaBlu();
}

// Linea Blu: la spunta è attiva solo se l'origine appartiene a questo Building
const LINEA_BLU_BUILDING = 'B26';

// Abilita/disabilita la spunta in base all'origine selezionata
function _aggiornaLineaBlu() {
  const cb = document.getElementById('nm-lineablu');
  if (!cb) return;
  const orId = document.getElementById('nm-origine')?.value;
  const ub = _getState().ubicazioni.find(x => x.id === orId);
  const ok = !!ub && ub.buildingId === LINEA_BLU_BUILDING;
  cb.disabled = !ok;
  if (!ok) cb.checked = false;
  const wrap = document.getElementById('nm-lineablu-wrap');
  if (wrap) { wrap.style.opacity = ok ? '1' : '.5'; wrap.style.cursor = ok ? 'pointer' : 'not-allowed'; }
  const hint = document.getElementById('nm-lineablu-hint');
  if (hint) hint.textContent = ok ? '' : `Solo per origini del building ${LINEA_BLU_BUILDING}`;
}

// Badge + stile per le missioni Linea Blu (priorità)
const BLU_BORDER = 'border-left:4px solid #2563eb;';
function _badgeBlu(m) {
  return m.lineaBlu
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#2563eb;color:#fff;letter-spacing:.3px">🔵 LINEA BLU</span>'
    : '';
}
function _styleBlu(m) { return m.lineaBlu ? ` style="${BLU_BORDER}"` : ''; }

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

  // Linea Blu valida solo se l'origine appartiene al building B26
  const lineaBlu = !!document.getElementById('nm-lineablu')?.checked
    && origine.buildingId === LINEA_BLU_BUILDING;

  const btn = document.getElementById('nm-btn');
  btn.disabled = true; btn.textContent = '⏳ Creazione…';
  try {
    await addDoc(collection(window.db, 'missioni'), {
      elementoId: elId, elementoCodice: elemento.codice,
      origineId: orId, origineNome: origine.nome,
      destinazioneId: deId, destinazioneNome: destinazione.nome,
      lineaBlu,
      stato: 'richiesta',
      navettaId: null, navettaNome: null,
      ownerUid: u.uid, ownerNome: u.name || u.email,
      vuotoId: null,
      createdAt: serverTimestamp(), presaInCaricoAt: null, consegnataAt: null,
    });
    await window.logHistory({
      action: 'Missione creata', elemento: elemento.codice,
      origine: origine.nome, destinazione: destinazione.nome,
      lineaBlu,
    });
    showToast(`Missione${lineaBlu ? ' LINEA BLU' : ''} creata: ${elemento.codice} → ${destinazione.nome}`, 'success');
    // Reset selezioni
    document.getElementById('nm-elemento').value = '';
    document.getElementById('nm-origine').value = '';
    document.getElementById('nm-destinazione').value = '';
    const cb = document.getElementById('nm-lineablu'); if (cb) cb.checked = false;
    _aggiornaLineaBlu();
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
  // Linea Blu in alto, poi per anzianità (la più vecchia prima)
  const mieRichieste = st.missioni
    .filter(m => m.stato === 'richiesta' && m.ownerUid === u.uid)
    .sort((a, b) => (b.lineaBlu ? 1 : 0) - (a.lineaBlu ? 1 : 0) || tsVal(a.createdAt) - tsVal(b.createdAt));

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
    <div class="mCard pieno"${_styleBlu(m)}>
      <div class="mHead">
        <span class="mElemento">${esc(m.elementoCodice)}</span>
        ${_badgeBlu(m)}
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
    <div class="mCard pieno"${_styleBlu(m)}>
      <div class="mHead">
        <span class="mElemento">${esc(m.elementoCodice)}</span>
        ${_badgeBlu(m)}
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
