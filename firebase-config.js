
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAwrTWGIyMIyJGBGMF4Qt8h1F7gFUJD7EU",
  authDomain: "werewolf-game-a1c85.firebaseapp.com",
  projectId: "werewolf-game-a1c85",
  storageBucket: "werewolf-game-a1c85.firebasestorage.app",
  messagingSenderId: "251026823752",
  appId: "1:251026823752:web:cecb7e546958af0b40d67d"
};


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export async function loginAnonymously() {
  await auth.authStateReady();

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const result = await signInAnonymously(auth);
  return result.user;
}
