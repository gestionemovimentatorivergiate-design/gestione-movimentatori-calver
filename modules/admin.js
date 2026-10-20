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
  // Tipo di conferma della consegna: B = barcode, M = manuale (da PC); solo per "Consegna completata"
  const confTipo = h => /barcode/i.test(h.dettaglio || '') ? 'B' : /manualmente/i.test(h.dettaglio || '') ? 'M' : '';
  const stato = h => h.action === 'Pieno preso in carico' ? 'Preso in carico' : (h.action || '');   // vecchie voci rinominate
  const fAz  = fill('st-azione',   H.map(stato),         'Tutti');
  const fUt  = fill('st-utente',   H.map(utente),        'Tutti');
  const fPer = fill('st-percorso', H.map(percorso),      'Tutti');
  const fEl  = fill('st-elemento', H.map(h => h.elemento), 'Tutti');
  const fPar = fill('st-partenza', H.map(h => h.origine),      'Tutti');
  const fArr = fill('st-arrivo',   H.map(h => h.destinazione), 'Tutti');
  const fConf = document.getElementById('st-conferma')?.value || '';
  const fData = document.getElementById('st-data')?.value || '';          // aaaa-mm-gg
  const fId = (document.getElementById('st-id')?.value || '').trim().toLowerCase();
  const giorno = h => h.ts ? h.ts.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '';

  // Nessun filtro attivo → si mostrano solo i movimenti dell'ultima settimana.
  // Con almeno un filtro attivo la ricerca copre tutte le voci caricate.
  const nessunFiltro = !fAz && !fUt && !fPer && !fPar && !fArr && !fEl && !fConf && !fData && !fId;
  const da = Date.now() - 7 * 24 * 3600 * 1000;

  // Una missione compare se almeno una sua voce rispetta TUTTI i filtri (AND);
  // della missione si vedono poi tutti gli stati.
  const chiave = h => h.codice || ('_' + h.id);
  // Il filtro Stato guarda lo stato ATTUALE della missione (la sua voce più recente)
  const tvH = h => h.ts ? h.ts.getTime() : Number.MAX_SAFE_INTEGER;
  const ultimo = new Map();
  // Le "Missione modificata" non cambiano lo stato: si ignorano per stabilire lo stato attuale
  H.forEach(h => {
    if (h.action === 'Missione modificata') return;
    const k = chiave(h), o = ultimo.get(k); if (!o || tvH(h) >= tvH(o)) ultimo.set(k, h);
  });
  const trovate = new Set(H.filter(h =>
    (!nessunFiltro || !h.ts || h.ts.getTime() >= da) &&
    (!fAz  || stato(ultimo.get(chiave(h)) || h) === fAz) &&
    (!fUt  || utente(h) === fUt) &&
    (!fPer || percorso(h) === fPer) &&
    (!fPar || h.origine === fPar) &&
    (!fArr || h.destinazione === fArr) &&
    (!fConf || confTipo(h) === fConf) &&
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
  const oraStr = d => d ? d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const prima = (v, f) => (v.find(h => f(h)) || v[0]);

  body.innerHTML = lista.length ? lista.map(({ k, v }) => {
    const p = v[0];
    const ult = [...v].reverse().find(x => x.action !== 'Missione modificata') || v[v.length - 1];
    // Elemento e percorso: i valori più recenti (una modifica può averli cambiati)
    const rv = [...v].reverse();
    const el = (rv.find(h => h.elemento) || p).elemento;
    const pe = rv.find(h => h.origine || h.destinazione) || p;
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
      <td>${_azBadge(stato(x))}${x.dettaglio ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(x.dettaglio)}</div>` : ''}</td>
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
    'Missione modificata':  'blue',
    'Missione annullata':   'red',
    'Storico eliminato':    'red',
    'Statistiche azzerate': 'red',
  };
  const color = map[a] || 'muted';
  const bg = { blue: '#3b82f613;color:#1d4ed8', orange: '#f59e0b13;color:#b45309', green: '#A4D20018;color:#7fa000', red: '#ef444413;color:#dc2626', muted: 'transparent;color:#6b7280' }[color];
  return `<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:${bg}">${esc(a || '—')}</span>`;
}

// ── STATISTICHE ──────────────────────────────────────────────────────────────
// Tutto calcolato sulle missioni (non sullo storico, che è limitato alle ultime
// voci). Le missioni ANNULLATE sono sempre escluse.
// Filtri: quelli in alto valgono per tutta la pagina; ogni sezione ha anche i
// propri filtri locali (id "sl-…"): se impostati, per quella sezione
// SOSTITUISCONO il filtro globale corrispondente.
// Il periodo (Dal/Al) filtra per data di creazione, tranne la sezione
// "Consegne per operatore", che usa la data di consegna (default: oggi).
const _gg = ms => ms ? new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '';   // aaaa-mm-gg
const _ggIt = s => s ? s.split('-').reverse().join('/') : '';
const _val = id => document.getElementById(id)?.value || '';

// ── Menu a selezione multipla (filtri Statistiche) ──
const _ms = new Map();                       // id → Set dei valori scelti
const _msVal = id => [...(_ms.get(id) || [])];
document.addEventListener('click', e => {   // chiude i menu aperti cliccando fuori
  document.querySelectorAll('.ms.open').forEach(r => { if (!r.contains(e.target)) r.classList.remove('open'); });
});
// groups: [{label?, items:[{v,l}]}] — ricostruisce le voci solo se cambiano (il pannello resta aperto)
function _msFill(id, groups, tutti) {
  const root = document.getElementById(id); if (!root) return [];
  const valide = new Set(groups.flatMap(g => g.items.map(i => i.v)));
  const sel = new Set([...(_ms.get(id) || [])].filter(v => valide.has(v)));
  _ms.set(id, sel);
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
          _ms.set(id, new Set()); renderStatistiche();
        }
      });
      root.addEventListener('change', e => {
        const cb = e.target; if (cb.type !== 'checkbox') return;
        const set = _ms.get(id) || new Set();
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        _ms.set(id, set); renderStatistiche();
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
  const btn = root.querySelector('.msBtn');
  btn.textContent = sel.size === 0 ? tutti : sel.size === 1 ? nomi[[...sel][0]] : sel.size + ' selezionati';
  root.classList.toggle('sel', sel.size > 0);
  return [...sel];
}

export function renderStatistiche() {
  const st = _getState();
  const cards = document.getElementById('stat-cards');
  if (!cards) return;
  // Pulsante "Azzera statistiche": visibile solo all'amministratore
  const btnAz = document.getElementById('ss-azzera');
  if (btnAz) btnAz.style.display = (_getUser()?.role === 'amministratore') ? 'inline-flex' : 'none';

  const ubMap = {}; st.ubicazioni.forEach(u => { ubMap[u.id] = u; });
  const bMap = {};  st.buildings.forEach(b => { bMap[b.id] = b; });
  // Building: "ID · descrizione" (se manca la descrizione, il nome)
  const bLabel = id => {
    const b = bMap[id]; if (!b) return id;
    const d = (b.descrizione || b.nome || '').trim();
    return d && d !== id ? id + ' · ' + d : id;
  };

  // Descrizione del building di un punto carico-scarico (se manca, il nome del building)
  const bDescId = bid => { const b = bMap[bid]; return b ? (b.descrizione || b.nome || '').trim() : ''; };
  const bDesc = ubId => {
    const b = bMap[ubMap[ubId]?.buildingId]; if (!b) return '';
    return (b.descrizione || b.nome || '').trim();
  };

  const base = st.missioni.filter(m => m.stato !== 'annullata');

  // Menu a tendina riempiti con i valori presenti, mantenendo la scelta
  const fillSel = (ids, html, valide) => {
    let v = '';
    [].concat(ids).forEach(id => {
      const sel = document.getElementById(id); if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = html;
      if (valide.includes(cur)) sel.value = cur;
      v = sel.value;
    });
    return v;
  };
  const opts = (vals, tutti) => `<option value="">${tutti}</option>` +
    [...new Set(vals.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'it', { numeric: true }))
      .map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const ops = base.map(m => m.navettaNome);
  const els = base.map(m => m.elementoCodice);
  const bSorted = st.buildings.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'it', { numeric: true }));
  const uSorted = st.ubicazioni.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
  const opG = vals => [{ items: [...new Set(vals.filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), 'it', { numeric: true })).map(v => ({ v, l: v })) }];
  const bItems = bSorted.map(b => ({ v: 'b:' + b.id, l: bLabel(b.id) }));
  const uItems = uSorted.map(u => ({ v: 'u:' + u.id, l: u.nome }));
  const bpG = [{ label: 'Building', items: bItems }, { label: 'Punti carico-scarico', items: uItems }];

  const fOp = _msFill('ss-op', opG(ops), 'Tutti');
  const fEl = _msFill('ss-elemento', opG(els), 'Tutti');
  const fTipo = _msFill('ss-tipo', [{ items: [{ v: 'lineaBlu', l: 'Linea Blu' }, { v: 'lineaRossa', l: 'Linea Rossa' }, { v: 'vuoto', l: 'Vuoti' }] }], 'Tutte');
  const fBp = _msFill('ss-bp', bpG, 'Tutti');
  // Aree di movimentazione (per destinazione della missione)
  const aree = (st.aree || []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it', { numeric: true }));
  const fArea = fillSel('ss-area', '<option value="">Tutte</option>' + aree.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join(''), aree.map(a => a.id));
  const areaSel = aree.find(a => a.id === fArea);
  const areaPunti = areaSel ? (areaSel.puntiIds || []) : null;
  // filtri locali di sezione (selezione multipla)
  const lTOp = _msFill('sl-t-op', opG(ops), 'Tutti');
  const lTDa = _msFill('sl-t-da', bpG, 'Tutti');
  const lTA  = _msFill('sl-t-a',  bpG, 'Tutti');
  const lGOp = _msFill('sl-g-op', opG(ops), 'Tutti');
  const lBBp = _msFill('sl-b-bp', [{ items: bItems }], 'Tutti i building');
  const lPBp = _msFill('sl-p-bp', [{ items: uItems }], 'Tutti i punti');
  const lPB  = _msFill('sl-p-b',  [{ items: bItems.map(i => ({ v: i.v.slice(2), l: i.l })) }], 'Tutti i building');

  const G = { op: fOp, el: fEl, tipo: fTipo, bp: fBp, da: [], a: [], area: areaPunti };
  const fDa = _val('ss-da'), fA = _val('ss-a');

  // Building e punti toccati da una missione (origine e/o destinazione)
  const punti = m => [...new Set([m.origineId, m.destinazioneId].filter(Boolean))];
  const bldgs = m => [...new Set([m.origineId, m.destinazioneId].map(i => ubMap[i]?.buildingId).filter(Boolean))];
  // Un token è 'b:<idBuilding>' o 'u:<idPunto>'
  const tokOk = (tok, ubId) => tok[0] === 'b' ? ubMap[ubId]?.buildingId === tok.slice(2) : ubId === tok.slice(2);
  const okBase = (m, f) =>
    (!f.op.length || f.op.includes(m.navettaNome)) &&
    (!f.el.length || f.el.includes(m.elementoCodice)) &&
    (!f.tipo.length || f.tipo.some(t => !!m[t])) &&
    (!f.area || f.area.includes(m.destinazioneId)) &&
    (!f.bp.length || f.bp.some(t => t[0] === 'b' ? bldgs(m).includes(t.slice(2)) : punti(m).includes(t.slice(2)))) &&
    (!f.da.length || f.da.some(t => tokOk(t, m.origineId))) &&
    (!f.a.length || f.a.some(t => tokOk(t, m.destinazioneId)));
  const inRange = (ms, da, a) => {
    if (!da && !a) return true;
    const g = _gg(ms); if (!g) return false;
    return (!da || g >= da) && (!a || g <= a);
  };
  // missioni di una sezione: filtri globali, con eventuali sostituzioni locali
  const sezione = (loc = {}) => {
    const f = { ...G, ...Object.fromEntries(Object.entries(loc).filter(([, v]) => Array.isArray(v) ? v.length : v)) };
    return { f, M: base.filter(m => okBase(m, f) && inRange(tsVal(m.createdAt), fDa, fA)) };
  };

  const diff = (m, a, b) => { const s = tsVal(m[a]), e = tsVal(m[b]); return (s && e && e >= s) ? e - s : null; };
  const media = (arr, a, b) => {
    const v = arr.map(m => diff(m, a, b)).filter(x => x != null);
    return { n: v.length, ms: v.length ? v.reduce((x, y) => x + y, 0) / v.length : null };
  };

  // ── Riepilogo (filtri globali) ──
  const M = sezione().M;
  const t3 = media(M, 'createdAt', 'consegnataAt');
  const completate = M.filter(m => m.stato === 'consegnata').length;
  const inCorso = M.filter(m => m.stato === 'richiesta' || m.stato === 'in_transito').length;
  cards.innerHTML = `
    <div class="statCard blue"><div class="val">${M.length}</div><div class="lbl">Missioni</div></div>
    <div class="statCard green"><div class="val">${completate}</div><div class="lbl">Completate</div></div>
    <div class="statCard orange"><div class="val">${inCorso}</div><div class="lbl">In corso</div></div>
    <div class="statCard violet"><div class="val">${_fmtDurMs(t3.ms)}</div><div class="lbl">Tempo medio totale</div></div>`;

  // Tabella a barre (nome | missioni con barretta e numero [| partenze | arrivi])
  const tabella = (res, selKeys, semplice, vuoto, colNome = 'Nome', conArea = false) => {
    let rows = Object.entries(res);
    if (selKeys && selKeys.length) rows = rows.filter(([k]) => selKeys.includes(k));
    rows.sort((x, y) => y[1].tot - x[1].tot || x[1].nome.localeCompare(y[1].nome, 'it', { numeric: true }));
    if (!rows.length) return `<div style="color:var(--muted);font-size:13px;padding:10px 2px">${vuoto || 'Nessun dato'}</div>`;
    const max = rows[0][1].tot || 1;
    return `<div class="tableWrap"><table>
      <thead><tr><th>${colNome}</th>${conArea ? '<th>Area</th>' : ''}<th>Missioni</th>${semplice ? '' : '<th style="text-align:center">Partenze</th><th style="text-align:center">Arrivi</th>'}</tr></thead>
      <tbody>${rows.map(([, e]) => `<tr><td>${esc(e.nome)}</td>${conArea ? `<td>${esc(e.area || '')}</td>` : ''}
        <td style="min-width:130px"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${e.tot / max * 100}%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div></div><b>${e.tot}</b></div></td>
        ${semplice ? '' : `<td style="text-align:center">${e.da}</td><td style="text-align:center">${e.a}</td>`}</tr>`).join('')}</tbody>
    </table></div>`;
  };

  // ── 1. Tempi medi: tre grafici, ognuno nella propria card ──
  const T = sezione({ op: lTOp, da: lTDa, a: lTA });
  const sub = document.getElementById('stat-tempi-sub');
  if (sub) sub.textContent = T.f.op.length ? 'Operatori: ' + T.f.op.join(', ') : 'Tutti gli operatori';
  const grafico = (elId, titolo, colTit, arr) => {
    const el = document.getElementById(elId); if (!el) return;
    const a1 = media(arr, 'createdAt', 'presaInCaricoAt'), a2 = media(arr, 'presaInCaricoAt', 'consegnataAt'), a3 = media(arr, 'createdAt', 'consegnataAt');
    const barre = [
      { lbl: 'Creata → Presa', t: a1, col: 'var(--orange)' },
      { lbl: 'Presa → Consegna', t: a2, col: 'var(--accent2)' },
      { lbl: 'Creata → Consegna', t: a3, col: 'var(--violet)' },
    ];
    const max = Math.max(...barre.map(x => x.t.ms || 0), 1);
    el.innerHTML = `<div style="text-align:center;font-weight:800;font-size:13px;color:${colTit};margin-bottom:6px">${titolo} <span style="color:var(--muted);font-weight:600">(${arr.length})</span></div>
      <div style="display:flex;gap:8px;align-items:flex-end;height:150px">` +
      barre.map(x => {
        const h = x.t.ms == null ? 0 : Math.max(4, x.t.ms / max * 80);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;color:var(--text);margin-bottom:3px;text-align:center;line-height:1.1">${_fmtDurMs(x.t.ms)}</div>
          <div style="width:100%;max-width:48px;height:${h}px;background:${x.col};border-radius:6px 6px 0 0;transition:height .3s"></div></div>`;
      }).join('') + `</div>
      <div style="display:flex;gap:8px;border-top:2px solid var(--border)">` +
      barre.map(x => `<div style="flex:1;text-align:center;padding-top:5px"><div style="font-size:10px;font-weight:700;line-height:1.2">${x.lbl}</div>
        <div style="font-size:10px;color:var(--muted)">su ${x.t.n} ${x.t.n === 1 ? 'missione' : 'missioni'}</div></div>`).join('') + `</div>`;
  };
  // Con un filtro "Tipo" attivo, restano valorizzati solo i grafici che gli corrispondono
  grafico('stat-tempi-all',   'Tutte',          'var(--text)', G.tipo.length ? [] : T.M);
  grafico('stat-tempi-blu',   '🔵 Linea Blu',   '#2563eb',     (!G.tipo.length || G.tipo.includes('lineaBlu'))   ? T.M.filter(m => m.lineaBlu)   : []);
  grafico('stat-tempi-rossa', '🔴 Linea Rossa', '#dc2626',     (!G.tipo.length || G.tipo.includes('lineaRossa')) ? T.M.filter(m => m.lineaRossa) : []);

  // Grafici a linea: tempo medio per passaggio di stato, un giorno per punto, una settimana alla volta
  const PASSI = [
    { v: 'cp', l: 'Creata → Presa',     da: 'createdAt',      a: 'presaInCaricoAt', dash: '6 4' },
    { v: 'pc', l: 'Presa → Consegna',   da: 'presaInCaricoAt', a: 'consegnataAt',    dash: '2 4' },
    { v: 'cc', l: 'Creata → Consegna',  da: 'createdAt',      a: 'consegnataAt',    dash: '' },
  ];
  const selPassi = _msFill('sl-l-pass', [{ items: PASSI.map(x => ({ v: x.v, l: x.l })) }], 'Creata → Consegna');
  const passiAtt = PASSI.filter(x => selPassi.length ? selPassi.includes(x.v) : x.v === 'cc');
  // Settimane (lunedì → domenica) in cui esistono dati, dalla più recente
  const lunedi = g => { const d = new Date(g + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const aggiungiGg = (g, n) => { const d = new Date(g + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const settimane = new Set();
  T.M.forEach(m => PASSI.forEach(x => { if (diff(m, x.da, x.a) != null) settimane.add(lunedi(_gg(tsVal(m[x.a])))); }));
  const wList = [...settimane].sort().reverse();
  const wScelte = _msFill('sl-l-week', [{ items: wList.map(w => ({ v: w, l: _ggIt(w).slice(0, 5) + ' – ' + _ggIt(aggiungiGg(w, 6)) })) }], wList.length ? 'Ultima settimana' : 'Nessun dato');
  const wAtt = (wScelte.length ? wScelte : wList.slice(0, 1)).slice().sort();   // senza scelta: la più recente
  const lineaGrafico = (elId, titolo, colTit, colLinea, arr) => {
    const el = document.getElementById(elId); if (!el) return;
    const giorniW = wAtt.flatMap(w => Array.from({ length: 7 }, (_, i) => aggiungiGg(w, i)));
    // serie: per ogni passaggio, media per giorno (giorno dell'evento finale) dentro la settimana
    const serie = passiAtt.map(x => {
      const pg = {};
      arr.forEach(m => {
        const d = diff(m, x.da, x.a); if (d == null) return;
        const g = _gg(tsVal(m[x.a])); if (!giorniW.includes(g)) return;
        (pg[g] = pg[g] || []).push(d);
      });
      return { x, pts: giorniW.filter(g => pg[g]).map(g => ({ g, ms: pg[g].reduce((p, q) => p + q, 0) / pg[g].length, n: pg[g].length })) };
    });
    const nMiss = new Set(arr.filter(m => passiAtt.some(x => { const d = diff(m, x.da, x.a); return d != null && giorniW.includes(_gg(tsVal(m[x.a]))); })).map(m => m.id)).size;
    const testa = `<div style="text-align:center;font-weight:800;font-size:13px;color:${colTit};margin-bottom:6px">${titolo} <span style="color:var(--muted);font-weight:600">(${nMiss})</span></div>`;
    if (!serie.some(q => q.pts.length)) { el.innerHTML = testa + '<div style="height:150px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px">Nessun dato nel periodo scelto</div>'; return; }
    const W = 320, H = 170, L = 56, R = 20, T0 = 12, B = 30;
    const nG = giorniW.length;
    const X = g => L + giorniW.indexOf(g) / Math.max(nG - 1, 1) * (W - L - R);
    const maxMs = Math.max(...serie.flatMap(q => q.pts.map(p => p.ms)), 1);
    const Y = ms => T0 + (1 - ms / maxMs) * (H - T0 - B);
    const dm = g => g.slice(8) + '/' + g.slice(5, 7);
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="${esc(titolo)}">`;
    [0, .5, 1].forEach(f => {
      const y = Y(maxMs * f);
      svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1"/>` +
             `<text x="${L - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${_fmtDurMs(maxMs * f)}</text>`;
    });
    const passoEt = nG <= 7 ? 1 : 7 * Math.ceil(wAtt.length / 6);   // più settimane: etichette solo sui lunedì (a salti se troppe)
    giorniW.forEach((g, i) => { if (i % passoEt === 0) svg += `<text x="${X(g)}" y="${H - 12}" text-anchor="middle" font-size="9" fill="var(--muted)">${dm(g)}</text>`; });
    serie.forEach(q => {
      if (q.pts.length > 1) svg += `<polyline fill="none" stroke="${colLinea}" stroke-width="2.5" stroke-linejoin="round"${q.x.dash ? ` stroke-dasharray="${q.x.dash}"` : ''} points="${q.pts.map(p => X(p.g) + ',' + Y(p.ms)).join(' ')}"/>`;
      q.pts.forEach(p => { svg += `<circle cx="${X(p.g)}" cy="${Y(p.ms)}" r="${nG > 14 ? 2.5 : 3.5}" fill="${colLinea}"><title>${esc(q.x.l)} · ${_ggIt(p.g)} · ${_fmtDurMs(p.ms)} (${p.n} ${p.n === 1 ? 'missione' : 'missioni'})</title></circle>`; });
    });
    const legenda = passiAtt.length > 1
      ? `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;font-size:10px;color:var(--muted)">` +
        passiAtt.map(x => `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="26" height="6"><line x1="0" x2="26" y1="3" y2="3" stroke="${colLinea}" stroke-width="2.5"${x.dash ? ` stroke-dasharray="${x.dash}"` : ''}/></svg>${esc(x.l)}</span>`).join('') + '</div>'
      : `<div style="text-align:center;font-size:10px;color:var(--muted)">giorno · tempo medio ${esc(passiAtt[0].l)}</div>`;
    el.innerHTML = testa + svg + '</svg>' + legenda;
  };
  lineaGrafico('stat-linea-all',   'Tutte',          'var(--text)', 'var(--accent2)', G.tipo.length ? [] : T.M);
  lineaGrafico('stat-linea-blu',   '🔵 Linea Blu',   '#2563eb',     '#2563eb',        (!G.tipo.length || G.tipo.includes('lineaBlu'))   ? T.M.filter(m => m.lineaBlu)   : []);
  lineaGrafico('stat-linea-rossa', '🔴 Linea Rossa', '#dc2626',     '#dc2626',        (!G.tipo.length || G.tipo.includes('lineaRossa')) ? T.M.filter(m => m.lineaRossa) : []);

  // ── 2. Consegne per operatore (data di consegna; default: oggi) ──
  const dayEl = document.getElementById('stat-giorni');
  if (dayEl) {
    const oggi = _gg(Date.now());
    const lDa = _val('sl-g-da'), lA = _val('sl-g-a');
    let dal = lDa || lA ? lDa : fDa, al = lDa || lA ? lA : fA;
    if (!dal && !al) { dal = oggi; al = oggi; }
    const f = { ...G, op: lGOp.length ? lGOp : G.op };
    const C = base.filter(m => m.stato === 'consegnata' && m.consegnataAt && okBase(m, f) && inRange(tsVal(m.consegnataAt), dal, al));
    const res = {};
    C.forEach(m => { const o = m.navettaNome || '—'; (res[o] = res[o] || { nome: o, tot: 0 }).tot++; });
    const subG = document.getElementById('stat-giorni-sub');
    if (subG) subG.textContent = dal && dal === al ? (dal === oggi ? 'Oggi · ' : '') + _ggIt(dal)
      : 'Dal ' + (_ggIt(dal) || 'inizio') + ' al ' + (_ggIt(al) || 'oggi');
    dayEl.innerHTML = tabella(res, null, true, 'Nessuna consegna nel periodo selezionato.')
      + (C.length ? `<div style="font-size:12px;color:var(--muted);margin-top:6px">Totale consegne: <b>${C.length}</b></div>` : '');
  }

  // ── 3. Missioni per Building ──
  const conta = (chiavi, nome, Ms) => {
    const r = {};
    Ms.forEach(m => chiavi(m).forEach(k => { (r[k] = r[k] || { nome: nome(k, m), tot: 0, da: 0, a: 0 }).tot++; }));
    return r;
  };
  const B = sezione({ bp: lBBp });
  const bRes = conta(bldgs, k => k, B.M);
  Object.keys(bRes).forEach(k => { bRes[k].area = bDescId(k); });
  B.M.forEach(m => {
    const bo = ubMap[m.origineId]?.buildingId, bd = ubMap[m.destinazioneId]?.buildingId;
    if (bo && bRes[bo]) bRes[bo].da++;
    if (bd && bRes[bd]) bRes[bd].a++;
  });
  const bEl = document.getElementById('stat-building');
  if (bEl) bEl.innerHTML = tabella(bRes, lBBp.map(t => t.slice(2)), false, '', 'Building', true);

  // ── 4. Missioni per Punto carico-scarico ──
  const P = sezione({ bp: lPBp });
  const pRes = conta(punti, (k, m) => ubMap[k]?.nome || (k === m.origineId ? m.origineNome : m.destinazioneNome) || k, P.M);
  Object.keys(pRes).forEach(k => { pRes[k].area = bDesc(k); });
  P.M.forEach(m => {
    if (m.origineId && pRes[m.origineId]) pRes[m.origineId].da++;
    if (m.destinazioneId && pRes[m.destinazioneId]) pRes[m.destinazioneId].a++;
  });
  // Filtro per Building di appartenenza: restano solo i punti di quel building
  if (lPB.length) Object.keys(pRes).forEach(k => { if (!lPB.includes(ubMap[k]?.buildingId)) delete pRes[k]; });
  const pEl = document.getElementById('stat-punti');
  if (pEl) pEl.innerHTML = tabella(pRes, lPBp.map(t => t.slice(2)), false, '', 'Punto di carico-scarico', true);
}

window.renderStatistiche = renderStatistiche;
// Azzera i filtri globali e quelli di tutte le sezioni
window.resetFiltriStat = function () {
  ['ss-da', 'ss-a', 'ss-op', 'ss-elemento', 'ss-bp', 'ss-area', 'ss-tipo',
   'sl-t-op', 'sl-t-da', 'sl-t-a', 'sl-l-pass', 'sl-l-week', 'sl-g-da', 'sl-g-a', 'sl-g-op', 'sl-b-bp', 'sl-p-bp', 'sl-p-b'
  ].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    if (_ms.has(id)) _ms.set(id, new Set()); else el.value = '';
  });
  renderStatistiche();
};

// Formatta una durata in millisecondi (s / min / h / g).
function _fmtDurMs(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'min';
  return Math.floor(h / 24) + 'g ' + (h % 24) + 'h';
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
// Finestra di conferma nello stile delle altre finestre dell'app: per procedere
// bisogna scrivere ELIMINA (il bottone resta disattivato finché non è corretto).
function _dialogEliminaStorico(quanti) {
  return _dialogDistruttiva({
    titolo: 'Elimina dati storici',
    avviso: `⚠️ Verranno cancellati tutti i movimenti registrati${quanti ? ` (${quanti} voci caricate)` : ''}. L'operazione NON si può annullare.`,
    parola: 'ELIMINA', okLabel: '🗑 Elimina tutto',
  });
}

function _dialogDistruttiva({ titolo, avviso, parola, okLabel }) {
  return new Promise(resolve => {
    document.getElementById('modalEliminaStorico')?.remove();
    const ov = document.createElement('div');
    ov.className = 'modalOverlay open';
    ov.id = 'modalEliminaStorico';
    ov.innerHTML = `<div class="modalBox">
      <h3>${titolo}</h3>
      <div style="padding:10px 12px;border-radius:8px;background:#dc262618;color:#b91c1c;font-size:13px;font-weight:600;margin-bottom:12px">
        ${avviso}</div>
      <div class="field"><label>Per confermare scrivi ${parola}</label>
        <input type="text" id="es-conf" placeholder="${parola}" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
      <div class="modalActions">
        <button class="btnGray" id="es-back">Annulla</button>
        <button class="btnRed" id="es-ok" disabled style="opacity:.45">${okLabel}</button>
      </div></div>`;
    document.body.appendChild(ov);
    const chiudi = v => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') chiudi(false); };
    document.addEventListener('keydown', onKey);
    { let dn = false; ov.addEventListener('mousedown', e => { dn = e.target === ov; }); ov.onclick = e => { if (e.target === ov && dn) chiudi(false); }; }
    const inp = document.getElementById('es-conf'), ok = document.getElementById('es-ok');
    const valido = () => inp.value.trim() === parola;
    inp.addEventListener('input', () => { ok.disabled = !valido(); ok.style.opacity = valido() ? '1' : '.45'; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && valido()) chiudi(true); });
    document.getElementById('es-back').onclick = () => chiudi(false);
    ok.onclick = () => { if (valido()) chiudi(true); };
    inp.focus();
  });
}

// ── Azzera statistiche (solo amministratore) ────────────────────────────────
// Le statistiche si calcolano sulle missioni: azzerarle = eliminare le missioni
// CONCLUSE (consegnate e annullate). Restano le missioni ancora aperte (in
// coda / in carico) e i contatori giornalieri degli ID, così la numerazione
// non riparte da capo. Lo storico (tab Storico) non viene toccato.
window.azzeraStatistiche = async function () {
  const u = _getUser();
  if (!u || u.role !== 'amministratore') { showToast('Solo un amministratore può azzerare le statistiche.', 'error'); return; }
  const chiuse = (_getState().missioni || []).filter(m => m.stato === 'consegnata' || m.stato === 'annullata');
  const aperte = (_getState().missioni || []).filter(m => m.stato === 'richiesta' || m.stato === 'in_transito').length;
  if (!chiuse.length) { showToast('Nessuna missione conclusa da eliminare: le statistiche sono già a zero.', 'success'); return; }
  const ok = await _dialogDistruttiva({
    titolo: 'Azzera statistiche',
    avviso: `⚠️ Verranno eliminate ${chiuse.length} missioni concluse (consegnate e annullate) e le statistiche ripartiranno da zero.`
      + (aperte ? ` Le ${aperte} missioni ancora aperte (in coda o in carico) restano.` : '')
      + ` L'operazione NON si può annullare.`,
    parola: 'AZZERA', okLabel: '🗑 Azzera statistiche',
  });
  if (!ok) return;
  const btn = document.getElementById('ss-azzera');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Azzeramento…'; }
  try {
    for (let i = 0; i < chiuse.length; i += 400) {
      const batch = writeBatch(window.db);
      chiuse.slice(i, i + 400).forEach(m => batch.delete(doc(window.db, 'missioni', m.id)));
      await batch.commit();
    }
    await window.logHistory({ action: 'Statistiche azzerate', voci: chiuse.length });
    showToast(`Statistiche azzerate (${chiuse.length} missioni eliminate).`, 'success');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Azzera statistiche'; }
  }
};

window.eliminaStorico = async function () {
  const u = _getUser();
  if (!u || u.role !== 'amministratore') { showToast('Solo un amministratore può eliminare lo storico.', 'error'); return; }
  const quanti = (_getState().history || []).length;
  if (!await _dialogEliminaStorico(quanti)) return;
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
const _col = i => String.fromCharCode(65 + i);   // A..K

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
  const styles = `${HD}<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm:ss"/></numFmts>` +
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
    const head = ['Data', 'Ora', 'Stato', 'ID missione', 'Elemento', 'Origine', 'Destinazione', 'Utente', 'Linea Blu', 'Linea Rossa', 'Vuoto', 'Tipo di conferma'];
    const dati = rows.map(h => [
      ..._excelData(h.ts), (h.action === 'Pieno preso in carico' ? 'Preso in carico' : (h.action || '')), h.codice || '', h.elemento || '',
      h.origine || '', h.destinazione || '', h.userName || h.user || '',
      h.lineaBlu ? 'Sì' : '', h.lineaRossa ? 'Sì' : '', h.vuoto ? 'Sì' : '',
      /barcode/i.test(h.dettaglio || '') ? 'B' : /manualmente/i.test(h.dettaglio || '') ? 'M' : '',
    ]);
    const bytes = _xlsxBytes(head, dati, [12, 10, 22, 17, 15, 20, 20, 22, 11, 12, 9, 17]);
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
  ['st-data', 'st-id', 'st-utente', 'st-percorso', 'st-partenza', 'st-arrivo', 'st-elemento', 'st-azione', 'st-conferma'].forEach(id => {
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
