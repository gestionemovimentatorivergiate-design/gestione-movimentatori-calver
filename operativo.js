// ── modules/operativo.js ──────────────────────────────────────────────────────
// Ruolo OPERATIVO:
//  1) crea la missione (da un'ubicazione a un'altra)
//  2) annulla le proprie missioni ancora IN ATTESA (mai in transito)
//
// missioni/{ID} : l'ID del documento è il codice univoco della missione, formato
//    ####-gg-mmaaaa (es. 0001-05-102026): progressivo del giorno (da mezzanotte, ora di
//    Roma) + data. Generato dall'app in una transazione e salvato anche nel campo
//    `codice`; non esiste nessun campo/azione per modificarlo.
//    Il progressivo è tenuto in un documento contatore `missioni/_cnt-ggmmaaaa`
//    (senza createdAt, quindi mai incluso nella lista delle missioni).
//    elemento + origine/destinazione + stato
//    stato: richiesta → in_transito → consegnata   (+ annullata da 'richiesta')
//    lineaBlu: true se la missione è prioritaria (spunta "Linea Blu"); assente = false
//    vuoto: true se è una missione di vuoto (spunta "Vuoto"); assente = false. Non cambia
//           l'ordinamento. Vuoto, Linea Blu e Linea Rossa sono mutuamente esclusive.
//    note: testo libero facoltativo (max 300 caratteri), modificabile dal creatore finché è 'richiesta'
//    modificataAt: ultima modifica (solo il creatore, solo finché è 'richiesta')
//    lineaRossa: true se la missione è prioritaria come la Linea Blu (spunta "Linea Rossa")

import {
  doc, updateDoc, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDate, tsVal } from '../shared-utils.js';
import './foglio.js';   // definisce window.stampaFoglioTrasferimento

let _getState, _getUser;

export function initOperativo({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

// ── NUOVA MISSIONE ────────────────────────────────────────────────────────────
window.cambiaRepartoPren = function () {
  const u = _getUser();
  try { if (u) localStorage.setItem('repartoPren:' + u.uid, document.getElementById('nm-reparto')?.value || ''); } catch (e) {}
  renderNuovaMissione();
};

// ── Menu a tendina con ricerca (selezione singola) ──────────────────────────
// Affianca a un <select> un menu con barra di ricerca; il <select> resta nascosto
// e mantiene valore ed eventi, quindi il resto del codice non cambia.
let _comboChiusura = false;
function _comboSync(id) {
  const sel = document.getElementById(id); if (!sel) return;
  if (!_comboChiusura) {
    _comboChiusura = true;
    document.addEventListener('click', e => {
      document.querySelectorAll('.ms.combo.open').forEach(r => { if (!r.contains(e.target)) r.classList.remove('open'); });
    });
  }
  let w = sel.nextElementSibling;
  if (!w || !w.classList.contains('combo') || w.dataset.for !== id) {
    w = document.createElement('div');
    w.className = 'ms combo'; w.dataset.for = id;
    w.innerHTML = '<button type="button" class="msBtn"></button><div class="msPanel">' +
      '<input class="msSearch" placeholder="Cerca…" autocomplete="off" spellcheck="false"><div class="msList"></div></div>';
    sel.style.display = 'none';
    sel.after(w);
    const filtra = () => {
      const q = w.querySelector('.msSearch').value.trim().toLowerCase();
      w.querySelectorAll('.msOpt').forEach(o => { o.style.display = !q || (o.dataset.v && o.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
    };
    const scegli = v => {
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      w.classList.remove('open');
      _comboSync(id);
    };
    w.addEventListener('click', e => {
      if (e.target.closest('.msBtn')) {
        const apri = !w.classList.contains('open');
        document.querySelectorAll('.ms.combo.open').forEach(r => r.classList.remove('open'));
        if (apri) { w.classList.add('open'); const i = w.querySelector('.msSearch'); i.value = ''; filtra(); i.focus();
          w.querySelector('.msOpt.on')?.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      const o = e.target.closest('.msOpt'); if (o) scegli(o.dataset.v);
    });
    w.addEventListener('input', e => { if (e.target.classList.contains('msSearch')) filtra(); });
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') w.classList.remove('open');
      if (e.key === 'Enter' && e.target.classList.contains('msSearch')) {
        e.preventDefault();
        const primo = [...w.querySelectorAll('.msOpt')].find(o => o.style.display !== 'none' && o.dataset.v);
        if (primo) scegli(primo.dataset.v);
      }
    });
    w._filtra = filtra;
  }
  const opts = [...sel.options];
  const sig = JSON.stringify(opts.map(o => [o.value, o.textContent])) + '|' + sel.value;
  if (w.dataset.sig === sig) return;
  w.dataset.sig = sig;
  w.querySelector('.msList').innerHTML = opts.map(o =>
    `<div class="msOpt${o.value === sel.value ? ' on' : ''}" data-v="${esc(o.value)}"><span>${esc(o.textContent)}</span></div>`).join('');
  w.querySelector('.msBtn').textContent = sel.options[sel.selectedIndex]?.textContent || '— seleziona —';
  w.classList.toggle('sel', !!sel.value);
  w._filtra();
}
const _comboTutti = () => ['nm-reparto', 'nm-elemento', 'nm-origine', 'nm-destinazione'].forEach(_comboSync);

// La destinazione non può coincidere con l'origine: la rimuove dall'elenco.
function _filtraDestinazione() {
  const st = _getState();
  const orSel = document.getElementById('nm-origine');
  const deSel = document.getElementById('nm-destinazione');
  if (!orSel || !deSel) return;
  const orId = orSel.value, cur = deSel.value;
  const ubi = st.ubicazioni.filter(u => u.attivo !== false)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
  deSel.innerHTML = '<option value="">— seleziona —</option>' +
    ubi.filter(u => u.id !== orId).map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');
  deSel.value = (cur && cur !== orId) ? cur : '';
  _comboSync('nm-destinazione');
}

// Scarico camion: missione senza destinazione, creabile solo dal reparto RICEZIONE
const SCARICO_NOME = 'SCARICO CAMION';
const _repartoRicezione = () => {
  const id = document.getElementById('nm-reparto')?.value;
  const r = id && (_getState().reparti || []).find(x => x.id === id);
  return !!r && String(r.nome || '').trim().toLowerCase() === 'ricezione';
};

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

  // Reparto: se scelto, l'ORIGINE propone solo i punti di quel reparto.
  // La scelta resta memorizzata su questo dispositivo.
  const repSel = document.getElementById('nm-reparto');
  let reparto = null;
  if (repSel) {
    const u = _getUser();
    let cur = repSel.value;
    const reparti = (st.reparti || []).filter(r => r.attivo !== false)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
    if (u && repSel.dataset.uid !== u.uid && reparti.length) {
      repSel.dataset.uid = u.uid;
      try { cur = localStorage.getItem('repartoPren:' + u.uid) || ''; } catch (e) { cur = ''; }
    }
    repSel.innerHTML = '<option value="">Tutti i reparti</option>' + reparti.map(r => `<option value="${esc(r.id)}">${esc(r.nome)}</option>`).join('');
    repSel.value = reparti.some(r => r.id === cur) ? cur : '';
    reparto = reparti.find(r => r.id === repSel.value) || null;
  }
  const origini = reparto ? ubicazioni.filter(u => (reparto.puntiIds || []).includes(u.id)) : ubicazioni;

  elSel.innerHTML = '<option value="">— seleziona —</option>' +
    elementi.map(e => `<option value="${e.id}">${esc(e.codice)}</option>`).join('');
  orSel.innerHTML = '<option value="">— seleziona —</option>' +
    origini.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');
  deSel.innerHTML = '<option value="">— seleziona —</option>' +
    ubicazioni.filter(u => !vOr || u.id !== vOr).map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');

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

  // Spunta "Linea Rossa": subito dopo la Linea Blu; selezionabile solo se non sono scelte Linea Blu né Vuoto
  if (!document.getElementById('nm-linearossa')) {
    const anchor = document.getElementById('nm-lineablu-wrap') || document.getElementById('nm-btn');
    if (anchor && anchor.parentNode) {
      const wrap = document.createElement('label');
      wrap.id = 'nm-linearossa-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 12px;' +
        'border:1px solid #dc262655;border-radius:8px;background:#dc262612;cursor:pointer;' +
        'font-weight:700;user-select:none';
      wrap.innerHTML = '<input type="checkbox" id="nm-linearossa" style="width:20px;height:20px;margin:0;accent-color:#dc2626;cursor:pointer">' +
        '<span>🔴 Linea Rossa</span>' +
        '<span id="nm-linearossa-hint" style="font-size:11px;font-weight:500;color:var(--muted);margin-left:auto"></span>';
      anchor.parentNode.insertBefore(wrap, anchor.id === 'nm-btn' ? anchor : anchor.nextSibling);
    }
  }

  // Spunta "Vuoto": sempre cliccabile (salvo incompatibilità con Linea Blu / Linea Rossa)
  if (!document.getElementById('nm-vuoto')) {
    const anchor = document.getElementById('nm-linearossa-wrap') || document.getElementById('nm-lineablu-wrap') || document.getElementById('nm-btn');
    if (anchor && anchor.parentNode) {
      const wrap = document.createElement('label');
      wrap.id = 'nm-vuoto-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 12px;' +
        'border:1px solid #16a34a55;border-radius:8px;background:#16a34a12;cursor:pointer;' +
        'font-weight:700;user-select:none';
      wrap.innerHTML = '<input type="checkbox" id="nm-vuoto" style="width:20px;height:20px;margin:0;accent-color:#16a34a;cursor:pointer">' +
        '<span>🟢 Vuoto</span>' +
        '<span id="nm-vuoto-hint" style="font-size:11px;font-weight:500;color:var(--muted);margin-left:auto"></span>';
      anchor.parentNode.insertBefore(wrap, anchor.id === 'nm-btn' ? anchor : anchor.nextSibling);
    }
  }
  // Spunta "Scarico camion": subito dopo Vuoto; attiva solo con il reparto RICEZIONE
  if (!document.getElementById('nm-camion')) {
    const anchor = document.getElementById('nm-vuoto-wrap') || document.getElementById('nm-btn');
    if (anchor && anchor.parentNode) {
      const wrap = document.createElement('label');
      wrap.id = 'nm-camion-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 12px;' +
        'border:1px solid #b4530955;border-radius:8px;background:#b4530912;cursor:pointer;' +
        'font-weight:700;user-select:none';
      wrap.innerHTML = '<input type="checkbox" id="nm-camion" style="width:20px;height:20px;margin:0;accent-color:#b45309;cursor:pointer">' +
        '<span>🚛 Scarico camion</span>' +
        '<span id="nm-camion-hint" style="font-size:11px;font-weight:500;color:var(--muted);margin-left:auto"></span>';
      anchor.parentNode.insertBefore(wrap, anchor.id === 'nm-btn' ? anchor : anchor.nextSibling);
    }
  }
  const cbCamion = document.getElementById('nm-camion'); if (cbCamion) cbCamion.onchange = _aggiornaSpunte;
  orSel.onchange = () => { _filtraDestinazione(); _aggiornaSpunte(); };
  const cbBlu = document.getElementById('nm-lineablu'); if (cbBlu) cbBlu.onchange = _aggiornaSpunte;
  const cbRossa = document.getElementById('nm-linearossa'); if (cbRossa) cbRossa.onchange = _aggiornaSpunte;
  const cbVuoto = document.getElementById('nm-vuoto');  if (cbVuoto) cbVuoto.onchange = _aggiornaSpunte;
  _aggiornaSpunte();
  _comboTutti();
}

// Linea Blu: la spunta è attiva solo se l'origine appartiene a questo Building
const LINEA_BLU_BUILDING = 'B26';

// Aggiorna le tre spunte. Regole (le tre spunte sono mutuamente esclusive):
//  • Linea Blu: cliccabile solo con origine del building B26 e se non sono spuntate Linea Rossa / Vuoto
//  • Linea Rossa: cliccabile solo se non sono spuntate Linea Blu / Vuoto
//  • Vuoto: cliccabile solo se non sono spuntate Linea Blu / Linea Rossa
function _aggiornaSpunte() {
  const cbBlu = document.getElementById('nm-lineablu');
  const cbRossa = document.getElementById('nm-linearossa');
  const cbVuoto = document.getElementById('nm-vuoto');
  const cbCamion = document.getElementById('nm-camion');
  if (!cbBlu || !cbRossa || !cbVuoto) return;

  // Scarico camion: solo con il reparto RICEZIONE; esclude tutte le altre spunte e la destinazione
  const ricezione = _repartoRicezione();
  if (cbCamion && !ricezione) cbCamion.checked = false;
  const camion = !!cbCamion && cbCamion.checked;
  const altraSel = cbBlu.checked || cbRossa.checked || cbVuoto.checked;
  const camionOk = !!cbCamion && ricezione && !altraSel;
  if (cbCamion) {
    cbCamion.disabled = !camionOk && !camion;
    const w = document.getElementById('nm-camion-wrap');
    if (w) { const ok = camionOk || camion; w.style.opacity = ok ? '1' : '.5'; w.style.cursor = ok ? 'pointer' : 'not-allowed'; }
    const h = document.getElementById('nm-camion-hint');
    if (h) h.textContent = camion ? 'Senza destinazione' : !ricezione ? 'Solo per il reparto RICEZIONE' : altraSel ? 'Non compatibile con le altre spunte' : '';
  }
  // La destinazione non serve: il campo sparisce e si svuota
  const deSel = document.getElementById('nm-destinazione');
  const deField = deSel?.closest('.field');
  if (deField) deField.style.display = camion ? 'none' : '';
  if (camion && deSel && deSel.value) { deSel.value = ''; _comboSync('nm-destinazione'); }
  // Nemmeno l'elemento da spostare serve: si sceglie solo l'origine
  const elSel = document.getElementById('nm-elemento');
  const elField = elSel?.closest('.field');
  if (elField) elField.style.display = camion ? 'none' : '';
  if (camion && elSel && elSel.value) { elSel.value = ''; _comboSync('nm-elemento'); }

  const orId = document.getElementById('nm-origine')?.value;
  const ub = _getState().ubicazioni.find(x => x.id === orId);
  const origineOk = !!ub && ub.buildingId === LINEA_BLU_BUILDING;

  // Se l'origine non è B26 la Linea Blu non può restare spuntata
  if (!origineOk) cbBlu.checked = false;

  const bluOk = !camion && origineOk && !cbRossa.checked && !cbVuoto.checked;
  const rossaOk = !camion && !cbBlu.checked && !cbVuoto.checked;
  const vuotoOk = !camion && !cbBlu.checked && !cbRossa.checked;
  cbBlu.disabled = !bluOk;
  cbRossa.disabled = !rossaOk;
  cbVuoto.disabled = !vuotoOk;

  const setStyle = (id, ok) => {
    const w = document.getElementById(id);
    if (w) { w.style.opacity = ok ? '1' : '.5'; w.style.cursor = ok ? 'pointer' : 'not-allowed'; }
  };
  setStyle('nm-lineablu-wrap', bluOk);
  setStyle('nm-linearossa-wrap', rossaOk);
  setStyle('nm-vuoto-wrap', vuotoOk);

  const altra = (...n) => 'Non compatibile con ' + n.join(' / ');
  const hBlu = document.getElementById('nm-lineablu-hint');
  if (hBlu) hBlu.textContent = bluOk ? ''
    : camion ? altra('Scarico camion') : (cbRossa.checked ? altra('Linea Rossa') : cbVuoto.checked ? altra('Vuoto') : `Solo per origini del building ${LINEA_BLU_BUILDING}`);
  const hRossa = document.getElementById('nm-linearossa-hint');
  if (hRossa) hRossa.textContent = rossaOk ? '' : camion ? altra('Scarico camion') : (cbBlu.checked ? altra('Linea Blu') : altra('Vuoto'));
  const hVuoto = document.getElementById('nm-vuoto-hint');
  if (hVuoto) hVuoto.textContent = vuotoOk ? '' : camion ? altra('Scarico camion') : (cbBlu.checked ? altra('Linea Blu') : altra('Linea Rossa'));
}

// Badge + stile per le missioni Linea Blu (priorità)
const BLU_BORDER = 'border-left:4px solid #2563eb;';
function _badgeBlu(m) {
  return m.lineaBlu
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#2563eb;color:#fff;letter-spacing:.3px">🔵 LINEA BLU</span>'
    : '';
}
function _badgeRossa(m) {
  return m.lineaRossa
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#dc2626;color:#fff;letter-spacing:.3px">🔴 LINEA ROSSA</span>'
    : '';
}
function _badgeVuoto(m) {
  return m.vuoto
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#16a34a;color:#fff;letter-spacing:.3px">🟢 VUOTO</span>'
    : '';
}
function _badgeCamion(m) {
  return m.scaricoCamion
    ? '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;background:#b45309;color:#fff;letter-spacing:.3px">🚛 SCARICO CAMION</span>'
    : '';
}
function _styleBlu(m) {
  return m.lineaBlu ? ` style="${BLU_BORDER}"` : m.lineaRossa ? ' style="border-left:4px solid #dc2626;"' : '';
}

// Data e ora con i secondi (ora di Roma): gg/mm/aa hh:mm:ss
function _dataOraSec(t) {
  if (!t) return '—';
  const d = t.toDate ? t.toDate() : new Date(t);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

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
  let elId = document.getElementById('nm-elemento').value;
  const orId = document.getElementById('nm-origine').value;
  let deId = document.getElementById('nm-destinazione').value;
  // Scarico camion: solo dal reparto RICEZIONE, senza destinazione
  const camion = !!document.getElementById('nm-camion')?.checked && _repartoRicezione();
  if (camion) deId = '';
  if (camion) elId = '';
  if (!orId || (!camion && (!elId || !deId))) { showToast(camion ? 'Seleziona l\'origine.' : 'Seleziona elemento, origine e destinazione.', 'error'); return; }

  const elemento = camion ? { id: null, codice: '' } : st.elementi.find(e => e.id === elId);
  const origine = st.ubicazioni.find(x => x.id === orId);
  const destinazione = camion ? { id: null, nome: SCARICO_NOME } : st.ubicazioni.find(x => x.id === deId);
  if (!elemento || !origine || !destinazione) { showToast('Dati non validi, riprova.', 'error'); return; }
  if (!camion && orId === deId) { showToast('Origine e destinazione non possono coincidere.', 'error'); return; }

  // Linea Blu valida solo se l'origine appartiene al building B26
  const vuoto = !camion && !!document.getElementById('nm-vuoto')?.checked;
  const note = (document.getElementById('nm-note')?.value || '').trim().slice(0, 300);
  const rossaSel = !camion && !!document.getElementById('nm-linearossa')?.checked;
  // Mutuamente esclusive: Linea Blu, Linea Rossa e Vuoto non vengono mai salvate insieme
  const lineaBlu = !camion && !vuoto && !rossaSel && !!document.getElementById('nm-lineablu')?.checked
    && origine.buildingId === LINEA_BLU_BUILDING;
  const lineaRossa = !vuoto && !lineaBlu && rossaSel;

  const btn = document.getElementById('nm-btn');
  btn.disabled = true; btn.textContent = '⏳ Creazione…';
  try {
    // ID univoco: ####-gg-mmaaaa. Transazione sul contatore del giorno: due utenti
    // che creano nello stesso istante non possono ottenere lo stesso numero.
    const giorno = _oggiGGMMAAAA();
    const cntRef = doc(window.db, 'missioni', '_cnt-' + giorno);
    let codice = '';
    await runTransaction(window.db, async (tx) => {
      const snap = await tx.get(cntRef);
      const n = (snap.exists() ? (snap.data().n || 0) : 0) + 1;
      codice = String(n).padStart(4, '0') + '-' + giorno.slice(0, 2) + '-' + giorno.slice(2);
      tx.set(cntRef, { n, giorno });
      tx.set(doc(window.db, 'missioni', codice), {
        codice,
        elementoId: camion ? null : elId, elementoCodice: elemento.codice,
        origineId: orId, origineNome: origine.nome,
        destinazioneId: camion ? null : deId, destinazioneNome: destinazione.nome,
        lineaBlu, lineaRossa, vuoto, note,
        ...(camion ? { scaricoCamion: true } : {}),
        stato: 'richiesta',
        navettaId: null, navettaNome: null,
        ownerUid: u.uid, ownerNome: u.name || u.email,
        createdAt: serverTimestamp(), presaInCaricoAt: null, consegnataAt: null,
      });
    });
    await window.logHistory({
      action: 'Missione creata', codice, elemento: elemento.codice,
      origine: origine.nome, destinazione: destinazione.nome,
      lineaBlu, lineaRossa, vuoto, note,
      ...(camion ? { scaricoCamion: true } : {}),
    });
    showToast(`Missione${camion ? ' SCARICO CAMION' : ''}${lineaBlu ? ' LINEA BLU' : ''}${lineaRossa ? ' LINEA ROSSA' : ''}${vuoto ? ' VUOTO' : ''} creata ${codice}: ${camion ? 'da ' + origine.nome : elemento.codice + ' → ' + destinazione.nome}`, 'success');
    // Reset selezioni
    document.getElementById('nm-elemento').value = '';
    document.getElementById('nm-origine').value = '';
    document.getElementById('nm-destinazione').value = '';
    _filtraDestinazione(); _comboTutti();
    const cn = document.getElementById('nm-note'); if (cn) cn.value = '';
    const cb = document.getElementById('nm-lineablu'); if (cb) cb.checked = false;
    const cr = document.getElementById('nm-linearossa'); if (cr) cr.checked = false;
    const cv = document.getElementById('nm-vuoto'); if (cv) cv.checked = false;
    const cc = document.getElementById('nm-camion'); if (cc) cc.checked = false;
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
    .sort((a, b) => ((b.lineaBlu || b.lineaRossa) ? 1 : 0) - ((a.lineaBlu || a.lineaRossa) ? 1 : 0) || tsVal(a.createdAt) - tsVal(b.createdAt));

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
        ${m.elementoCodice ? `<span class="mElemento">${esc(m.elementoCodice)}</span>` : ''}
        ${_badgeBlu(m)}
        ${_badgeRossa(m)}
        ${_badgeVuoto(m)}
        ${_badgeCamion(m)}
        <span class="mStatoBadge richiesta">In attesa</span>
      </div>
      <div class="mRoute"><span class="mLoc">${esc(m.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(m.destinazioneNome)}</span></div>
      ${m.note ? `<div class="mMeta" style="color:var(--text);font-size:16px;font-weight:600;line-height:1.4;white-space:pre-wrap;margin:4px 0">📝 ${esc(m.note)}</div>` : ''}
      <div class="mMeta">Creata: ${_dataOraSec(m.createdAt)}</div>
      <div class="mActions">
        <button class="btnGray" onclick="stampaFoglioTrasferimento('${m.id}')">🖨 Stampa foglio trasferimento</button>
        <button class="btnGray" onclick="modificaMissione('${m.id}')">✏️ Modifica</button>
        <button class="btnGray" onclick="annullaMissione('${m.id}')">✕ Annulla</button>
      </div>
    </div>`;
}

// ── AZIONE: modifica missione (solo 'richiesta', solo l'utente che l'ha creata) ──
// Modificabili: elemento, origine, destinazione, spunte Linea Blu / Linea Rossa / Vuoto.
// L'ID e la data di creazione non cambiano (quindi la posizione in lista resta la stessa).
window.modificaMissione = function (id) {
  const u = _getUser();
  const st = _getState();
  const m = st.missioni.find(x => x.id === id);
  if (!m) return;
  if (m.ownerUid !== u.uid) { showToast('Puoi modificare solo le tue missioni.', 'error'); return; }
  if (m.stato !== 'richiesta') { showToast('Modificabile solo finché è in attesa.', 'error'); return; }

  document.getElementById('modalModificaMissione')?.remove();
  const elementi = st.elementi.filter(e => e.attivo !== false || e.id === m.elementoId)
    .sort((a, b) => String(a.codice).localeCompare(String(b.codice), 'it', { numeric: true }));
  const ubic = st.ubicazioni.filter(x => x.attivo !== false || x.id === m.origineId || x.id === m.destinazioneId)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
  const opt = (list, lab, sel) => list.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x[lab])}</option>`).join('');
  const box = (cid, col, txt) => `<label id="${cid}-wrap" style="display:flex;align-items:center;gap:10px;margin:8px 0;padding:10px 12px;` +
    `border:1px solid ${col}55;border-radius:8px;background:${col}12;font-weight:700;user-select:none">` +
    `<input type="checkbox" id="${cid}" style="width:20px;height:20px;margin:0;accent-color:${col}">` +
    `<span>${txt}</span><span id="${cid}-hint" style="font-size:11px;font-weight:500;color:var(--muted);margin-left:auto"></span></label>`;

  const ov = document.createElement('div');
  ov.className = 'modalOverlay open';
  ov.id = 'modalModificaMissione';
  { let dn = false; ov.addEventListener('mousedown', e => { dn = e.target === ov; }); ov.onclick = e => { if (e.target === ov && dn) ov.remove(); }; }
  ov.innerHTML = `<div class="modalBox">
    <h3>Modifica missione${m.codice ? ' ' + esc(m.codice) : ''}</h3>
    ${m.scaricoCamion ? '' : `<div class="field"><label>Elemento da spostare</label><select id="mm-elemento">${opt(elementi, 'codice', m.elementoId)}</select></div>`}
    <div class="field"><label>Origine</label><select id="mm-origine">${opt(ubic, 'nome', m.origineId)}</select></div>
    ${m.scaricoCamion ? '' : `<div class="field"><label>Destinazione</label><select id="mm-destinazione">${opt(ubic, 'nome', m.destinazioneId)}</select></div>`}
    <div class="field"><label>Note <span class="opt">(facoltativo)</span></label><textarea id="mm-note" rows="2" maxlength="300" placeholder="Eventuali indicazioni per il movimentatore (non obbligatorio)">${esc(m.note || '')}</textarea></div>
    ${m.scaricoCamion ? '<div style="margin:8px 0;padding:10px 12px;border-radius:8px;background:#b4530912;border:1px solid #b4530955;font-weight:700">🚛 Scarico camion <span style="font-size:11px;font-weight:500;color:var(--muted)">(senza destinazione)</span></div>' : `${box('mm-blu', '#2563eb', '🔵 Linea Blu')}
    ${box('mm-rossa', '#dc2626', '🔴 Linea Rossa')}
    ${box('mm-vuoto', '#16a34a', '🟢 Vuoto')}`}
    <div class="modalActions">
      <button class="btnGray" id="mm-annulla">Chiudi</button>
      <button class="btnGreen" id="mm-salva">Salva modifiche</button>
    </div></div>`;
  document.body.appendChild(ov);

  const $ = x => document.getElementById(x);
  const camion = !!m.scaricoCamion;
  if (!camion) { $('mm-blu').checked = !!m.lineaBlu; $('mm-rossa').checked = !!m.lineaRossa; $('mm-vuoto').checked = !!m.vuoto; }

  // Stesse regole della creazione: le tre spunte sono mutuamente esclusive e
  // la Linea Blu richiede un'origine del building B26.
  const regole = () => {
    const ub = st.ubicazioni.find(x => x.id === $('mm-origine').value);
    const okB = !!ub && ub.buildingId === LINEA_BLU_BUILDING;
    if (!okB) $('mm-blu').checked = false;
    const b = $('mm-blu').checked, r = $('mm-rossa').checked, v = $('mm-vuoto').checked;
    const ok = { blu: okB && !r && !v, rossa: !b && !v, vuoto: !b && !r };
    [['blu', 'mm-blu'], ['rossa', 'mm-rossa'], ['vuoto', 'mm-vuoto']].forEach(([k, cid]) => {
      $(cid).disabled = !ok[k];
      $(cid + '-wrap').style.opacity = ok[k] ? '1' : '.5';
      $(cid + '-wrap').style.cursor = ok[k] ? 'pointer' : 'not-allowed';
      $(cid + '-hint').textContent = ok[k] ? '' : (k === 'blu' && !okB ? `Solo per origini del building ${LINEA_BLU_BUILDING}` : 'Non compatibile con la spunta scelta');
    });
  };
  if (!camion) {
    ['mm-origine', 'mm-blu', 'mm-rossa', 'mm-vuoto'].forEach(x => { $(x).onchange = regole; });
    regole();
  }

  $('mm-annulla').onclick = () => ov.remove();
  $('mm-salva').onclick = async () => {
    const el = camion ? { id: null, codice: '' } : st.elementi.find(x => x.id === $('mm-elemento').value);
    const orig = st.ubicazioni.find(x => x.id === $('mm-origine').value);
    const dest = camion ? { id: null, nome: SCARICO_NOME } : st.ubicazioni.find(x => x.id === $('mm-destinazione').value);
    if (!el || !orig || !dest) { showToast('Seleziona elemento, origine e destinazione.', 'error'); return; }
    const nuovo = {
      elementoId: el.id, elementoCodice: el.codice,
      origineId: orig.id, origineNome: orig.nome,
      destinazioneId: dest.id, destinazioneNome: dest.nome,
      lineaBlu: !camion && $('mm-blu').checked && orig.buildingId === LINEA_BLU_BUILDING,
      lineaRossa: !camion && $('mm-rossa').checked,
      vuoto: !camion && $('mm-vuoto').checked,
      note: ($('mm-note').value || '').trim().slice(0, 300),
    };
    const diff = [];
    if (nuovo.elementoId !== m.elementoId) diff.push(`Elemento: ${m.elementoCodice} → ${nuovo.elementoCodice}`);
    if (nuovo.origineId !== m.origineId) diff.push(`Origine: ${m.origineNome} → ${nuovo.origineNome}`);
    if (nuovo.destinazioneId !== m.destinazioneId) diff.push(`Destinazione: ${m.destinazioneNome} → ${nuovo.destinazioneNome}`);
    [['lineaBlu', 'Linea Blu'], ['lineaRossa', 'Linea Rossa'], ['vuoto', 'Vuoto']].forEach(([k, lab]) => {
      if (!!m[k] !== !!nuovo[k]) diff.push(`${lab}: ${m[k] ? 'sì' : 'no'} → ${nuovo[k] ? 'sì' : 'no'}`);
    });
    if ((m.note || '') !== nuovo.note) diff.push(nuovo.note ? (m.note ? 'Note modificate' : 'Note aggiunte') : 'Note rimosse');
    if (!diff.length) { showToast('Nessuna modifica da salvare.', 'error'); return; }

    const btn = $('mm-salva'); btn.disabled = true; btn.textContent = '⏳ Salvataggio…';
    try {
      // Transazione: la missione deve essere ancora in attesa e di proprietà dell'utente
      const ref = doc(window.db, 'missioni', id);
      await runTransaction(window.db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Missione non trovata.');
        const cur = snap.data();
        if (cur.ownerUid !== u.uid) throw new Error('Puoi modificare solo le tue missioni.');
        if (cur.stato !== 'richiesta') throw new Error('La missione è già stata presa in carico: non è più modificabile.');
        tx.update(ref, { ...nuovo, modificataAt: serverTimestamp() });
      });
      await window.logHistory({
        action: 'Missione modificata', codice: m.codice || null,
        elemento: nuovo.elementoCodice, origine: nuovo.origineNome, destinazione: nuovo.destinazioneNome,
        lineaBlu: nuovo.lineaBlu, lineaRossa: nuovo.lineaRossa, vuoto: nuovo.vuoto, note: nuovo.note,
        dettaglio: diff.join(' · '),
      });
      ov.remove();
      showToast('Missione modificata.', 'success');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Salva modifiche';
      showToast('Errore: ' + e.message, 'error');
    }
  };
};

// ── AZIONE: annulla missione (solo 'richiesta', solo l'utente che l'ha creata) ────────────────
// Finestra di conferma nello stile delle altre finestre dell'app (al posto del confirm() del browser).
// Restituisce una Promise<boolean>.
function _dialogConferma({ titolo, corpo, okLabel, backLabel, danger }) {
  return new Promise(resolve => {
    document.getElementById('modalConferma')?.remove();
    const ov = document.createElement('div');
    ov.className = 'modalOverlay open';
    ov.id = 'modalConferma';
    ov.innerHTML = `<div class="modalBox">
      <h3>${esc(titolo)}</h3>${corpo}
      <div class="modalActions">
        <button class="btnGray" id="mc-back">${esc(backLabel || 'Indietro')}</button>
        <button class="${danger ? 'btnRed' : 'btnGreen'}" id="mc-ok">${okLabel}</button>
      </div></div>`;
    document.body.appendChild(ov);
    const chiudi = v => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') chiudi(false); };
    document.addEventListener('keydown', onKey);
    { let dn = false; ov.addEventListener('mousedown', e => { dn = e.target === ov; }); ov.onclick = e => { if (e.target === ov && dn) chiudi(false); }; }
    document.getElementById('mc-back').onclick = () => chiudi(false);
    document.getElementById('mc-ok').onclick = () => chiudi(true);
    document.getElementById('mc-back').focus();
  });
}

window.annullaMissione = async function (id) {
  const u = _getUser();
  const m = _getState().missioni.find(x => x.id === id);
  if (!m) return;
  if (m.stato !== 'richiesta') { showToast('Annullabile solo finché è in attesa.', 'error'); return; }
  if (m.ownerUid !== u.uid) { showToast('Puoi annullare solo le tue missioni.', 'error'); return; }
  const ok = await _dialogConferma({
    titolo: 'Annulla missione' + (m.codice ? ' ' + m.codice : ''),
    corpo: `${m.elementoCodice ? `<div style="font-size:15px;font-weight:700;margin-bottom:6px">${esc(m.elementoCodice)}</div>` : ''}
      <div class="mRoute" style="margin-bottom:10px"><span class="mLoc">${esc(m.origineNome)}</span><span class="mArrow">→</span><span class="mLoc">${esc(m.destinazioneNome)}</span></div>
      <div style="font-size:13px;color:var(--muted)">La missione verrà annullata e non sarà più disponibile per i movimentatori. L'operazione non si può annullare.</div>`,
    okLabel: '✕ Annulla missione', backLabel: 'Indietro', danger: true,
  });
  if (!ok) return;
  try {
    await updateDoc(doc(window.db, 'missioni', id), { stato: 'annullata', annullataAt: serverTimestamp() });
    await window.logHistory({ action: 'Missione annullata', codice: m.codice || null, elemento: m.elementoCodice, origine: m.origineNome, destinazione: m.destinazioneNome });
    showToast('Missione annullata.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};
