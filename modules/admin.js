// ── modules/admin.js ──────────────────────────────────────────────────────────
// Ruolo AMMINISTRATIVO (sola lettura): Storico + Statistiche.
// Ruolo AMMINISTRATORE: anche gestione Utenti.

import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { firebaseConfig } from '../firebase-config.js';
import {
  getAuth, createUserWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, limit, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { showToast, esc, fmtDate, tsVal } from '../shared-utils.js';

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

  // Menu a tendina: riempiti con i valori presenti nello storico, mantenendo la scelta
  const percorso = h => (h.origine || h.destinazione) ? (h.origine || '?') + ' → ' + (h.destinazione || '?') : '';
  const utente = h => h.userName || h.user || '';
  const fill = (id, vals, tutti) => {
    const sel = document.getElementById(id);
    if (!sel) return '';
    const cur = sel.value;
    const list = [...new Set(vals.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'it', { numeric: true }));
    sel.innerHTML = `<option value="">${tutti}</option>` + list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (list.includes(cur)) sel.value = cur;
    return sel.value;
  };
  const fAz  = fill('st-azione',   H.map(h => h.action), 'Tutte');
  const fUt  = fill('st-utente',   H.map(utente),        'Tutti');
  const fPer = fill('st-percorso', H.map(percorso),      'Tutti');
  const fEl  = fill('st-elemento', H.map(h => h.elemento), 'Tutti');
  const fData = document.getElementById('st-data')?.value || '';          // aaaa-mm-gg
  const fId = (document.getElementById('st-id')?.value || '').trim().toLowerCase();
  const giorno = h => h.ts ? h.ts.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '';

  // Tutti i filtri attivi si combinano (AND)
  const rows = H.filter(h =>
    (!fAz  || h.action === fAz) &&
    (!fUt  || utente(h) === fUt) &&
    (!fPer || percorso(h) === fPer) &&
    (!fEl  || h.elemento === fEl) &&
    (!fData || giorno(h) === fData) &&
    (!fId  || (h.codice || '').toLowerCase().includes(fId)));

  // Pulsante "Elimina dati storici": visibile solo all'amministratore
  const btnReset = document.getElementById('st-reset');
  if (btnReset) btnReset.style.display = (_getUser()?.role === 'amministratore') ? 'inline-flex' : 'none';

  const cnt = document.getElementById('st-count');
  if (cnt) cnt.textContent = `${rows.length} di ${H.length} movimenti caricati`;

  body.innerHTML = rows.length ? rows.map(h => `
    <tr>
      <td class="mono" style="font-size:11px;white-space:nowrap">${fmtDate(h.ts)}</td>
      <td>${_azBadge(h.action)}</td>
      <td class="mono" style="font-size:12px;white-space:nowrap">${esc(h.codice || '—')}</td>
      <td class="mono">${esc(h.elemento || '—')}</td>
      <td style="font-size:12px">${h.origine || h.destinazione ? esc(h.origine || '?') + ' → ' + esc(h.destinazione || '?') : '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(h.userName || h.user || '—')}</td>
    </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px">Nessun movimento</td></tr>';
}

function _azBadge(a) {
  const map = {
    'Missione creata':      'blue',
    'Pieno preso in carico':'orange',
    'Consegna completata':  'green',
    'Missione annullata':   'red',
    'Storico eliminato':    'red',
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
  const consegnate = st.missioni.filter(m => m.stato === 'consegnata').length;

  // Durata media: creazione missione → consegna
  const avgPieni = _durataMedia(st.missioni.filter(m => m.consegnataAt), 'createdAt', 'consegnataAt');

  cards.innerHTML = `
    <div class="statCard orange"><div class="val">${missAttive}</div><div class="lbl">Missioni in corso</div></div>
    <div class="statCard green"><div class="val">${consegnate}</div><div class="lbl">Consegne totali</div></div>
    <div class="statCard blue"><div class="val">${_fmtDurMs(avgPieni)}</div><div class="lbl">Durata media consegna</div></div>`;

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

// Media (in ms) della differenza tra due timestamp su una lista di documenti.
// Ignora i record senza entrambi i tempi o con durata negativa. null se vuoto.
function _durataMedia(arr, startField, endField) {
  const durate = arr.map(x => {
    const s = tsVal(x[startField]);
    const e = tsVal(x[endField]);
    return (s && e && e >= s) ? (e - s) : null;
  }).filter(v => v != null);
  if (!durate.length) return null;
  return durate.reduce((a, b) => a + b, 0) / durate.length;
}

// Formatta una durata in millisecondi in forma leggibile (min / h / g).
function _fmtDurMs(ms) {
  if (ms == null) return '—';
  const totMin = Math.round(ms / 60000);
  if (totMin < 1) return '<1 min';
  if (totMin < 60) return totMin + ' min';
  const h = Math.floor(totMin / 60);
  const m = totMin % 60;
  if (h < 24) return h + 'h ' + m + 'min';
  const d = Math.floor(h / 24);
  return d + 'g ' + (h % 24) + 'h';
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
        ${['operativo', 'movimentatore', 'amministrativo', 'amministratore'].map(r =>
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

    // Istanza Firebase secondaria temporanea: crea l'account senza toccare
    // la sessione dell'amministratore corrente.
    const secondaryApp = initializeApp(firebaseConfig, 'secondary-' + Date.now());
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    const uid = cred.user.uid;
    await setDoc(doc(window.db, 'users', uid), { name, email, role, username });
    await setDoc(doc(window.db, 'usernames', username), { email });

    // Pulizia dell'istanza temporanea: se fallisce, non deve invalidare la creazione.
    try { await signOut(secondaryAuth); } catch (e) {}
    try { await deleteApp(secondaryApp); } catch (e) {}

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
// ── ELIMINA DATI STORICI (solo amministratore) ──────────────────────────────
// Svuota l'intera raccolta `history` (non solo le 300 voci mostrate), a blocchi.
// Doppia conferma: finestra di avviso + parola "ELIMINA" da scrivere.
// Protezione anche lato server: le regole Firestore permettono la cancellazione
// di `history` solo agli amministratori.
window.eliminaStorico = async function () {
  const u = _getUser();
  if (!u || u.role !== 'amministratore') { showToast('Solo un amministratore può eliminare lo storico.', 'error'); return; }
  if (!confirm('Eliminare TUTTO lo storico?\n\nL\'operazione cancella ogni movimento registrato e NON si può annullare.')) return;
  if (prompt('Per confermare scrivi ELIMINA (in maiuscolo):') !== 'ELIMINA') {
    showToast('Eliminazione annullata.', 'error'); return;
  }
  const btn = document.getElementById('st-reset');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Eliminazione…'; }
  try {
    let tot = 0;
    for (;;) {
      const snap = await getDocs(query(collection(window.db, 'history'), limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(window.db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      tot += snap.size;
    }
    // Traccia dell'operazione: resta come unica voce nello storico appena svuotato
    await window.logHistory({ action: 'Storico eliminato', voci: tot });
    showToast(`Storico eliminato (${tot} voci).`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗑 ELIMINA DATI STORICI'; }
  }
};

window.resetFiltriStorico = function () {
  ['st-data', 'st-id', 'st-utente', 'st-percorso', 'st-elemento', 'st-azione'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderStorico();
};

// ── Helper modale ────────────────────────────────────────────────────────────
window.openModal = function (id) {
  // La finestra "Nuovo utente" parte sempre pulita
  if (id === 'modalAddUser') {
    ['nu-name', 'nu-username', 'nu-email', 'nu-pass'].forEach(f => {
      const el = document.getElementById(f); if (el) el.value = '';
    });
    const role = document.getElementById('nu-role'); if (role) role.value = 'operativo';
  }
  document.getElementById(id)?.classList.add('open');
};
window.closeModal = function (id) { document.getElementById(id)?.classList.remove('open'); };
