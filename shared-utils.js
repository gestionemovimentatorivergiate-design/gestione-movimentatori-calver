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

// ── Finestra di conferma eliminazione (stesso stile delle finestre "Modifica") ──
// Restituisce una Promise<boolean>. `nome` e `nota` sono testo semplice.
export function dialogElimina({ titolo, nome, nota, okLabel = '🗑 Elimina' }) {
  return new Promise(resolve => {
    document.getElementById('modalElimina')?.remove();
    const ov = document.createElement('div');
    ov.className = 'modalOverlay open';
    ov.id = 'modalElimina';
    ov.innerHTML = `<div class="modalBox"><h3>${esc(titolo)}</h3>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;word-break:break-word">${esc(nome)}</div>
      ${nota ? `<div style="font-size:13px;color:var(--muted);margin-bottom:6px">${esc(nota)}</div>` : ''}
      <div class="modalActions">
        <button class="btnGray" id="del-back">Annulla</button>
        <button class="btnRed" id="del-ok">${esc(okLabel)}</button>
      </div></div>`;
    document.body.appendChild(ov);
    const onKey = e => { if (e.key === 'Escape') chiudi(false); };
    const chiudi = v => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
    document.addEventListener('keydown', onKey);
    { let dn = false; ov.addEventListener('mousedown', e => { dn = e.target === ov; }); ov.onclick = e => { if (e.target === ov && dn) chiudi(false); }; }
    document.getElementById('del-back').onclick = () => chiudi(false);
    document.getElementById('del-ok').onclick = () => chiudi(true);
    document.getElementById('del-back').focus();
  });
}

// ── Menu a selezione multipla con ricerca (usato da Storico e In corso) ───────
const _msSel = new Map();                       // id → Set dei valori scelti
if (!window.__msChiudi) {
  window.__msChiudi = true;
  document.addEventListener('click', e => {
    document.querySelectorAll('.ms.open').forEach(r => { if (!r.contains(e.target)) r.classList.remove('open'); });
  });
}
export function msClear(...ids) { ids.forEach(id => _msSel.set(id, new Set())); }
// groups: [{label?, items:[{v,l}]}]; ritorna l'array dei valori scelti; onChange() a ogni modifica
export function msFill(id, groups, tutti, onChange) {
  const root = document.getElementById(id); if (!root) return [];
  root._msOnChange = onChange;
  const valide = new Set(groups.flatMap(g => g.items.map(i => i.v)));
  const sel = new Set([...(_msSel.get(id) || [])].filter(v => valide.has(v)));
  _msSel.set(id, sel);
  const sig = JSON.stringify(groups);
  if (root.dataset.sig !== sig) {
    root.dataset.sig = sig; root.classList.add('ms');
    root.innerHTML = '<button type="button" class="msBtn"></button><div class="msPanel">' +
      '<input class="msSearch" placeholder="Cerca…" autocomplete="off"><div class="msList">' +
      groups.map(g => (g.label ? `<div class="msGrp">${esc(g.label)}</div>` : '') +
        g.items.map(i => `<label class="msOpt"><input type="checkbox" value="${esc(i.v)}"><span>${esc(i.l)}</span></label>`).join('')).join('') +
      '</div><div class="msFoot"><button type="button" class="msClear">Deseleziona tutto</button></div></div>';
    if (!root._msBound) {
      root._msBound = true;
      root.addEventListener('click', e => {
        if (e.target.closest('.msBtn')) {
          const apri = !root.classList.contains('open');
          document.querySelectorAll('.ms.open').forEach(r => r.classList.remove('open'));
          if (apri) root.classList.add('open');
        } else if (e.target.closest('.msClear')) {
          _msSel.set(id, new Set()); root._msOnChange && root._msOnChange();
        }
      });
      root.addEventListener('change', e => {
        const cb = e.target; if (cb.type !== 'checkbox') return;
        const set = _msSel.get(id) || new Set();
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        _msSel.set(id, set); root._msOnChange && root._msOnChange();
      });
      root.addEventListener('input', e => {
        if (!e.target.classList.contains('msSearch')) return;
        const q = e.target.value.trim().toLowerCase();
        root.querySelectorAll('.msOpt').forEach(o => { o.style.display = !q || o.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      });
    }
  }
  root.querySelectorAll('.msOpt input').forEach(cb => { cb.checked = sel.has(cb.value); });
  const nomi = {}; groups.forEach(g => g.items.forEach(i => { nomi[i.v] = i.l; }));
  root.querySelector('.msBtn').textContent = sel.size === 0 ? tutti : sel.size === 1 ? nomi[[...sel][0]] : sel.size + ' selezionati';
  root.classList.toggle('sel', sel.size > 0);
  return [...sel];
}
// Tipologie di missione (le spunte di Prenotazioni): campo della missione → etichetta
export const TIPOLOGIE = [
  { v: 'lineaBlu', l: '🔵 Linea Blu' }, { v: 'lineaRossa', l: '🔴 Linea Rossa' }, { v: 'vuoto', l: '🟢 Vuoto' },
  { v: 'scaricoCamion', l: '🚛 Scarico camion' }, { v: 'disimballo', l: '📦 Disimballo' }, { v: 'coperto', l: '☂️ Al coperto' },
];
