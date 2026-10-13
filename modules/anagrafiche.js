// ── modules/anagrafiche.js ────────────────────────────────────────────────────
// CRUD di Elementi e Ubicazioni. Editabili in qualsiasi momento.
//
// elementi/{id}    : { codice, descrizione, attivo, createdAt }
// BUILDING         : salvati nella collezione ubicazioni/{ID} con tipo: 'building'
//                    { nome, descrizione, tipo:'building', attivo, createdAt }
//                    (così usano le regole già esistenti di 'ubicazioni').
//                    L'ID del documento è l'ID scelto dall'admin (lettere e numeri,
//                    maiuscolo, univoco, NON modificabile dopo la creazione).
//                    app.js li separa dalle ubicazioni vere in state.buildings.
// ubicazioni/{id}  : { nome, buildingId, attivo, createdAt }  (nessun tipo: origine e destinazione sono libere)
//                    buildingId → ID del Building; il nome si legge sempre da
//                    state.buildings (non è copiato), quindi resta aggiornato.
//
// Nota: missioni e rientri referenziano gli ID; nomi/codici sono anche
// denormalizzati sulle missioni al momento della creazione, quindi rinominare
// un'anagrafica non rompe le missioni già create.

import {
  addDoc, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc } from '../shared-utils.js';

let _getState, _getUser;

export function initAnagrafiche({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

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

window.renameElemento = async function (id) {
  if (!_requireAdmin()) return;
  const e = _getState().elementi.find(x => x.id === id);
  if (!e) return;
  const codice = prompt('Codice elemento:', e.codice);
  if (codice === null) return;
  const descrizione = prompt('Descrizione (facoltativa):', e.descrizione || '');
  if (descrizione === null) return;
  try {
    await updateDoc(doc(window.db, 'elementi', id), { codice: codice.trim().toUpperCase(), descrizione: descrizione.trim() });
    showToast('Elemento aggiornato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
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
  if (!confirm(`Eliminare l'elemento "${codice}"? Meglio disattivarlo se ha uno storico.`)) return;
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
window.renameBuilding = async function (id) {
  if (!_requireAdmin()) return;
  const b = _getState().buildings.find(x => x.id === id);
  if (!b) return;
  const nome = prompt(`Nome building (ID ${b.id}, non modificabile):`, b.nome);
  if (nome === null || !nome.trim()) return;
  const descrizione = prompt('Descrizione (facoltativa):', b.descrizione || '');
  if (descrizione === null) return;
  try {
    await updateDoc(doc(window.db, 'ubicazioni', id), { nome: nome.trim(), descrizione: descrizione.trim() });
    showToast('Building aggiornato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.toggleBuilding = async function (id, attiva) {
  if (!_requireAdmin()) return;
  try {
    await updateDoc(doc(window.db, 'ubicazioni', id), { attivo: !!attiva });
    showToast(attiva ? 'Building riattivato.' : 'Building disattivato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteBuilding = async function (id) {
  if (!_requireAdmin()) return;
  const b = _getState().buildings.find(x => x.id === id);
  if (!b) return;
  const usate = _getState().ubicazioni.filter(u => u.buildingId === id).length;
  if (usate) { showToast(`Building usato da ${usate} ubicazioni: disattivalo invece di eliminarlo.`, 'error'); return; }
  if (!confirm(`Eliminare il building "${b.id} · ${b.nome}"?`)) return;
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
  const list = _getState().ubicazioni;
  if (!list.length) { el.innerHTML = '<div class="emptyState">Nessuna ubicazione. Aggiungine una sopra.</div>'; return; }
  const bMap = {};
  _getState().buildings.forEach(b => { bMap[b.id] = b; });
  el.innerHTML = list.map(u => {
    const b = u.buildingId ? bMap[u.buildingId] : null;
    const bTxt = !u.buildingId ? '— nessun building'
      : b ? `Building ${esc(b.id)} · ${esc(b.nome)}`
      : `Building ${esc(u.buildingId)} (non trovato)`;
    return `
    <div class="rowItem ${u.attivo === false ? 'off' : ''}">
      <div class="rowMain">
        <div class="rowTitle">${esc(u.nome)} ${u.attivo === false ? '<span class="pill off">disattivata</span>' : ''}</div>
        <div class="rowSub">🏢 ${bTxt}</div>
      </div>
      <button class="btnIcon" title="Rinomina" onclick="renameUbicazione('${u.id}')">✏️</button>
      <button class="btnIcon" title="${u.attivo === false ? 'Riattiva' : 'Disattiva'}" onclick="toggleUbicazione('${u.id}',${u.attivo === false})">${u.attivo === false ? '↩️' : '🚫'}</button>
      <button class="btnIcon" title="Elimina" onclick="deleteUbicazione('${u.id}','${esc(u.nome)}')">🗑</button>
    </div>`;
  }).join('');
}

window.addUbicazione = async function () {
  if (!_requireAdmin()) return;
  const nomeEl = document.getElementById('ub-nome');
  const nome = (nomeEl.value || '').trim();
  const buildingId = (document.getElementById('ub-building')?.value || '').trim();
  if (!nome) { showToast('Inserisci il nome ubicazione.', 'error'); return; }
  if (!buildingId) { showToast('Seleziona il Building dell\'ubicazione.', 'error'); return; }
  if (!_getState().buildings.some(b => b.id === buildingId)) { showToast('Building non valido.', 'error'); return; }
  if (_getState().ubicazioni.some(u => (u.nome || '').toLowerCase() === nome.toLowerCase())) {
    showToast('Ubicazione già esistente.', 'error'); return;
  }
  try {
    await addDoc(collection(window.db, 'ubicazioni'), { nome, buildingId, attivo: true, createdAt: serverTimestamp() });
    nomeEl.value = '';
    showToast('Ubicazione aggiunta.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.renameUbicazione = async function (id) {
  if (!_requireAdmin()) return;
  const u = _getState().ubicazioni.find(x => x.id === id);
  if (!u) return;
  const nome = prompt('Nome ubicazione:', u.nome);
  if (nome === null || !nome.trim()) return;
  const elenco = _getState().buildings.map(b => `${b.id} = ${b.nome}`).join('\n');
  const bIn = prompt('ID Building:\n' + elenco, u.buildingId || '');
  if (bIn === null) return;
  const buildingId = bIn.trim().toUpperCase();
  if (!_getState().buildings.some(b => b.id === buildingId)) { showToast('Building non valido: usa un ID esistente.', 'error'); return; }
  try {
    await updateDoc(doc(window.db, 'ubicazioni', id), { nome: nome.trim(), buildingId });
    showToast('Ubicazione aggiornata.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.toggleUbicazione = async function (id, attiva) {
  if (!_requireAdmin()) return;
  try {
    await updateDoc(doc(window.db, 'ubicazioni', id), { attivo: !!attiva });
    showToast(attiva ? 'Ubicazione riattivata.' : 'Ubicazione disattivata.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteUbicazione = async function (id, nome) {
  if (!_requireAdmin()) return;
  if (!confirm(`Eliminare l'ubicazione "${nome}"? Meglio disattivarla se ha uno storico.`)) return;
  try {
    await deleteDoc(doc(window.db, 'ubicazioni', id));
    showToast('Ubicazione eliminata.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};
