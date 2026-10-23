

import {
  ref,
  set,
  onValue,
  get,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";


import {
  db,
  loginAnonymously
} from "./firebase-config.js";

const entryScreen = document.getElementById("entry-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const nameInput = document.getElementById("online-name");
const joinNameInput =
  document.getElementById("online-join-name");
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
let stopConnectionListener = null;
let currentPhase = "lobby";
let reconnectNeeded = false;
let connectedOnce = false;
let reconnecting = false;

function showStatus(message) {
  statusText.textContent = message;
}

function setBusy(value) {
  busy = value;
  createButton.disabled = value;
  joinButton.disabled = value;
}

function getPlayerName() {
  const name = onlineIsHost
  ? nameInput.value.trim()
  : joinNameInput.value.trim();

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

  // 接続が切れたときに、自分の参加者情報を削除
  // 登録より先に設定しておく
  await onDisconnect(memberRef).remove();

  // 参加者を登録
  await set(memberRef, {
    name,
    joinedAt: Date.now()
  });

  console.log("参加者登録完了：", name);
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
watchOnlinePhase();
watchOnlineSettings();
watchOnlineConnection();
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
        memberCount.dataset.playerCount =
  String(members.length);
  if (!onlineIsHost && sharedOnlineSettings) {
  renderOnlineGuestSettings(sharedOnlineSettings);
}

if (onlineIsHost) {
  validateOnlineRoles();
}

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

console.log("① 匿名認証開始");
const user = await getUser();
console.log("② 匿名認証成功");

    let roomCode = null;

    // 万一ルーム番号が重複したら再発行
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomRoomCode();

      try {
        console.log("③ データベースに書き込み開始");
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


console.log("④ ルーム作成成功");


await registerMember(roomCode, name, user.uid);

console.log("⑤ 参加者登録成功");

// ルーム作成時の詳細設定を保存
await set(
  ref(db, `rooms/${roomCode}/settings`),
  collectOnlineSettings()
);

showLobby(roomCode);


  } catch (error) {
    showStatus("エラー：" + error.message);
  } finally {
    setBusy(false);
  }
}


async function joinRoom() {
  if (busy) return;

  const name = joinNameInput.value.trim();

  // 名前が未入力の場合
  if (!name) {
    showStatus("名前を入力してください。");
    joinNameInput.focus();
    return;
  }

  if (name.length > 20) {
    showStatus("名前は20文字以内で入力してください。");
    joinNameInput.focus();
    return;
  }

  const roomCode = roomInput.value.trim();

  if (!/^\d{6}$/.test(roomCode)) {
    showStatus("6桁のルーム番号を入力してください。");
    roomInput.focus();
    return;
  }

  setBusy(true);
  showStatus("ルームに参加しています…");

  try {
    const user = await getUser();

    await registerMember(roomCode, name, user.uid);

    showLobby(roomCode);

  } catch (error) {
    console.error("ルーム参加エラー：", error);

    if (error.code === "PERMISSION_DENIED" ||
        error.code === "permission-denied") {
      showStatus(
        "ルームが見つからないか、すでにゲームが始まっています。"
      );
    } else {
      showStatus(
        "参加できませんでした。通信状態を確認して、もう一度お試しください。"
      );
    }
  } finally {
    setBusy(false);
  }
}



// ========================================
// オンライン役職設定・配布
// ========================================

const ONLINE_ROLES = [
  { name: "人狼", description: "毎晩1人を襲撃します。" },
  { name: "狂人", description: "人狼陣営の味方です。" },
  { name: "占い師", description: "毎晩1人を占います。" },
  { name: "騎士", description: "毎晩1人を護衛します。" },
  { name: "霊媒師", description: "処刑された人の正体を調べます。" },
  { name: "てるてる", description: "昼に処刑されると単独勝利します。" },
  { name: "怪盗", description: "最初の夜に役職を交換できます。" }
];

const roleSettingsBox =
  document.getElementById("online-role-settings");
const roleListBox =
  document.getElementById("online-role-list");
const roleRevealBox =
  document.getElementById("online-role-reveal");
const roleErrorBox =
  document.getElementById("online-role-error");
const startGameButton =
  document.getElementById("online-start-game");
const roleMissingInput =
  document.getElementById("online-role-missing");

let onlineIsHost = false;
let onlineRoleStarted = false;
let stopPhaseListener = null;
let stopRoleListener = null;
let stopReadyListener = null;

// 役職設定欄を生成
ONLINE_ROLES.forEach((role, index) => {
  const row = document.createElement("div");
  row.className = "online-role-row";

  const label = document.createElement("label");
  label.textContent = role.name;
  label.htmlFor = `online-role-${index}`;

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "20";
  input.step = "1";
  input.value = index === 0 ? "1" : "0";
  input.id = `online-role-${index}`;
  input.className = "online-role-count";

  input.addEventListener("input", validateOnlineRoles);

  row.append(label, input);
  roleListBox.appendChild(row);
});

roleMissingInput.addEventListener(
  "change",
  validateOnlineRoles
);

function getOnlineRoleCounts() {
  return ONLINE_ROLES.map((_, index) => {
    const value = document.getElementById(
      `online-role-${index}`
    ).value;

    return value.trim() === "" ? NaN : Number(value);
  });
}

function validateOnlineRoles() {
  const counts = getOnlineRoleCounts();

  const total = counts.reduce(
    (sum, count) => sum + count,
    0
  );

  const numberOfPlayers = Number(
    memberCount.dataset.playerCount || 0
  );

  const villagers = numberOfPlayers - total;

  document.getElementById(
    "online-villager-count"
  ).textContent = `村人：${villagers}人`;

  let error = "";

  if (numberOfPlayers < 3 || numberOfPlayers > 20) {
    error = "プレイヤーは3〜20人必要です。";
  } else if (
    counts.some(count =>
      !Number.isInteger(count) || count < 0
    )
  ) {
    error = "役職人数は0以上の整数にしてください。";
  } else if (counts[0] < 1) {
    error = "人狼は最低1人必要です。";
  } else if (villagers < 1) {
    error = "村人を最低1人残してください。";
  } else if (
    counts[0] >= numberOfPlayers - counts[0]
  ) {
    error = "人狼の人数が多すぎます。";
  } else if (counts[5] > 1 || counts[6] > 1) {
    error = "てるてると怪盗は各1人までです。";
  } else if (
    roleMissingInput.checked &&
    counts.slice(1).every(count => count === 0)
  ) {
    error = "役職欠けには人狼以外の特殊役職が必要です。";
  }

  roleErrorBox.textContent = error;
  startGameButton.disabled =
    Boolean(error) || onlineRoleStarted;

  return error;
}

function shuffleOnlineRoles(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);

    const j = random[0] % (i + 1);

    [result[i], result[j]] =
      [result[j], result[i]];
  }

  return result;
}

async function startOnlineRoleGame() {
  if (!currentRoom || !onlineIsHost ||
      onlineRoleStarted) return;

  if (validateOnlineRoles()) return;

  onlineRoleStarted = true;
  startGameButton.disabled = true;

  
try {
  // 入力途中の保存タイマーを止める
  clearTimeout(settingsSaveTimer);

  // 役職配布前に最新の設定を確定する
  await saveOnlineSettings();

  const snapshot = await get(
    ref(db, `rooms/${currentRoom}/members`)
  );


    const members = Object.keys(snapshot.val() || {});
    const counts = getOnlineRoleCounts();

    const roles = [];

    ONLINE_ROLES.forEach((role, index) => {
      for (let i = 0; i < counts[index]; i++) {
        roles.push(role.name);
      }
    });

    while (roles.length < members.length) {
      roles.push("村人");
    }

    if (roles.length !== members.length) {
      throw new Error("参加人数が変更されました。");
    }

    // 役職欠け：特殊役職を1枚村人に置き換える
    if (roleMissingInput.checked) {
      const candidates = roles
        .map((role, index) => ({ role, index }))
        .filter(item =>
          item.role !== "人狼" &&
          item.role !== "村人"
        );

      if (candidates.length === 0) {
        throw new Error("欠ける役職がありません。");
      }

      const random = new Uint32Array(1);
      crypto.getRandomValues(random);

      const choice =
        candidates[random[0] % candidates.length];

      roles[choice.index] = "村人";
    }

    const shuffled = shuffleOnlineRoles(roles);
    const assignments = {};

    members.forEach((uid, index) => {
      assignments[uid] = shuffled[index];
    });

    showStatus("役職を配布しています…");

    // 役職の保存を完了してからゲームを開始
    await set(
      ref(db, `rooms/${currentRoom}/roles`),
      assignments
    );

    await set(
      ref(db, `rooms/${currentRoom}/meta/phase`),
      "firstNight"
    );

    showStatus("役職を配布しました。");

  } catch (error) {
    console.error(error);
    showStatus("配布エラー：" + error.message);
  } finally {
    onlineRoleStarted = false;
    validateOnlineRoles();
  }
}

startGameButton.addEventListener(
  "click",
  startOnlineRoleGame
);

// 自分の役職だけを表示
function showMyOnlineRole(role) {
  const roleName =
    document.getElementById("online-my-role");
  const description =
    document.getElementById("online-my-role-description");

  roleName.textContent = role;

  const found = ONLINE_ROLES.find(
    item => item.name === role
  );

  description.textContent = found
    ? found.description
    : "特殊能力のない村人です。";
}

// 役職確認完了
document.getElementById("online-ready-button")
  .addEventListener("click", async () => {
    if (!currentRoom || !currentUid) return;

    const button =
      document.getElementById("online-ready-button");

    button.disabled = true;

    try {
      await set(
        ref(db,
          `rooms/${currentRoom}/ready/${currentUid}`
        ),
        true
      );

      button.textContent = "確認完了";
    } catch (error) {
      button.disabled = false;
      showStatus("確認エラー：" + error.message);
    }
  });

function watchOnlineReady() {
  if (stopReadyListener) stopReadyListener();

  stopReadyListener = onValue(
    ref(db, `rooms/${currentRoom}/ready`),
    snapshot => {
      const ready = snapshot.val() || {};
      const count = Object.values(ready)
        .filter(Boolean).length;

      document.getElementById(
        "online-ready-count"
      ).textContent = `役職確認済み：${count}人`;

      const button =
        document.getElementById("online-ready-button");

      if (ready[currentUid] === true) {
        button.disabled = true;
        button.textContent = "確認完了";
      }
    }
  );
}

// 現在のフェーズを監視
function watchOnlinePhase() {
  if (stopPhaseListener) stopPhaseListener();

  stopPhaseListener = onValue(
    ref(db, `rooms/${currentRoom}/meta`),
    snapshot => {
      const meta = snapshot.val();

      if (!meta) return;

      onlineIsHost = meta.hostUid === currentUid;
    currentPhase = meta.phase;
      
if (meta.phase === "lobby") {
  roleRevealBox.hidden = true;

  updateOnlineSettingsVisibility();

  if (onlineIsHost) {
    validateOnlineRoles();
  } else {
    renderOnlineGuestSettings(
      sharedOnlineSettings
    );
  }
}


      if (meta.phase === "firstNight") {
        // 待機画面から役職確認画面へ
        document.getElementById(
          "entry-screen"
        ).hidden = true;

        document.getElementById(
          "lobby-screen"
        ).hidden = true;

        roleSettingsBox.hidden = true;
        roleRevealBox.hidden = false;

        if (stopRoleListener) stopRoleListener();

        stopRoleListener = onValue(
          ref(db,
            `rooms/${currentRoom}/roles/${currentUid}`
          ),
          snapshot => {
            if (snapshot.exists()) {
              showMyOnlineRole(snapshot.val());
            }
          },
          error => {
            showStatus("役職取得エラー：" + error.message);
          }
        );

        watchOnlineReady();
      }
    },
    error => {
      showStatus("進行同期エラー：" + error.message);
    }
  );
}


// ========================================
// オンライン設定の共有・同期
// ========================================

const ONLINE_EXTRA_SETTINGS = [
  {
    key: "madmanKnowsWolves",
    id: "online-madman-knows-wolves",
    label: "狂人が人狼を把握できる"
  },
  {
    key: "allowConsecutiveGuard",
    id: "online-consecutive-guard",
    label: "騎士の連続護衛を許可"
  },
  {
    key: "roleMissing",
    id: "online-role-missing",
    label: "役職欠けを有効にする"
  },
  {
    key: "publicVotes",
    id: "online-public-votes",
    label: "投票履歴を公開する"
  },
  {
    key: "randomEvents",
    id: "online-random-events",
    label: "ランダム事件カード"
  }
];

let stopSettingsListener = null;
let settingsSaveTimer = null;
let settingsSavePromise = Promise.resolve();
let sharedOnlineSettings = null;

// 現在の入力欄から設定を読み取る
function collectOnlineSettings() {
  const roleCounts = {};

  ONLINE_ROLES.forEach((role, index) => {
    roleCounts[String(index)] =
      getOnlineRoleCounts()[index];
  });

  const extras = {};

  ONLINE_EXTRA_SETTINGS.forEach(setting => {
    extras[setting.key] =
      document.getElementById(setting.id).checked;
  });

  return {
    roleCounts,
    extras
  };
}


function saveOnlineSettings() {
  // ホストだけが設定を保存
  if (!currentRoom || !onlineIsHost) {
    return Promise.resolve();
  }

  const data = collectOnlineSettings();

  // 未入力や不正な人数は保存しない
  const counts = Object.values(data.roleCounts);

  if (
    counts.some(count =>
      !Number.isInteger(count) ||
      count < 0 ||
      count > 20
    )
  ) {
    return Promise.resolve();
  }

  // ゲーム開始が可能かどうかに関係なく設定を保存
  settingsSavePromise = settingsSavePromise
    .catch(() => {})
    .then(async () => {
      await set(
        ref(db, `rooms/${currentRoom}/settings`),
        data
      );

      console.log("設定保存成功：", data);
    });

  settingsSavePromise.catch(error => {
    console.error("設定保存エラー：", error);
    showStatus(
      "設定を保存できませんでした。通信状態を確認してください。"
    );
  });

  return settingsSavePromise;
}


// 細かい入力操作のたびに通信しない

function scheduleOnlineSettingsSave() {
  clearTimeout(settingsSaveTimer);

  settingsSaveTimer = setTimeout(() => {
    saveOnlineSettings();
  }, 300);
}


// ========================================
// ホストの設定変更をFirebaseに反映
// ========================================

// 役職人数が変更されたとき
document.querySelectorAll(".online-role-count")
  .forEach(input => {
    input.addEventListener("input", () => {
      validateOnlineRoles();
      scheduleOnlineSettingsSave();
    });
  });

// 詳細設定のスイッチが変更されたとき
ONLINE_EXTRA_SETTINGS.forEach(setting => {
  const input = document.getElementById(setting.id);

  input.addEventListener("change", () => {
    validateOnlineRoles();
    scheduleOnlineSettingsSave();
  });
});


// 参加者用の閲覧専用画面を更新
function renderOnlineGuestSettings(settings) {
  const guestRoles =
    document.getElementById("online-guest-role-list");

  const guestExtras =
    document.getElementById("online-guest-extras");

  const villagerText =
    document.getElementById("online-guest-villagers");

  guestRoles.replaceChildren();
  guestExtras.replaceChildren();

  if (!settings ||
      !settings.roleCounts ||
      !settings.extras) {
    villagerText.textContent =
      "ホストの設定を待っています。";
    return;
  }

  const counts = ONLINE_ROLES.map((_, index) =>
    Number(settings.roleCounts[String(index)] ?? 0)
  );

  ONLINE_ROLES.forEach((role, index) => {
    const row = document.createElement("div");
    row.className = "online-readonly-row";

    const name = document.createElement("strong");
    name.textContent = role.name;

    const count = document.createElement("span");
    count.textContent = `${counts[index]}人`;

    row.append(name, count);
    guestRoles.appendChild(row);
  });

  const playerCount =
    Number(memberCount.dataset.playerCount || 0);

  const selectedTotal = counts.reduce(
    (sum, count) => sum + count,
    0
  );

  villagerText.textContent =
    `村人：${Math.max(0, playerCount - selectedTotal)}人`;

  ONLINE_EXTRA_SETTINGS.forEach(setting => {
    const row = document.createElement("div");
    row.className = "online-readonly-row";

    const name = document.createElement("strong");
    name.textContent = setting.label;

    const value = document.createElement("span");
    const enabled = settings.extras[setting.key] === true;

    value.textContent = enabled ? "ON" : "OFF";
    value.className = enabled
      ? "online-setting-on"
      : "online-setting-off";

    row.append(name, value);
    guestExtras.appendChild(row);
  });
}

// 自分がホストか参加者かによって表示を切り替える
function updateOnlineSettingsVisibility() {
  const guestBox =
    document.getElementById("online-guest-settings");

  // 役職配布前だけ表示する
  const inLobby =
    !document.getElementById("lobby-screen").hidden;

  guestBox.hidden = !inLobby || onlineIsHost;

  roleSettingsBox.hidden = !inLobby || !onlineIsHost;
}


function watchOnlineSettings() {
  if (stopSettingsListener) {
    stopSettingsListener();
    stopSettingsListener = null;
  }

  const settingsRef = ref(
    db,
    `rooms/${currentRoom}/settings`
  );

  stopSettingsListener = onValue(
    settingsRef,
    snapshot => {
      sharedOnlineSettings = snapshot.val();

      console.log(
        "設定データを受信：",
        sharedOnlineSettings
      );

      // 参加者側の画面を更新
      if (!onlineIsHost) {
        renderOnlineGuestSettings(
          sharedOnlineSettings
        );
      }
    },
    error => {
      console.error("設定同期エラー：", error);
      showStatus(
        "設定を読み込めませんでした。ページを再読み込みしてください。"
      );
    }
  );
}



/* ========================================
   ルーム作成・参加ボタンの設定
======================================== */

// 新しいルームを作成
createButton.addEventListener("click", createRoom);

// 既存のルームに参加
joinButton.addEventListener("click", joinRoom);

// 招待リンクをコピー
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

// 招待リンクから開いた場合、ルーム番号を自動入力
const invitedRoom =
  new URLSearchParams(location.search).get("room");

if (invitedRoom && /^\d{6}$/.test(invitedRoom)) {
  roomInput.value = invitedRoom;
  switchOnlineEntryScreen("join");
}

// ページを離れたときに監視を解除

window.addEventListener("pagehide", () => {
  if (stopMembersListener) {
    stopMembersListener();
  }

  if (stopPhaseListener) {
    stopPhaseListener();
  }

  if (stopRoleListener) {
    stopRoleListener();
  }

  if (stopReadyListener) {
    stopReadyListener();
  }

  if (stopSettingsListener) {
    stopSettingsListener();
  }

  // Firebaseの接続監視を終了する
  if (stopConnectionListener) {
    stopConnectionListener();
  }
});



// ========================================
// 通信切断・再接続への対応
// ========================================

function watchOnlineConnection() {
  if (stopConnectionListener) {
    stopConnectionListener();
  }

  const connectionRef = ref(
    db,
    ".info/connected"
  );

  stopConnectionListener = onValue(
    connectionRef,
    async snapshot => {
      const connected = snapshot.val() === true;

      if (!connected) {
        if (connectedOnce) {
          reconnectNeeded = true;
          console.log("Firebase接続が切れました");
        }
        return;
      }

      connectedOnce = true;

      // 切断後の再接続だけを処理する
      if (!reconnectNeeded || reconnecting) return;

      // ゲーム開始後は参加者名簿を変更しない
      if (currentPhase !== "lobby") return;

      if (!currentRoom || !currentUid) return;

      reconnecting = true;

      try {
        const name = onlineIsHost
  ? nameInput.value.trim()
  : joinNameInput.value.trim();

        await registerMember(
          currentRoom,
          name,
          currentUid
        );

        reconnectNeeded = false;
        showStatus("ルームに再接続しました。");
        console.log("ルームに再入室しました");

      } catch (error) {
        console.error("再接続エラー：", error);

        showStatus(
          "ルームへの再接続に失敗しました。再度入室してください。"
        );
      } finally {
        reconnecting = false;
      }
    }
  );
}

// ========================================
// ルーム選択画面の切り替え
// ========================================

const onlineMenuScreen =
  document.getElementById("online-menu-screen");

const onlineCreateScreen =
  document.getElementById("online-create-screen");

const onlineJoinScreen =
  document.getElementById("online-join-screen");

function switchOnlineEntryScreen(screen) {
  onlineMenuScreen.hidden = screen !== "menu";
  onlineCreateScreen.hidden = screen !== "create";
  onlineJoinScreen.hidden = screen !== "join";

  // 画面切り替え時に古いエラーを消す
  showStatus("");
}

// 新しいルームを作成
document.getElementById("open-create-room")
  .addEventListener("click", () => {
    switchOnlineEntryScreen("create");
    nameInput.focus();
  });

// ルームに参加
document.getElementById("open-join-room")
  .addEventListener("click", () => {
    switchOnlineEntryScreen("join");
    joinNameInput.focus();
  });

// 戻るボタン
document.getElementById("back-from-create")
  .addEventListener("click", () => {
    switchOnlineEntryScreen("menu");
  });

document.getElementById("back-from-join")
  .addEventListener("click", () => {
    switchOnlineEntryScreen("menu");
  });
