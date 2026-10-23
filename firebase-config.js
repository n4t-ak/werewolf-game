
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
   databaseURL: "https://werewolf-game-a1c85-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "werewolf-game-a1c85",
  storageBucket: "werewolf-game-a1c85.firebasestorage.app",
  messagingSenderId: "251026823752",
  appId: "1:251026823752:web:cecb7e546958af0b40d67d"
};


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);


export async function loginAnonymously() {
  console.log("認証：開始");

  // 既にログインしている場合はそのユーザーを使用
  if (auth.currentUser) {
    console.log("認証：既存ユーザーを使用");
    return auth.currentUser;
  }

  // 匿名ログイン
  console.log("認証：signInAnonymouslyを実行");

  const result = await signInAnonymously(auth);

  console.log("認証：ログイン成功");
  return result.user;
}

