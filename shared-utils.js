// ── shared-utils.js ───────────────────────────────────────────────────────────
// Utility condivise da tutti i moduli.
import { addDoc, collection, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── LOG STORICO CENTRALIZZATO ────────────────────────────────────────────────
// Unico punto di scrittura su `history`. Riempie sempre ts (ora server),
// user/userName (nome di chi esegue l'azione, da window.currentUser) e role.
// Qualsiasi campo extra passato viene incluso così com'è.
window.logHistory = function (entry = {}) {
  const u = window.currentUser || {};
  const nome = u.name || u.email || '—';
  const { action = null, ...rest } = entry;
  return addDoc(collection(window.db, 'history'), {
    ...rest,
    ts: serverTimestamp(),
    action,
    user: nome,
    userName: nome,
    role: u.role || null,
  });
};

// ── Formattazione date ────────────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return '—';
  const dt = d.toDate ? d.toDate() : new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// Durata trascorsa da un timestamp (anzianità in coda)
export function fmtDur(since) {
  if (!since) return '—';
  const d = since.toDate ? since.toDate() : new Date(since);
  const ms = Date.now() - d.getTime();
  if (ms < 0) return '—';
  const totMin = Math.floor(ms / 60000);
  if (totMin < 60) return totMin + ' min';
  const h = Math.floor(totMin / 60);
  if (h < 24) return h + 'h ' + (totMin % 60) + 'min';
  return Math.floor(h / 24) + 'g ' + (h % 24) + 'h';
}

// Converte un valore (Timestamp Firestore / Date / stringa) in millisecondi.
export function tsVal(v) {
  if (!v) return 0;
  if (v.toDate) return v.toDate().getTime();
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
export function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  const icon = type === 'success' ? '✓ ' : type === 'error' ? '✗ ' : 'ℹ ';
  t.textContent = icon + msg;
  t.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
