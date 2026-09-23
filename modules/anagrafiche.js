// ── modules/anagrafiche.js ────────────────────────────────────────────────────
// CRUD di Elementi e Ubicazioni. Editabili in qualsiasi momento.
//
// elementi/{id}    : { codice, descrizione, attivo, createdAt }
// ubicazioni/{id}  : { nome, tipo: 'magazzino'|'linea', attivo, createdAt }
//
// Nota: missioni e rientri referenziano gli ID; nomi/codici sono anche
// denormalizzati sulle missioni al momento della creazione, quindi rinominare
// un'anagrafica non rompe le missioni già create.

import {
  addDoc, collection, doc, updateDoc, deleteDoc, serverTimestamp
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

// ── UBICAZIONI ──────────────────────────────────────────────────────────────
export function renderUbicazioni() {
  const el = document.getElementById('ub-list');
  if (!el) return;
  const list = _getState().ubicazioni;
  if (!list.length) { el.innerHTML = '<div class="emptyState">Nessuna ubicazione. Aggiungine una sopra.</div>'; return; }
  el.innerHTML = list.map(u => `
    <div class="rowItem ${u.attivo === false ? 'off' : ''}">
      <div class="rowMain">
        <div class="rowTitle">${esc(u.nome)} <span class="pill ${u.tipo}">${u.tipo === 'magazzino' ? 'Magazzino' : 'Linea'}</span> ${u.attivo === false ? '<span class="pill off">disattivata</span>' : ''}</div>
      </div>
      <button class="btnIcon" title="Rinomina" onclick="renameUbicazione('${u.id}')">✏️</button>
      <button class="btnIcon" title="${u.attivo === false ? 'Riattiva' : 'Disattiva'}" onclick="toggleUbicazione('${u.id}',${u.attivo === false})">${u.attivo === false ? '↩️' : '🚫'}</button>
      <button class="btnIcon" title="Elimina" onclick="deleteUbicazione('${u.id}','${esc(u.nome)}')">🗑</button>
    </div>`).join('');
}

window.addUbicazione = async function () {
  if (!_requireAdmin()) return;
  const nomeEl = document.getElementById('ub-nome');
  const tipoEl = document.getElementById('ub-tipo');
  const nome = (nomeEl.value || '').trim();
  const tipo = tipoEl.value === 'linea' ? 'linea' : 'magazzino';
  if (!nome) { showToast('Inserisci il nome ubicazione.', 'error'); return; }
  if (_getState().ubicazioni.some(u => (u.nome || '').toLowerCase() === nome.toLowerCase())) {
    showToast('Ubicazione già esistente.', 'error'); return;
  }
  try {
    await addDoc(collection(window.db, 'ubicazioni'), { nome, tipo, attivo: true, createdAt: serverTimestamp() });
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
  const tipo = confirm('OK = Magazzino · Annulla = Linea\n(attuale: ' + (u.tipo === 'magazzino' ? 'Magazzino' : 'Linea') + ')') ? 'magazzino' : 'linea';
  try {
    await updateDoc(doc(window.db, 'ubicazioni', id), { nome: nome.trim(), tipo });
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
