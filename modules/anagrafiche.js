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
  addDoc, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc } from '../shared-utils.js';

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
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div class="modalBox"><h3>${esc(titolo)}</h3>${campi.map(riga).join('')}
    <div class="modalActions">
      <button class="btnGray" id="ma-chiudi">Chiudi</button>
      <button class="btnGreen" id="ma-salva">Salva modifiche</button>
    </div></div>`;
  document.body.appendChild(ov);
  const first = campi.find(c => c.tipo !== 'info');
  if (first) document.getElementById('ma-' + first.id)?.focus();
  document.getElementById('ma-chiudi').onclick = () => ov.remove();
  ov.addEventListener('keydown', e => {
    if (e.key === 'Escape') ov.remove();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') document.getElementById('ma-salva').click();
  });
  document.getElementById('ma-salva').onclick = async () => {
    const val = {};
    campi.forEach(c => { if (c.tipo !== 'info') val[c.id] = (document.getElementById('ma-' + c.id)?.value || '').trim(); });
    const btn = document.getElementById('ma-salva');
    btn.disabled = true; btn.textContent = '⏳ Salvataggio…';
    try { await onSave(val); ov.remove(); }
    catch (e) { btn.disabled = false; btn.textContent = 'Salva modifiche'; showToast(e.message || String(e), 'error'); }
  };
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
    await updateDoc(doc(window.db, 'ubicazioni', id), { attivo: !!attiva });
    showToast(attiva ? 'Building riattivato.' : 'Building disattivato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteBuilding = async function (id) {
  if (!_requireAdmin()) return;
  const b = _getState().buildings.find(x => x.id === id);
  if (!b) return;
  const usate = _getState().ubicazioni.filter(u => u.buildingId === id).length;
  if (usate) { showToast(`Building usato da ${usate} punti carico-scarico: disattivalo invece di eliminarlo.`, 'error'); return; }
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
  if (!list.length) { el.innerHTML = '<div class="emptyState">Nessun punto carico-scarico. Aggiungine uno sopra.</div>'; return; }
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
  if (!confirm(`Eliminare il punto carico-scarico "${nome}"? Meglio disattivarlo se ha uno storico.`)) return;
  try {
    await deleteDoc(doc(window.db, 'ubicazioni', id));
    showToast('Punto carico-scarico eliminato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};
