
import {
  ref,
  set,
  onValue,
  get
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

import {
  db,
  loginAnonymously
} from "./firebase-config.js";

const entryScreen = document.getElementById("entry-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const nameInput = document.getElementById("online-name");
const roomInput = document.getElementById("room-code");
const statusText = document.getElementById("online-status");
const membersBox = document.getElementById("online-members");
const memberCount = document.getElementById("member-count");
const createButton = document.getElementById("create-room");
const joinButton = document.getElementById("join-room");

let currentRoom = null;
let currentUid = null;
let stopMembersListener = null;
let busy = false;

function showStatus(message) {
  statusText.textContent = message;
}

function setBusy(value) {
  busy = value;
  createButton.disabled = value;
  joinButton.disabled = value;
}

function getPlayerName() {
  const name = nameInput.value.trim();

  if (!name || name.length > 20) {
    throw new Error("名前を1〜20文字で入力してください。");
  }

  return name;
}

function randomRoomCode() {
  // 6桁のルーム番号
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);

  return String(100000 + array[0] % 900000);
}

async function getUser() {
  const user = await loginAnonymously();
  currentUid = user.uid;
  return user;
}

function getMemberPath(roomCode, uid) {
  return `rooms/${roomCode}/members/${uid}`;
}

// 自分をルームの参加者として登録する
async function registerMember(roomCode, name, uid) {
  const memberRef = ref(
    db,
    getMemberPath(roomCode, uid)
  );

  await set(memberRef, {
    name,
    joinedAt: Date.now()
  });
}

// ルームに入った後の画面
function showLobby(roomCode) {
  currentRoom = roomCode;

  entryScreen.hidden = true;
  lobbyScreen.hidden = false;

  document.getElementById("display-room-code")
    .textContent = roomCode;

  history.replaceState(
    null,
    "",
    `${location.pathname}?room=${roomCode}`
  );

  showStatus("ルームに接続しました。");

  watchMembers(roomCode);
}

// 参加者一覧をリアルタイム同期する
function watchMembers(roomCode) {
  if (stopMembersListener) {
    stopMembersListener();
    stopMembersListener = null;
  }

  const membersRef = ref(
    db,
    `rooms/${roomCode}/members`
  );

  stopMembersListener = onValue(
    membersRef,
    snapshot => {
      const data = snapshot.val() || {};

      const members = Object.entries(data)
        .sort((a, b) =>
          (a[1].joinedAt || 0) -
          (b[1].joinedAt || 0)
        );

      membersBox.replaceChildren();

      memberCount.textContent =
        `参加者（${members.length}人）`;

      members.forEach(([uid, member]) => {
        const item = document.createElement("div");
        item.className = "online-member";

        const name = document.createElement("strong");
        name.textContent = member.name;

        const mark = document.createElement("span");
        mark.textContent =
          uid === currentUid ? "あなた" : "参加中";

        item.append(name, mark);
        membersBox.appendChild(item);
      });
    },
    error => {
      showStatus(
        "参加者一覧を取得できません：" + error.message
      );
    }
  );
}

// 新しいルームを作成する
async function createRoom() {
  if (busy) return;

  setBusy(true);
  showStatus("ルームを作成しています…");

  try {
    const name = getPlayerName();
    const user = await getUser();

    let roomCode = null;

    // 万一ルーム番号が重複したら再発行
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomRoomCode();

      try {
        await set(
          ref(db, `rooms/${candidate}/meta`),
          {
            hostUid: user.uid,
            phase: "lobby",
            createdAt: Date.now()
          }
        );

        roomCode = candidate;
        break;
      } catch (error) {
        // 番号衝突以外の設定エラーでも失敗しうる
        if (error.code !== "PERMISSION_DENIED" &&
            error.code !== "permission-denied") {
          throw error;
        }
      }
    }

    if (!roomCode) {
      throw new Error(
        "ルームを作成できません。Firebaseのルールを確認してください。"
      );
    }

    await registerMember(roomCode, name, user.uid);

    showLobby(roomCode);

  } catch (error) {
    showStatus("エラー：" + error.message);
  } finally {
    setBusy(false);
  }
}

// 既存のルームへ入室する
async function joinRoom() {
  if (busy) return;

  setBusy(true);
  showStatus("ルームに参加しています…");

  try {
    const name = getPlayerName();
    const roomCode = roomInput.value.trim();

    if (!/^\d{6}$/.test(roomCode)) {
      throw new Error("6桁のルーム番号を入力してください。");
    }

    const user = await getUser();

    // ルール側で存在する待機中ルームだけ許可
    await registerMember(roomCode, name, user.uid);

    showLobby(roomCode);

  } catch (error) {
    showStatus(
      "参加できません。番号・ルームの状態・権限を確認してください。"
    );
    console.error(error);
  } finally {
    setBusy(false);
  }
}

createButton.addEventListener("click", createRoom);
joinButton.addEventListener("click", joinRoom);

// 招待リンクをコピーする
document.getElementById("copy-room-link")
  .addEventListener("click", async () => {
    if (!currentRoom) return;

    const url =
      `${location.origin}${location.pathname}?room=${currentRoom}`;

    try {
      await navigator.clipboard.writeText(url);
      showStatus("招待リンクをコピーしました。");
    } catch {
      showStatus("リンクをコピーできませんでした。");
    }
  });

// 招待リンクから開いた場合はルーム番号を入力済みにする
const invitedRoom =
  new URLSearchParams(location.search).get("room");

if (invitedRoom && /^\d{6}$/.test(invitedRoom)) {
  roomInput.value = invitedRoom;
}

// 使わなくなった監視を終了
window.addEventListener("pagehide", () => {
  if (stopMembersListener) {
    stopMembersListener();
  }
});
