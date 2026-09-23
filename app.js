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
import { initNavetta, renderCoda, renderInCorso } from './modules/navetta.js';
import { initAnagrafiche, renderElementi, renderUbicazioni } from './modules/anagrafiche.js';
import { initAdmin, renderStorico, renderStatistiche, renderUtenti } from './modules/admin.js';

// ── STATO CONDIVISO ─────────────────────────────────────────────────────────
let currentUser = null;
const state = {
  missioni: [],     // pieni: magazzino → linea
  rientri: [],      // vuoti: linea → magazzino
  elementi: [],
  ubicazioni: [],
  history: [],
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
    case 'NuovaMissione': renderNuovaMissione(); break;
    case 'MieMissioni':   renderMieMissioni();   break;
    case 'Coda':          renderCoda();          break;
    case 'InCorso':       renderInCorso();       break;
    case 'Storico':       renderStorico();       break;
    case 'Statistiche':   renderStatistiche();   break;
    case 'Anagrafiche':   renderElementi(); renderUbicazioni(); break;
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

  _unsub.push(onSnapshot(query(collection(db, 'rientri'), orderBy('createdAt', 'desc')),
    snap => { state.rientri = snap.docs.map(d => ({ id: d.id, ...d.data() })); refreshCurrentPage(); },
    err => console.error('Errore rientri:', err)));

  _unsub.push(onSnapshot(query(collection(db, 'elementi'), orderBy('__name__')),
    snap => { state.elementi = snap.docs.map(d => ({ id: d.id, ...d.data() })); refreshCurrentPage(); },
    err => console.error('Errore elementi:', err)));

  _unsub.push(onSnapshot(query(collection(db, 'ubicazioni'), orderBy('__name__')),
    snap => { state.ubicazioni = snap.docs.map(d => ({ id: d.id, ...d.data() })); refreshCurrentPage(); },
    err => console.error('Errore ubicazioni:', err)));

  // Storico e utenti solo per chi ne ha bisogno (amministrativo/amministratore)
  if (isAmm) {
    _unsub.push(onSnapshot(query(collection(db, 'history'), orderBy('ts', 'desc'), limit(300)),
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
  try {
    const snap = await getDoc(doc(window.db, 'usernames', username));
    if (!snap.exists()) { errEl.textContent = 'Utente non trovato.'; errEl.style.display = 'block'; return; }
    await signInWithEmailAndPassword(window.auth, snap.data().email, pass);
  } catch (e) {
    let msg = 'Credenziali non valide.';
    if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') msg = 'Username o password errata.';
    if (e.code === 'auth/user-not-found')          msg = 'Utente non trovato.';
    if (e.code === 'auth/too-many-requests')       msg = 'Troppi tentativi. Riprova più tardi.';
    if (e.code === 'auth/network-request-failed')  msg = 'Errore di rete.';
    errEl.textContent = msg; errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Accedi'; btn.disabled = false;
  }
}
async function doLogout() { await signOut(window.auth); }
window.doLogin = doLogin;
window.doLogout = doLogout;

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
