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

  // Filtro "Area di movimentazione": solo le missioni con destinazione in uno dei
  // punti dell'area. La scelta resta memorizzata su questo dispositivo.
  const aree = (st.aree || []).filter(a => a.attivo !== false)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
  const sel = document.getElementById('ic-area');
  let area = null;
  if (sel) {
    let cur = sel.value;
    if (sel.dataset.uid !== u.uid) {            // primo disegno per questo utente: ripristina la scelta salvata
      sel.dataset.uid = u.uid;
      try { cur = localStorage.getItem('areaInCorso:' + u.uid) || ''; } catch (e) { cur = ''; }
    }
    sel.innerHTML = '<option value="">Tutte le aree</option>' + aree.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('');
    sel.value = aree.some(a => a.id === cur) ? cur : '';
    area = aree.find(a => a.id === sel.value) || null;
  }
  // Filtro "Reparto": solo le missioni con ORIGINE in uno dei punti del reparto (scelta memorizzata)
  const reparti = (st.reparti || []).filter(r => r.attivo !== false)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
  const rSel = document.getElementById('ic-reparto');
  let reparto = null;
  if (rSel) {
    let cur = rSel.value;
    if (rSel.dataset.uid !== u.uid && reparti.length) {
      rSel.dataset.uid = u.uid;
      try { cur = localStorage.getItem('repartoInCorso:' + u.uid) || ''; } catch (e) { cur = ''; }
    }
    rSel.innerHTML = '<option value="">Tutti i reparti</option>' + reparti.map(r => `<option value="${esc(r.id)}">${esc(r.nome)}</option>`).join('');
    rSel.value = reparti.some(r => r.id === cur) ? cur : '';
    reparto = reparti.find(r => r.id === rSel.value) || null;
  }
  // Filtro "Origine": menu dei punti; limitato ai punti dell'area e/o del reparto scelti.
  const oSel = document.getElementById('ic-origine');
  let origId = '';
  if (oSel) {
    const punti = (st.ubicazioni || []).filter(x => x.attivo !== false && (!area || (area.puntiIds || []).includes(x.id)) && (!reparto || (reparto.puntiIds || []).includes(x.id)))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
    const cur = oSel.value;
    oSel.innerHTML = '<option value="">Tutte le origini</option>' + punti.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
    oSel.value = punti.some(x => x.id === cur) ? cur : '';
    origId = oSel.value;
  }
  const inArea = m => (!area || (area.puntiIds || []).includes(m.destinazioneId)) && (!reparto || (reparto.puntiIds || []).includes(m.origineId)) && (!origId || m.origineId === origId);

  // Da prendere
  const avTutte = st.missioni.filter(m => m.stato === 'richiesta');
  const avMiss = avTutte.filter(inArea)
    .map(m => ({ ...m, _kind: 'missione', _avail: true }));

  // Presi in carico (propri; l'admin li vede tutti)
  const tkTutte = st.missioni.filter(m => m.stato === 'in_transito' && (isAdmin || m.navettaId === u.uid));
  const tkMiss = tkTutte.filter(inArea)
    .map(m => ({ ...m, _kind: 'missione', _avail: false }));

  const nascoste = (avTutte.length - avMiss.length) + (tkTutte.length - tkMiss.length);
  const nEl = document.getElementById('ic-nascoste');
  if (nEl) nEl.textContent = (area || reparto || origId) && nascoste ? `${nascoste} ${nascoste === 1 ? 'missione nascosta' : 'missioni nascoste'} dai filtri` : '';

  // Un'unica lista: prima le missioni LINEA BLU, poi tutto il resto; a parità
  // ordinata per anzianità. Prendere un elemento non lo sposta di posizione
  // (la card "rimane" dov'era), perché lineaBlu e createdAt non cambiano.
  // Filtro per stato: Aperta (da prendere) / In carico
  const fStato = document.getElementById('ic-stato')?.value || '';
  const lista = (fStato === 'aperta' ? avMiss : fStato === 'carico' ? tkMiss : avMiss.concat(tkMiss))
    .sort((a, b) => (a._avail ? 1 : 0) - (b._avail ? 1 : 0)            // prima le prese in carico
                 || (!a._avail ? _presa(b) - _presa(a) : 0) // l'ultima presa in cima
                 || ((b.lineaBlu || b.lineaRossa) ? 1 : 0) - ((a.lineaBlu || a.lineaRossa) ? 1 : 0)
                 || tsVal(a.createdAt) - tsVal(b.createdAt));

  // Statistiche
  const statsEl = document.getElementById('incorso-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="statCard orange"><div class="val">${avMiss.length}</div><div class="lbl">Aperte</div></div>
      <div class="statCard green"><div class="val">${tkMiss.length}</div><div class="lbl">In carico</div></div>`;
  }

  if (!lista.length) { el.innerHTML = (area || reparto || fStato || origId) ? '<div class="emptyState">Nessuna missione con questi filtri. 👍</div>' : '<div class="emptyState">Nulla in corso. 👍</div>'; return; }
  el.innerHTML = lista.map(_card).join('');
}

// Ora di presa in carico; se il server non ha ancora risposto (valore nullo) è la più recente.
function _presa(m) { return m.presaInCaricoAt ? tsVal(m.presaInCaricoAt) : Date.now() + 1e9; }

window.renderInCorso = renderInCorso;
window.cambiaRepartoInCorso = function () {
  const u = _getUser();
  try { localStorage.setItem('repartoInCorso:' + u.uid, document.getElementById('ic-reparto')?.value || ''); } catch (e) {}
  renderInCorso();
};
window.cambiaAreaInCorso = function () {
  const u = _getUser();
  try { localStorage.setItem('areaInCorso:' + u.uid, document.getElementById('ic-area')?.value || ''); } catch (e) {}
  renderInCorso();
};

function _card(item) {
  let statoBadge, actionBtn, meta;
  if (item._avail) {
    // Da prendere → pulsante GIALLO
    statoBadge = `<span class="mStatoBadge richiesta">Aperta</span>`;
    meta = `⏱ in coda da ${fmtDur(item.createdAt)}`;
    actionBtn = `<button class="btnOrange" onclick="prendiMissione('${item.id}')">🚚 Prendi in carico</button>`;
  } else {
    // Preso in carico → pulsante VERDE
    statoBadge = `<span class="mStatoBadge in_transito">In carico</span>`;
    // Chi ha preso in carico: ben visibile (grande e in grassetto)
    meta = `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">`
      + (item.navettaNome ? `<span style="font-size:19px;font-weight:800;color:var(--text);line-height:1.2">👤 ${esc(item.navettaNome)}</span>` : '')
      + `<span style="font-size:12px;color:var(--muted)">in carico da ${fmtDur(item.presaInCaricoAt)}</span></div>`;
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
      ${item.note ? `<div class="mMeta" style="color:var(--text);font-size:16px;font-weight:600;line-height:1.4;white-space:pre-wrap;margin:4px 0">📝 ${esc(item.note)}</div>` : ''}
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
// Per confermare la consegna il movimentatore deve identificare il PUNTO DI
// DESTINAZIONE: scansionando il barcode con la fotocamera oppure, in
// alternativa, scegliendolo a mano da un menù. In entrambi i casi il punto deve
// coincidere con la destinazione della missione; il metodo usato viene salvato
// sulla missione e nello storico.
//
// Cosa deve contenere il barcode: il NOME del punto carico-scarico
// (es. B12-STA13-A) oppure il suo ID interno; maiuscole/spazi ininfluenti.
// Formati letti: Code 128 / 39 / 93, EAN, ITF, Codabar, QR, Data Matrix.
async function _conferma(coll, id, statoAtteso, statoFinale, campoData, extra = {}) {
  const u = _getUser();
  const isAdmin = u.role === 'amministratore';
  const ref = doc(window.db, coll, id);
  await runTransaction(window.db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Elemento non più presente');
    const d = snap.data();
    if (d.stato !== statoAtteso) throw new Error('Stato non valido');
    if (d.navettaId !== u.uid && !isAdmin) throw new Error('Non è la tua missione');
    tx.update(ref, { stato: statoFinale, [campoData]: serverTimestamp(), ...extra });
  });
}

// ── Scanner fotocamera ───────────────────────────────────────────────────────
let _scanStop = null;   // funzione che ferma la fotocamera in uso

function _fermaScanner() {
  if (_scanStop) { try { _scanStop(); } catch (e) {} _scanStop = null; }
}

// Avvia la fotocamera posteriore e chiama onCode(testo) per ogni lettura.
async function _avviaScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Fotocamera non disponibile su questo dispositivo/browser (serve una connessione sicura https).');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError'
      ? 'Accesso alla fotocamera negato: consenti la fotocamera per questo sito nelle impostazioni del browser.'
      : 'Impossibile avviare la fotocamera (' + (e.name || e.message) + ').');
  }
  let attivo = true, controlli = null;
  _scanStop = () => {
    attivo = false;
    try { controlli?.stop?.(); } catch (e) {}
    stream.getTracks().forEach(tr => tr.stop());
    video.srcObject = null;
  };

  // 1) Rilevatore nativo del browser (Chrome/Android, Edge…)
  if ('BarcodeDetector' in window) {
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      const formati = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'qr_code', 'data_matrix', 'upc_a', 'upc_e']
        .filter(f => sup.includes(f));
      if (formati.length) {
        const det = new window.BarcodeDetector({ formats: formati });
        video.srcObject = stream;
        await video.play();
        const ciclo = async () => {
          if (!attivo) return;
          try {
            const r = await det.detect(video);
            if (attivo && r.length && r[0].rawValue) onCode(r[0].rawValue);
          } catch (e) { /* frame non pronto */ }
          if (attivo) setTimeout(ciclo, 200);
        };
        ciclo();
        return;
      }
    } catch (e) { /* si passa alla libreria */ }
  }

  // 2) Libreria ZXing (iPhone/Safari e browser senza rilevatore nativo)
  let lib;
  try {
    lib = await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
  } catch (e) {
    _fermaScanner();
    throw new Error('Scanner non disponibile (libreria non caricata): riprova più tardi.');
  }
  const reader = new lib.BrowserMultiFormatReader();
  controlli = await reader.decodeFromStream(stream, video, (res) => {
    if (attivo && res) onCode(res.getText());
  });
}

// ── Finestra "Conferma consegna" ─────────────────────────────────────────────
// Telefono/tablet (schermo touch): lì è prevista la scansione con la fotocamera.
// Su PC la conferma si fa digitando il punto di consegna.
const _isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && window.matchMedia?.('(pointer:coarse)').matches);

const _norm = s => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

window.confermaMissione = function (id) {
  const st = _getState();
  const m = st.missioni.find(x => x.id === id);
  if (!m) return;
  _fermaScanner();
  document.getElementById('modalConfermaConsegna')?.remove();

  const bMap = {}; st.buildings.forEach(b => { bMap[b.id] = b; });
  const etichetta = ub => {
    const b = bMap[ub.buildingId];
    const d = b ? (b.descrizione || b.nome || '').trim() : '';
    return ub.nome + (d ? ' · ' + d : '');
  };
  const punti = st.ubicazioni.filter(x => x.attivo !== false || x.id === m.destinazioneId)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));

  const mobile = _isMobile();
  const ov = document.createElement('div');
  ov.className = 'modalOverlay open';
  ov.id = 'modalConfermaConsegna';
  const chiudi = () => { _fermaScanner(); ov.remove(); };
  { let dn = false; ov.addEventListener('mousedown', e => { dn = e.target === ov; }); ov.onclick = e => { if (e.target === ov && dn) chiudi(); }; }
  ov.innerHTML = `<div class="modalBox">
    <h3>Conferma consegna${m.codice ? ' ' + esc(m.codice) : ''}</h3>
    <div style="font-size:13px;color:var(--muted);margin-bottom:4px">Punto di destinazione</div>
    <div style="font-size:20px;font-weight:800;margin-bottom:14px">${esc(m.destinazioneNome)}</div>

    ${mobile ? `<button class="btnOrange" id="cd-scan" style="width:100%;padding:14px;font-size:15px">📷 Scansiona barcode</button>
    <div id="cd-cam" style="display:none;margin-top:10px">
      <video id="cd-video" playsinline muted style="width:100%;border-radius:10px;background:#000;max-height:260px;object-fit:cover"></video>
      <div style="font-size:12px;color:var(--muted);text-align:center;margin-top:4px">Inquadra il barcode del punto di destinazione</div>
      <button class="btnGray btnSmall" id="cd-stopcam" style="width:100%;margin-top:6px">Chiudi fotocamera</button>
    </div>` : ''}
    <div id="cd-msg" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:600"></div>

    ${mobile ? `<div style="margin-top:12px;font-size:12px;color:var(--muted);text-align:center">Da telefono la consegna si conferma solo scansionando il barcode del punto di destinazione.</div>` : `
    <div class="field" style="margin-top:14px"><label>Punto di consegna</label>
      <input type="text" id="cd-txt" placeholder="Scrivi per cercare o scegli dall'elenco" autocomplete="off" spellcheck="false">
      <div id="cd-lista" style="max-height:210px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:4px;background:var(--surface);margin-top:6px">
        ${punti.map(x => `<div class="cdRow" data-id="${esc(x.id)}" data-t="${esc((x.nome + ' ' + etichetta(x)).toLowerCase())}" style="padding:9px 12px;border-radius:8px;cursor:pointer;border:1.5px solid transparent">
          <div style="font-weight:700;font-size:14px">${esc(x.nome)}</div>
          ${etichetta(x) !== x.nome ? `<div style="font-size:12px;color:var(--muted)">${esc(etichetta(x).slice(x.nome.length + 3))}</div>` : ''}</div>`).join('')}
        <div id="cd-vuoto" style="display:none;padding:10px;color:var(--muted);font-size:13px">Nessun punto trovato.</div>
      </div></div>
    <button class="btnGreen" id="cd-manuale" style="width:100%">✅ Conferma manualmente</button>
    `}
    <div class="modalActions"><button class="btnGray" id="cd-chiudi">Annulla</button></div>
  </div>`;
  document.body.appendChild(ov);

  const $ = x => document.getElementById(x);
  const msg = (txt, ok) => {
    const el = $('cd-msg'); el.style.display = 'block'; el.textContent = txt;
    el.style.background = ok ? '#16a34a22' : '#dc262622'; el.style.color = ok ? '#15803d' : '#b91c1c';
  };
  let inCorso = false;
  const conferma = async (ub, metodo) => {
    if (inCorso) return;
    if (ub.id !== m.destinazioneId) {
      msg(`Punto errato: hai selezionato "${ub.nome}", la destinazione di questa missione è "${m.destinazioneNome}".`, false);
      return;
    }
    inCorso = true; _fermaScanner();
    if ($('cd-manuale')) $('cd-manuale').disabled = true; if ($('cd-scan')) $('cd-scan').disabled = true;
    try {
      await _conferma('missioni', id, 'in_transito', 'consegnata', 'consegnataAt', {
        consegnaMetodo: metodo, consegnaPuntoId: ub.id, consegnaPuntoNome: ub.nome,
      });
      await window.logHistory({
        action: 'Consegna completata', codice: m.codice || null, elemento: m.elementoCodice,
        origine: m.origineNome, destinazione: m.destinazioneNome,
        dettaglio: metodo === 'scansione' ? 'Confermata con scansione barcode' : 'Confermata manualmente (menù)',
      });
      ov.remove();
      showToast('Consegna confermata.', 'success');
    } catch (e) {
      inCorso = false;
      if ($('cd-manuale')) $('cd-manuale').disabled = false; if ($('cd-scan')) $('cd-scan').disabled = false;
      msg(e.message || 'Errore', false);
    }
  };

  let ultimo = '', ultimoT = 0;
  const alCodice = (testo) => {
    const n = _norm(testo), ora = Date.now();
    if (n === ultimo && ora - ultimoT < 2500) return;      // stessa lettura ripetuta
    ultimo = n; ultimoT = ora;
    const ub = st.ubicazioni.find(x => _norm(x.nome) === n || _norm(x.id) === n);
    if (!ub) { msg(`Barcode non riconosciuto: "${testo}".`, false); return; }
    conferma(ub, 'scansione');
  };

  $('cd-chiudi').onclick = chiudi;
  if (mobile) {
    $('cd-stopcam').onclick = () => { _fermaScanner(); $('cd-cam').style.display = 'none'; $('cd-scan').style.display = ''; };
    $('cd-scan').onclick = async () => {
      $('cd-msg').style.display = 'none';
      $('cd-cam').style.display = 'block'; $('cd-scan').style.display = 'none';
      try { await _avviaScanner($('cd-video'), alCodice); }
      catch (e) {
        $('cd-cam').style.display = 'none'; $('cd-scan').style.display = '';
        msg(e.message || 'Fotocamera non disponibile.', false);
      }
    };
  }
  if (!mobile) {   // la conferma manuale esiste solo da PC
    // Elenco punti: filtro mentre si scrive, selezione con un tocco
    let scelto = '';
    const righe = [...ov.querySelectorAll('.cdRow')];
    const evidenzia = () => righe.forEach(r => {
      const on = r.dataset.id === scelto;
      r.style.background = on ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : '';
      r.style.borderColor = on ? 'var(--accent2)' : 'transparent';
    });
    const filtra = () => {
      const q = $('cd-txt').value.trim().toLowerCase();
      let n = 0;
      righe.forEach(r => { const v = !q || r.dataset.t.includes(q); r.style.display = v ? '' : 'none'; if (v) n++; });
      $('cd-vuoto').style.display = n ? 'none' : 'block';
    };
    righe.forEach(r => r.onclick = () => {
      scelto = r.dataset.id;
      $('cd-txt').value = st.ubicazioni.find(x => x.id === scelto)?.nome || '';
      evidenzia();
    });
    $('cd-txt').addEventListener('input', () => { scelto = ''; evidenzia(); filtra(); });
    $('cd-manuale').onclick = () => {
      let ub = scelto ? st.ubicazioni.find(x => x.id === scelto) : null;
      if (!ub) {
        const v = _norm($('cd-txt').value);
        if (!v) { msg('Scegli o scrivi il punto di consegna.', false); return; }
        ub = st.ubicazioni.find(x => _norm(x.nome) === v || _norm(x.id) === v);
        if (!ub) { msg('Punto non trovato: scegli un punto dall\'elenco.', false); return; }
      }
      conferma(ub, 'manuale');
    };
    // Invio dalla tastiera (PC)
    $('cd-txt')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('cd-manuale').click(); });
    setTimeout(() => $('cd-txt')?.focus(), 50);
  }
};
