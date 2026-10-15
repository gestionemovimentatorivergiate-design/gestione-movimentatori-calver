// ── firebase-config.js ────────────────────────────────────────────────────────
// Configurazione del progetto Firebase "gestione-movimentatori-calver".
// La apiKey è una chiave client, pubblica per natura: può stare nel repo.
//
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: "AIzaSyB5FGdkTUkhkpjYdcK3H11z7yqeT19cZCk",
  authDomain: "movimentazione-vergiate.firebaseapp.com",
  projectId: "movimentazione-vergiate",
  storageBucket: "movimentazione-vergiate.firebasestorage.app",
  messagingSenderId: "14215181073",
  appId: "1:14215181073:web:9b690340bb57b898a992b0"
};

const app   = initializeApp(firebaseConfig);
window.auth = getAuth(app);
window.db   = getFirestore(app);
