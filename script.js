



let players = [];
let roles = [];
let alive = [];

let currentPlayer = 0;
let firstNightOrder = [];
let pendingThiefSwap = null;
let robbedPlayer = null;
let robberyNoticeShown = false;
let nightCount = 0;
let dayCount = 0;

let discussionTimerId = null;


let nightActions = {};
let nightOrder = [];
let nightIndex = 0;

// 秘密の個人操作画面だけで役職を表示する。受け渡し画面では null にする。
let privateActor = null;
let isNightPhase = false;

let previousExecution = null;
// 各占い師が過去に占ったプレイヤーを記録
let seerHistory = {};


// 詳細設定

let gameSettings = {
  madmanKnowsWolves: false,
  allowConsecutiveGuard: false,
  roleMissing: false,
  publicVotes: false,
  randomEvents: false
};


// 騎士ごとの前夜の護衛先
let knightHistory = {};
// 前回のゲームで設定した役職人数を保存
let lastRoleCounts = [];

let initialRoles = [];
let missingRole = null;
let gameHistory = [];
let discussionMinutes = 3;
let currentEvent = null;

function recordGameEvent(text) {
  gameHistory.push(text);
}

function readExtraSettings() {
  [
    ["roleMissing", "role-missing"],
    ["publicVotes", "public-votes"],
    ["randomEvents", "random-events"]
  ].forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (input) gameSettings[key] = input.checked;
  });
}

// 投票者の一覧を表示する共通処理
function appendVoteDetails() {
  if (!gameSettings.publicVotes) return;

  const heading = document.createElement("h3");
  heading.textContent = "誰が誰に投票したか";
  game.appendChild(heading);

  votes.forEach(vote => {
    const p = document.createElement("p");
    p.textContent =
      `${players[vote.voter]} → ${players[vote.target]}`;
    game.appendChild(p);
  });
}

// 毎朝の事件カード
function drawMorningEvent() {
  discussionMinutes = 3;
  currentEvent = null;

  if (!gameSettings.randomEvents) return;

  const chance = Math.random();

  if (chance < 0.2) {
    discussionMinutes = 2;
    currentEvent = "緊急会議：議論時間が2分になります";
  } else if (chance < 0.4) {
    discussionMinutes = 5;
    currentEvent = "延長会議：議論時間が5分になります";
  } else {
    currentEvent = "平穏な朝：議論時間は通常の3分です";
  }

  recordGameEvent(`${dayCount}日目：${currentEvent}`);
}



// 投票関連
let voteOrder = [];
let voteIndex = 0;
let voteCandidates = [];
let votes = [];
let voteRound = 1;



const roleTypes = [
  {
    id: "werewolf",
    name: "人狼",
    description: "毎晩1人を襲撃する"
  },
  {
    id: "madman",
    name: "狂人",
    description: "人狼陣営の味方をする"
  },
  {
    id: "seer",
    name: "占い師",
    description: "毎晩1人が人狼か占う"
  },
  {
    id: "knight",
    name: "騎士",
    description: "毎晩1人を護衛する"
  },
  {
    id: "medium",
    name: "霊媒師",
    description: "処刑された人の正体を調べる"
  },
  {
    id: "teruteru",
    name: "てるてる",
    description: "昼に処刑されると単独勝利"
  },
  {
    id: "thief",
    name: "怪盗",
    description: "最初の夜に1人と役職交換"
  }
];



// 夜・昼の個人操作画面に役職を表示する（受け渡し画面には表示しない）
function showPrivateRoleBadge() {
  if (!isNightPhase) return;
  if (privateActor === null) return;
  if (!roles[privateActor]) return;

  const badge = document.createElement("div");
  badge.className = "private-role-badge";
  badge.setAttribute("aria-label", "あなたの役職");

  const label = document.createElement("span");
  label.textContent = "あなたの役職";

  const value = document.createElement("strong");
  value.textContent = roles[privateActor];

  badge.append(label, value);
  game.prepend(badge);

  // 最初の夜だけ新役職の説明を表示
  if (nightCount === 0) {
    const role = roles[privateActor];

    const explanations = {
      "てるてる":
        "あなたは第三陣営です。昼の投票で自分が処刑されると単独勝利します。人狼に襲撃されても勝利にはなりません。",

      "怪盗":
        "最初の夜に1人を選び、役職を交換できます。交換しないこともできます。交換は最初の夜の終了時に確定し、交換後に怪盗になった人は交換できません。"
    };

    if (explanations[role]) {
      const description = document.createElement("p");
      description.className = "special-role-description";
      description.textContent = explanations[role];

      badge.insertAdjacentElement("afterend", description);
    }
  }
}


// 画面が切り替わったとき、ふわっと現れるアニメーション
// 子要素の直接の追加・削除のみ監視。テキスト入力中には動かない。
const screenObserver = new MutationObserver(changes => {
  if (!changes.some(change => change.type === "childList")) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (typeof game.animate !== "function") return;

  game.getAnimations().forEach(animation => animation.cancel());
  game.animate(
    [
      { opacity: 0.35, transform: "translateY(13px) scale(0.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ],
    { duration: 330, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
});
screenObserver.observe(game, { childList: true });

// ------------------------------------
// 共通の画面表示
// ------------------------------------

function showScreen(title, message, buttonText, callback) {
  game.replaceChildren();

  const h2 = document.createElement("h2");
  h2.textContent = title;

  const p = document.createElement("p");
  p.textContent = message;

  const button = document.createElement("button");
  button.textContent = buttonText;
  button.onclick = callback;

  game.append(h2, p, button);
  showPrivateRoleBadge();
}

function showRandomWait(title, message) {
  const waitSeconds = Math.floor(Math.random() * 3) + 2;

  game.replaceChildren();

  const h2 = document.createElement("h2");
  h2.textContent = title;

  const p = document.createElement("p");
  p.textContent = message;

  const status = document.createElement("p");
  status.textContent = "夜が明けるまで待機してください。";

  const button = document.createElement("button");
  button.textContent = "確認完了・画面を隠す";
  button.style.display = "none";
  button.onclick = nextNightPlayer;

  game.append(h2, p, status, button);
  showPrivateRoleBadge();

  setTimeout(() => {
    if (!game.contains(button)) return;

    status.textContent = "待機が終了しました。";
    button.style.display = "block";
  }, waitSeconds * 1000);
}

function showChoices(title, message, targets, callback) {
  game.replaceChildren();

  const h2 = document.createElement("h2");
  h2.textContent = title;

  const p = document.createElement("p");
  p.textContent = message;

  const list = document.createElement("div");
  list.className = "choice-list";

  targets.forEach(index => {
    const button = document.createElement("button");
    button.className = "choice-button";
    button.textContent = players[index];

    button.onclick = () => callback(index);

    list.appendChild(button);
  });

  game.append(h2, p, list);
  showPrivateRoleBadge();
}

// ------------------------------------
// 1. プレイヤー数の選択
// ------------------------------------

const initialCount = document.getElementById("count");
const initialMinus = document.getElementById("initial-count-minus");
const initialPlus = document.getElementById("initial-count-plus");

function updateInitialCountButtons() {
  const value = Number(initialCount.value);
  initialMinus.disabled = value <= 3;
  initialPlus.disabled = value >= 20;
}

initialMinus.onclick = () => {
  initialCount.value = Math.max(3, Number(initialCount.value) - 1);
  updateInitialCountButtons();
};

initialPlus.onclick = () => {
  initialCount.value = Math.min(20, Number(initialCount.value) + 1);
  updateInitialCountButtons();
};

initialCount.addEventListener("input", updateInitialCountButtons);
updateInitialCountButtons();

document.getElementById("start").onclick = () => {
  const count = Number(
    document.getElementById("count").value
  );

  if (!Number.isInteger(count) || count < 3 || count > 20) {
    alert("3〜20人で設定してください");
    return;
  }

  showNameForm(count);
};

// ------------------------------------
// 2. プレイヤー名の登録
// ------------------------------------

function showNameForm(count) {
  
game.innerHTML = `
  <h2>プレイヤー登録</h2>
  <p>名前を入力してください（空欄でもOK）</p>
  <p>空欄の場合はプレイヤー番号が自動設定されます。</p>
  <div id="name-inputs"></div>
  <button id="register">次へ</button>
  <button id="back-to-count" class="back-button">
    人数設定に戻る
  </button>
`;


document.getElementById("back-to-count").onclick = () => {
  const inputs = document.querySelectorAll(".name-input");

  players = Array.from(inputs).map(input => input.value.trim());

  showPlayerCountSettings();
};


  const container = document.getElementById("name-inputs");

  for (let i = 0; i < count; i++) {
    const input = document.createElement("input");

    input.type = "text";
    input.placeholder = `プレイヤー ${i + 1}`;
    input.maxLength = 20;
    input.className = "name-input";

    container.appendChild(input);
  }

  document.getElementById("register").onclick = () => {
    const inputs = document.querySelectorAll(".name-input");

   
players = Array.from(inputs).map((input, index) => {
  const name = input.value.trim();

  // 空欄なら自動的に名前を設定
  return name === ""
    ? `プレイヤー${index + 1}`
    : name;
});


    if (new Set(players).size !== players.length) {
      alert("同じ名前は使用できません");
      return;
    }

    showRoleSettings();
  };
}

// ------------------------------------
// 3. 役職の設定
// ------------------------------------

function showRoleSettings() {
  game.innerHTML = `
    <h2>役職設定</h2>
    <p>役職ごとの人数を設定してください</p>
    <div id="role-settings"></div>
    
<details class="advanced-settings">
  <summary>詳細設定</summary>

  <div class="setting-item">
    <div class="setting-description">
      <strong>狂人が人狼を把握できる</strong>
      <p>狂人に人狼の名前を公開します。</p>
    </div>

    <label class="setting-switch">
      <input
        type="checkbox"
        id="madman-knows-wolves"
      >
      <span class="switch-slider"></span>
    </label>
  </div>

  <div class="setting-item">
    <div class="setting-description">
      <strong>騎士の連続護衛を許可</strong>
      <p>前の夜と同じ相手も護衛できます。</p>
    </div>

    <label class="setting-switch">
      <input
        type="checkbox"
        id="consecutive-guard"
      >
      <span class="switch-slider"></span>
    </label>
  </div>

  
<div class="setting-item">
  <div class="setting-description">
    <strong>役職欠けを有効にする</strong>
    <p>役職カードを1枚多く用意し、ランダムに1枚除外します。人狼は必ず残ります。</p>
  </div>
  <label class="setting-switch">
    <input type="checkbox" id="role-missing">
    <span class="switch-slider"></span>
  </label>
</div>

<div class="setting-item">
  <div class="setting-description">
    <strong>投票履歴を公開する</strong>
    <p>投票終了後、誰が誰に投票したかを全員に公開します。</p>
  </div>
  <label class="setting-switch">
    <input type="checkbox" id="public-votes">
    <span class="switch-slider"></span>
  </label>
</div>

<div class="setting-item">
  <div class="setting-description">
    <strong>ランダム事件カード</strong>
    <p>毎朝、確率で議論時間が2分または5分になります。</p>
  </div>
  <label class="setting-switch">
    <input type="checkbox" id="random-events">
    <span class="switch-slider"></span>
  </label>
</div>

</details>

    
<p id="villager-count"></p>
<p id="role-error" class="error-text"></p>
<button id="assign">役職を決定</button>
<button id="back-to-names" class="back-button">
  名前入力に戻る
</button>

  `;


document.getElementById("back-to-names").onclick = () => {
  // 役職人数と詳細設定を保持
  lastRoleCounts = getRoleCounts();

  gameSettings.madmanKnowsWolves =
    document.getElementById("madman-knows-wolves").checked;

  gameSettings.allowConsecutiveGuard =
    document.getElementById("consecutive-guard").checked;

    readExtraSettings();
  showNameForm(players.length);

  // 入力済みの名前を復元
  document.querySelectorAll(".name-input").forEach((input, index) => {
    input.value = players[index] ?? "";
  });
};





  const container = document.getElementById("role-settings");

  roleTypes.forEach((role, index) => {
    const row = document.createElement("div");
    row.className = "role-row";

   
// 役職名と説明文をまとめる
const roleInfo = document.createElement("div");
roleInfo.className = "role-info";

const label = document.createElement("label");
label.className = "role-name";
label.textContent = role.name;
label.htmlFor = role.id;

const description = document.createElement("p");
description.className = "role-description";
description.textContent = role.description;

roleInfo.append(label, description);


    const input = document.createElement("input");
    input.type = "number";
    input.id = role.id;
    input.className = "role-count";
    input.min = "0";
    input.max = String(players.length);
    input.step = "1";
    input.value = lastRoleCounts.length === roleTypes.length
  ? String(lastRoleCounts[index])
  : (index === 0 ? "1" : "0");

    row.append(roleInfo, input);
    container.appendChild(row);

    input.addEventListener("input", updateRoleCount);
  });

 

document.getElementById("assign").onclick = () => assignRoles();

  // 前回の詳細設定を画面に反映
  document.getElementById("madman-knows-wolves").checked =
    gameSettings.madmanKnowsWolves;

  document.getElementById("consecutive-guard").checked =
    gameSettings.allowConsecutiveGuard;


// 狂人が人狼を把握できるか
document.getElementById("madman-knows-wolves")
  .addEventListener("change", event => {
    gameSettings.madmanKnowsWolves =
      event.target.checked;
  });

// 騎士の連続護衛を許可するか
document.getElementById("consecutive-guard")
  .addEventListener("change", event => {
    gameSettings.allowConsecutiveGuard =
      event.target.checked;
  });


// 保存された設定を画面へ反映
[
  ["roleMissing", "role-missing"],
  ["publicVotes", "public-votes"],
  ["randomEvents", "random-events"]
].forEach(([key, id]) => {
  const input = document.getElementById(id);

  input.checked = gameSettings[key];

  
input.addEventListener("change", () => {
  gameSettings[key] = input.checked;
  updateRoleCount();
});

});


updateRoleCount();

}

function getRoleCounts() {
  return roleTypes.map(role => {
    const value = document.getElementById(role.id).value;

    return value.trim() === "" ? NaN : Number(value);
  });
}

function validateRoleCounts(counts) {
  if (counts.some(n => !Number.isInteger(n) || n < 0)) {
    return "役職の人数は0以上の整数にしてください";
  }

  const total = counts.reduce((sum, n) => sum + n, 0);
  const villagers = players.length - total;

  if (counts[0] < 1) {
    return "人狼は最低1人必要です";
  }

  if (villagers < 1) {
    return "村人を最低1人残してください";
  }

  if (counts[0] >= players.length - counts[0]) {
    return "人狼は村人陣営より少なくしてください";
  }

  // てるてる・怪盗は最大1人
  const teruteruIndex = roleTypes.findIndex(
    role => role.id === "teruteru"
  );

  const thiefIndex = roleTypes.findIndex(
    role => role.id === "thief"
  );

  if (counts[teruteruIndex] > 1) {
    return "てるてるは最大1人までです";
  }

  if (counts[thiefIndex] > 1) {
    return "怪盗は最大1人までです";
  }

// 役職欠けONでは、人狼以外の特殊役職が必要
const specialRoleCount = counts
  .slice(1)
  .reduce((sum, n) => sum + n, 0);

if (
  gameSettings.roleMissing &&
  specialRoleCount === 0
) {
  return "役職欠けを使う場合は、人狼以外の役職を1つ以上設定してください";
}


  // すべての条件を満たしたらエラーなし
  return "";
}


function updateRoleCount() {
  const counts = getRoleCounts();

  const total = counts.reduce((sum, n) => sum + n, 0);
  const villagers = players.length - total;

  document.getElementById("villager-count").textContent =
    `村人：${Number.isNaN(villagers) ? "未設定" : villagers}人`;

  const error = validateRoleCounts(counts);

  document.getElementById("role-error").textContent = error;
  document.getElementById("assign").disabled = error !== "";
}

// ------------------------------------
// 4. 役職配布
// ------------------------------------


function assignRoles(savedCounts = null) {
  // 初回は設定画面から取得し、
  // 2回目以降は保存済みの設定を使用
  const counts = savedCounts ?? getRoleCounts();

  const error = validateRoleCounts(counts);

  // 役職の人数設定を保存
  lastRoleCounts = [...counts];


  if (error) {
    alert(error);
    return;
  }

  roles = [];

  roleTypes.forEach((role, index) => {
    for (let i = 0; i < counts[index]; i++) {
      roles.push(role.name);
    }
  });

  while (roles.length < players.length) {
    roles.push("村人");
  }


readExtraSettings();

missingRole = null;

if (gameSettings.roleMissing) {
  // 人狼・村人以外の役職を抽選対象にする
  const removable = roles
    .map((role, index) => ({ role, index }))
    .filter(item =>
      item.role !== "人狼" &&
      item.role !== "村人"
    );

  if (removable.length > 0) {
    // 欠ける役職をランダムに1枚選ぶ
    const choice = removable[
      Math.floor(Math.random() * removable.length)
    ];

    // 欠けた役職を記録
    missingRole = choice.role;

    // 選ばれた特殊役職を村人に置き換える
    roles[choice.index] = "村人";
  }
}



  // シャッフル
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

// シャッフル後の初期役職を保存
initialRoles = [...roles];

// 新しいゲームの履歴を初期化
gameHistory = [];
recordGameEvent("ゲーム開始");

if (gameSettings.roleMissing) {
  recordGameEvent(
    "役職欠けあり（欠けた役職はゲーム終了後に公開）"
  );
}

  alive = players.map(() => true);

  currentPlayer = 0;
  nightCount = 0;
  dayCount = 0;
  previousExecution = null;
    seerHistory = {};
    knightHistory = {};

  
  // 最初の夜の行動を役職確認と同時に行うための準備
  nightActions = {
    attack: null,
    guards: [],
    inspections: [],
    wolfProposals: []
  };

  
nightOrder = players.map((_, index) => index);
nightIndex = 0;
privateActor = null;
isNightPhase = true;

firstNightOrder = players.map((_, index) => index);
pendingThiefSwap = null;
robbedPlayer = null;
robberyNoticeShown = false;

showPassScreen();


}

// ------------------------------------
// 5. 役職確認
// ------------------------------------



function showPassScreen() {
  privateActor = null;

  // 全員が最初の夜の行動を終えた場合
  
if (currentPlayer >= firstNightOrder.length) {
  // 全員が初夜の行動を終えてから交換
  applyThiefSwap();

  resolveNight();
  return;
}


  const index = firstNightOrder[currentPlayer];

  showPlayerPassScreen(
    index,
    "役職と行動を確認",
    () => showNightAction(index)
  );
}



function showMadmanWolfNames() {
  // 現在生存している人狼を取得
  const wolfNames = getLivingWolfNames();

  const message = wolfNames.length > 0
    ? "あなたが協力する人狼を確認してください。"
    : "現在、生存している人狼はいません。";

  showRandomWait(
    "狂人：人狼の確認",
    message
  );

  // 人狼の名前を大きな赤文字で表示
  if (wolfNames.length > 0) {
    const card = document.createElement("div");
    card.className = "madman-wolf-card";

    const label = document.createElement("p");
    label.textContent = "生存している人狼";

    const names = document.createElement("strong");
    names.className = "madman-wolf-names";
    names.textContent = wolfNames.join("、");

    card.append(label, names);

    // 待機メッセージの前に表示
    const status = game.querySelector("h2 + p + p");

    if (status) {
      status.before(card);
    }
  }
}

// 生存している人狼の名前を取得
function getLivingWolfNames() {
  return players
    .map((name, index) => ({ name, index }))
    .filter(player =>
      alive[player.index] &&
      roles[player.index] === "人狼"
    )
    .map(player => player.name);
}


function showRole() {
  isNightPhase = true;
  showNightAction(currentPlayer);
}


function startNight() {
  // 夜の行動データを初期化
  nightActions = {
    attack: null,
    guards: [],
    inspections: [],
    wolfProposals: []
  };

  // 生存しているプレイヤーを行動順に登録
  nightOrder = players
    .map((_, index) => index)
    .filter(index => alive[index]);

  nightIndex = 0;
  privateActor = null;

  // 夜のターンへ移行
  isNightPhase = true;

  showNightPassScreen();
}



function showPlayerPassScreen(index, buttonText, callback) {
  // 受け渡し画面では役職を表示しない
  privateActor = null;

  game.replaceChildren();

  const name = document.createElement("h2");
  name.className = "pass-player-name";
  name.textContent = players[index];

  const message = document.createElement("p");
  message.className = "pass-instruction";
  message.textContent = "さんに端末を渡してください";

  const button = document.createElement("button");
  button.textContent = buttonText;
  button.onclick = callback;

  game.append(name, message, button);
}


function showNightPassScreen() {
  privateActor = null; // 端末受け渡し時には役職を絶対に出さない
  if (nightIndex >= nightOrder.length) {
    resolveNight();
    return;
  }

  const index = nightOrder[nightIndex];

    showPlayerPassScreen(
    index,
    "自分の行動を確認",
    () => showNightAction(index)
  );
}




function showNightAction(index) {
  // 夜の個人行動画面では役職を表示
  isNightPhase = true;

  privateActor = index;
  const role = roles[index];

  
// 役職を盗まれた人に、2回目の夜に通知
if (
  nightCount === 1 &&
  index === robbedPlayer &&
  !robberyNoticeShown
) {
  robberyNoticeShown = true;

  
showScreen(
  "役職変更のお知らせ",
  "あなたは役職を盗まれました。新しい役職は「怪盗」です。",
  "確認完了・画面を隠して次へ",
  nextNightPlayer
);

  // 通知文を赤色で強調
  const message = game.querySelector("h2 + p");

  if (message) {
    message.className = "robbery-notice";

    const warning = document.createElement("strong");
    warning.textContent = "あなたは役職を盗まれました";

    const detail = document.createElement("span");
    detail.textContent = "あなたの新しい役職は";

    const newRole = document.createElement("strong");
    newRole.className = "robbery-new-role";
    newRole.textContent = "怪盗";

    message.replaceChildren(warning, detail, newRole);
  }

  return;
}


  // 最初の夜
  
if (nightCount === 0) {
  if (role === "怪盗") {
    handleThief(index);

  } else if (role === "占い師") {
    handleSeer(index);


    } else if (role === "人狼") {
      // 自分以外の生存人狼を取得
      const teammates = players
        .map((_, i) => i)
        .filter(i =>
          alive[i] &&
          roles[i] === "人狼" &&
          i !== index
        );

      const message = teammates.length > 0
        ? `仲間の人狼：${teammates.map(i => players[i]).join("、")}`
        : "あなた以外に人狼はいません。";

      
showRandomWait(
  "人狼：仲間の確認",
  message
);

// 仲間の名前を大きな赤文字で強調
if (teammates.length > 0) {
  const messageElement = game.querySelector("h2 + p");

  if (messageElement) {
    messageElement.className = "wolf-teammates";

    messageElement.replaceChildren();

    const label = document.createElement("span");
    label.textContent = "仲間の人狼";

    const names = document.createElement("strong");
    names.textContent = teammates
      .map(i => players[i])
      .join("、");

    messageElement.append(label, names);
  }
}


    
} else if (
  role === "狂人" &&
  gameSettings.madmanKnowsWolves
) {
  // 詳細設定がONの狂人
  showMadmanWolfNames();

} else {
  showRandomWait(
    "最初の夜",
    "今夜は行動がありません。"
  );
}


    return;
  }

  // 2回目以降の夜
  if (role === "人狼") {
    handleWerewolf(index);

  } else if (role === "占い師") {
    handleSeer(index);

  } else if (role === "騎士") {
    handleKnight(index);

} else if (role === "霊媒師") {
  handleMedium();

} else if (
  role === "狂人" &&
  gameSettings.madmanKnowsWolves
) {
  // 2回目以降の夜も人狼を確認
  showMadmanWolfNames();

} else {
  showRandomWait(
    "夜のフェーズ",
    "今夜は特殊行動がありません。"
  );
}

}



function getTargets(index, excludeSelf = true) {
  return players
    .map((_, i) => i)
    .filter(i =>
      alive[i] && (!excludeSelf || i !== index)
    );
}


function handleThief(index) {
  const targets = players
    .map((_, i) => i)
    .filter(i => i !== index && alive[i]);

  showChoices(
    "怪盗：役職交換",
    "交換する相手を1人選んでください。役職交換は最初の夜の終了時に確定します。",
    targets,
    target => {
      // この時点では交換先だけを記録
      pendingThiefSwap = {
        thief: index,
        target: target
      };

      // 交換で手に入れる役職
      const stolenRole = roles[target];

      showScreen(
        "怪盗：交換した役職",
        `${players[target]}さんを選びました。`,
        "確認完了・画面を隠して次へ",
        nextNightPlayer
      );

      // 交換した役職を大きく表示
      const roleResult = document.createElement("div");
      roleResult.className = "thief-role-result";

      const roleLabel = document.createElement("p");
      roleLabel.textContent = "交換後のあなたの役職";

      const roleName = document.createElement("strong");
      roleName.className = "thief-stolen-role";
      roleName.textContent = stolenRole;

      roleResult.append(roleLabel, roleName);

      // 確認ボタンの直前に表示
      const confirmButton = game.querySelector("button");

      if (confirmButton) {
        confirmButton.before(roleResult);
      }
    }
  );

  // 交換しない場合
  const skipButton = document.createElement("button");
  skipButton.textContent = "交換しない";
  skipButton.className = "back-button";

skipButton.onclick = () => {
  pendingThiefSwap = null;

  recordGameEvent(
    `怪盗：${players[index]}は交換しなかった`
  );

  showScreen(
    "怪盗：行動終了",
    "今回は役職を交換しませんでした。",
    "確認完了・画面を隠して次へ",
    nextNightPlayer
  );
};

  game.appendChild(skipButton);
}



// 最初の夜の終了時に、一度だけ交換を確定する


function applyThiefSwap() {
  if (pendingThiefSwap === null) {
    return;
  }

  const { thief, target } = pendingThiefSwap;

  // 交換相手が持っていた役職
  const targetRole = roles[target];

  // 実際に役職を交換
  roles[thief] = targetRole;
  roles[target] = "怪盗";

  // 盗まれたプレイヤーを記録
  robbedPlayer = target;
  robberyNoticeShown = false;

  // ゲーム終了後の振り返りに記録
  recordGameEvent(
    `怪盗：${players[thief]}が${players[target]}から「${targetRole}」を盗んだ`
  );

  // 同じ交換を二度実行しない
  pendingThiefSwap = null;
}




// ------------------------------------
// 7. 人狼の襲撃
// ------------------------------------


function handleWerewolf(index) {

  // 生存している人狼を取得
  const wolves = nightOrder.filter(
    i => alive[i] && roles[i] === "人狼"
  );

  // 生存する人狼の人数
  const wolfCount = wolves.length;

  // 最後に行動する人狼か判定
  const wolfPosition = wolves.indexOf(index);
  const isLastWolf = wolfPosition === wolfCount - 1;

  // 人狼が1人だけかどうか
  const isSoloWolf = wolfCount === 1;

  // 人狼以外の生存者を襲撃候補にする
  const targets = players
    .map((_, i) => i)
    .filter(i =>
      alive[i] && roles[i] !== "人狼"
    );

  if (targets.length === 0) {
    showScreen(
      "人狼",
      "襲撃可能なプレイヤーがいません。",
      "確認完了",
      nextNightPlayer
    );
    return;
  }

  game.replaceChildren();

  // 画面タイトル
  const title = document.createElement("h2");

  title.textContent = isLastWolf
    ? "人狼：最終判断"
    : "人狼：仮投票";

  game.appendChild(title);

  // 状況に応じた説明文
  const explanation = document.createElement("p");
  explanation.className = "wolf-explanation";


if (isSoloWolf) {
  // 人狼が1人だけの場合
  explanation.textContent =
    "あなたが襲撃相手を決めます。襲撃したい相手を選択してください。";

} else if (isLastWolf) {
  // 複数人狼のうち、最後に行動する人狼
  explanation.textContent =
    "あなたが襲撃相手を決めます。味方の意見を参考に最終決定を下しましょう。";

} else {
  // 最初・途中に行動する人狼
  explanation.textContent =
    "あなただけでは襲撃相手を決定できません。味方にだれを襲撃したいか意見を示し、協力して襲撃相手を決めましょう。";
}


  game.appendChild(explanation);

  // 仲間の名前
  // 人狼が1人の場合は仲間の表示を省略
  if (!isSoloWolf) {
    const teammates = document.createElement("p");

    teammates.textContent =
      "仲間の人狼：" +
      wolves
        .filter(i => i !== index)
        .map(i => players[i])
        .join("、");

    game.appendChild(teammates);
  }

  // 複数人狼の場合のみ意見交換欄を表示
  if (
    !isSoloWolf &&
    nightActions.wolfProposals.length > 0
  ) {
    const heading = document.createElement("h3");
    heading.textContent = "これまでの投票と意見";
    game.appendChild(heading);

    nightActions.wolfProposals.forEach(proposal => {
      const card = document.createElement("div");
      card.className = "wolf-opinion";

      const name = document.createElement("strong");
      name.textContent = players[proposal.wolf];

      const vote = document.createElement("p");
      vote.textContent =
        `襲撃希望：${players[proposal.target]}`;

      const opinion = document.createElement("p");
      opinion.textContent =
        `意見：${proposal.comment}`;

      card.append(name, vote, opinion);
      game.appendChild(card);
    });
  }


  // 襲撃先をボタンで選択
  const targetLabel = document.createElement("h3");
  targetLabel.textContent = "襲撃先を選択";
  game.appendChild(targetLabel);

  const targetButtons = document.createElement("div");
  targetButtons.className = "wolf-button-list";

  const targetSelect = { value: "" };

  targets.forEach(target => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-choice-button";
    button.textContent = players[target];

    button.onclick = () => {
      targetSelect.value = String(target);

      targetButtons.querySelectorAll("button").forEach(b => {
        b.classList.remove("selected");
      });

      button.classList.add("selected");
    };

    targetButtons.appendChild(button);
  });

  game.appendChild(targetButtons);

  // 襲撃理由をボタンで選択
  let opinionSelect = null;

  // 最後の人狼は襲撃理由を選ぶ必要がない
  if (!isLastWolf) {
    const opinionLabel = document.createElement("h3");
    opinionLabel.textContent = "襲撃したい理由";
    game.appendChild(opinionLabel);

    const opinionButtons = document.createElement("div");
    opinionButtons.className = "wolf-button-list";

    opinionSelect = { value: "" };

    const templates = [
      "占い師の可能性が高い",
      "騎士の可能性が高い",
      "議論を主導している",
      "人狼を疑っている",
      "今後の脅威になりそう",
      "うざい",
      "特に理由はない",
      "ほかの人狼の判断に任せる"
    ];

    templates.forEach(template => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wolf-choice-button";
      button.textContent = template;

      button.onclick = () => {
        opinionSelect.value = template;

        opinionButtons.querySelectorAll("button").forEach(b => {
          b.classList.remove("selected");
        });

        button.classList.add("selected");
      };

      opinionButtons.appendChild(button);
    });

    game.appendChild(opinionButtons);
  }



  // 決定ボタン
  const button = document.createElement("button");

  button.textContent = isLastWolf
    ? "最終襲撃先を決定"
    : "仮投票と意見を送信";

  button.onclick = () => {

    if (targetSelect.value === "") {
      alert("襲撃先を選択してください");
      return;
    }

    const target = Number(targetSelect.value);

    if (!targets.includes(target)) {
      alert("無効な襲撃先です");
      return;
    }

    if (isLastWolf) {

      // 最後の人狼が襲撃先を確定
      // 単独人狼もここで決定する
      nightActions.attack = target;
      
recordGameEvent(
  `${nightCount + 1}回目の夜：人狼が${players[target]}を襲撃先に選択`
);


      showWolfDecision();

    } else {

      if (!opinionSelect.value) {
        alert("意見を選択してください");
        return;
      }

      // 仮投票と意見を保存
      nightActions.wolfProposals.push({
        wolf: index,
        target: target,
        comment: opinionSelect.value
      });

      nextNightPlayer();
    }
  };

  game.appendChild(button);
  showPrivateRoleBadge();
}



// 最後の人狼が襲撃先を決めた後の画面
function showWolfDecision() {
  nextNightPlayer();
}


// ------------------------------------
// 8. 占い師の占い
// ------------------------------------

function handleSeer(index) {

  // この占い師の履歴を用意
  if (!seerHistory[index]) {
    seerHistory[index] = [];
  }

  // 自分・死亡者・過去に占った人を除外
  const targets = getTargets(index).filter(
    target => !seerHistory[index].includes(target)
  );

  // 占える人がいない場合
  if (targets.length === 0) {
    showScreen(
      "占い師",
      "まだ占っていない生存者がいません。",
      "確認完了",
      nextNightPlayer
    );
    return;
  }

  showChoices(
    "占い師：占い",
    "まだ占っていないプレイヤーを選んでください",
    targets,
    target => {

      const isWolf = roles[target] === "人狼";

      // 占い履歴に追加
      
recordGameEvent(
  `${nightCount + 1}回目の夜：${players[index]}が${players[target]}を占い、` +
  `${isWolf ? "人狼" : "人狼ではない"}と判定`
);

      seerHistory[index].push(target);

      nightActions.inspections.push({
        seer: index,
        target: target,
        result: isWolf
      });

      

showScreen(
  "占い結果",
  `${players[target]}さんは${
    isWolf ? "人狼です" : "人狼ではありません"
  }`,
  "確認完了・画面を隠して次へ",
  () => {
    // 確認欄が重複しないようにする
    if (document.getElementById("seer-confirm")) return;

    const box = document.createElement("div");
    box.id = "seer-confirm";
    box.className = "seer-confirm";

    const title = document.createElement("h3");
    title.textContent = "占い結果は確認しましたか？";

    const message = document.createElement("p");
    message.textContent =
      "次に進むと、この結果は再表示できません。";

    const actions = document.createElement("div");
    actions.className = "seer-confirm-actions";

    const cancel = document.createElement("button");
    cancel.textContent = "戻る";
    cancel.className = "seer-confirm-cancel";
    cancel.onclick = () => box.remove();

    const proceed = document.createElement("button");
    proceed.textContent = "確認して次へ";
    proceed.onclick = nextNightPlayer;

    actions.append(cancel, proceed);
    box.append(title, message, actions);
    game.appendChild(box);
  }
);


// 占い結果の文字を強調表示
const resultParagraph = game.querySelector("p");

if (resultParagraph) {
  resultParagraph.className = "seer-result-text";

  const nameText = document.createElement("span");
  nameText.textContent = `${players[target]}さんの判定結果`;

  const roleText = document.createElement("strong");
  roleText.textContent = isWolf
    ? "人狼"
    : "人狼ではありません";

  resultParagraph.replaceChildren(nameText, roleText);
}


    }
  );
}


// ------------------------------------
// 9. 騎士の護衛
// ------------------------------------


function handleKnight(index) {

  // 生存者全員を護衛候補にする
  // 自分自身も護衛可能
  let targets = getTargets(index, false);

  // 前の夜に護衛したプレイヤー
  const previousTarget = knightHistory[index];

  // 連続護衛がOFFの場合
  if (
    !gameSettings.allowConsecutiveGuard &&
    previousTarget !== undefined
  ) {
    targets = targets.filter(
      target => target !== previousTarget
    );
  }

  // 護衛できる相手がいない場合
  if (targets.length === 0) {
    showScreen(
      "騎士：護衛",
      "今夜は護衛できる相手がいません。",
      "確認完了",
      nextNightPlayer
    );
    return;
  }

  const message = gameSettings.allowConsecutiveGuard
    ? "護衛するプレイヤーを選んでください。連続護衛も可能です。"
    : "護衛するプレイヤーを選んでください。前の夜と同じ人は護衛できません。";

  showChoices(
    "騎士：護衛",
    message,
    targets,
    target => {

      // 今夜の護衛先を記録
      
recordGameEvent(
  `${nightCount + 1}回目の夜：${players[index]}が${players[target]}を護衛`
);

      nightActions.guards.push(target);

      // 次の夜のために護衛先を保存
      knightHistory[index] = target;

      nextNightPlayer();
    }
  );
}


// ------------------------------------
// 10. 霊媒師
// ------------------------------------

function handleMedium() {
  if (previousExecution === null) {
    showScreen(
      "霊媒師",
      "まだ処刑された人はいません。",
      "確認完了",
      nextNightPlayer
    );
    return;
  }

  const isWolf = roles[previousExecution] === "人狼";

  showScreen(
    "霊媒結果",
    `${players[previousExecution]}さんは${
      isWolf ? "人狼でした" : "人狼ではありませんでした"
    }`,
    "確認完了・画面を隠す",
    nextNightPlayer
  );
}


function nextNightPlayer() {
  // 最初の夜は役職確認と行動を兼ねる
  if (nightCount === 0) {
    currentPlayer++;
    showPassScreen();
    return;
  }

  // 2回目以降の夜は従来どおり
  nightIndex++;
  showNightPassScreen();
}


// ------------------------------------
// 11. 夜の結果判定
// ------------------------------------

function resolveNight() {
  let victim = null;

  // 最初の夜は犠牲者なし
  if (nightCount > 0) {
    const attack = nightActions.attack;
    const guards = nightActions.guards;

    if (
      attack !== null &&
      !guards.includes(attack)
    ) {
      victim = attack;
      alive[victim] = false;
    }
  }

  nightCount++;

  showMorning(victim);
}

// ------------------------------------
// 12. 朝の結果発表
// ------------------------------------


function showMorning(victim) {
  // 朝になったら役職表示を無効にする
  isNightPhase = false;

  privateActor = null;
  dayCount++;

// 毎朝の事件カードを決定
drawMorningEvent();

recordGameEvent(
  victim === null
    ? `${dayCount}日目の朝：犠牲者なし`
    : `${dayCount}日目の朝：${players[victim]}が襲撃された`
);


  game.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = `${dayCount}日目の朝`;

  const result = document.createElement("p");

  result.textContent = victim === null
    ? "昨夜の犠牲者はいませんでした。"
    : `${players[victim]}さんが襲撃されました。`;

  game.append(title, result);

// 事件カードの表示
if (currentEvent !== null) {
  const eventCard = document.createElement("div");
  eventCard.className = "event-card";

  const eventTitle = document.createElement("strong");
  eventTitle.textContent = "本日の事件カード";

  const eventText = document.createElement("p");
  eventText.textContent = currentEvent;

  eventCard.append(eventTitle, eventText);
  game.appendChild(eventCard);
}

  const heading = document.createElement("h3");
  heading.textContent = "現在の生存者";
  game.appendChild(heading);

  const list = document.createElement("div");
  list.className = "survivor-list";

  players.forEach((name, index) => {
    const item = document.createElement("p");

    item.textContent = alive[index]
      ? `生存：${name}`
      : `脱落：${name}`;

    item.className = alive[index]
      ? "survivor"
      : "eliminated";

    list.appendChild(item);
  });

  game.appendChild(list);

  const winner = checkWinner();

  if (winner !== null) {
    const button = document.createElement("button");
    button.textContent = "結果を確認";
    button.onclick = () => showWinner(winner);
    game.appendChild(button);
    return;
  }

  const button = document.createElement("button");
  button.textContent = "昼の議論へ";
  button.onclick = startDay;

  game.appendChild(button);
}

// ------------------------------------
// 13. 昼の議論
// ------------------------------------


function startDay() {
  clearInterval(discussionTimerId);
  discussionTimerId = null;

  game.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = `${dayCount}日目の昼`;

  const message = document.createElement("p");
  message.textContent =
    "生存者全員で話し合い、人狼だと思う人を探してください。";

  const timerBox = document.createElement("div");
  timerBox.className = "discussion-timer";

  const timerLabel = document.createElement("p");
  timerLabel.textContent = "議論の残り時間";

  const timerDisplay = document.createElement("div");
  timerDisplay.className = "discussion-timer-display";

  // タイマー操作ボタンの入れ物
  const controls = document.createElement("div");
  controls.className = "discussion-timer-controls";

  const addTimeButton = document.createElement("button");
  addTimeButton.textContent = "＋1分";
  addTimeButton.className = "discussion-add-time";

  const pauseButton = document.createElement("button");
  pauseButton.textContent = "一時停止";
  pauseButton.className = "discussion-pause";

  // 初期時間は3分
  let remainingMs = discussionMinutes * 60 * 1000;
  let lastTick = Date.now();
  let isPaused = false;

  function updateTimer() {
    const now = Date.now();

    if (!isPaused && remainingMs > 0) {
      remainingMs = Math.max(0, remainingMs - (now - lastTick));
    }

    lastTick = now;

    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    timerDisplay.textContent =
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`;

    timerDisplay.classList.toggle(
      "time-up",
      remainingSeconds === 0
    );

    if (remainingSeconds === 0) {
      timerLabel.textContent = "時間終了";
      pauseButton.disabled = true;
      clearInterval(discussionTimerId);
      discussionTimerId = null;
    } else {
      timerLabel.textContent = isPaused
        ? "一時停止中"
        : "議論の残り時間";

      pauseButton.disabled = false;
    }
  }

  // タイマーの一時停止・再開
  pauseButton.onclick = () => {
    updateTimer();

    isPaused = !isPaused;
    lastTick = Date.now();

    pauseButton.textContent = isPaused
      ? "再開"
      : "一時停止";

    updateTimer();
  };

  // 残り時間を1分追加
  addTimeButton.onclick = () => {
    updateTimer();

    remainingMs += 60 * 1000;
    lastTick = Date.now();

    // 時間終了後は追加すると再開
    if (discussionTimerId === null) {
      isPaused = false;
      pauseButton.textContent = "一時停止";
      discussionTimerId = setInterval(updateTimer, 250);
    }

    updateTimer();
  };

  controls.append(addTimeButton, pauseButton);
  timerBox.append(timerLabel, timerDisplay, controls);

  const voteButton = document.createElement("button");
  voteButton.textContent = "議論終了・投票開始";
  voteButton.onclick = () => {
    clearInterval(discussionTimerId);
    discussionTimerId = null;
    startVoting();
  };

  const skipButton = document.createElement("button");
  skipButton.textContent = "投票をスキップ";
  skipButton.className = "skip-button";
  skipButton.onclick = () => {
    clearInterval(discussionTimerId);
    discussionTimerId = null;
    skipVoting();
  };

  game.append(
    title,
    message,
    timerBox,
    voteButton,
    skipButton
  );

  updateTimer();
  discussionTimerId = setInterval(updateTimer, 250);
}




function skipVoting() {
  showScreen(
    "投票をスキップしますか？",
    "投票をスキップすると、今日は誰も処刑されません。",
    "スキップを確定する",
    () => {
      previousExecution = null;

      const winner = checkWinner();

      if (winner !== null) {
        showWinner(winner);
      } else {
        showScreen(
          "夜になりました",
          "今日は誰も処刑されませんでした。",
          "夜を開始",
          startNight
        );
      }
    }
  );

  // キャンセルボタンを追加
  const cancelButton = document.createElement("button");
  cancelButton.textContent = "昼の議論に戻る";
  cancelButton.className = "cancel-button";
  cancelButton.onclick = startDay;

  game.appendChild(cancelButton);
}



// ------------------------------------
// 14. 投票開始
// ------------------------------------

function startVoting() {
  voteOrder = players
    .map((_, index) => index)
    .filter(index => alive[index]);

  // 最初は全生存者が候補
  voteCandidates = [...voteOrder];

  voteRound = 1;

  beginVoteRound();
}

function beginVoteRound() {
  voteIndex = 0;
  votes = [];

  const title = voteRound === 1
    ? "投票開始"
    : `再投票（${voteRound}回目）`;

  const message = voteRound === 1
    ? "生存者全員が順番に投票します。"
    : "最多得票で同票だった候補者だけに投票します。";

  showScreen(
    title,
    message,
    "投票を始める",
    showVotePassScreen
  );
}

// ------------------------------------
// 15. 投票者に端末を渡す
// ------------------------------------

function showVotePassScreen() {
  privateActor = null; // 次の投票者へ渡す前に役職を隠す
  if (voteIndex >= voteOrder.length) {
    countVotes();
    return;
  }

  const voter = voteOrder[voteIndex];

    showPlayerPassScreen(
    voter,
    "投票する",
    () => showVoteChoices(voter)
  );
}

// ------------------------------------
// 16. 投票先を選択
// ------------------------------------


function showVoteChoices(voter) {
  privateActor = voter;
  // 自分自身を投票候補から除外
  const targets = voteCandidates.filter(
    index => alive[index] && index !== voter
  );

  // 再投票で投票可能な候補がいない場合
  if (targets.length === 0) {
    showScreen(
      "投票できません",
      "投票可能な候補者がいないため、棄権します。",
      "次へ",
      () => {
        voteIndex++;
        showVotePassScreen();
      }
    );
    return;
  }

  showChoices(
    `${players[voter]}さんの投票`,
    "自分以外のプレイヤーに投票してください",
    targets,
    target => {
      votes.push({
        voter: voter,
        target: target
      });

      
voteIndex++;
showVotePassScreen();

    }
  );
}


// ------------------------------------
// 17. 票数を集計
// ------------------------------------

function countVotes() {
  const results = {};

  voteCandidates.forEach(index => {
    results[index] = 0;
  });

  votes.forEach(vote => {
    results[vote.target]++;
  });

  
// ゲーム終了後の振り返り用に投票を保存
recordGameEvent(
  `${dayCount}日目・${voteRound === 1 ? "通常投票" : "再投票"}：` +
  votes.map(vote =>
    `${players[vote.voter]}→${players[vote.target]}`
  ).join("、")
);

  const maxVotes = Math.max(...Object.values(results));

  const topCandidates = voteCandidates.filter(
    index => results[index] === maxVotes
  );

  // 最多得票者が1人なら、そのプレイヤーを処刑
  if (topCandidates.length === 1) {
    showVoteResults(results, topCandidates[0]);
    return;
  }

  // 通常投票で同票になった場合
  if (voteRound === 1) {
    voteCandidates = topCandidates;
    voteRound = 2;

    showScreen(
      "同票になりました",
      `最多得票者が${topCandidates.length}人います。対象者だけで1回限りの再投票を行います。`,
      "再投票へ",
      beginVoteRound
    );
    appendVoteDetails();

    return;
  }

  // 再投票でも同票なら、処刑せず夜へ進む
  previousExecution = null;
  privateActor = null;
  isNightPhase = false;

  showScreen(
    "再投票も同票になりました",
    "再投票でも決着がつかなかったため、今日は誰も処刑されません。",
    "夜を開始",
    startNight
  );
  appendVoteDetails();
}


// ------------------------------------
// 18. 投票結果と処刑
// ------------------------------------

function showVoteResults(results, executed) {
  privateActor = null;
  // 処刑されたプレイヤーを脱落させる
  alive[executed] = false;

  previousExecution = executed;

  game.replaceChildren();

// 議論画面にも本日の事件を表示
if (currentEvent !== null) {
  const eventText = document.createElement("p");
  eventText.className = "discussion-event";
  eventText.textContent = currentEvent;
  game.appendChild(eventText);
}

  const title = document.createElement("h2");
  title.textContent = "投票結果";

  game.appendChild(title);

  Object.keys(results).forEach(key => {
    const index = Number(key);

    const p = document.createElement("p");
    p.textContent = `${players[index]}：${results[index]}票`;

    game.appendChild(p);
  });

  const result = document.createElement("h3");
  result.textContent =
    `${players[executed]}さんが処刑されました。`;

  game.appendChild(result);
  
recordGameEvent(
  `${dayCount}日目：${players[executed]}が処刑された`
);

// 設定ONなら投票者と投票先を公開
appendVoteDetails();


  const button = document.createElement("button");
  button.textContent = "次へ";

button.onclick = () => {

  // てるてるが処刑された場合は単独勝利
  if (roles[executed] === "てるてる") {
    showWinner("てるてる");
    return;
  }

  const winner = checkWinner();

  if (winner !== null) {
    showWinner(winner);
  } else {
    showScreen(
      "夜になりました",
      "生存者は次の夜を迎えます。",
      "夜を開始",
      startNight
    );
  }
};


  game.appendChild(button);
}

// ------------------------------------
// 19. 勝敗判定
// ------------------------------------

function checkWinner() {
  let wolves = 0;
  let villagers = 0;

  players.forEach((_, index) => {
    if (!alive[index]) {
      return;
    }

    if (roles[index] === "人狼") {
      wolves++;
    } else {
      villagers++;
    }
  });

  // 人狼が全滅
  if (wolves === 0) {
    return "村人陣営";
  }

  // 人狼が村人陣営以上
  if (wolves >= villagers) {
    return "人狼陣営";
  }

  return null;
}

// ------------------------------------
// 20. 勝利画面
// ------------------------------------




function showPlayerCountSettings() {
  privateActor = null;
  isNightPhase = false;

  game.innerHTML = `
    <h2>プレイヤー人数の設定</h2>
    <p>参加人数を選んでください（3〜20人）</p>

    <div class="count-selector">
      <button id="count-minus" class="count-adjust" type="button">−</button>

      <div class="count-display">
        <input
          type="number"
          id="new-player-count"
          min="3"
          max="20"
          value="${players.length || 3}"
        >
        <span>人</span>
      </div>

      <button id="count-plus" class="count-adjust" type="button">＋</button>
    </div>

    <button id="confirm-player-count">次へ</button>
  `;

  const countInput = document.getElementById("new-player-count");
  const minus = document.getElementById("count-minus");
  const plus = document.getElementById("count-plus");

  function updateButtons() {
    const value = Number(countInput.value);
    minus.disabled = value <= 3;
    plus.disabled = value >= 20;
  }

  minus.onclick = () => {
    countInput.value = Math.max(3, Number(countInput.value) - 1);
    updateButtons();
  };

  plus.onclick = () => {
    countInput.value = Math.min(20, Number(countInput.value) + 1);
    updateButtons();
  };

  countInput.addEventListener("input", updateButtons);
  updateButtons();

  document.getElementById("confirm-player-count").onclick = () => {
    const count = Number(countInput.value);

    if (!Number.isInteger(count) || count < 3 || count > 20) {
      alert("人数は3〜20人で設定してください");
      return;
    }

    const previousNames = [...players];

    showNameForm(count);

    document.querySelectorAll(".name-input").forEach((input, index) => {
      input.value = previousNames[index] ?? "";
    });
  };
}


function getReviewRoleClass(role) {
  // 人狼陣営
  if (role === "人狼" || role === "狂人") {
    return "review-team-wolf";
  }

  // 第三陣営
  if (role === "てるてる" || role === "怪盗") {
    return "review-team-third";
  }

  // 村人陣営
  return "review-team-village";
}



function showWinner(winner) {
  privateActor = null;
  isNightPhase = false;

  clearInterval(discussionTimerId);
  discussionTimerId = null;

  game.replaceChildren();

  // 勝利陣営に応じた演出
  const victory = document.createElement("div");
  victory.className = "victory-screen";

  if (winner === "人狼陣営") {
    victory.classList.add("victory-wolf");
  } else if (winner === "てるてる") {
    victory.classList.add("victory-teruteru");
  } else {
    victory.classList.add("victory-village");
  }

  const symbol = document.createElement("div");
  symbol.className = "victory-symbol";
  symbol.textContent =
    winner === "人狼陣営" ? "☾" :
    winner === "てるてる" ? "✦" : "✧";

  const title = document.createElement("h2");
  title.textContent = "ゲーム終了";

  const result = document.createElement("h3");
  result.className = "victory-result";
  result.textContent = `${winner}の勝利！`;

  victory.append(symbol, title, result);
  game.appendChild(victory);

  // 振り返りボタン
  const reviewButton = document.createElement("button");
  reviewButton.textContent = "ゲームを振り返る";
  reviewButton.className = "review-button";

  const reviewPanel = document.createElement("div");
  reviewPanel.className = "review-panel";
  reviewPanel.hidden = true;

  const roleHeading = document.createElement("h3");
  roleHeading.textContent = "全員の役職";
  reviewPanel.appendChild(roleHeading);

  players.forEach((name, index) => {
    const card = document.createElement("div");
    card.className = "review-player";

    const playerName = document.createElement("strong");
    playerName.textContent = name;

   
const initial = document.createElement("div");
initial.className = "review-role-row";

const initialLabel = document.createElement("span");
initialLabel.textContent = "最初の役職";


const initialName = document.createElement("strong");
initialName.className =
  "review-role-name " + getReviewRoleClass(initialRoles[index]);
initialName.textContent = initialRoles[index];


initial.append(initialLabel, initialName);

const finalRole = document.createElement("div");
finalRole.className = "review-role-row";

const finalLabel = document.createElement("span");
finalLabel.textContent = "最終役職";


const finalName = document.createElement("strong");
finalName.className =
  "review-role-name " + getReviewRoleClass(roles[index]);
finalName.textContent = roles[index];


finalRole.append(finalLabel, finalName);


    const status = document.createElement("p");
    status.textContent =
      alive[index] ? "状態：生存" : "状態：脱落";

    card.append(playerName, initial, finalRole, status);
    reviewPanel.appendChild(card);
  });

  // 欠けた役職を発表
  if (gameSettings.roleMissing) {
    const missing = document.createElement("p");
    missing.className = "review-missing";
    missing.textContent =
      `今回欠けていた役職：${missingRole}`;
    reviewPanel.appendChild(missing);
  }

  const historyHeading = document.createElement("h3");
  historyHeading.textContent = "ゲームの進行履歴";
  reviewPanel.appendChild(historyHeading);


gameHistory.forEach(entry => {
  const item = document.createElement("div");
  item.className = "review-history-item";

  // 投票履歴かどうかを判定
  if (entry.includes("通常投票：") ||
      entry.includes("再投票：")) {

    const separator = "：";
    const position = entry.indexOf(separator);

    const heading = document.createElement("strong");
    heading.className = "review-vote-heading";
    heading.textContent = entry.slice(0, position);

    item.appendChild(heading);

    const voteText = entry.slice(position + 1);

    voteText.split("、").forEach(vote => {
      const line = document.createElement("div");
      line.className = "review-vote-line";

      const parts = vote.split("→");

      if (parts.length === 2) {
        const voter = document.createElement("span");
        voter.textContent = parts[0];

        const arrow = document.createElement("span");
        arrow.className = "review-vote-arrow";
        arrow.textContent = "→";

        const target = document.createElement("strong");
        target.className = "review-vote-target";
        target.textContent = parts[1];

        line.append(voter, arrow, target);
      } else {
        line.textContent = vote;
      }

      item.appendChild(line);
    });

  } else {
    item.textContent = entry;
  }

  reviewPanel.appendChild(item);
});


  reviewButton.onclick = () => {
    reviewPanel.hidden = !reviewPanel.hidden;

    reviewButton.textContent = reviewPanel.hidden
      ? "ゲームを振り返る"
      : "振り返りを閉じる";
  };

  game.append(reviewButton, reviewPanel);

  const retryButton = document.createElement("button");
  retryButton.textContent = "設定を引き継いで遊ぶ";
  retryButton.onclick = showRoleSettings;

  const changeButton = document.createElement("button");
  changeButton.textContent = "人数を変更して遊ぶ";
  changeButton.className = "secondary-button";
  changeButton.onclick = showPlayerCountSettings;

  game.append(retryButton, changeButton);
}




