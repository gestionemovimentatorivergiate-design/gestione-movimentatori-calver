// ── modules/anagrafiche.js ────────────────────────────────────────────────────
// CRUD di Elementi, Building e Punti carico-scarico (collezione 'ubicazioni'). Editabili in qualsiasi momento.
//
// elementi/{id}    : { codice, descrizione, attivo, createdAt }
// BUILDING         : salvati nella collezione ubicazioni/{ID} con tipo: 'building'
//                    { nome, descrizione, tipo:'building', attivo, createdAt }
//                    (così usano le regole già esistenti di 'ubicazioni').
//                    L'ID del documento è l'ID scelto dall'admin (lettere e numeri,
//                    maiuscolo, univoco, NON modificabile dopo la creazione).
//                    app.js li separa dalle ubicazioni vere in state.buildings.
// ubicazioni/{id}  : { nome, buildingId, descrizione (facoltativa), attivo, createdAt }  [= "Punti carico-scarico"]  (nessun tipo: origine e destinazione sono libere)
//                    buildingId → ID del Building; il nome si legge sempre da
//                    state.buildings (non è copiato), quindi resta aggiornato.
//
// Nota: missioni e rientri referenziano gli ID; nomi/codici sono anche
// denormalizzati sulle missioni al momento della creazione, quindi rinominare
// un'anagrafica non rompe le missioni già create.

import {
  addDoc, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, dialogElimina } from '../shared-utils.js';

let _getState, _getUser;

export function initAnagrafiche({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

// ── Finestra di modifica (stesso stile della modifica missioni) ─────────────
// campi: [{ id, label, tipo:'text'|'select'|'info', valore, opzioni:[{v,t}], placeholder, hint }]
// onSave(valori) → async; deve lanciare Error('messaggio') per mostrare un errore e non chiudere.
function _dialogModifica({ titolo, campi, onSave }) {
  document.getElementById('modalModificaAnagrafica')?.remove();
  const riga = c => {
    const lab = `<label>${esc(c.label)}</label>`;
    if (c.tipo === 'info') return `<div class="field">${lab}<div style="font-weight:700;padding:6px 0">${esc(c.valore)}</div></div>`;
    if (c.tipo === 'checks') return `<div class="field">${lab}${_checklistHtml('ma-' + c.id, c.opzioni, c.valore || [])}</div>`;
    if (c.tipo === 'select') {
      return `<div class="field">${lab}<select id="ma-${c.id}">` +
        c.opzioni.map(o => `<option value="${esc(o.v)}"${o.v === c.valore ? ' selected' : ''}>${esc(o.t)}</option>`).join('') +
        `</select></div>`;
    }
    return `<div class="field">${lab}<input type="text" id="ma-${c.id}" value="${esc(c.valore || '')}" ` +
      `placeholder="${esc(c.placeholder || '')}" spellcheck="false"></div>`;
  };
  const ov = document.createElement('div');
  ov.className = 'modalOverlay open';
  ov.id = 'modalModificaAnagrafica';
  { let dn = false; ov.addEventListener('mousedown', e => { dn = e.target === ov; }); ov.onclick = e => { if (e.target === ov && dn) ov.remove(); }; }
  ov.innerHTML = `<div class="modalBox"><h3>${esc(titolo)}</h3>${campi.map(riga).join('')}
    <div class="modalActions">
      <button class="btnGray" id="ma-chiudi">Chiudi</button>
      <button class="btnGreen" id="ma-salva">Salva modifiche</button>
    </div></div>`;
  document.body.appendChild(ov);
  const first = campi.find(c => c.tipo !== 'info' && c.tipo !== 'checks');
  if (first) document.getElementById('ma-' + first.id)?.focus();
  document.getElementById('ma-chiudi').onclick = () => ov.remove();
  ov.addEventListener('keydown', e => {
    if (e.key === 'Escape') ov.remove();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') document.getElementById('ma-salva').click();
  });
  document.getElementById('ma-salva').onclick = async () => {
    const val = {};
    campi.forEach(c => {
      if (c.tipo === 'info') return;
      if (c.tipo === 'checks') val[c.id] = _checklistLeggi('ma-' + c.id, ov);
      else val[c.id] = (document.getElementById('ma-' + c.id)?.value || '').trim();
    });
    const btn = document.getElementById('ma-salva');
    btn.disabled = true; btn.textContent = '⏳ Salvataggio…';
    try { await onSave(val); ov.remove(); }
    catch (e) { btn.disabled = false; btn.textContent = 'Salva modifiche'; showToast(e.message || String(e), 'error'); }
  };
}

// ── Elenco a caselle con ricerca (selezione multipla) ───────────────────────
// opzioni: [{v, t}]; selected: array di v già spuntati
function _checklistHtml(gid, opzioni, selected) {
  const sel = new Set(selected);
  return `<div data-grp="${esc(gid)}">
    <input type="text" placeholder="🔍 Cerca…" oninput="filtraChecklist(this)" style="margin-bottom:6px" spellcheck="false">
    <div style="max-height:230px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:4px;background:var(--surface)">` +
    (opzioni.length ? opzioni.map(o => `<label data-t="${esc(String(o.t).toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;font-weight:600">
      <input type="checkbox" data-chk="${esc(gid)}" value="${esc(o.v)}"${sel.has(o.v) ? ' checked' : ''} style="width:18px;height:18px;margin:0;accent-color:var(--accent2)">
      <span>${esc(o.t)}</span></label>`).join('')
      : '<div style="padding:10px;color:var(--muted);font-size:13px">Nessun punto carico-scarico disponibile.</div>') +
    `</div></div>`;
}
function _checklistLeggi(gid, root = document) {
  return [...root.querySelectorAll('input[data-chk]')].filter(x => x.dataset.chk === gid && x.checked).map(x => x.value);
}
window.filtraChecklist = function (inp) {
  const q = inp.value.trim().toLowerCase();
  inp.parentElement.querySelectorAll('label[data-t]').forEach(l => { l.style.display = l.dataset.t.includes(q) ? 'flex' : 'none'; });
};

function _requireAdmin() {
  const u = _getUser();
  if (!u || u.role !== 'amministratore') {
    showToast('Solo un amministratore può modificare le anagrafiche.', 'error');
    return false;
  }
  return true;
}

// ── ELEMENTI ────────────────────────────────────────────────────────────────
export function renderElementi() {
  const el = document.getElementById('el-list');
  if (!el) return;
  const list = _getState().elementi;
  if (!list.length) { el.innerHTML = '<div class="emptyState">Nessun elemento. Aggiungine uno sopra.</div>'; return; }
  el.innerHTML = list.map(e => `
    <div class="rowItem ${e.attivo === false ? 'off' : ''}">
      <div class="rowMain">
        <div class="rowTitle">${esc(e.codice)} ${e.attivo === false ? '<span class="pill off">disattivato</span>' : ''}</div>
        ${e.descrizione ? `<div class="rowSub">${esc(e.descrizione)}</div>` : ''}
      </div>
      <button class="btnIcon" title="Rinomina" onclick="renameElemento('${e.id}')">✏️</button>
      <button class="btnIcon" title="${e.attivo === false ? 'Riattiva' : 'Disattiva'}" onclick="toggleElemento('${e.id}',${e.attivo === false})">${e.attivo === false ? '↩️' : '🚫'}</button>
      <button class="btnIcon" title="Elimina" onclick="deleteElemento('${e.id}','${esc(e.codice)}')">🗑</button>
    </div>`).join('');
}

window.addElemento = async function () {
  if (!_requireAdmin()) return;
  const codeEl = document.getElementById('el-codice');
  const descEl = document.getElementById('el-desc');
  const codice = (codeEl.value || '').trim().toUpperCase();
  const descrizione = (descEl.value || '').trim();
  if (!codice) { showToast('Inserisci il codice elemento.', 'error'); return; }
  if (_getState().elementi.some(e => (e.codice || '').toUpperCase() === codice)) {
    showToast('Elemento già esistente.', 'error'); return;
  }
  try {
    await addDoc(collection(window.db, 'elementi'), { codice, descrizione, attivo: true, createdAt: serverTimestamp() });
    codeEl.value = ''; descEl.value = '';
    showToast('Elemento aggiunto.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.renameElemento = function (id) {
  if (!_requireAdmin()) return;
  const e = _getState().elementi.find(x => x.id === id);
  if (!e) return;
  _dialogModifica({
    titolo: 'Modifica elemento',
    campi: [
      { id: 'codice', label: 'Codice', valore: e.codice },
      { id: 'desc', label: 'Descrizione (facoltativa)', valore: e.descrizione || '' },
    ],
    onSave: async v => {
      const codice = v.codice.toUpperCase();
      if (!codice) throw new Error('Inserisci il codice elemento.');
      if (_getState().elementi.some(x => x.id !== id && (x.codice || '').toUpperCase() === codice)) throw new Error('Codice già esistente.');
      await updateDoc(doc(window.db, 'elementi', id), { codice, descrizione: v.desc });
      showToast('Elemento aggiornato.', 'success');
    },
  });
};

window.toggleElemento = async function (id, attiva) {
  if (!_requireAdmin()) return;
  try {
    await updateDoc(doc(window.db, 'elementi', id), { attivo: !!attiva });
    showToast(attiva ? 'Elemento riattivato.' : 'Elemento disattivato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteElemento = async function (id, codice) {
  if (!_requireAdmin()) return;
  if (!await dialogElimina({ titolo: 'Elimina elemento', nome: codice, nota: 'Meglio disattivarlo se ha uno storico.' })) return;
  try {
    await deleteDoc(doc(window.db, 'elementi', id));
    showToast('Elemento eliminato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ── BUILDINGS ───────────────────────────────────────────────────────────────
const _BID_RE = /^[A-Za-z0-9]+$/;

export function renderBuildings() {
  const el = document.getElementById('bd-list');
  if (!el) return;
  const list = [..._getState().buildings]
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'it', { numeric: true }));
  if (!list.length) { el.innerHTML = '<div class="emptyState">Nessun building. Aggiungine uno sopra.</div>'; return; }
  el.innerHTML = list.map(b => `
    <div class="rowItem ${b.attivo === false ? 'off' : ''}">
      <div class="rowMain">
        <div class="rowTitle"><span class="mono">${esc(b.id)}</span> · ${esc(b.nome)} ${b.attivo === false ? '<span class="pill off">disattivato</span>' : ''}</div>
        ${b.descrizione ? `<div class="rowSub">${esc(b.descrizione)}</div>` : ''}
      </div>
      <button class="btnIcon" title="Modifica" onclick="renameBuilding('${esc(b.id)}')">✏️</button>
      <button class="btnIcon" title="${b.attivo === false ? 'Riattiva' : 'Disattiva'}" onclick="toggleBuilding('${esc(b.id)}',${b.attivo === false})">${b.attivo === false ? '↩️' : '🚫'}</button>
      <button class="btnIcon" title="Elimina" onclick="deleteBuilding('${esc(b.id)}')">🗑</button>
    </div>`).join('');
}

// Menu "Building" del form Ubicazioni: solo building attivi; mantiene la selezione
function _fillBuildingSelect() {
  const sel = document.getElementById('ub-building');
  if (!sel) return;
  const cur = sel.value;
  const attivi = [..._getState().buildings]
    .filter(b => b.attivo !== false)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'it', { numeric: true }));
  sel.innerHTML = '<option value="">— building —</option>' +
    attivi.map(b => `<option value="${esc(b.id)}">${esc(b.id)} · ${esc(b.nome)}</option>`).join('');
  sel.value = attivi.some(b => b.id === cur) ? cur : '';
}

window.addBuilding = async function () {
  if (!_requireAdmin()) return;
  const idEl = document.getElementById('bd-id');
  const nomeEl = document.getElementById('bd-nome');
  const descEl = document.getElementById('bd-desc');
  const id = (idEl.value || '').trim().toUpperCase();
  const nome = (nomeEl.value || '').trim();
  const descrizione = (descEl.value || '').trim();
  if (!id) { showToast('Inserisci l\'ID del building.', 'error'); return; }
  if (!_BID_RE.test(id)) { showToast('ID: solo lettere e numeri, senza spazi o simboli.', 'error'); return; }
  if (!nome) { showToast('Inserisci il nome del building.', 'error'); return; }
  try {
    const ref = doc(window.db, 'ubicazioni', id);
    if ((await getDoc(ref)).exists()) { showToast('ID building già esistente.', 'error'); return; }
    await setDoc(ref, { nome, descrizione, tipo: 'building', attivo: true, createdAt: serverTimestamp() });
    idEl.value = ''; nomeEl.value = ''; descEl.value = '';
    showToast('Building aggiunto.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// L'ID non è modificabile: si cambiano solo nome e descrizione
window.renameBuilding = function (id) {
  if (!_requireAdmin()) return;
  const b = _getState().buildings.find(x => x.id === id);
  if (!b) return;
  _dialogModifica({
    titolo: 'Modifica building',
    campi: [
      { id: 'id', label: 'ID (non modificabile)', tipo: 'info', valore: b.id },
      { id: 'nome', label: 'Nome', valore: b.nome },
      { id: 'desc', label: 'Descrizione (facoltativa)', valore: b.descrizione || '' },
    ],
    onSave: async v => {
      if (!v.nome) throw new Error('Inserisci il nome del building.');
      await updateDoc(doc(window.db, 'ubicazioni', id), { nome: v.nome, descrizione: v.desc });
      showToast('Building aggiornato.', 'success');
    },
  });
};

window.toggleBuilding = async function (id, attiva) {
  if (!_requireAdmin()) return;
  try {
    // Il building e tutti i suoi punti carico-scarico cambiano stato insieme (un'unica scrittura).
    // Aree e reparti non vengono modificati: i punti disattivati spariscono da lì finché restano
    // disattivi e tornano da soli alla riattivazione.
    const punti = _getState().ubicazioni.filter(u => u.buildingId === id && (u.attivo !== false) !== !!attiva);
    const batch = writeBatch(window.db);
    batch.update(doc(window.db, 'ubicazioni', id), { attivo: !!attiva });
    punti.forEach(u => batch.update(doc(window.db, 'ubicazioni', u.id), { attivo: !!attiva }));
    await batch.commit();
    const n = punti.length ? ` (${punti.length} ${punti.length === 1 ? 'punto' : 'punti'} carico-scarico ${attiva ? 'riattivat' : 'disattivat'}${punti.length === 1 ? 'o' : 'i'})` : '';
    showToast((attiva ? 'Building riattivato' : 'Building disattivato') + n + '.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteBuilding = async function (id) {
  if (!_requireAdmin()) return;
  const b = _getState().buildings.find(x => x.id === id);
  if (!b) return;
  const usate = _getState().ubicazioni.filter(u => u.buildingId === id).length;
  if (usate) { showToast(`Building usato da ${usate} punti carico-scarico: disattivalo invece di eliminarlo.`, 'error'); return; }
  if (!await dialogElimina({ titolo: 'Elimina building', nome: `${b.id} · ${b.nome}` })) return;
  try {
    await deleteDoc(doc(window.db, 'ubicazioni', id));
    showToast('Building eliminato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ── UBICAZIONI ──────────────────────────────────────────────────────────────
export function renderUbicazioni() {
  _fillBuildingSelect();
  const el = document.getElementById('ub-list');
  if (!el) return;
  const tutti = _getState().ubicazioni;
  if (!tutti.length) { el.innerHTML = '<div class="emptyState">Nessun punto carico-scarico. Aggiungine uno sopra.</div>'; return; }
  const bMap = {};
  _getState().buildings.forEach(b => { bMap[b.id] = b; });
  // Filtro per building (mantiene la scelta): "__nessuno" = punti senza building
  const fSel = document.getElementById('ub-filtro-b');
  let fB = '';
  if (fSel) {
    const cur = fSel.value;
    const bs = _getState().buildings.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'it', { numeric: true }));
    fSel.innerHTML = '<option value="">Tutti i building</option><option value="__nessuno">— senza building</option>' +
      bs.map(b => `<option value="${esc(b.id)}">${esc(b.id)} · ${esc(b.nome)}</option>`).join('');
    fSel.value = (cur === '__nessuno' || bs.some(b => b.id === cur)) ? cur : '';
    fB = fSel.value;
  }
  const list = !fB ? tutti : tutti.filter(u => fB === '__nessuno' ? !u.buildingId : u.buildingId === fB);
  const cnt = document.getElementById('ub-conta');
  if (cnt) cnt.textContent = fB ? `${list.length} di ${tutti.length} punti` : `${tutti.length} punti`;
  if (!list.length) { el.innerHTML = '<div class="emptyState">Nessun punto carico-scarico per questo building.</div>'; return; }
  el.innerHTML = list.map(u => {
    const b = u.buildingId ? bMap[u.buildingId] : null;
    const bTxt = !u.buildingId ? '— nessun building'
      : b ? `Building ${esc(b.id)} · ${esc(b.nome)}`
      : `Building ${esc(u.buildingId)} (non trovato)`;
    return `
    <div class="rowItem ${u.attivo === false ? 'off' : ''}">
      <div class="rowMain">
        <div class="rowTitle">${esc(u.nome)} ${u.attivo === false ? '<span class="pill off">disattivato</span>' : ''}</div>
        <div class="rowSub">🏢 ${bTxt}</div>
        ${u.descrizione ? `<div class="rowSub">${esc(u.descrizione)}</div>` : ''}
      </div>
      <button class="btnIcon" title="Modifica" onclick="renameUbicazione('${u.id}')">✏️</button>
      <button class="btnIcon" title="${u.attivo === false ? 'Riattiva' : 'Disattiva'}" onclick="toggleUbicazione('${u.id}',${u.attivo === false})">${u.attivo === false ? '↩️' : '🚫'}</button>
      <button class="btnIcon" title="Elimina" onclick="deleteUbicazione('${u.id}','${esc(u.nome)}')">🗑</button>
    </div>`;
  }).join('');
}

window.renderUbicazioni = renderUbicazioni;

window.addUbicazione = async function () {
  if (!_requireAdmin()) return;
  const nomeEl = document.getElementById('ub-nome');
  const nome = (nomeEl.value || '').trim();
  const buildingId = (document.getElementById('ub-building')?.value || '').trim();
  const descEl = document.getElementById('ub-desc');
  const descrizione = (descEl?.value || '').trim();
  if (!nome) { showToast('Inserisci il nome del punto carico-scarico.', 'error'); return; }
  if (!buildingId) { showToast('Seleziona il Building del punto carico-scarico.', 'error'); return; }
  if (!_getState().buildings.some(b => b.id === buildingId)) { showToast('Building non valido.', 'error'); return; }
  if (_getState().ubicazioni.some(u => (u.nome || '').toLowerCase() === nome.toLowerCase())) {
    showToast('Punto carico-scarico già esistente.', 'error'); return;
  }
  try {
    await addDoc(collection(window.db, 'ubicazioni'), { nome, buildingId, descrizione, attivo: true, createdAt: serverTimestamp() });
    nomeEl.value = '';
    if (descEl) descEl.value = '';
    showToast('Punto carico-scarico aggiunto.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.renameUbicazione = function (id) {
  if (!_requireAdmin()) return;
  const u = _getState().ubicazioni.find(x => x.id === id);
  if (!u) return;
  // Building attivi (più quello attuale, anche se disattivato)
  const bs = _getState().buildings.filter(b => b.attivo !== false || b.id === u.buildingId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'it', { numeric: true }));
  _dialogModifica({
    titolo: 'Modifica punto carico-scarico',
    campi: [
      { id: 'nome', label: 'Nome', valore: u.nome },
      { id: 'building', label: 'Building', tipo: 'select', valore: u.buildingId || '',
        opzioni: [{ v: '', t: '— building —' }, ...bs.map(b => ({ v: b.id, t: `${b.id} · ${b.nome}` }))] },
      { id: 'desc', label: 'Descrizione (facoltativa)', valore: u.descrizione || '' },
    ],
    onSave: async v => {
      if (!v.nome) throw new Error('Inserisci il nome del punto carico-scarico.');
      if (!_getState().buildings.some(b => b.id === v.building)) throw new Error('Seleziona un Building.');
      if (_getState().ubicazioni.some(x => x.id !== id && (x.nome || '').toLowerCase() === v.nome.toLowerCase())) throw new Error('Punto carico-scarico già esistente.');
      await updateDoc(doc(window.db, 'ubicazioni', id), { nome: v.nome, buildingId: v.building, descrizione: v.desc });
      showToast('Punto carico-scarico aggiornato.', 'success');
    },
  });
};

window.toggleUbicazione = async function (id, attiva) {
  if (!_requireAdmin()) return;
  try {
    await updateDoc(doc(window.db, 'ubicazioni', id), { attivo: !!attiva });
    showToast(attiva ? 'Punto carico-scarico riattivato.' : 'Punto carico-scarico disattivato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteUbicazione = async function (id, nome) {
  if (!_requireAdmin()) return;
  if (!await dialogElimina({ titolo: 'Elimina punto carico-scarico', nome, nota: 'Meglio disattivarlo se ha uno storico.' })) return;
  try {
    await deleteDoc(doc(window.db, 'ubicazioni', id));
    showToast('Punto carico-scarico eliminato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// ── GRUPPI DI PUNTI: AREE DI MOVIMENTAZIONE e REPARTI ───────────────────────
// Due anagrafiche con la stessa struttura (un nome + uno o più punti carico-scarico),
// salvate in ubicazioni/{auto-id} con un 'tipo' (così usano le regole già esistenti,
// come i Building): { nome, tipo:'area'|'reparto', puntiIds:[id punti], attivo, createdAt }
//  • AREA di movimentazione → tab "In corso" e "Statistiche": filtro per DESTINAZIONE.
//  • REPARTO               → tab "Prenotazioni": limita i punti di ORIGINE proposti.
function _opzioniPunti(includiIds = []) {
  const st = _getState();
  return st.ubicazioni.filter(u => u.attivo !== false || includiIds.includes(u.id))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }))
    .map(u => ({ v: u.id, t: u.nome + (u.buildingId ? '  ·  ' + u.buildingId : '') }));
}

// cfg: { tipo, stato (chiave in state), pre (prefisso id html), Nome (per le funzioni window),
//        titoloModifica, labelNome, singolo ("l'area"/"il reparto"), art ("Area"/"Reparto") }
function _gruppoPunti(cfg) {
  const { tipo, stato, pre, Nome, titoloModifica, labelNome, singolo, art, plurale } = cfg;

  const render = () => {
    const st = _getState();
    // Elenco punti del form "nuovo": ridisegnato mantenendo le spunte e la ricerca
    const box = document.getElementById(pre + '-checks');
    if (box) {
      const spunte = _checklistLeggi(pre + '-new', box);
      const q = box.querySelector('input[type=text]')?.value || '';
      box.innerHTML = _checklistHtml(pre + '-new', _opzioniPunti(), spunte);
      const inp = box.querySelector('input[type=text]');
      if (inp && q) { inp.value = q; window.filtraChecklist(inp); }
    }
    const el = document.getElementById(pre + '-list');
    if (!el) return;
    const list = [...(st[stato] || [])].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
    if (!list.length) { el.innerHTML = `<div class="emptyState">Nessun ${art.toLowerCase()} creato. Creane uno sopra.</div>`; return; }
    const uMap = {}; st.ubicazioni.forEach(u => { uMap[u.id] = u; });
    el.innerHTML = list.map(a => {
      // Solo i punti attivi: quelli disattivati (anche via building) non compaiono né si contano
      const tutti = (a.puntiIds || []).filter(i => uMap[i]);
      const nomi = tutti.filter(i => uMap[i].attivo !== false).map(i => uMap[i].nome);
      const nOff = tutti.length - nomi.length;
      const txt = nomi.slice(0, 6).join(', ') + (nomi.length > 6 ? ` … (+${nomi.length - 6})` : '');
      return `
      <div class="rowItem ${a.attivo === false ? 'off' : ''}">
        <div class="rowMain">
          <div class="rowTitle">${esc(a.nome)} ${a.attivo === false ? `<span class="pill off">disattivat${art === 'Area' ? 'a' : 'o'}</span>` : ''}</div>
          <div class="rowSub">📍 ${nomi.length} ${nomi.length === 1 ? 'punto' : 'punti'}${txt ? ': ' + esc(txt) : ''}${nOff ? ` <span style="color:var(--muted)">· ${nOff} disattivat${nOff === 1 ? 'o' : 'i'}</span>` : ''}</div>
        </div>
        <button class="btnIcon" title="Modifica" onclick="rename${Nome}('${esc(a.id)}')">✏️</button>
        <button class="btnIcon" title="${a.attivo === false ? 'Riattiva' : 'Disattiva'}" onclick="toggle${Nome}('${esc(a.id)}',${a.attivo === false})">${a.attivo === false ? '↩️' : '🚫'}</button>
        <button class="btnIcon" title="Elimina" onclick="delete${Nome}('${esc(a.id)}')">🗑</button>
      </div>`;
    }).join('');
  };

  window['add' + Nome] = async function () {
    if (!_requireAdmin()) return;
    const nomeEl = document.getElementById(pre + '-nome');
    const nome = (nomeEl.value || '').trim();
    const puntiIds = _checklistLeggi(pre + '-new', document.getElementById(pre + '-checks'));
    if (!nome) { showToast('Inserisci il nome.', 'error'); return; }
    if (!puntiIds.length) { showToast('Seleziona almeno un punto carico-scarico.', 'error'); return; }
    if ((_getState()[stato] || []).some(a => (a.nome || '').toLowerCase() === nome.toLowerCase())) { showToast(`${art} già esistente.`, 'error'); return; }
    try {
      await addDoc(collection(window.db, 'ubicazioni'), { nome, tipo, puntiIds, attivo: true, createdAt: serverTimestamp() });
      nomeEl.value = '';
      document.querySelectorAll('#' + pre + '-checks input[data-chk]').forEach(c => { c.checked = false; });
      showToast(`${art} aggiunt${art === 'Area' ? 'a' : 'o'}.`, 'success');
    } catch (e) { showToast('Errore: ' + e.message, 'error'); }
  };

  window['rename' + Nome] = function (id) {
    if (!_requireAdmin()) return;
    const a = (_getState()[stato] || []).find(x => x.id === id);
    if (!a) return;
    _dialogModifica({
      titolo: titoloModifica,
      campi: [
        { id: 'nome', label: labelNome, valore: a.nome },
        { id: 'punti', label: 'Punti carico-scarico', tipo: 'checks', valore: a.puntiIds || [], opzioni: _opzioniPunti(a.puntiIds || []) },
      ],
      onSave: async v => {
        if (!v.nome) throw new Error('Inserisci il nome.');
        if (!v.punti.length) throw new Error('Seleziona almeno un punto carico-scarico.');
        if ((_getState()[stato] || []).some(x => x.id !== id && (x.nome || '').toLowerCase() === v.nome.toLowerCase())) throw new Error(`${art} già esistente.`);
        await updateDoc(doc(window.db, 'ubicazioni', id), { nome: v.nome, puntiIds: v.punti });
        showToast(`${art} aggiornat${art === 'Area' ? 'a' : 'o'}.`, 'success');
      },
    });
  };

  window['toggle' + Nome] = async function (id, attiva) {
    if (!_requireAdmin()) return;
    try {
      await updateDoc(doc(window.db, 'ubicazioni', id), { attivo: !!attiva });
      const f = art === 'Area' ? 'a' : 'o';
      showToast(`${art} ${attiva ? 'riattivat' : 'disattivat'}${f}.`, 'success');
    } catch (e) { showToast('Errore: ' + e.message, 'error'); }
  };

  window['delete' + Nome] = async function (id) {
    if (!_requireAdmin()) return;
    const a = (_getState()[stato] || []).find(x => x.id === id);
    if (!a) return;
    if (!await dialogElimina({ titolo: 'Elimina ' + singolo.replace(/^l['’]/, '').replace(/^il /, ''), nome: a.nome, nota: 'I punti carico-scarico non vengono toccati.' })) return;
    try {
      await deleteDoc(doc(window.db, 'ubicazioni', id));
      showToast(`${art} eliminat${art === 'Area' ? 'a' : 'o'}.`, 'success');
    } catch (e) { showToast('Errore: ' + e.message, 'error'); }
  };

  return render;
}

export const renderAree = _gruppoPunti({
  tipo: 'area', stato: 'aree', pre: 'ar', Nome: 'Area', art: 'Area', singolo: "l'area",
  titoloModifica: 'Modifica area di movimentazione', labelNome: 'Nome area di movimentazione',
});
export const renderReparti = _gruppoPunti({
  tipo: 'reparto', stato: 'reparti', pre: 'rp', Nome: 'Reparto', art: 'Reparto', singolo: 'il reparto',
  titoloModifica: 'Modifica reparto', labelNome: 'Nome reparto',
});
