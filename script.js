
const game = document.getElementById("game");

let players = [];
let roles = [];
let alive = [];

let currentPlayer = 0;
let nightCount = 0;
let dayCount = 0;

let nightActions = {};
let nightOrder = [];
let nightIndex = 0;

// 秘密の個人操作画面だけで役職を表示する。受け渡し画面では null にする。
let privateActor = null;

let previousExecution = null;
// 各占い師が過去に占ったプレイヤーを記録
let seerHistory = {};

// 投票関連
let voteOrder = [];
let voteIndex = 0;
let voteCandidates = [];
let votes = [];
let voteRound = 1;
// 第4段階：試合全体の振り返り
let mvMatchLog = [];
let mvInitialRoles = [];
// 怪盗：初夜に予約した交換と、翌夜に表示する本人宛通知
let mvThiefChoices = [];
let mvThiefNotices = {};
let mvMadmanKnowsWolves = false;
// 以前の詳細設定（オフライン）
let mvDetailSettings = {
  allowConsecutiveGuard: false,
  roleMissing: false,
  publicVotes: false,
  randomEvents: false
};
let mvPreviousGuards = {};
let mvDiscussionState = { duration: 180, remaining: 180, running: false, eventText: '' };
let mvDiscussionTimerId = null;
function mvStopDiscussionTimer() {
  if (mvDiscussionTimerId !== null) clearInterval(mvDiscussionTimerId);
  mvDiscussionTimerId = null;
}


const roleTypes = [
  { id: "werewolf", name: "人狼" },
  { id: "seer", name: "占い師" },
  { id: "knight", name: "騎士" },
  { id: "medium", name: "霊媒師" },
  { id: "madman", name: "狂人" },
  { id: "teruteru", name: "てるてる" },
  { id: "thief", name: "怪盗" }
];

// 夜・昼の個人操作画面に役職を表示する（受け渡し画面には表示しない）
function showPrivateRoleBadge() {
  // 端末の受け渡し画面では、役職を表示しない。
  if (privateActor === null || !roles[privateActor]) return;

  const stage = document.createElement('div');
  stage.className = 'mv-private-role-card-stage';
  stage.setAttribute('aria-label', `あなたの役職：${roles[privateActor]}`);

  // 役職名だけを表示する旧バッジは作らず、カード画像を表示する。
  if (window.MVRoleCard) {
    window.MVRoleCard.mount(stage, roles[privateActor], {
      compact: false,
      animate: true
    });
  } else {
    const fallback = document.createElement('strong');
    fallback.textContent = roles[privateActor];
    stage.appendChild(fallback);
  }

  // 見出しの直下へ置く。選択・決定ボタンより上に表示する。
  const heading = game.querySelector('h2');
  if (heading) heading.after(stage);
  else game.prepend(stage);
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


// Stage 9: safe offline recovery. Snapshots contain hidden roles, and are removed on completion.
const MV_SAVE_KEY = 'moonlit-village-offline-save-v1';
let mvRestoring = false;
function mvSaveSafe(point) {
  if (mvRestoring || !players.length || !roles.length) return;
  const permitted = ['firstPass','nightPass','discussion','votePass','voteStart'];
  if (!permitted.includes(point) || privateActor !== null) return;
  try {
    localStorage.setItem(MV_SAVE_KEY, JSON.stringify({
      version:1, savedAt:Date.now(), point,
      state: {players,roles,alive,currentPlayer,nightCount,dayCount,nightActions,
        nightOrder,nightIndex,previousExecution,seerHistory,voteOrder,voteIndex,
        voteCandidates,votes,voteRound,mvMatchLog,mvInitialRoles,
        mvThiefChoices,mvThiefNotices,mvMadmanKnowsWolves,
        mvDetailSettings,mvPreviousGuards,mvDiscussionState}
    }));
  } catch(e) { console.warn('途中復帰の保存に失敗しました',e); }
}
function mvClearSave() { try { localStorage.removeItem(MV_SAVE_KEY); } catch(e) {} }
function mvOfferRecovery() {
  let saved;
  try { saved=JSON.parse(localStorage.getItem(MV_SAVE_KEY)||'null'); } catch(e) { mvClearSave(); }
  if (!saved || saved.version!==1 || !saved.state ||
      !Array.isArray(saved.state.players) || !Array.isArray(saved.state.roles)) return;
  // Do not keep a roster of secret roles on a shared device indefinitely.
  if (Date.now()-saved.savedAt>24*60*60*1000) { mvClearSave(); return; }
  const wrapper=document.createElement('div');wrapper.className='mv-recovery';
  const title=document.createElement('h2');title.textContent='前回のゲームが見つかりました';
  const notice=document.createElement('p');notice.textContent='途中から再開すると、次の人への受け渡し画面から始まります。役職はここでは表示されません。';
  const resume=document.createElement('button');resume.type='button';resume.textContent='途中から再開';
  const fresh=document.createElement('button');fresh.type='button';fresh.textContent='新しく始める（前回の記録を削除）';
  resume.onclick=()=>{
    const st=saved.state;
    try {
      if(st.players.length!==st.roles.length || st.alive.length!==st.players.length) throw Error('保存データが不正です');
      ({players,roles,alive,currentPlayer,nightCount,dayCount,nightActions,nightOrder,
        nightIndex,previousExecution,seerHistory,voteOrder,voteIndex,
        voteCandidates,votes,voteRound,mvMatchLog,mvInitialRoles}=st);
      mvThiefChoices = Array.isArray(st.mvThiefChoices) ? st.mvThiefChoices : [];
      mvThiefNotices = st.mvThiefNotices || {};
      mvMadmanKnowsWolves = st.mvMadmanKnowsWolves === true;
      mvDetailSettings = {allowConsecutiveGuard:false,roleMissing:false,publicVotes:false,randomEvents:false,...st.mvDetailSettings};
      mvPreviousGuards = st.mvPreviousGuards || {};
      mvDiscussionState = st.mvDiscussionState || {duration:180,remaining:180,running:false,eventText:''};
      mvStopDiscussionTimer();
      privateActor=null; mvRestoring=true;
      document.querySelector('.mv-mode-nav')?.setAttribute('hidden','');
      // Recovery only invokes transitions known not to mutate votes or resolve a night twice.
      switch(saved.point) {
        case 'firstPass': showPassScreen(); break;
        case 'nightPass': showNightPassScreen(); break;
        case 'votePass': showVotePassScreen(); break;
        case 'voteStart': beginVoteRound(); break;
        case 'discussion': startDay(); break;
        default: throw Error('不明な保存画面');
      }
    } catch(e) { console.error(e); mvClearSave(); location.reload(); }
    finally { mvRestoring=false; }
  };
  fresh.onclick=()=>{mvClearSave();location.reload();};
  wrapper.append(title,notice,resume,fresh);game.replaceChildren(wrapper);
}
window.addEventListener('DOMContentLoaded', mvOfferRecovery, {once:true});

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
  let clicked = false;
  button.onclick = () => {
    if (clicked) return;
    clicked = true;
    button.disabled = true;
    try { callback(); } catch (error) { clicked=false; button.disabled=false; throw error; }
  };

  game.append(h2, p, button);
  showPrivateRoleBadge();
}

function showRandomWait(title, message) {
  const waitSeconds = Math.floor(Math.random() * 3) + 3;

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
  if (title === "人狼：仲間の確認" && p.textContent.startsWith("仲間の人狼：")) {
    const names = p.textContent.slice("仲間の人狼：".length);
    p.className = 'wolf-teammates';
    p.replaceChildren();
    const label = document.createElement('span');
    label.textContent = '仲間の人狼';
    const strong = document.createElement('strong');
    strong.textContent = names;
    p.append(label, strong);
  }
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
    button.className = "choice-button mv-person-choice";
    button.innerHTML = `<span class="mv-avatar-default" aria-hidden="true"><span class="mv-avatar-head"></span><span class="mv-avatar-body"></span></span><span class="mv-person-name"></span>`;
    button.style.setProperty("--player-color", ["#f2c57f","#80caff","#fb8792","#8ee5ab","#c8a5fc","#ffbb87","#80e2d8","#f2a6cf"][index % 8]);
    button.querySelector(".mv-person-name").textContent = players[index];

    let clicked = false;
    button.onclick = () => {
      if (clicked) return;
      clicked = true;
      button.disabled = true;
      try { callback(index); } catch (error) { clicked=false; button.disabled=false; throw error; }
    };

    list.appendChild(button);
  });

  game.append(h2, p, list);
  showPrivateRoleBadge();
}

// ------------------------------------
// 1. プレイヤー数の選択
// ------------------------------------

function proceedFromPlayerCount() {
  const input = document.getElementById("count");
  const count = Number(input?.value);

  if (!Number.isInteger(count) || count < 3 || count > 20) {
    alert("参加人数は3〜20人の整数で設定してください。");
    input?.focus();
    return;
  }

  const nav = document.querySelector('.mv-mode-nav');
  if (nav) nav.hidden = true;
  showNameForm(count);
}

// JS が読み込まれた時点で、確実にイベントを登録する。
function initializePlayerCountButton() {
  const startButton = document.getElementById("start");
  if (!startButton) return;
  startButton.addEventListener("click", proceedFromPlayerCount, { once: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePlayerCountButton, { once: true });
} else {
  initializePlayerCountButton();
}

// ------------------------------------
// 2. プレイヤー名の登録
// ------------------------------------

function showNameForm(count) {
  game.innerHTML = `
    <h2>プレイヤー登録</h2>
    <p>${count}人の名前を入力してください</p>
    <div id="name-inputs"></div>
    <button id="register">次へ</button>
  `;

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

    players = Array.from(inputs).map((input, index) =>
      input.value.trim() || `プレイヤー${index + 1}`
    );

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
    <fieldset class="mv-extra-settings" style="margin:16px 0;padding:14px;border:1px solid #9d8556;border-radius:12px">
      <legend style="color:#f4ddb0;font-weight:bold">詳細設定</legend>
      <label class="field-label" style="display:block;margin:9px 0"><input id="mv-madman-knows" type="checkbox"> 狂人が人狼の名前を確認できる</label>
      <label class="field-label" style="display:block;margin:9px 0"><input id="mv-consecutive-guard" type="checkbox"> 騎士の連続護衛を許可</label>
      <label class="field-label" style="display:block;margin:9px 0"><input id="mv-role-missing" type="checkbox"> 役職欠けを有効にする</label>
      <label class="field-label" style="display:block;margin:9px 0"><input id="mv-public-votes" type="checkbox"> 投票履歴を公開する</label>
      <label class="field-label" style="display:block;margin:9px 0"><input id="mv-random-events" type="checkbox"> ランダム事件カードを有効にする</label>
      <p style="font-size:12px;margin-top:8px">議論時間は通常3分。事件カードON時は2分・3分・5分のいずれかになります。</p>
    </fieldset>
    <p id="villager-count"></p>
    <p id="role-error" class="error-text"></p>
    <button id="assign">役職を決定</button>
  `;

  const container = document.getElementById("role-settings");

  roleTypes.forEach((role, index) => {
    const row = document.createElement("div");
    row.className = "role-row";

    const label = document.createElement("label");
    label.textContent = role.name;
    label.htmlFor = role.id;

    const input = document.createElement("input");
    input.type = "number";
    input.id = role.id;
    input.className = "role-count";
    input.min = "0";
    input.max = String(players.length);
    input.step = "1";
    input.value = index === 0 ? "1" : "0";

    row.append(label, input);
    container.appendChild(row);

    input.addEventListener("input", updateRoleCount);
  });

  document.getElementById("assign").onclick = assignRoles;
  document.getElementById('mv-role-missing').addEventListener('change',updateRoleCount);

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

  if (document.getElementById('mv-role-missing')?.checked && counts.slice(1).every(n => n === 0)) {
    return "役職欠けを使用するには、人狼以外の特殊役職を1人以上設定してください";
  }

  if (counts[0] < 1) {
    return "人狼は最低1人必要です";
  }

  if (villagers < 1) {
    return "村人を最低1人残してください";
  }

  if (counts[0] >= players.length - counts[0]) {
    return "人狼は村人陣営より少なくしてください";
  }

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

function assignRoles() {
  const counts = getRoleCounts();
  const error = validateRoleCounts(counts);

  if (error) {
    alert(error);
    return;
  }

  mvMadmanKnowsWolves = document.getElementById("mv-madman-knows")?.checked === true;
  mvDetailSettings = {
    allowConsecutiveGuard: document.getElementById('mv-consecutive-guard').checked,
    roleMissing: document.getElementById('mv-role-missing').checked,
    publicVotes: document.getElementById('mv-public-votes').checked,
    randomEvents: document.getElementById('mv-random-events').checked
  };
  mvPreviousGuards = {};
  mvDiscussionState = {duration:180,remaining:180,running:false,eventText:''};
  mvStopDiscussionTimer();
  roles = [];

  roleTypes.forEach((role, index) => {
    for (let i = 0; i < counts[index]; i++) {
      roles.push(role.name);
    }
  });

  while (roles.length < players.length) {
    roles.push("村人");
  }
  // オンライン版と同様、人狼・村人以外の特殊役職1枠を村人に置換。
  if (mvDetailSettings.roleMissing) {
    const options = roles.map((role,i) => role!=='人狼' && role!=='村人' ? i : -1).filter(i => i>=0);
    if (options.length) roles[options[Math.floor(Math.random()*options.length)]]='村人';
  }

  // シャッフル
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  alive = players.map(() => true);

  currentPlayer = 0;
  nightCount = 0;
  dayCount = 0;
  previousExecution = null;
    seerHistory = {};

  // 配役直後に初夜の記録と行動順を初期化する。役職確認と初夜は同じ画面で行う。
  mvInitialRoles = [...roles];
  mvMatchLog = [];
  mvThiefChoices = [];
  mvThiefNotices = {};
  nightActions = { attack: null, guards: [], inspections: [], wolfProposals: [] };
  nightOrder = players.map((_, i) => i).filter(i => alive[i]);
  nightIndex = 0;
  privateActor = null;
  showPassScreen();
}

// ------------------------------------
// 5. 役職確認
// ------------------------------------

function showPassScreen() {
  // 役職を次の人に見せない。最初の夜の行動を終えたらそのまま朝へ。
  privateActor = null;
  if (currentPlayer >= players.length) {
    resolveNight();
    return;
  }
  mvSaveSafe('firstPass');
  showScreen(
    players[currentPlayer],
    `${players[currentPlayer]}さんに端末を渡してください。`,
    "役職確認・最初の夜の行動",
    showRole
  );
}

function showRole() {
  // 1回目の個人画面に役職カードと夜の行動をまとめる。
  nightIndex = currentPlayer;
  showNightAction(currentPlayer);
}

// ------------------------------------
// 6. 夜の開始
// ------------------------------------


function startNight() {
  if (nightCount === 0 && mvInitialRoles.length === 0) {mvInitialRoles = [...roles];mvMatchLog = [];}
  nightActions = {
    attack: null,
    guards: [],
    inspections: [],
    wolfProposals: []
  };

  nightOrder = players
    .map((_, index) => index)
    .filter(index => alive[index]);

  nightIndex = 0;

  if (nightCount === 0) {
    showScreen(
      "最初の夜",
      "今夜、人狼は仲間の名前を確認するだけです。占い師だけが占いを行います。",
      "夜を開始",
      showNightPassScreen
    );
  } else {
    showScreen(
      `${nightCount + 1}回目の夜`,
      "各プレイヤーが順番に行動します。",
      "夜を開始",
      showNightPassScreen
    );
  }
}


function showNightPassScreen() {
  privateActor = null; // 端末受け渡し時には役職を絶対に出さない
  if (nightIndex >= nightOrder.length) {
    resolveNight();
    return;
  }

  const index = nightOrder[nightIndex];
  mvSaveSafe('nightPass');

  showScreen(
    "夜のフェーズ",
    `${players[index]}さんに端末を渡してください`,
    "自分の行動を確認",
    () => showNightAction(index)
  );
}



function showNightAction(index) {
  privateActor = index;
  // 交換された側には翌夜の本人画面でのみ通知する。
  const notice = nightCount > 0 ? mvThiefNotices[index] : null;
  if (notice) {
    delete mvThiefNotices[index];
    showScreen('怪盗による役職交換', `あなたの役職は「${notice}」になりました。`,
      '新しい役職を確認して夜の行動へ', () => showNightAction(index));
    return;
  }
  const role = roles[index];

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

    } else if (role === '狂人') {
      // 狂人は人狼側だが、人狼そのものではない。
      const wolves = players.map((_,i)=>i).filter(i=>alive[i]&&roles[i]==='人狼');
      showRandomWait('狂人：仲間の確認', mvMadmanKnowsWolves
        ? (wolves.length ? `人狼：${wolves.map(i=>players[i]).join('、')}` : '人狼は確認できません。')
        : 'あなたは人狼陣営です。今夜は行動がありません。');
    } else {
      showRandomWait('最初の夜', '今夜は行動がありません。');
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

  } else {
    showRandomWait(
      "夜のフェーズ",
      "今夜は特殊行動がありません。"
    );
  }
}



// 怪盗は初夜に一度だけ交換相手を選ぶ。交換は初夜全員の行動後に確定。
// 操作順で怪盗が特定されないよう、選択後は通常の個人操作と同じ受け渡しへ。
function handleThief(index) {
  if (mvThiefChoices.some(choice=>choice.thief===index)) {
    showRandomWait('最初の夜','今夜の行動は完了しています。');
    return;
  }
  const reserved = new Set(mvThiefChoices.flatMap(c=>[c.thief,c.target]));
  const targets = getTargets(index).filter(i=>!reserved.has(i));
  if (!targets.length) {
    showRandomWait('怪盗','交換できる相手がいません。');
    return;
  }
  showChoices('怪盗：役職交換','役職を交換する相手を1人選んでください。',targets,target=>{
    mvThiefChoices.push({thief:index,target});
    showScreen('交換先を決定','交換は最初の夜が終わると確定します。',
      '画面を隠して次へ',nextNightPlayer);
  });
}

function mvApplyFirstNightThiefSwaps() {
  const used = new Set();
  for (const {thief,target} of mvThiefChoices) {
    if (used.has(thief)||used.has(target)||roles[thief]!=='怪盗'||thief===target) continue;
    const taken=roles[target];
    roles[thief]=taken;
    roles[target]='怪盗';
    mvThiefNotices[thief]=taken;
    mvThiefNotices[target]='怪盗';
    used.add(thief);used.add(target);
  }
  mvThiefChoices=[];
}

function getTargets(index, excludeSelf = true) {
  return players
    .map((_, i) => i)
    .filter(i =>
      alive[i] && (!excludeSelf || i !== index)
    );
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

    teammates.className = 'wolf-teammates';
    const allyLabel = document.createElement('span');
    allyLabel.textContent = '仲間の人狼';
    const allyNames = document.createElement('strong');
    allyNames.textContent = wolves
      .filter(i => i !== index)
      .map(i => players[i])
      .join('、');
    teammates.append(allyLabel, allyNames);
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

  // 襲撃先の選択
  const instruction = document.createElement("p");

  instruction.textContent = isLastWolf
    ? "最終的な襲撃先を選択してください。"
    : "襲撃希望先と意見を選択してください。";

  game.appendChild(instruction);

  const targetSelect = document.createElement("select");
  targetSelect.className = "wolf-select";

  const targetPlaceholder = document.createElement("option");
  targetPlaceholder.value = "";
  targetPlaceholder.textContent = "襲撃先を選択してください";
  targetSelect.appendChild(targetPlaceholder);

  targets.forEach(target => {
    const option = document.createElement("option");
    option.value = String(target);
    option.textContent = players[target];
    targetSelect.appendChild(option);
  });

  game.appendChild(targetSelect);

  // 意見テンプレート
  // 最後の人狼・単独人狼には表示しない
  let opinionSelect = null;

  if (!isLastWolf) {
    const opinionLabel = document.createElement("p");
    opinionLabel.textContent = "襲撃したい理由";

    opinionSelect = document.createElement("select");
    opinionSelect.className = "wolf-select";

    const templates = [
      "占い師の可能性が高い",
      "騎士の可能性が高い",
      "発言が怪しい",
      "議論を主導している",
      "人狼を疑っている",
      "今後の脅威になりそう",
      "特に理由はない",
      "ほかの人狼の判断に任せる"
    ];

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "意見を選択してください";
    opinionSelect.appendChild(placeholder);

    templates.forEach(template => {
      const option = document.createElement("option");
      option.value = template;
      option.textContent = template;
      opinionSelect.appendChild(option);
    });

    game.append(opinionLabel, opinionSelect);
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

      showScreen(
        "仮投票完了",
        "投票と意見を保存しました。",
        "画面を隠して次へ",
        nextNightPlayer
      );
    }
  };

  game.appendChild(button);
  showPrivateRoleBadge();
}



// 最後の人狼が襲撃先を決めた後の画面
function showWolfDecision() {
  showScreen(
    "襲撃先を決定しました",
    "最終的な襲撃先を記録しました。画面を隠してください。",
    "画面を隠して次へ",
    nextNightPlayer
  );
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
        "結果を確認・画面を隠す",
        nextNightPlayer
      );
      // 結果の名前と判定を大きく表示（判定は人狼か否かのみ）。
      const resultCard=document.createElement('div');
      resultCard.className='mv-seer-result';
      if(isWolf) resultCard.classList.add('mv-seer-result--wolf');
      const cap=document.createElement('div');cap.className='mv-seer-caption';cap.textContent='占った相手';
      const person=document.createElement('strong');person.className='mv-seer-person';person.textContent=players[target];
      const label=document.createElement('div');label.className='mv-seer-label';label.textContent='判定結果';
      const verdict=document.createElement('strong');verdict.className='mv-seer-verdict';verdict.textContent=isWolf?'人狼':'人狼ではない';
      resultCard.append(cap,person,label,verdict);
      const actionButton=game.querySelector('button');
      if(actionButton)actionButton.before(resultCard); else game.append(resultCard);
    }
  );
}


// ------------------------------------
// 9. 騎士の護衛
// ------------------------------------

function handleKnight(index) {
  let targets = getTargets(index, false);
  if (!mvDetailSettings.allowConsecutiveGuard && mvPreviousGuards[index] !== undefined) {
    targets = targets.filter(target => target !== mvPreviousGuards[index]);
  }
  if (!targets.length) {
    showScreen('騎士：護衛', '護衛できる相手がいません。', '画面を隠して次へ', nextNightPlayer);
    return;
  }

  showChoices(
    "騎士：護衛",
    "守るプレイヤーを選んでください",
    targets,
    target => {
      nightActions.guards.push(target);
      mvPreviousGuards[index] = target;

      showScreen(
        "護衛先を決定",
        "行動を記録しました。",
        "画面を隠して次へ",
        nextNightPlayer
      );
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
  nightIndex++;
  privateActor = null;
  if (nightCount === 0) {
    currentPlayer = nightIndex;
    showPassScreen();
  } else {
    showNightPassScreen();
  }
}

// ------------------------------------
// 11. 夜の結果判定
// ------------------------------------

function resolveNight() {
  if (nightCount === 0) mvApplyFirstNightThiefSwaps();
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

  mvMatchLog.push({type:"night",day:nightCount,victim:victim, note:victim===null?"犠牲者なし":`${players[victim]}が襲撃されました`});
  showMorning(victim);
}

// ------------------------------------
// 12. 朝の結果発表
// ------------------------------------

function showMorning(victim) {
  privateActor = null;
  dayCount++;

  game.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = `${dayCount}日目の朝`;

  const result = document.createElement("p");

  result.textContent = victim === null
    ? "昨夜の犠牲者はいませんでした。"
    : `${players[victim]}さんが襲撃されました。`;

  game.append(title, result);

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
  privateActor = null;
  mvStopDiscussionTimer();
  // 復元直後は保存されたイベントと残り時間を引き継ぐ。
  if (!mvRestoring) {
    let seconds=180, eventText='平穏な朝：議論は3分';
    if (mvDetailSettings.randomEvents) {
      const roll=Math.random();
      seconds = roll < 0.2 ? 120 : roll < 0.4 ? 300 : 180;
      eventText= seconds===120?'緊急会議：議論は2分':seconds===300?'延長会議：議論は5分':'平穏な朝：議論は3分';
    }
    mvDiscussionState={duration:seconds,remaining:seconds,running:false,eventText};
    mvMatchLog.push({type:'event',day:dayCount,note:eventText});
  }
  mvSaveSafe('discussion');
  showScreen(
    `${dayCount}日目の昼`,
    "生存者全員で話し合い、人狼だと思う人を探してください。",
    "議論終了・投票開始",
    startVoting
  );
  const section=document.createElement('section');
  section.className='mv-discussion-controls';
  section.style.cssText='border:1px solid #96794c;border-radius:12px;padding:14px;margin:14px 0;text-align:center;background:#141b29';
  const event=document.createElement('p');event.textContent=mvDiscussionState.eventText;
  const clock=document.createElement('div');clock.style.cssText='font-size:40px;font-weight:800;color:#f0d293;font-variant-numeric:tabular-nums';
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;justify-content:center';
  const toggle=document.createElement('button');toggle.type='button';toggle.textContent='開始';
  const extend=document.createElement('button');extend.type='button';extend.textContent='＋1分';
  const render=()=>{
    const sec=Math.max(0,Math.ceil(mvDiscussionState.remaining));
    clock.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    toggle.textContent= mvDiscussionState.running?'一時停止':sec?'開始・再開':'時間終了';
    toggle.disabled=sec===0;
  };
  let last=Date.now();
  const tick=()=>{
    const now=Date.now();
    if(mvDiscussionState.running) {
      mvDiscussionState.remaining=Math.max(0,mvDiscussionState.remaining-(now-last)/1000);
      if(mvDiscussionState.remaining===0)mvDiscussionState.running=false;
      render();
    }
    last=now;
  };
  toggle.onclick=()=>{tick();mvDiscussionState.running=!mvDiscussionState.running;last=Date.now();render();mvSaveSafe('discussion');};
  extend.onclick=()=>{tick();mvDiscussionState.remaining+=60;mvDiscussionState.duration+=60;render();mvSaveSafe('discussion');};
  actions.append(toggle,extend);section.append(event,clock,actions);
  game.insertBefore(section,game.lastElementChild);
  render();mvDiscussionTimerId=setInterval(tick,250);
}

// ------------------------------------
// 14. 投票開始
// ------------------------------------

function startVoting() {
  mvStopDiscussionTimer();
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
  privateActor = null;
  mvSaveSafe('voteStart');

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
  mvSaveSafe('votePass');

  showScreen(
    "投票",
    `${players[voter]}さんに端末を渡してください`,
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

      showScreen(
        "投票完了",
        "投票を記録しました。",
        "画面を隠して次へ",
        () => {
          voteIndex++;
          showVotePassScreen();
        }
      );
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

  const maxVotes = Math.max(
    ...Object.values(results)
  );

  const topCandidates = voteCandidates.filter(
    index => results[index] === maxVotes
  );

  // 最多得票者が1人
  if (topCandidates.length === 1) {
    const executed = topCandidates[0];

    showVoteResults(results, executed);
    return;
  }

  // 同票なら候補者を絞って再投票
  voteCandidates = topCandidates;
  voteRound++;

  showScreen(
    "同票になりました",
    `最多得票者が${topCandidates.length}人います。候補者だけで再投票します。`,
    "再投票へ",
    beginVoteRound
  );
}

// ------------------------------------
// 18. 投票結果と処刑
// ------------------------------------

function showVoteResults(results, executed) {
  privateActor = null;
  // 処刑されたプレイヤーを脱落させる
  alive[executed] = false;

  previousExecution = executed;
  mvMatchLog.push({type:"vote",day:dayCount,executed:executed,counts:{...results},votes:votes.map(v=>({...v})),note:`${players[executed]}が処刑されました`});

  game.replaceChildren();

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

  const button = document.createElement("button");
  button.textContent = "次へ";

  button.onclick = () => {
    // てるてるは昼の投票による処刑時のみ単独勝利。
    const winner = roles[executed] === 'てるてる' ? 'てるてる' : checkWinner();

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

function showWinner(winner) {
  mvStopDiscussionTimer();
  privateActor = null;
  mvClearSave();
  game.replaceChildren();
  const root=document.createElement('div');
  root.className='mv-finale';
  root.dataset.winner=winner==='人狼陣営'?'wolf':winner==='てるてる'?'third':'village';
  const hero=document.createElement('header');hero.className='mv-finale-hero';
  const sigil=document.createElement('div');sigil.className='mv-finale-sigil';sigil.textContent=winner==='人狼陣営'?'☾':winner==='てるてる'?'✷':'✦';
  const eyebrow=document.createElement('p');eyebrow.textContent='GAME RESULT · THE LAST REVELATION';
  const heading=document.createElement('h2');heading.textContent=`${winner}の勝利`;
  const subtitle=document.createElement('p');subtitle.textContent=`${players.length}人の物語 · ${dayCount}日間の記録`;
  hero.append(sigil,eyebrow,heading,subtitle);root.append(hero);
  const rolesSection=document.createElement('section');rolesSection.className='mv-finale-panel';
  const rolesTitle=document.createElement('h3');rolesTitle.textContent='全員の役職と結末';rolesSection.append(rolesTitle);
  const grid=document.createElement('div');grid.className='mv-finale-role-grid';
  players.forEach((name,i)=>{
    const item=document.createElement('div');item.className='mv-finale-person';
    const symbol=document.createElement('span');symbol.className='mv-finale-person-mark';
    symbol.textContent=({'人狼':'☾','占い師':'✧','騎士':'⚔','霊媒師':'◇','怪盗':'◈','狂人':'☽','てるてる':'✷','村人':'✦'})[roles[i]]||'✦';
    const info=document.createElement('div');
    const label=document.createElement('strong');label.textContent=name;
    const description=document.createElement('small');
    const before=mvInitialRoles[i]&&mvInitialRoles[i]!==roles[i]?` · 開始時：${mvInitialRoles[i]}`:'';
    description.textContent=`${roles[i]||'不明'}${before}`;info.append(label,description);
    const state=document.createElement('span');state.className='mv-finale-state';state.textContent=alive[i]?'生存':'脱落';
    item.append(symbol,info,state);grid.append(item);
  });rolesSection.append(grid);root.append(rolesSection);
  const logSection=document.createElement('section');logSection.className='mv-finale-panel';
  const logTitle=document.createElement('h3');logTitle.textContent='試合を振り返る';logSection.append(logTitle);
  if(!mvMatchLog.length){const empty=document.createElement('p');empty.textContent='記録はありません。';logSection.append(empty);}
  const days=[...new Set(mvMatchLog.map(x=>x.day))].sort((a,b)=>a-b);
  days.forEach((day,index)=>{
    const details=document.createElement('details');details.className='mv-finale-day';details.open=index===days.length-1;
    const summary=document.createElement('summary');summary.textContent=`${day}日目の出来事`;details.append(summary);
    mvMatchLog.filter(x=>x.day===day).forEach(item=>{
      const line=document.createElement('div');line.className='mv-finale-logline';
      const title=document.createElement('strong');title.textContent=item.type==='night'?'夜明け':item.type==='event'?'事件カード':'投票・処刑';
      const desc=document.createElement('span');desc.textContent=item.note;line.append(title,desc);details.append(line);
      if(item.type==='vote'){
        const score=document.createElement('p');score.className='mv-finale-votes';
        score.textContent=Object.entries(item.counts).map(([id,count])=>`${players[id]}：${count}票`).join(' ／ ');details.append(score);
        const choices=document.createElement('p');choices.className='mv-finale-votes';
        choices.textContent=mvDetailSettings.publicVotes
          ? (item.votes.map(v=>`${players[v.voter]} → ${players[v.target]}`).join(' ／ ')||'個別の投票記録なし')
          : '個別の投票先は非公開設定です';
        details.append(choices);
      }
    });logSection.append(details);
  });root.append(logSection);
  const again=document.createElement('button');again.className='mv-finale-again';again.textContent='↻ 新しいゲームを始める';again.onclick=()=>location.reload();root.append(again);
  game.append(root);
}
