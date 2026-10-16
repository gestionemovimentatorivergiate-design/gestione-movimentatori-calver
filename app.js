// ── app.js ─ Entry point unico ────────────────────────────────────────────────
// Carica Firebase, gestisce login/ruoli, i listener Firestore condivisi e il
// routing tra le pagine. I singoli moduli (operativo, navetta, anagrafiche,
// admin) leggono lo stato tramite getState() e disegnano le rispettive viste.
//
// Il cache-busting ?v= viene applicato al deploy (deploy.yml) solo su index.html
// e app.js: gli import interni qui sotto restano "nudi" — ci pensa sw.js a
// garantire file sempre freschi. Non modificare a mano i ?v=.

import './firebase-config.js';
import './shared-utils.js';

import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, collection, query, orderBy, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { showToast } from './shared-utils.js';
import { initOperativo, renderNuovaMissione, renderMieMissioni } from './modules/operativo.js';
import { initNavetta, renderInCorso } from './modules/navetta.js';
import { initAnagrafiche, renderElementi, renderUbicazioni, renderBuildings, renderAree } from './modules/anagrafiche.js';
import { initAdmin, renderStorico, renderStatistiche, renderUtenti } from './modules/admin.js';

// ── STATO CONDIVISO ─────────────────────────────────────────────────────────
let currentUser = null;
// Quante voci di storico vengono caricate (le più recenti). Usato anche da admin.js.
const HISTORY_LIMIT = 1000;
const state = {
  missioni: [],
  elementi: [],
  buildings: [],
  ubicazioni: [],
  aree: [],
  history: [],
  historyLimit: HISTORY_LIMIT,
  utenti: [],
};
const getState = () => state;
const getUser  = () => currentUser;

// Getter esposti anche su window per i moduli che ne hanno bisogno
window.getAppState = getState;
window.getAppUser  = getUser;

// ── ROUTING PAGINE ────────────────────────────────────────────────────────────
let currentPage = null;

function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.navBtn').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById('page' + id);
  if (pg) pg.classList.add('active');
  if (btn) btn.classList.add('active');
  currentPage = id;
  refreshCurrentPage();
}
window.showPage = showPage;

// Ridisegna la pagina attualmente visibile con i dati correnti
function refreshCurrentPage() {
  switch (currentPage) {
    case 'Prenotazioni':  renderNuovaMissione(); renderMieMissioni(); break;
    case 'InCorso':       renderInCorso();       break;
    case 'Storico':       renderStorico();       break;
    case 'Statistiche':   renderStatistiche();   break;
    case 'Anagrafiche':   renderElementi(); renderBuildings(); renderUbicazioni(); renderAree(); break;
    case 'Utenti':        renderUtenti();        break;
  }
}
window.refreshCurrentPage = refreshCurrentPage;

// Collega i click delle schede
document.querySelectorAll('.navBtn').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page, btn));
});

// ── LISTENER FIRESTORE ─────────────────────────────────────────────────────────
const _unsub = [];
function stopListeners() { while (_unsub.length) { try { _unsub.pop()(); } catch (e) {} } }

function startListeners() {
  stopListeners();
  const db = window.db;
  const isAdmin = currentUser.role === 'amministratore';
  const isAmm   = currentUser.role === 'amministrativo' || isAdmin;

  _unsub.push(onSnapshot(query(collection(db, 'missioni'), orderBy('createdAt', 'desc')),
    snap => { state.missioni = snap.docs.map(d => ({ id: d.id, ...d.data() })); refreshCurrentPage(); },
    err => console.error('Errore missioni:', err)));

  _unsub.push(onSnapshot(query(collection(db, 'elementi'), orderBy('__name__')),
    snap => { state.elementi = snap.docs.map(d => ({ id: d.id, ...d.data() })); refreshCurrentPage(); },
    err => console.error('Errore elementi:', err)));

  _unsub.push(onSnapshot(query(collection(db, 'ubicazioni'), orderBy('__name__')),
    snap => {
      // I Building sono salvati nella stessa collezione (tipo: 'building'):
      // qui vengono separati dalle ubicazioni vere (magazzino / linea).
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Anche le Aree di movimentazione (tipo: 'area') vivono in questa collezione.
      state.buildings  = all.filter(x => x.tipo === 'building');
      state.aree       = all.filter(x => x.tipo === 'area');
      state.ubicazioni = all.filter(x => x.tipo !== 'building' && x.tipo !== 'area');
      refreshCurrentPage();
    },
    err => console.error('Errore ubicazioni:', err)));

  // Storico e utenti solo per chi ne ha bisogno (amministrativo/amministratore)
  if (isAmm) {
    _unsub.push(onSnapshot(query(collection(db, 'history'), orderBy('ts', 'desc'), limit(HISTORY_LIMIT)),
      snap => { state.history = snap.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().ts?.toDate() })); refreshCurrentPage(); },
      err => console.error('Errore history:', err)));
  }
  if (isAdmin) {
    _unsub.push(onSnapshot(collection(db, 'users'),
      snap => { state.utenti = snap.docs.map(d => ({ uid: d.id, ...d.data() })); refreshCurrentPage(); },
      err => console.error('Errore utenti:', err)));
  }
}

// ── AUTH ────────────────────────────────────────────────────────────────────
onAuthStateChanged(window.auth, async fbUser => {
  if (fbUser) {
    try {
      const snap = await getDoc(doc(window.db, 'users', fbUser.uid));
      const role = snap.exists() ? (snap.data().role || 'operativo') : 'operativo';
      const name = snap.exists() ? (snap.data().name || fbUser.email) : fbUser.email;
      currentUser = { uid: fbUser.uid, email: fbUser.email, role, name };
    } catch (e) {
      currentUser = { uid: fbUser.uid, email: fbUser.email, role: 'operativo', name: fbUser.email };
    }
    window.currentUser = currentUser;
    showApp();
  } else {
    currentUser = null;
    window.currentUser = null;
    stopListeners();
    showLogin();
  }
  document.getElementById('loadingScreen').style.display = 'none';
});

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass     = document.getElementById('loginPass').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  errEl.style.display = 'none';
  if (!username || !pass) { errEl.textContent = 'Inserisci username e password.'; errEl.style.display = 'block'; return; }
  btn.textContent = 'Accesso…'; btn.disabled = true;
  const mostra = m => { errEl.textContent = m; errEl.style.display = 'block'; };
  try {
    // 1) Ricerca username → email (database)
    let snap;
    try {
      snap = await getDoc(doc(window.db, 'usernames', username));
    } catch (e) {
      console.error('Login - lettura username fallita:', e.code, e.message);
      mostra(e.code === 'permission-denied'
        ? 'Accesso al database negato (regole Firestore). [' + e.code + ']'
        : 'Impossibile contattare il database: connessione assente o bloccata da un\'estensione/antivirus/rete (es. ad-blocker). Prova in incognito o da un altro dispositivo. [' + (e.code || e.message) + ']');
      return;
    }
    if (!snap.exists()) { mostra('Utente non trovato.'); return; }
    const email = snap.data().email;
    if (!email) { mostra('Utente senza email associata: contatta l\'amministratore.'); return; }

    // 2) Autenticazione
    await signInWithEmailAndPassword(window.auth, email, pass);
  } catch (e) {
    console.error('Login - autenticazione fallita:', e.code, e.message);
    let msg = 'Accesso non riuscito. [' + (e.code || e.message) + ']';
    if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') msg = 'Username o password errata.';
    if (e.code === 'auth/user-not-found')          msg = 'Utente non trovato.';
    if (e.code === 'auth/user-disabled')           msg = 'Utente disabilitato.';
    if (e.code === 'auth/too-many-requests')       msg = 'Troppi tentativi. Riprova più tardi.';
    if (e.code === 'auth/network-request-failed')  msg = 'Errore di rete: connessione assente o bloccata (ad-blocker/antivirus/rete).';
    if (e.code === 'auth/operation-not-allowed')   msg = 'Accesso con email/password non abilitato in Firebase. [' + e.code + ']';
    if (e.code === 'auth/invalid-api-key' || e.code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.') msg = 'Chiave API Firebase non valida. [' + e.code + ']';
    mostra(msg);
  } finally {
    btn.textContent = 'Accedi'; btn.disabled = false;
  }
}
async function doLogout() { await signOut(window.auth); }
window.doLogin = doLogin;
window.doLogout = doLogout;

// Mostra/nascondi la password nel campo di login
window.togglePass = function () {
  const inp = document.getElementById('loginPass');
  const btn = document.getElementById('pwToggle');
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (btn) {
    btn.textContent = show ? '🙈' : '👁️';
    btn.classList.toggle('on', show);
    btn.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
  }
};

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  const rb = document.getElementById('topRole');
  rb.textContent = currentUser.role;
  rb.className = 'roleBadge ' + currentUser.role;
  document.getElementById('topBarUser').textContent = currentUser.name || currentUser.email;

  // Inizializza i moduli con il contesto condiviso
  const ctx = { getState, getUser };
  initOperativo(ctx);
  initNavetta(ctx);
  initAnagrafiche(ctx);
  initAdmin(ctx);

  // Mostra solo le schede consentite al ruolo
  const role = currentUser.role;
  let firstBtn = null;
  document.querySelectorAll('.navBtn').forEach(btn => {
    const roles = (btn.dataset.roles || '').split(',');
    const visible = roles.includes(role);
    btn.classList.toggle('hidden', !visible);
    if (visible && !firstBtn) firstBtn = btn;
  });

  startListeners();

  // Apre la prima scheda disponibile per il ruolo
  if (firstBtn) showPage(firstBtn.dataset.page, firstBtn);
}
