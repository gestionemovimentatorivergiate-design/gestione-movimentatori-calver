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
let _storicoRows = [];   // righe attualmente visibili (dopo i filtri)

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
  const stato = h => h.action === 'Pieno preso in carico' ? 'Preso in carico' : (h.action || '');   // vecchie voci rinominate
  const fAz  = fill('st-azione',   H.map(stato),         'Tutti');
  const fUt  = fill('st-utente',   H.map(utente),        'Tutti');
  const fPer = fill('st-percorso', H.map(percorso),      'Tutti');
  const fEl  = fill('st-elemento', H.map(h => h.elemento), 'Tutti');
  const fData = document.getElementById('st-data')?.value || '';          // aaaa-mm-gg
  const fId = (document.getElementById('st-id')?.value || '').trim().toLowerCase();
  const giorno = h => h.ts ? h.ts.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '';

  // Nessun filtro attivo → si mostrano solo i movimenti dell'ultima settimana.
  // Con almeno un filtro attivo la ricerca copre tutte le voci caricate.
  const nessunFiltro = !fAz && !fUt && !fPer && !fEl && !fData && !fId;
  const da = Date.now() - 7 * 24 * 3600 * 1000;

  // Una missione compare se almeno una sua voce rispetta TUTTI i filtri (AND);
  // della missione si vedono poi tutti gli stati.
  const chiave = h => h.codice || ('_' + h.id);
  const trovate = new Set(H.filter(h =>
    (!nessunFiltro || !h.ts || h.ts.getTime() >= da) &&
    (!fAz  || stato(h) === fAz) &&
    (!fUt  || utente(h) === fUt) &&
    (!fPer || percorso(h) === fPer) &&
    (!fEl  || h.elemento === fEl) &&
    (!fData || giorno(h) === fData) &&
    (!fId  || (h.codice || '').toLowerCase().includes(fId))).map(chiave));

  const tv = h => h.ts ? h.ts.getTime() : Number.MAX_SAFE_INTEGER;
  const gruppi = new Map();
  H.forEach(h => { const k = chiave(h); if (!trovate.has(k)) return; if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(h); });
  const lista = [...gruppi.entries()].map(([k, v]) => ({ k, v: v.sort((x, y) => tv(x) - tv(y)) }))
    .sort((x, y) => tv(y.v[y.v.length - 1]) - tv(x.v[x.v.length - 1]));   // ultima attività in alto
  _storicoRows = lista.flatMap(g => g.v);      // sono le voci che scarica il pulsante Excel

  // Pulsante "Elimina dati storici": visibile solo all'amministratore
  const btnReset = document.getElementById('st-reset');
  if (btnReset) btnReset.style.display = (_getUser()?.role === 'amministratore') ? 'inline-flex' : 'none';

  const cnt = document.getElementById('st-count');
  if (cnt) {
    const lim = _getState().historyLimit;
    const troncato = lim && H.length >= lim ? ` ⚠ Sono caricate solo le ultime ${lim} voci: le più vecchie non sono incluse.` : '';
    cnt.textContent = `${lista.length} missioni (${_storicoRows.length} stati)` +
      (nessunFiltro ? ' — ultimi 7 giorni (nessun filtro attivo).' : '.') + troncato;
  }
  const bx = document.getElementById('st-excel');
  if (bx) bx.disabled = !_storicoRows.length;

  const dataStr = d => d ? d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const oraStr = d => d ? d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }) : '—';
  const prima = (v, f) => (v.find(h => f(h)) || v[0]);

  body.innerHTML = lista.length ? lista.map(({ k, v }) => {
    const p = v[0], ult = v[v.length - 1];
    const el = prima(v, h => h.elemento).elemento;
    const pe = prima(v, h => h.origine || h.destinazione);
    const aperto = p.codice && _stAperti.has(k);
    const idCell = p.codice
      ? `<a href="#" onclick="toggleMissioneStorico('${esc(k)}');return false" style="color:var(--text);font-weight:700;text-decoration:underline">${aperto ? '▾' : '▸'} ${esc(p.codice)}</a>`
      : '—';
    let h = `
    <tr>
      <td class="mono" style="font-size:12px;white-space:nowrap">${dataStr(p.ts)}</td>
      <td class="mono" style="font-size:12px;white-space:nowrap">${oraStr(p.ts)}</td>
      <td class="mono" style="font-size:12px;white-space:nowrap">${idCell}</td>
      <td>${_azBadge(stato(ult))}</td>
      <td class="mono">${esc(el || '—')}</td>
      <td style="font-size:12px">${pe.origine || pe.destinazione ? esc(pe.origine || '?') + ' → ' + esc(pe.destinazione || '?') : '—'}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(utente(p) || '—')}</td>
    </tr>`;
    if (aperto) h += v.map(x => `
    <tr style="background:rgba(0,0,0,.03)">
      <td class="mono" style="font-size:11px;white-space:nowrap;padding-left:22px">${dataStr(x.ts)}</td>
      <td class="mono" style="font-size:11px;white-space:nowrap">${oraStr(x.ts)}</td>
      <td></td>
      <td>${_azBadge(stato(x))}</td>
      <td></td><td></td>
      <td style="font-size:12px;color:var(--muted)">${esc(utente(x) || '—')}</td>
    </tr>`).join('');
    return h;
  }).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">Nessun movimento</td></tr>';
}

const _stAperti = new Set();   // ID missione con il dettaglio stati aperto
window.toggleMissioneStorico = function (k) {
  if (_stAperti.has(k)) _stAperti.delete(k); else _stAperti.add(k);
  renderStorico();
};

function _azBadge(a) {
  const map = {
    'Missione creata':      'blue',
    'Preso in carico':      'orange',
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

// ── EXCEL (righe visibili, cioè già filtrate) ───────────────────────────────
// Il file .xlsx viene costruito direttamente qui, senza librerie esterne né
// connessione a internet: un .xlsx è uno zip di piccoli file XML.

// CRC32 (richiesto dal formato zip)
const _CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function _crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// Zip senza compressione ("store"): files = [{ name, data: Uint8Array }]
function _zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), crc = _crc32(f.data), size = f.data.length;
    const lh = Uint8Array.from([0x50, 0x4B, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0,
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0]);
    parts.push(lh, name, f.data);
    central.push(Uint8Array.from([0x50, 0x4B, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0,
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(off)]), name);
    off += lh.length + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = Uint8Array.from([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(off), 0, 0]);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let pos = 0; for (const a of all) { out.set(a, pos); pos += a.length; }
  return out;
}

const _xe = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const _col = i => String.fromCharCode(65 + i);   // A..J

// Costruisce il file .xlsx: head = intestazioni, rows = array di array
// (numero = numero/data seriale; stringa = testo). Colonna 0 = data, colonna 1 = ora.
function _xlsxBytes(head, rows, larghezze) {
  const enc = new TextEncoder();
  const cell = (v, r, c, st) => {
    const ref = _col(c) + r;
    if (v === '' || v == null) return '';
    if (typeof v === 'number') return `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${v}</v></c>`;
    return `<c r="${ref}"${st ? ` s="${st}"` : ''} t="inlineStr"><is><t>${_xe(v)}</t></is></c>`;
  };
  let sd = `<row r="1">${head.map((h, c) => cell(h, 1, c, 2)).join('')}</row>`;
  rows.forEach((row, i) => {
    sd += `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c, typeof v === 'number' ? (c === 0 ? 1 : c === 1 ? 3 : 0) : 0)).join('')}</row>`;
  });
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const HD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const sheet = `${HD}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${sd}</sheetData><autoFilter ref="A1:${_col(head.length - 1)}${rows.length + 1}"/></worksheet>`;
  const styles = `${HD}<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const T = (name, txt) => ({ name, data: enc.encode(txt) });
  return _zip([
    T('[Content_Types].xml', `${HD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    T('_rels/.rels', `${HD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    T('xl/workbook.xml', `${HD}<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Storico" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    T('xl/_rels/workbook.xml.rels', `${HD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    T('xl/styles.xml', styles),
    T('xl/worksheets/sheet1.xml', sheet),
  ]);
}

// Data/ora (ora di Roma) → [data seriale Excel, frazione di giorno = ora]
function _excelData(d) {
  if (!d) return ['', ''];
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(d);
  const g = t => +p.find(x => x.type === t).value;
  const giorni = Date.UTC(g('year'), g('month') - 1, g('day')) / 86400000 + 25569;
  return [giorni, (g('hour') * 3600 + g('minute') * 60 + g('second')) / 86400];
}

window.scaricaStoricoExcel = function () {
  const rows = _storicoRows;
  if (!rows.length) { showToast('Nessun movimento da scaricare.', 'error'); return; }
  try {
    const head = ['Data', 'Ora', 'Stato', 'ID missione', 'Elemento', 'Origine', 'Destinazione', 'Utente', 'Linea Blu', 'Vuoto'];
    const dati = rows.map(h => [
      ..._excelData(h.ts), (h.action === 'Pieno preso in carico' ? 'Preso in carico' : (h.action || '')), h.codice || '', h.elemento || '',
      h.origine || '', h.destinazione || '', h.userName || h.user || '',
      h.lineaBlu ? 'Sì' : '', h.vuoto ? 'Sì' : '',
    ]);
    const bytes = _xlsxBytes(head, dati, [12, 8, 22, 17, 15, 20, 20, 22, 11, 9]);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Storico_${oggi}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    showToast(`File Excel scaricato (${rows.length} movimenti).`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
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
