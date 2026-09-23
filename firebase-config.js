// ── firebase-config.js ────────────────────────────────────────────────────────
// Configurazione del progetto Firebase "gestione-movimentatori-calver".
// La apiKey è una chiave client, pubblica per natura: può stare nel repo.
//
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey:            "AIzaSyB5AcDkQ_4sDn3W6d_2weGIApiDR0y4_ig",
  authDomain:        "gestione-movimentatori-calver.firebaseapp.com",
  projectId:         "gestione-movimentatori-calver",
  storageBucket:     "gestione-movimentatori-calver.firebasestorage.app",
  messagingSenderId: "401287586484",
  appId:             "1:401287586484:web:6699682566475a3445ede1",
  measurementId:     "G-BFG8B8RDQB",
};

const app   = initializeApp(firebaseConfig);
window.auth = getAuth(app);
window.db   = getFirestore(app);
