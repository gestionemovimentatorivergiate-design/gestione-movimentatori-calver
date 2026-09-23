// ── modules/admin.js ──────────────────────────────────────────────────────────
// Ruolo AMMINISTRATIVO (sola lettura): Storico + Statistiche.
// Ruolo AMMINISTRATORE: anche gestione Utenti.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { firebaseConfig } from '../firebase-config.js';
import {
  getAuth, createUserWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDate } from '../shared-utils.js';

let _getState, _getUser;

export function initAdmin({ getState, getUser }) {
  _getState = getState;
  _getUser = getUser;
}

// ── STORICO ──────────────────────────────────────────────────────────────────
export function renderStorico() {
  const body = document.getElementById('st-body');
  if (!body) return;
  const H = _getState().history || [];

  // Popola il select azioni preservando la selezione
  const selAz = document.getElementById('st-azione');
  if (selAz) {
    const cur = selAz.value;
    const azioni = [...new Set(H.map(h => h.action).filter(Boolean))].sort();
    selAz.innerHTML = '<option value="">Tutte le azioni</option>' +
      azioni.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    if (azioni.includes(cur)) selAz.value = cur;
  }

  const q = (document.getElementById('st-cerca')?.value || '').trim().toLowerCase();
  const fAz = selAz?.value || '';

  let rows = H;
  if (fAz) rows = rows.filter(h => h.action === fAz);
  if (q) rows = rows.filter(h =>
    (h.elemento || '').toLowerCase().includes(q) ||
    (h.origine || '').toLowerCase().includes(q) ||
    (h.destinazione || '').toLowerCase().includes(q));

  body.innerHTML = rows.length ? rows.map(h => `
    <tr>
      <td class="mono" style="font-size:11px;white-space:nowrap">${fmtDate(h.ts)}</td>
      <td>${_azBadge(h.action)}</td>
      <td class="mono">${esc(h.elemento || '—')}</td>
      <td style="font-size:12px">${h.origine || h.destinazione ? esc(h.origine || '?') + ' → ' + esc(h.destinazione || '?') : '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(h.userName || h.user || '—')}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">Nessun movimento</td></tr>';
}

function _azBadge(a) {
  const map = {
    'Missione creata':      'blue',
    'Pieno preso in carico':'orange',
    'Consegna completata':  'green',
    'Vuoto dichiarato':     'blue',
    'Vuoto preso in carico':'orange',
    'Rientro completato':   'green',
    'Missione annullata':   'red',
    'Vuoto annullato':      'red',
  };
  const color = map[a] || 'muted';
  const bg = { blue: '#3b82f613;color:#1d4ed8', orange: '#f59e0b13;color:#b45309', green: '#A4D20018;color:#7fa000', red: '#ef444413;color:#dc2626', muted: 'transparent;color:#6b7280' }[color];
  return `<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:${bg}">${esc(a || '—')}</span>`;
}

// ── STATISTICHE ──────────────────────────────────────────────────────────────
export function renderStatistiche() {
  const st = _getState();
  const cards = document.getElementById('stat-cards');
  if (!cards) return;

  const missAttive = st.missioni.filter(m => m.stato === 'richiesta' || m.stato === 'in_transito').length;
  const rientAttivi = st.rientri.filter(r => r.stato === 'da_rientrare' || r.stato === 'in_transito').length;
  const consegnate = st.missioni.filter(m => m.stato === 'consegnata').length;
  const rientrati = st.rientri.filter(r => r.stato === 'rientrato').length;

  cards.innerHTML = `
    <div class="statCard orange"><div class="val">${missAttive}</div><div class="lbl">Pieni in corso</div></div>
    <div class="statCard blue"><div class="val">${rientAttivi}</div><div class="lbl">Vuoti in corso</div></div>
    <div class="statCard green"><div class="val">${consegnate}</div><div class="lbl">Consegne totali</div></div>
    <div class="statCard green"><div class="val">${rientrati}</div><div class="lbl">Rientri totali</div></div>`;

  // Top elementi (per numero di missioni create)
  const cntEl = {};
  st.missioni.forEach(m => { cntEl[m.elementoCodice] = (cntEl[m.elementoCodice] || 0) + 1; });
  _renderBar('stat-topElementi', cntEl);

  // Attività per ubicazione (origine + destinazione delle missioni)
  const cntUb = {};
  st.missioni.forEach(m => {
    cntUb[m.origineNome] = (cntUb[m.origineNome] || 0) + 1;
    cntUb[m.destinazioneNome] = (cntUb[m.destinazioneNome] || 0) + 1;
  });
  _renderBar('stat-topUbic', cntUb);
}

function _renderBar(elId, counts) {
  const el = document.getElementById(elId);
  if (!el) return;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top[0]?.[1] || 1;
  el.innerHTML = top.length ? top.map(([label, n]) => `
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
      <div style="width:110px;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</div>
      <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${n / max * 100}%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div></div>
      <div style="width:32px;text-align:right;font-size:12px;color:var(--muted)">${n}</div>
    </div>`).join('') : '<div style="color:var(--muted);font-size:13px">Nessun dato</div>';
}

// ── UTENTI (solo amministratore) ─────────────────────────────────────────────
export function renderUtenti() {
  const el = document.getElementById('user-list');
  if (!el) return;
  const users = _getState().utenti || [];
  el.innerHTML = users.length ? users.map(u => `
    <div class="rowItem">
      <div class="rowMain">
        <div class="rowTitle">${esc(u.name || '—')}</div>
        <div class="rowSub">${esc(u.username || '')}${u.email ? ' · ' + esc(u.email) : ''}</div>
      </div>
      <select class="btnGhost" style="max-width:150px" onchange="changeRole('${u.uid}',this.value)">
        ${['operativo', 'autista', 'amministrativo', 'amministratore'].map(r =>
          `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
      <button class="btnIcon" title="Elimina" onclick="deleteUser('${u.uid}','${esc(u.name || u.email)}')">🗑</button>
    </div>`).join('')
    : '<div class="emptyState">Nessun utente.</div>';
}

window.changeRole = async function (uid, role) {
  try {
    await updateDoc(doc(window.db, 'users', uid), { role });
    showToast('Ruolo aggiornato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

window.deleteUser = async function (uid, nome) {
  if (!confirm(`Eliminare l'utente "${nome}"? Rimuove il profilo (non l'account di autenticazione).`)) return;
  try {
    const snap = await getDoc(doc(window.db, 'users', uid));
    const uname = snap.exists() ? snap.data().username : null;
    await deleteDoc(doc(window.db, 'users', uid));
    if (uname) await deleteDoc(doc(window.db, 'usernames', uname));
    showToast('Utente eliminato.', 'success');
  } catch (e) { showToast('Errore: ' + e.message, 'error'); }
};

// Crea utente senza disconnettere l'admin (istanza Firebase secondaria temporanea)
window.addUser = async function () {
  const name = document.getElementById('nu-name').value.trim();
  const username = document.getElementById('nu-username').value.trim().toLowerCase();
  const email = document.getElementById('nu-email').value.trim();
  const pass = document.getElementById('nu-pass').value;
  const role = document.getElementById('nu-role').value;
  if (!name || !username || !email || !pass) { showToast('Compila tutti i campi.', 'error'); return; }
  if (pass.length < 6) { showToast('Password di almeno 6 caratteri.', 'error'); return; }
  try {
    const exists = await getDoc(doc(window.db, 'usernames', username));
    if (exists.exists()) { showToast('Username già in uso.', 'error'); return; }

    const secondaryApp = initializeApp(firebaseConfig, 'secondary-' + Date.now());
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    const uid = cred.user.uid;
    await setDoc(doc(window.db, 'users', uid), { name, email, role, username });
    await setDoc(doc(window.db, 'usernames', username), { email });
    await signOut(secondaryAuth);
    await secondaryApp.delete();

    showToast(`Utente ${name} creato.`, 'success');
    ['nu-name', 'nu-username', 'nu-email', 'nu-pass'].forEach(id => document.getElementById(id).value = '');
    window.closeModal('modalAddUser');
  } catch (e) {
    let msg = 'Errore: ' + e.message;
    if (e.code === 'auth/email-already-in-use') msg = 'Email già registrata.';
    if (e.code === 'auth/invalid-email') msg = 'Email non valida.';
    if (e.code === 'auth/weak-password') msg = 'Password troppo debole.';
    showToast(msg, 'error');
  }
};

// Esposta su window: i filtri dello storico la richiamano da onclick/oninput inline
window.renderStorico = renderStorico;

// ── Helper modale ────────────────────────────────────────────────────────────
window.openModal = function (id) { document.getElementById(id)?.classList.add('open'); };
window.closeModal = function (id) { document.getElementById(id)?.classList.remove('open'); };
