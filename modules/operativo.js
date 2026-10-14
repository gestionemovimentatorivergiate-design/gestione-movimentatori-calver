// ── modules/operativo.js ──────────────────────────────────────────────────────
// Ruolo OPERATIVO:
//  1) crea la missione (da un'ubicazione a un'altra)
//  2) annulla le proprie missioni ancora IN ATTESA (mai in transito)
//
// missioni/{ID} : l'ID del documento è il codice univoco della missione, formato
//    ####-ggmmaaaa (es. 0001-05102026): progressivo del giorno (da mezzanotte, ora di
//    Roma) + data. Generato dall'app in una transazione e salvato anche nel campo
//    `codice`; non esiste nessun campo/azione per modificarlo.
//    Il progressivo è tenuto in un documento contatore `missioni/_cnt-ggmmaaaa`
//    (senza createdAt, quindi mai incluso nella lista delle missioni).
//    elemento + origine/destinazione + stato
//    stato: richiesta → in_transito → consegnata   (+ annullata da 'richiesta')
//    lineaBlu: true se la missione è prioritaria (spunta "Linea Blu"); assente = false
//    vuoto: true se è una missione di vuoto (spunta "Vuoto"); assente = false. Non cambia
//           l'ordinamento. Vuoto e Linea Blu sono mutuamente esclusive.

import {
  doc, updateDoc, runTransaction, serverTimestamp
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
  // Origine e destinazione: qualsiasi ubicazione attiva (nessun vincolo di tipo)
  const ubicazioni = st.ubicazioni.filter(u => u.attivo !== false)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));

  elSel.innerHTML = '<option value="">— seleziona —</option>' +
    elementi.map(e => `<option value="${e.id}">${esc(e.codice)}</option>`).join('');
  orSel.innerHTML = '<option value="">— seleziona —</option>' +
    ubicazioni.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');
  deSel.innerHTML = '<option value="">— seleziona —</option>' +
    ubicazioni.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');

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

  // Spunta "Vuoto": sempre cliccabile (salvo incompatibilità con Linea Blu)
  if (!document.getElementById('nm-vuoto')) {
    const anchor = document.getElementById('nm-lineablu-wrap') || document.getElementById('nm-btn');
    if (anchor && anchor.parentNode) {
      const wrap = document.createElement('label');
      wrap.id = 'nm-vuoto-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 12px;' +
        'border:1px solid #6b728066;border-radius:8px;background:#6b728012;cursor:pointer;' +
        'font-weight:700;user-select:none';
      wrap.innerHTML = '<input type="checkbox" id="nm-vuoto" style="width:20px;height:20px;margin:0;accent-color:#6b7280;cursor:pointer">' +
        '<span>⚪ Vuoto</span>' +
        '<span id="nm-vuoto-hint" style="font-size:11px;font-weight:500;color:var(--muted);margin-left:auto"></span>';
      anchor.parentNode.insertBefore(wrap, anchor.id === 'nm-btn' ? anchor : anchor.nextSibling);
    }
  }
  orSel.onchange = _aggiornaSpunte;
  const cbBlu = document.getElementById('nm-lineablu'); if (cbBlu) cbBlu.onchange = _aggiornaSpunte;
  const cbVuoto = document.getElementById('nm-vuoto');  if (cbVuoto) cbVuoto.onchange = _aggiornaSpunte;
  _aggiornaSpunte();
}

// Linea Blu: la spunta è attiva solo se l'origine appartiene a questo Building
const LINEA_BLU_BUILDING = 'B26';

// Aggiorna le due spunte. Regole:
//  • Linea Blu: cliccabile solo con origine del building B26 e se "Vuoto" NON è spuntato
//  • Vuoto: sempre cliccabile, tranne quando "Linea Blu" è spuntata
// Le due spunte sono quindi mutuamente esclusive.
function _aggiornaSpunte() {
  const cbBlu = document.getElementById('nm-lineablu');
  const cbVuoto = document.getElementById('nm-vuoto');
  if (!cbBlu || !cbVuoto) return;

  const orId = document.getElementById('nm-origine')?.value;
  const ub = _getState().ubicazioni.find(x => x.id === orId);
  const origineOk = !!ub && ub.buildingId === LINEA_BLU_BUILDING;

  // Se l'origine non è B26 la Linea Blu non può restare spuntata
  if (!origineOk) cbBlu.checked = false;

  const bluOk = origineOk && !cbVuoto.checked;
  const vuotoOk = !cbBlu.checked;
  cbBlu.disabled = !bluOk;
  cbVuoto.disabled = !vuotoOk;

  const setStyle = (id, ok) => {
    const w = document.getElementById(id);
    if (w) { w.style.opacity = ok ? '1' : '.5'; w.style.cursor = ok ? 'pointer' : 'not-allowed'; }
  };
  setStyle('nm-lineablu-wrap', bluOk);
  setStyle('nm-vuoto-wrap', vuotoOk);

  const hBlu = document.getElementById('nm-lineablu-hint');
  if (hBlu) hBlu.textContent = bluOk ? ''
    : (cbVuoto.checked ? 'Non compatibile con Vuoto' : `Solo per origini del building ${LINEA_BLU_BUILDING}`);
  const hVuoto = document.getElementById('nm-vuoto-hint');
  if (hVuoto) hVuoto.textContent = vuotoOk ? '' : 'Non compatibile con Linea Blu';
}

// Badge + stile per le missioni Linea Blu (priorità)
const BLU_BORDER = 'border-left:4px solid #2563eb;';
function _badgeBlu(m) {
  return m.lineaBlu
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#2563eb;color:#fff;letter-spacing:.3px">🔵 LINEA BLU</span>'
    : '';
}
function _badgeVuoto(m) {
  return m.vuoto
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#6b7280;color:#fff;letter-spacing:.3px">⚪ VUOTO</span>'
    : '';
}
function _styleBlu(m) { return m.lineaBlu ? ` style="${BLU_BORDER}"` : ''; }

// Data di oggi come ggmmaaaa, fuso orario di Roma (la "mezzanotte" è quella locale)
function _oggiGGMMAAAA() {
  const p = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return g('day') + g('month') + g('year');
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

  // Linea Blu valida solo se l'origine appartiene al building B26
  const vuoto = !!document.getElementById('nm-vuoto')?.checked;
  // Mutuamente esclusive: se è spuntato Vuoto, la Linea Blu non viene mai salvata
  const lineaBlu = !vuoto && !!document.getElementById('nm-lineablu')?.checked
    && origine.buildingId === LINEA_BLU_BUILDING;

  const btn = document.getElementById('nm-btn');
  btn.disabled = true; btn.textContent = '⏳ Creazione…';
  try {
    // ID univoco: ####-ggmmaaaa. Transazione sul contatore del giorno: due utenti
    // che creano nello stesso istante non possono ottenere lo stesso numero.
    const giorno = _oggiGGMMAAAA();
    const cntRef = doc(window.db, 'missioni', '_cnt-' + giorno);
    let codice = '';
    await runTransaction(window.db, async (tx) => {
      const snap = await tx.get(cntRef);
      const n = (snap.exists() ? (snap.data().n || 0) : 0) + 1;
      codice = String(n).padStart(4, '0') + '-' + giorno;
      tx.set(cntRef, { n, giorno });
      tx.set(doc(window.db, 'missioni', codice), {
        codice,
        elementoId: elId, elementoCodice: elemento.codice,
        origineId: orId, origineNome: origine.nome,
        destinazioneId: deId, destinazioneNome: destinazione.nome,
        lineaBlu, vuoto,
        stato: 'richiesta',
        navettaId: null, navettaNome: null,
        ownerUid: u.uid, ownerNome: u.name || u.email,
        createdAt: serverTimestamp(), presaInCaricoAt: null, consegnataAt: null,
      });
    });
    await window.logHistory({
      action: 'Missione creata', codice, elemento: elemento.codice,
      origine: origine.nome, destinazione: destinazione.nome,
      lineaBlu, vuoto,
    });
    showToast(`Missione${lineaBlu ? ' LINEA BLU' : ''}${vuoto ? ' VUOTO' : ''} creata ${codice}: ${elemento.codice} → ${destinazione.nome}`, 'success');
    // Reset selezioni
    document.getElementById('nm-elemento').value = '';
    document.getElementById('nm-origine').value = '';
    document.getElementById('nm-destinazione').value = '';
    const cb = document.getElementById('nm-lineablu'); if (cb) cb.checked = false;
    const cv = document.getElementById('nm-vuoto'); if (cv) cv.checked = false;
    _aggiornaSpunte();
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

  // Mie missioni ancora in attesa (annullabili)
  // Linea Blu in alto, poi per anzianità (la più vecchia prima)
  const mieRichieste = st.missioni
    .filter(m => m.stato === 'richiesta' && m.ownerUid === u.uid)
    .sort((a, b) => (b.lineaBlu ? 1 : 0) - (a.lineaBlu ? 1 : 0) || tsVal(a.createdAt) - tsVal(b.createdAt));

  let html = '';
  html += `<div class="groupTitle">Mie missioni in attesa (${mieRichieste.length})</div>`;
  html += mieRichieste.length
    ? mieRichieste.map(_cardMissioneAttesa).join('')
    : '<div class="emptyState">Nessuna missione in attesa.</div>';

  el.innerHTML = html;
}

function _cardMissioneAttesa(m) {
  return `
    <div class="mCard pieno"${_styleBlu(m)}>
      <div class="mHead">
        ${m.codice ? `<span style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;letter-spacing:.5px;color:var(--muted)">${esc(m.codice)}</span>` : ''}
        <span class="mElemento">${esc(m.elementoCodice)}</span>
        ${_badgeBlu(m)}
        ${_badgeVuoto(m)}
        <span class="mStatoBadge richiesta">In attesa</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(m.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(m.destinazioneNome)}</span></div>
      <div class="mMeta">Creata: ${fmtDate(m.createdAt)}</div>
      <div class="mActions">
        <button class="btnGray" onclick="annullaMissione('${m.id}')">✕ Annulla</button>
      </div>
    </div>`;
}

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
    await window.logHistory({ action: 'Missione annullata', codice: m.codice || null, elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Missione annullata.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};
