/* オンライン人狼：無料版（ホスト判定方式） */
import { ref, get, set, update, onValue, runTransaction, push } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js';
import { db, loginAnonymously } from './firebase-config.js';
import {validatePlayerCount,getRoundPath,getAliveUids,needsNightAction,checkGameWinner,countCompleted,calculateVotes,applyThiefSwap,getSeerResult,getMediumResult,resolveExecution,resolveNight} from './online-engine.js';

const $ = id => document.getElementById(id);
const MV_ROOM_KEY='moonlit-village-online-room-v1';
function mvStoreRoom(roomCode,displayName){
  try{localStorage.setItem(MV_ROOM_KEY,JSON.stringify({roomCode,displayName,savedAt:Date.now()}));}catch(e){}
}
function mvForgetRoom(){try{localStorage.removeItem(MV_ROOM_KEY);}catch(e){}}

const screens = ['entry-screen','lobby-screen','online-role-reveal','online-night-screen','online-day-screen','online-discussion-screen','online-vote-screen','online-vote-result-screen','online-game-over-screen'];
const roleNames = ['人狼','狂人','占い師','騎士','霊媒師','てるてる','怪盗'];
const extras = [
  ['madmanKnowsWolves','online-madman-knows-wolves','狂人が人狼を把握できる'],
  ['allowConsecutiveGuard','online-consecutive-guard','騎士の連続護衛を許可'],
  ['roleMissing','online-role-missing','役職欠けを有効にする'],
  ['publicVotes','online-public-votes','投票履歴を公開する'],
  ['randomEvents','online-random-events','ランダム事件カード']
];
let room = null, uid = null, data = null, offRoom = null, currentView = '', busy = false;
let offWolfChat = null, wolfChatKey = '';
let entryView = 'menu', timer = null, savedSettings = '', lastRenderedPhase = '';
const roomRef = field => ref(db, field?.startsWith('rooms/') ? field : `rooms/${room}${field ? '/' + field : ''}`);
const roundField = (field, day = data?.meta?.round || 1) => `rounds/${day}${field ? '/' + field : ''}`;
const myRole = () => data?.roles?.[uid] || '';
const host = () => !!uid && data?.meta?.hostUid === uid;
const phase = () => data?.meta?.phase || 'lobby';
const round = () => Number(data?.meta?.round || 1);
const members = () => data?.members || {};
const alive = () => getAliveUids(members(), data?.eliminated || {});
const living = u => alive().includes(u);
const nameOf = u => members()[u]?.name || '不明な参加者';
const setting = k => data?.settings?.extras?.[k] === true;
const thisRound = () => data?.rounds?.[round()] || {};
const notification = txt => { $('online-status').textContent = txt || ''; };
const esc = txt => String(txt ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// プレイヤーの色は参加順に固定（同名でもUIDで識別）
const mvPlayerColors = ['#f2c57f','#80caff','#fb8792','#8ee5ab','#c8a5fc','#ffbb87','#80e2d8','#f2a6cf'];
function mvPlayerColor(playerId){
  const ordered=Object.entries(members()).sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0)||a[0].localeCompare(b[0]));
  const index=ordered.findIndex(([id])=>id===playerId);
  return mvPlayerColors[(index<0?0:index)%mvPlayerColors.length];
}
function mvAvatar(){
  const icon=document.createElement('span');
  icon.className='mv-avatar-default';
  icon.setAttribute('aria-hidden','true');
  const head=document.createElement('span');head.className='mv-avatar-head';
  const body=document.createElement('span');body.className='mv-avatar-body';
  icon.append(head,body);
  return icon;
}
const renderList = (element, rows) => {
  element.replaceChildren();
  for (const row of rows) {
    const el=document.createElement('div');el.className='online-member';
    const a=document.createElement('strong');a.textContent=row[0];
    const b=document.createElement('span');b.textContent=row[1];
    if(element.id==='online-discussion-members'){
      const id=Object.keys(members()).find(candidate=>nameOf(candidate)===row[0]);
      if(id){el.style.setProperty('--player-color',mvPlayerColor(id));el.classList.add('mv-discussion-member');el.append(mvAvatar());}
    }
    el.append(a,b);element.append(el);
  }
};
const setView = id => { for (const screen of screens) {const el=$(screen);if(el)el.hidden=screen!==id;} if(id!==currentView) { currentView=id; if(id==='entry-screen') switchEntry(entryView); } };
const opt = (select, candidates, label='相手を選択してください') => {
  const previous=select.value;
  const present=Array.from(select.options).slice(1).map(o=>o.value);
  const changed=present.length!==candidates.length || present.some((id,i)=>id!==candidates[i]);
  if(changed){
    select.replaceChildren(new Option(label,''));
    for(const id of candidates)select.add(new Option(nameOf(id),id));
    if(candidates.includes(previous))select.value=previous;
  }
};
function renderPlayerCards(selectId, holderId){
  const select=$(selectId), holder=$(holderId);
  if(!select||!holder)return;
  const candidates=Array.from(select.options).filter(o=>o.value);
  const signature=candidates.map(o=>o.value+':'+o.textContent+':'+mvPlayerColor(o.value)).join('|');
  if(holder.dataset.signature!==signature){
    const fragment=document.createDocumentFragment();
    candidates.forEach((option,i)=>{
      const button=document.createElement('button');
      button.type='button'; button.className='mv-target-card';
      button.dataset.target=option.value;
      const icon=mvAvatar();
      const name=document.createElement('span');name.className='mv-target-name';name.textContent=option.textContent;
      button.style.setProperty('--player-color',mvPlayerColor(option.value));
      button.append(icon,name);
      button.addEventListener('click',()=>{
        if(select.disabled)return;
        select.value=option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        syncPlayerCards(selectId,holderId);
      });
      fragment.append(button);
    });
    holder.replaceChildren(fragment);
    holder.dataset.signature=signature;
  }
  syncPlayerCards(selectId,holderId);
}
function syncPlayerCards(selectId,holderId){
  const select=$(selectId),holder=$(holderId);
  if(!select||!holder)return;
  holder.querySelectorAll('.mv-target-card').forEach(b=>{
    const chosen=b.dataset.target===select.value;
    b.classList.toggle('is-selected',chosen);
    b.setAttribute('aria-pressed',String(chosen));
    b.disabled=select.disabled;
  });
}
const randomIndex = n => {const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n;};
const shuffled = a => {const b=[...a];for(let i=b.length-1;i>0;i--){const j=randomIndex(i+1);[b[i],b[j]]=[b[j],b[i]];}return b;};
const voteSkipConfirmModal =
  document.getElementById("vote-skip-confirm-modal");

const cancelVoteSkipButton =
  document.getElementById("cancel-vote-skip");

const confirmVoteSkipButton =
  document.getElementById("confirm-vote-skip");
function switchEntry(section) {
  entryView=section;
  $('online-menu-screen').hidden=section!=='menu';
  $('online-create-screen').hidden=section!=='create';
  $('online-join-screen').hidden=section!=='join';
}
$('open-create-room').onclick=()=>switchEntry('create');
$('open-join-room').onclick=()=>switchEntry('join');
$('back-from-create').onclick=()=>switchEntry('menu');
$('back-from-join').onclick=()=>switchEntry('menu');
const fromUrl = new URLSearchParams(location.search).get('room');
if(fromUrl && /^\d{6}$/.test(fromUrl)) {$('room-code').value=fromUrl;switchEntry('join');}

async function enterRoom(roomCode, nickname, create=false) {
 if(busy)return;busy=true;notification('接続しています…');
 try {
  const me=await loginAnonymously();uid=me.uid;
  room=roomCode;
  updateRoomNavigation();
  if(create){
   const meta={hostUid:uid,phase:'lobby',round:1,createdAt:Date.now()};
   const transaction=await runTransaction(roomRef('meta'),v=>v===null?meta:undefined,{applyLocally:false});
   if(!transaction.committed)throw Error('ルーム番号が重複しました。もう一度作成してください。');
  }else{
   const s=await get(roomRef('meta'));if(!s.exists())throw Error('ルームが見つかりません。');
   const own=await get(roomRef(`members/${uid}`));
   if(s.val().phase!=='lobby'&&!own.exists())throw Error('ゲーム開始後は新規参加できません。');
  }
  const memberRef=roomRef(`members/${uid}`);
  const existing=await get(memberRef);
  if(!existing.exists())await set(memberRef,{name:nickname,joinedAt:Date.now()});
  mvStoreRoom(room,nickname);
  history.replaceState(null,'',`${location.pathname}?room=${room}`);
  if(offRoom)offRoom();
  offRoom=onValue(roomRef(''),snap=>{if(!snap.exists()){notification('ルームが存在しません。');return;}data=snap.val();render();},err=>notification('同期エラー：'+err.message));
  notification('');
 }catch(e){console.error(e);notification('接続に失敗：'+e.message);room=null;updateRoomNavigation();}
 finally{busy=false;}
}
$('create-room').onclick=()=>{const n=$('online-name').value.trim();if(!n||n.length>20){notification('名前を1〜20文字で入力してください。');return;}enterRoom(String(100000+randomIndex(900000)),n,true);};
$('join-room').onclick=()=>{const n=$('online-join-name').value.trim(),c=$('room-code').value.trim();if(!n||n.length>20){notification('名前を1〜20文字で入力してください。');return;}if(!/^\d{6}$/.test(c)){notification('6桁のルーム番号を入力してください。');return;}enterRoom(c,n);};
$('copy-room-link').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);notification('招待リンクをコピーしました。');}catch(e){notification('コピーできませんでした。');}};
// 世界観に合わせた退出確認モーダル。キャンセルはDBを変更しない。
function mvConfirmExit(message) {
  const backdrop=document.getElementById('mv-exit-modal');
  if(!backdrop)return Promise.resolve(false);
  const text=backdrop.querySelector('[data-exit-message]');
  const cancel=backdrop.querySelector('[data-exit-cancel]');
  const approve=backdrop.querySelector('[data-exit-confirm]');
  text.textContent=message;
  backdrop.hidden=false;
  cancel.focus();
  return new Promise(resolve=>{
    let finished=false;
    function finish(yes){if(finished)return;finished=true;backdrop.hidden=true;cancel.removeEventListener('click',no);approve.removeEventListener('click',ok);backdrop.removeEventListener('click',outside);document.removeEventListener('keydown',key);resolve(yes);}
    const no=()=>finish(false),ok=()=>finish(true);
    const outside=e=>{if(e.target===backdrop)no();};
    const key=e=>{if(e.key==='Escape')no();};
    cancel.addEventListener('click',no);approve.addEventListener('click',ok);backdrop.addEventListener('click',outside);document.addEventListener('keydown',key);
  });
}
// ロビーから退出する。ホストは次の参加者へ権限を引き継ぐ。
$('online-leave-room').onclick = async () => {
  if (busy || !room || !uid || phase() !== 'lobby') return;
  const others = Object.keys(members()).filter(id => id !== uid);
  const message = host()
    ? (others.length
      ? 'ルームから退出しますか？ ホスト権限はほかの参加者に引き継がれます。'
      : 'ルームから退出しますか？ 参加者がいないため部屋は解散されます。')
    : 'ルームから退出しますか？';
  if (!(await mvConfirmExit(message))) return;

  const button = $('online-leave-room');
  busy = true;
  button.disabled = true;
  try {
    if (host()) {
      if (others.length) {
        // ホストの書き込み権限で両変更を一括反映する。
        const nextHost = others.sort((a, b) =>
          (members()[a]?.joinedAt || 0) - (members()[b]?.joinedAt || 0)
        )[0];
        await update(roomRef(''), {
          'meta/hostUid': nextHost,
          [`members/${uid}`]: null
        });
      } else {
        await set(roomRef(''), null);
      }
    } else {
      await set(roomRef(`members/${uid}`), null);
    }

    if (offRoom) { offRoom(); offRoom = null; }
    room = null;
    data = null;
    savedSettings = '';
    if (timer) { clearInterval(timer); timer = null; }
    mvForgetRoom();
     history.replaceState(null, '', location.pathname);
    switchEntry('menu');
    setView('entry-screen');
    updateRoomNavigation();
    notification('ルームから退出しました。');
  } catch (error) {
    console.error(error);
    notification('退出できませんでした：' + error.message);
  } finally {
    busy = false;
    button.disabled = false;
  }
};

function updateRoomNavigation() {
  const nav = $('online-mode-nav');
  if (nav) nav.hidden = !!room;
}


// 役職人数・詳細設定
for(const [i,r] of roleNames.entries()){
 const row=document.createElement('div');row.className='online-role-row';const label=document.createElement('label');label.textContent=r;label.htmlFor='online-role-'+i;
 const inp=document.createElement('input');inp.type='number';inp.id='online-role-'+i;inp.className='online-role-count';inp.min='0';inp.max='20';inp.value=i===0?'1':'0';inp.addEventListener('input',()=>{updateRoleValidity();saveSettingsSoon();});row.append(label,inp);$('online-role-list').append(row);
}
for(const [,id] of extras){$(id).addEventListener('change',()=>{updateRoleValidity();saveSettingsSoon();});}
function collectSettings(){return {roleCounts:Object.fromEntries(roleNames.map((_,i)=>[i,Number($('online-role-'+i).value)])),extras:Object.fromEntries(extras.map(([k,id])=>[k,$(id).checked]))};}
function validateSettings(s){const n=Object.keys(members()).length;const counts=roleNames.map((_,i)=>s.roleCounts[i]);const sum=counts.reduce((a,b)=>a+b,0);
 if(!validatePlayerCount(n))return '参加者は3〜20人必要です。';
 if(counts.some(x=>!Number.isInteger(x)||x<0||x>20))return '役職人数は0〜20の整数にしてください。';
 if(counts[0]<1||counts[0]>=n-counts[0])return '人狼の人数を調整してください。';
 if(n-sum<1)return '村人を最低1人残してください。';
 if(counts[5]>1||counts[6]>1)return 'てるてる・怪盗は各1人までです。';
 if(s.extras.roleMissing && counts.slice(1).every(x=>x===0))return '役職欠けには特殊役職が必要です。';return '';
}
function updateRoleValidity(){if(!data)return;const s=collectSettings();const n=Object.keys(members()).length;const cnt=roleNames.reduce((a,_,i)=>a+s.roleCounts[i],0);
 $('online-villager-count').textContent=`村人：${n-cnt}人`;const err=validateSettings(s);$('online-role-error').textContent=err;$('online-start-game').disabled=!!err;}
let saveJob=0;
function saveSettingsSoon(){clearTimeout(saveJob);if(!host()||phase()!=='lobby')return;saveJob=setTimeout(async()=>{try{const s=collectSettings();if(roleNames.some((_,i)=>!Number.isInteger(s.roleCounts[i])))return;await set(roomRef('settings'),s);}catch(e){notification('設定保存：'+e.message);}},350);}
function renderLobby(){setView('lobby-screen');$('online-last-game-review').hidden=!data.lastGame;$('display-room-code').textContent=room;
 const list=Object.entries(members()).sort((a,b)=>a[1].joinedAt-b[1].joinedAt);
 $('member-count').textContent=`参加者（${list.length}人）`;
 renderList($('online-members'),list.map(([id,m])=>[m.name,id===data.meta.hostUid?'ホスト':id===uid?'あなた':'参加中']));
 $('online-role-settings').hidden=!host();$('online-guest-settings').hidden=host();
 if(host()){
  const s=data.settings;
  if(s && savedSettings!==JSON.stringify(s)){
   for(let i=0;i<roleNames.length;i++){$('online-role-'+i).value=s.roleCounts?.[i]??0;}
   for(const [k,id] of extras)$(id).checked=s.extras?.[k]===true;
   savedSettings=JSON.stringify(s);
  }
  updateRoleValidity();
 }else{
  const s=data.settings;
  renderList($('online-guest-role-list'),roleNames.map((r,i)=>[r,`${s?.roleCounts?.[i]||0}人`]));
  const sum=roleNames.reduce((a,_,i)=>a+Number(s?.roleCounts?.[i]||0),0);
  $('online-guest-villagers').textContent=`村人：${Math.max(0,list.length-sum)}人`;
  renderList($('online-guest-extras'),extras.map(([k,,label])=>[label,s?.extras?.[k]?'ON':'OFF']));
 }
}
$('online-start-game').onclick=async()=>{
 if(!host()||phase()!=='lobby')return;const s=collectSettings(),err=validateSettings(s);if(err){notification(err);return;}
 $('online-start-game').disabled=true;
 try{
  const ids=Object.keys(members());let pool=[];
  roleNames.forEach((r,i)=>{for(let j=0;j<s.roleCounts[i];j++)pool.push(r);});
  while(pool.length<ids.length)pool.push('村人');
  if(s.extras.roleMissing){const possible=pool.map((r,i)=>r!=='人狼'&&r!=='村人'?i:-1).filter(i=>i>=0);pool[possible[randomIndex(possible.length)]]='村人';}
  pool=shuffled(pool);const roles={};ids.forEach((id,i)=>roles[id]=pool[i]);
  await update(roomRef(''),{settings:s,roles,initialRoles:roles,'meta/phase':'night'});
 }catch(e){notification('開始エラー：'+e.message);$('online-start-game').disabled=false;}
};

function renderReveal(){setView('online-role-reveal');const r=myRole();$('online-my-role').textContent=r||'確認中';
 if(window.MVRoleCard && r) window.MVRoleCard.mount($('online-tarot-role'),r);
 const details={人狼:'毎晩1人を襲撃する。',狂人:'人狼陣営の味方。',占い師:'毎晩1人を占う。',騎士:'毎晩1人を護衛する。',霊媒師:'前の処刑者が人狼か調べる。',てるてる:'昼に処刑されると単独勝利。',怪盗:'初夜に他人と役職を交換できる。',村人:'議論と投票で人狼を見つける。'};
 $('online-my-role-description').textContent=details[r]||'';
 const ready=data.ready||{};const total=Object.keys(members()).length;const count=Object.values(ready).filter(Boolean).length;
 $('online-ready-count').textContent=`役職確認済み：${count} / ${total}人`;
 const b=$('online-ready-button');b.disabled=ready[uid]===true;b.textContent=b.disabled?'確認完了':'役職を確認しました';
 const go=$('online-go-night');go.hidden=!host();go.disabled=count!==total;
 if(r==='狂人'&&setting('madmanKnowsWolves')){
  const wolves=Object.keys(data.roles||{}).filter(id=>data.roles[id]==='人狼').map(nameOf);
  $('online-my-role-description').textContent+=' 人狼：'+wolves.join('、');
 }
 if(r==='人狼'){$('online-my-role-description').textContent+=' 仲間：'+Object.keys(data.roles||{}).filter(id=>id!==uid&&data.roles[id]==='人狼').map(nameOf).join('、');}
}
$('online-ready-button').onclick=()=>set(roomRef(`ready/${uid}`),true).catch(e=>notification(e.message));
$('online-go-night').onclick=()=>{if(host()&&Object.keys(members()).every(id=>data.ready?.[id]===true))set(roomRef('meta/phase'),'night').catch(e=>notification(e.message));};

function nightTargets(){const r=myRole();let ids=alive();if(r!=='騎士')ids=ids.filter(id=>id!==uid);
 if(r==='人狼')ids=ids.filter(id=>data.roles?.[id]!=='人狼');
 if(r==='騎士'&&!setting('allowConsecutiveGuard')&&round()>2){const prev=data.rounds?.[round()-1]?.nightActions?.[uid]?.targetUid;ids=ids.filter(id=>id!==prev);}
 if(r==='占い師'){
  for(let i=1;i<round();i++){const prev=data.rounds?.[i]?.nightActions?.[uid]?.targetUid; if(prev)ids=ids.filter(id=>id!==prev);}
 }
 return ids;
}

// 狼チャットは独立したwolfChats配下に保存（一般参加者のrooms権限とは分離）。
// 狂人は「人狼把握」設定がONのときだけ閲覧・発言できる。
let mvDayChatMode = 'public';
function mvWolfChatEligible() {
 if (!uid || !room || !members()[uid]) return false;
 // 脱落者は人狼専用チャットも閲覧できる（送信はできない）。
 if (!living(uid)) return true;
 const role = myRole();
 const authorized = role === '人狼' || (role === '狂人' && setting('madmanKnowsWolves'));
 if (!authorized) return false;
 const teammates = Object.keys(data?.roles || {}).filter(id =>
  living(id) && (data.roles[id] === '人狼' ||
   (data.roles[id] === '狂人' && setting('madmanKnowsWolves'))));
 return teammates.length >= 2;
}
function mvSyncDayChatTabs() {
 const tabs=$('mv-day-chat-tabs');
 const wolfPanel=$('online-wolf-chat-panel');
 const regularMessages=$('online-chat-messages');
 const regularForm=$('online-chat-form');
 const regularNotice=$('online-chat-notice');
 if(!tabs||!wolfPanel)return;
 const isDay=phase()==='discussion';
 const allowed=isDay&&mvWolfChatEligible();
 tabs.hidden=!allowed;
 if(!allowed)mvDayChatMode='public';
 const wolfMode=allowed&&mvDayChatMode==='wolf';
 for(const id of ['mv-chat-tab-public','mv-chat-tab-wolf']){
  const b=$(id);if(!b)continue;
  const current=(id==='mv-chat-tab-wolf')===wolfMode;
  b.classList.toggle('is-current',current);
  b.setAttribute('aria-selected',String(current));
 }
 if(isDay){
  regularMessages.hidden=wolfMode;
  regularForm.hidden=wolfMode || !living(uid);
  regularNotice.hidden=wolfMode;
  wolfPanel.hidden=!wolfMode;
 }
}
$('mv-chat-tab-public')?.addEventListener('click',()=>{mvDayChatMode='public';mvSyncDayChatTabs();});
$('mv-chat-tab-wolf')?.addEventListener('click',()=>{mvDayChatMode='wolf';mvSyncDayChatTabs();});
function stopWolfChat(){
 if(offWolfChat){offWolfChat();offWolfChat=null;}
 wolfChatKey='';
 const panel=$('online-wolf-chat-panel');if(panel)panel.hidden=true;
}
function renderWolfChat(){
 const panel=$('online-wolf-chat-panel');if(!panel)return;
 const inActivePhase=phase()==='night'||phase()==='discussion';
 if(!inActivePhase||!mvWolfChatEligible()){stopWolfChat();mvSyncDayChatTabs();return;}
 // 夜は夜画面に、昼は議論チャット内に、同一のチャットを移動する。
 const destination=phase()==='night' ? $('mv-night-wolf-chat-slot') : $('mv-day-wolf-chat-slot');
 if(destination && panel.parentElement!==destination)destination.append(panel);
 panel.hidden=phase()==='discussion' && mvDayChatMode!=='wolf';
 const key=`${room}/${round()}`;
 if(wolfChatKey===key && offWolfChat){mvSyncDayChatTabs();return;}
 stopWolfChat();wolfChatKey=key;
 panel.hidden=phase()==='discussion' && mvDayChatMode!=='wolf';
 const holder=$('online-wolf-chat-messages');holder.replaceChildren();
 const note=$('online-wolf-chat-notice');
 const ghost=!living(uid);
 const form=$('online-wolf-chat-form');
 if(form)form.hidden=ghost;
 const send=$('online-wolf-chat-send');
 if(send)send.disabled=ghost;
 note.textContent=ghost?'脱落者は閲覧のみ可能です。送信はできません。':'人狼陣営の参加資格がある生存者だけが発言できます。';
 offWolfChat=onValue(ref(db,`wolfChats/${key}`),snapshot=>{
  if(wolfChatKey!==key)return;
  const entries=Object.entries(snapshot.val()||{}).filter(([,v])=>v&&typeof v.text==='string'&&members()[v.uid]);
  entries.sort((a,b)=>(a[1].at||0)-(b[1].at||0)||a[0].localeCompare(b[0]));
  const nearBottom=holder.scrollHeight-holder.scrollTop-holder.clientHeight<85;
  holder.replaceChildren();
  for(const [,v] of entries){
   const message=document.createElement('div');message.className='mv-chat-entry';
   if(v.uid===uid)message.classList.add('is-mine');
   message.style.setProperty('--player-color',mvPlayerColor(v.uid));
   const wrap=document.createElement('div');wrap.className='mv-chat-content';
   const name=document.createElement('strong');name.className='online-chat-author';name.textContent=nameOf(v.uid);
   const bubble=document.createElement('div');bubble.className='online-chat-bubble';
   const text=document.createElement('p');text.textContent=v.text;bubble.append(text);
   wrap.append(name,bubble);message.append(mvAvatar(),wrap);holder.append(message);
  }
  if(!entries.length){const empty=document.createElement('p');empty.className='online-chat-empty';empty.textContent='まだ相談メッセージはありません。';holder.append(empty);}
  if(nearBottom)holder.scrollTop=holder.scrollHeight;
 },err=>{note.textContent='チャット取得エラー：'+err.message+'（Firebase Rulesを確認してください）';});
 mvSyncDayChatTabs();
}
$('online-wolf-chat-form')?.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!room||!uid||!['night','discussion'].includes(phase())||!mvWolfChatEligible())return;
 const input=$('online-wolf-chat-input'),submit=$('online-wolf-chat-send'),message=input.value.trim();
 if(!message||message.length>300||submit.disabled)return;
 submit.disabled=true;
 try{await push(ref(db,`wolfChats/${room}/${round()}`),{uid,text:message,at:Date.now()});input.value='';}
 catch(e){$('online-wolf-chat-notice').textContent='送信エラー：'+e.message+'（Firebase Rulesを確認してください）';}
 finally{submit.disabled=false;}
});

function mvShowSeerResult(element, person, verdict){
 const wolf=verdict==='人狼';
 element.replaceChildren(); element.classList.add('mv-seer-result');
 element.classList.toggle('mv-seer-result--wolf',wolf);
 const title=document.createElement('div'); title.className='mv-seer-caption';title.textContent='占い結果';
 const name=document.createElement('strong');name.className='mv-seer-person';name.textContent=person;
 const label=document.createElement('div');label.className='mv-seer-label';label.textContent='判定';
 const result=document.createElement('strong');result.className='mv-seer-verdict';result.textContent=wolf?'人狼':'人狼ではない';
 element.append(title,name,label,result);
}
function renderNight(){setView('online-night-screen');$('online-night-title').textContent=round()===1?'初夜':`${round()}日目の夜`;
 const r=myRole(),rn=thisRound(),done=rn.nightDone||{},act=rn.nightActions?.[uid];const needs=living(uid)&&needsNightAction(r,round());
 $('online-night-role').textContent='';
 if(window.MVRoleCard && living(uid) && r) window.MVRoleCard.mount($('online-night-tarot'),r,{animate:true});
 else $('online-night-tarot').replaceChildren();
 renderWolfChat();
 let msg=round()===1?'あなたの役職を確認し、最初の夜の行動を行ってください。':'夜の行動を終えてください。';
 if(!living(uid))msg='あなたは脱落しています。生存者の夜明けを待ちます。';
 else if(r==='人狼')msg=round()===1?'最初の夜は襲撃しません。仲間の人狼を確認してください。':'襲撃する相手を選んでください。';
 else if(r==='占い師')msg='占う相手を選んでください。';
 else if(r==='騎士')msg='護衛する相手を選んでください。自分も護衛できます。';
 else if(r==='怪盗'&&round()===1)msg='交換する相手を選ぶか、交換せずに終了してください。';
 else if(r==='霊媒師'&&round()>1){const prev=data.rounds?.[round()-1]?.voteResult?.targetUid;msg=prev?`前日処刑された${nameOf(prev)}は、${getMediumResult(data.roles,prev)}です。`:'昨日は処刑者がいませんでした。';}
 $('online-night-message').textContent=msg;
 const friends=$('online-night-wolf-friends');
 if(friends){const ids=Object.keys(data.roles||{}).filter(id=>id!==uid&&data.roles[id]==='人狼');const show=living(uid)&&round()===1&&(r==='人狼'||(r==='狂人'&&setting('madmanKnowsWolves')));friends.hidden=!show;friends.textContent=show?(ids.length?`仲間の人狼：${ids.map(nameOf).join('、')}`:'人狼の仲間はいません。'):'';}

 const targets=nightTargets();opt($('online-night-target'),targets);
 const actionArea=$('online-night-action-area');actionArea.hidden=!needs||!!done[uid]||!!act;
 $('online-night-target').disabled=targets.length===0;
 $('online-submit-night').disabled=targets.length===0;
 renderPlayerCards('online-night-target','mv-night-candidates');
 $('online-night-skip').hidden=!(r==='怪盗'&&round()===1&&living(uid)&&!done[uid]&&!act) && !(needs&&targets.length===0&&!act&&!done[uid]);
 $('online-night-done').hidden=!living(uid)||!!done[uid]||needs&&!act;
 $('online-night-result').textContent=done[uid]?'完了しました。他の参加者を待っています。':act?'行動を送信しました。':' ';
 const reveal=$('online-seer-result-now');
 if(reveal){const target=act?.targetUid;const show=r==='占い師'&&living(uid)&&!!target;reveal.hidden=!show;if(show)mvShowSeerResult(reveal,nameOf(target),getSeerResult(data.roles||{},target));}
 $('online-night-done').textContent=r==='占い師'&&act&&!done[uid]?'占い結果を確認して夜の行動を完了':'夜の行動を完了する';
 const previousPrivate=data.rounds?.[round()-1]?.privateResults?.[uid];
 if(previousPrivate?.text && round()>1 && (previousPrivate.type==='seer'||previousPrivate.type==='thief'||previousPrivate.type==='stolen')) $('online-night-result').textContent=previousPrivate.text+'　'+$('online-night-result').textContent;
 const status=countCompleted(done,alive());$('online-night-done-count').textContent=`夜の行動完了：${status.completed} / ${status.total}人`;
 $('online-go-day').hidden=!host();$('online-go-day').disabled=!status.allDone;
}
$('online-submit-night').onclick=async()=>{
 if(!living(uid)||phase()!=='night')return;const r=myRole(),target=$('online-night-target').value;if(!nightTargets().includes(target))return notification('相手を選択してください。');
 try{await set(roomRef(roundField(`nightActions/${uid}`)),{role:r,targetUid:target,at:Date.now()});if(r!=='占い師')await set(roomRef(roundField(`nightDone/${uid}`)),true);else {const box=$('online-seer-result-now');if(box){box.hidden=false;mvShowSeerResult(box,nameOf(target),getSeerResult(data.roles||{},target));} $('online-night-action-area').hidden=true;$('online-night-done').hidden=false;}}catch(e){notification('夜の送信：'+e.message);}
};
$('online-night-done').onclick=async()=>{if(!living(uid)||needsNightAction(myRole(),round())&&!thisRound().nightActions?.[uid])return;try{await set(roomRef(roundField(`nightDone/${uid}`)),true);}catch(e){notification('完了通知：'+e.message);}};
$('online-night-skip').onclick=async()=>{if(!living(uid))return;try{await set(roomRef(roundField(`nightActions/${uid}`)),{role:myRole(),targetUid:'',skip:true,at:Date.now()});await set(roomRef(roundField(`nightDone/${uid}`)),true);}catch(e){notification('行動スキップ：'+e.message);}};
async function resolveMorning(){
 if(!host()||phase()!=='night')return;const r=round(),state=thisRound();if(!countCompleted(state.nightDone||{},alive()).allDone)return notification('生存者の夜の完了を待っています。');
 const original=data.roles||{},actions=state.nightActions||{};
 const privateResults={},patch={};let roles={...original};
 for(const [id,role] of Object.entries(original)){
  if(role==='占い師'&&living(id)&&actions[id]?.targetUid)privateResults[id]={type:'seer',text:`${nameOf(actions[id].targetUid)}は「${getSeerResult(original,actions[id].targetUid)}」です。`};
 }
 if(r===1){const thief=Object.keys(original).find(id=>original[id]==='怪盗');const target=actions[thief]?.targetUid;
  if(thief&&target&&living(thief)&&living(target)){
   const swapped=applyThiefSwap(original,thief,target);roles=swapped.roles;
   privateResults[thief]={type:'thief',text:`交換した役職：${swapped.stolenRole}。${nameOf(target)}と交換しました。`};
   privateResults[target]={type:'stolen',text:'怪盗に役職を交換されました。現在の役職は怪盗です。'};
  }
 }
 const order=Object.entries(actions).filter(([id,a])=>original[id]==='人狼'&&a?.targetUid).sort((a,b)=>(a[1].at||0)-(b[1].at||0)).map(([id])=>id);
 const night=resolveNight(r,roles,actions,data.eliminated||{},order);
 const eventOptions=setting('randomEvents')?['緊急会議：議論は2分','延長会議：議論は5分','平穏な朝：議論は3分']:['議論は3分'];
 const roll=Math.random();const event=setting('randomEvents')?(roll<0.2?0:roll<0.4?1:2):0;
 const minutes=event===0&&setting('randomEvents')?2:event===1&&setting('randomEvents')?5:3;
 patch[roundField('nightResult',r)]={victimUid:night.victimUid||'',guarded:night.guarded,eventText:eventOptions[event],minutes};
 patch[roundField('privateResults',r)]=privateResults;
 if(r===1)patch.roles=roles;
 if(night.victimUid)patch[`eliminated/${night.victimUid}`]=true;
 if(night.winner){patch['meta/winner']=night.winner;patch['meta/phase']='gameOver';}
 else patch['meta/phase']='day';
 await update(roomRef(''),patch);
}
$('online-go-day').onclick=async()=>{try{$('online-go-day').disabled=true;await resolveMorning();}catch(e){notification('朝への移行：'+e.message);$('online-go-day').disabled=false;}};

function renderDay(){setView('online-day-screen');$('online-day-title').textContent=`${round()}日目の朝`;const result=thisRound().nightResult;
 $('online-day-notice').textContent=result?.victimUid?`${nameOf(result.victimUid)}が襲撃されました。`: '昨夜の犠牲者はいませんでした。';
 $('online-day-notice').textContent+=' '+(result?.eventText||'');
 const personal=thisRound().privateResults?.[uid]?.text;
 $('online-private-result').classList.remove('mv-seer-result','mv-seer-result--wolf');$('online-private-result').textContent=personal||'';
 if(thisRound().privateResults?.[uid]?.type==='seer'){const target=thisRound().nightActions?.[uid]?.targetUid;if(target)mvShowSeerResult($('online-private-result'),nameOf(target),getSeerResult(data.initialRoles||data.roles||{},target));}
 renderList($('online-day-members'),Object.keys(members()).map(id=>[nameOf(id),living(id)?'生存':'脱落']));
 $('online-start-discussion').hidden=!host();
}
$('online-start-discussion').onclick=async()=>{if(!host()||phase()!=='day')return;try{await update(roomRef(''),{[`rounds/${round()}/discussionStartedAt`]:Date.now(),[`rounds/${round()}/discussionTimerControls`]:{paused:false,pausedAt:0,pausedMs:0,extraMs:0},'meta/phase':'discussion'});}catch(e){notification('議論開始：'+e.message);}};
function discussionLeft(){const r=thisRound(),base=(r.nightResult?.minutes||3)*60000,c=r.discussionTimerControls||{};const now=c.paused?c.pausedAt||Date.now():Date.now();const elapsed=Math.max(0,now-(r.discussionStartedAt||now)-(c.pausedMs||0));return Math.max(0,base+(c.extraMs||0)-elapsed);}
function renderTimer(){if(phase()!=='discussion')return;const sec=Math.ceil(discussionLeft()/1000);$('online-discussion-timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function renderDiscussionChat(){
 const holder=$('online-chat-messages');if(!holder)return;
 const chat=thisRound().chat||{};
 const records=Object.entries(chat).filter(([,m])=>m&&typeof m.text==='string'&&members()[m.uid]);
 records.sort((a,b)=>(a[1].at||0)-(b[1].at||0)||a[0].localeCompare(b[0]));
 const signature=records.map(([id,m])=>id+':'+m.uid+':'+m.text).join('|');
 if(holder.dataset.signature!==signature){
   const stickToBottom=holder.scrollHeight-holder.scrollTop-holder.clientHeight<75;
   holder.replaceChildren();
   if(!records.length){const empty=document.createElement('p');empty.className='online-chat-empty';empty.textContent='まだ発言がありません。';holder.append(empty);}
   for(const [,msg] of records){
     const item=document.createElement('div');item.className='mv-chat-entry';
     item.style.setProperty('--player-color',mvPlayerColor(msg.uid));
     if(msg.uid===uid)item.classList.add('is-mine');
     const avatar=mvAvatar();
     const content=document.createElement('div');content.className='mv-chat-content';
     const author=document.createElement('strong');author.className='online-chat-author';author.textContent=nameOf(msg.uid)+(msg.uid===uid?'（あなた）':'');
     const bubble=document.createElement('div');bubble.className='online-chat-bubble';
     const text=document.createElement('p');text.textContent=msg.text;bubble.append(text);
     content.append(author,bubble);item.append(avatar,content);holder.append(item);
   }
   holder.dataset.signature=signature;
   if(stickToBottom)holder.scrollTop=holder.scrollHeight;
 }
 const allowed=living(uid)&&phase()==='discussion';
 $('online-chat-input').disabled=!allowed;
 $('online-chat-send').disabled=!allowed;
 $('online-chat-notice').textContent=allowed?'生存者のみ発言できます。':'脱落者はチャットを閲覧できますが、送信はできません。';
}
$('online-chat-form')?.addEventListener('submit',async event=>{
 event.preventDefault();
 const input=$('online-chat-input'),button=$('online-chat-send');
 const message=input.value.trim();
 if(!message||message.length>300||!uid||!living(uid)||phase()!=='discussion')return;
 button.disabled=true;
 try{
   await push(roomRef(roundField('chat')),{uid,text:message,at:Date.now()});
   input.value='';
 }catch(error){notification('チャット送信：'+error.message);}
 finally{button.disabled=!(living(uid)&&phase()==='discussion');}
});
function renderDiscussion(){setView('online-discussion-screen');
 const personal=thisRound().privateResults?.[uid];const resultEl=$('online-discussion-private-result');
 resultEl.hidden=!(personal?.text);resultEl.classList.remove('mv-seer-result','mv-seer-result--wolf'); resultEl.textContent=personal?.text||'';if(personal?.type==='seer'){const target=thisRound().nightActions?.[uid]?.targetUid;if(target)mvShowSeerResult(resultEl,nameOf(target),getSeerResult(data.initialRoles||data.roles||{},target));}renderList($('online-discussion-members'),Object.keys(members()).map(id=>[nameOf(id),living(id)?'生存':'脱落']));
 $('online-discussion-controls').hidden=!host();$('online-start-vote').hidden=!host();$('online-skip-vote').hidden=!host();const ctrl=thisRound().discussionTimerControls||{};$('online-pause-discussion').textContent=ctrl.paused?'再開':'一時停止';
 renderDiscussionChat();renderWolfChat();renderTimer();if(!timer)timer=setInterval(renderTimer,500);
}
$('online-add-minute').onclick=async()=>{if(!host())return;try{const c=thisRound().discussionTimerControls||{};await update(roomRef(roundField('discussionTimerControls')),{extraMs:(c.extraMs||0)+60000});}catch(e){notification('時間追加：'+e.message);}};
$('online-pause-discussion').onclick=async()=>{if(!host())return;try{const c=thisRound().discussionTimerControls||{},now=Date.now();await update(roomRef(roundField('discussionTimerControls')),{paused:!c.paused,pausedAt:!c.paused?now:0,pausedMs:(c.pausedMs||0)+(c.paused?Math.max(0,now-(c.pausedAt||now)):0)});}catch(e){notification('一時停止：'+e.message);}};
async function startVoting(){if(!host()||phase()!=='discussion')return;await update(roomRef(''),{[roundField('voteState')]:{index:1,candidates:Object.fromEntries(alive().map(id=>[id,true]))},'meta/phase':'voting'});}
$('online-start-vote').onclick=()=>startVoting().catch(e=>notification('投票開始：'+e.message));
$('online-skip-vote').onclick=async()=>{
  if (!host() || phase() !== 'discussion') return;
  const confirmed = await openVoteSkipConfirm();
  if (!confirmed || !host() || phase() !== 'discussion') return;
  const button = $('online-skip-vote');
  button.disabled = true;
  try {
    await finishResult({counts:{}, tie:true, targetUid:'', skipped:true});
  } catch (e) {
    notification('スキップ：' + e.message);
    button.disabled = false;
  }
};
function renderVoting(){setView('online-vote-screen');const v=thisRound().voteState||{},index=v.index||1,candidates=Object.keys(v.candidates||{}).filter(id=>v.candidates[id]);const vote=thisRound().votes?.[index]?.[uid];const done=thisRound().voteReady?.[index]||{};
 $('online-vote-title').textContent=index===1?'昼の投票':`再投票（${index}回目）`;
 opt($('online-vote-target'),candidates.filter(id=>id!==uid&&living(id)),'投票する相手を選択');
 $('online-submit-vote').disabled=!living(uid)||!!vote;
 $('online-vote-target').disabled=!living(uid)||!!vote;
 renderPlayerCards('online-vote-target','mv-vote-candidates');
 $('online-vote-message').textContent=!living(uid)?'脱落者は投票できません。':vote?'投票済みです。':index>1?'最多得票の候補者だけに再投票します。':'投票先を選択してください。';
 const status=countCompleted(done,alive());$('online-vote-count').textContent=`投票完了：${status.completed} / ${status.total}人`;
 $('online-finish-vote').hidden=!host();$('online-finish-vote').disabled=!status.allDone;
}
$('online-submit-vote').onclick=async()=>{if(busy||!living(uid)||phase()!=='voting')return;busy=true;$('online-submit-vote').disabled=true;const v=thisRound().voteState,index=v?.index||1,target=$('online-vote-target').value;if(!target||target===uid||!v.candidates?.[target])return notification('投票先を選択してください。');
 try{await update(roomRef(''),{[roundField(`votes/${index}/${uid}`)]:target,[roundField(`voteReady/${index}/${uid}`)]:true});}catch(e){notification('投票保存：'+e.message);$('online-submit-vote').disabled=false;}finally{busy=false;}};
async function finishResult(result){
 const patch={[roundField('voteResult')]:result};let winner=null;
 if(result.targetUid){const execution=resolveExecution(data.roles,result.targetUid,data.eliminated||{});patch[`eliminated/${result.targetUid}`]=true;winner=execution.winner;}
 else winner=checkGameWinner(data.roles,data.eliminated||{});
 if(winner){patch['meta/winner']=winner;patch['meta/phase']='gameOver';}
 else patch['meta/phase']='voteResult';
 await update(roomRef(''),patch);
}
$('online-finish-vote').onclick=async()=>{if(!host()||phase()!=='voting')return;
 try{const v=thisRound().voteState,index=v?.index||1,voters=alive(),done=thisRound().voteReady?.[index]||{};if(!countCompleted(done,voters).allDone)throw Error('全員の投票が未完了です。');
  const candidates=Object.keys(v.candidates||{}).filter(id=>v.candidates[id]),votes=thisRound().votes?.[index]||{};
  const res=calculateVotes(votes,voters,candidates);
  if(res.tie&&index===1){await set(roomRef(roundField('voteState')),{index:2,candidates:Object.fromEntries(res.candidates.map(id=>[id,true]))});return;}
  await finishResult({counts:res.counts,tie:res.tie,targetUid:res.executedUid||'',voteIndex:index});
 }catch(e){notification('投票集計：'+e.message);}
};
function renderVoteResult(){setView('online-vote-result-screen');const result=thisRound().voteResult||{};
 renderList($('online-vote-results'),Object.entries(result.counts||{}).sort((a,b)=>b[1]-a[1]).map(([id,num])=>[nameOf(id),`${num}票`]));
 $('online-execution-result').textContent=result.targetUid?`${nameOf(result.targetUid)}が処刑されました。`:result.skipped?'投票をスキップしました。':'再投票も同票のため、処刑者はいません。';
 if(setting('publicVotes')){
  const idx=result.voteIndex||1,all=thisRound().votes?.[idx]||{};
  $('online-public-votes-result').textContent=Object.entries(all).map(([from,to])=>`${nameOf(from)} → ${nameOf(to)}`).join(' / ');
 }else $('online-public-votes-result').textContent='';
 renderList($('online-alive-members'),alive().map(id=>[nameOf(id),'生存']));
 renderList($('online-eliminated-members'),Object.keys(members()).filter(id=>!living(id)).map(id=>[nameOf(id),'脱落']));
 $('online-my-survival-status').textContent=living(uid)?'あなたは生存しています。':'あなたは脱落しています。';
 $('online-next-night').hidden=!host();$('online-next-night').textContent=`${round()+1}日目の夜へ進む`;
}
$('online-next-night').onclick=async()=>{if(!host()||phase()!=='voteResult')return;try{await update(roomRef(''),{'meta/round':round()+1,'meta/phase':'night'});}catch(e){notification('次の日への移行：'+e.message);}};
function buildEndgameReview(game) {
  const list = $('online-game-history');
  list.replaceChildren();
  const rounds = game.rounds || {};
  const names = game.members || {};
  const roleMap = game.roles || {};
  const initialRoleMap = game.initialRoles || roleMap;
  const displayName = id => names[id]?.name || '不明な参加者';
  const addRow = (parent, title, content) => {
    const row = document.createElement('div');
    row.className = 'online-review-line';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const body = document.createElement('span');
    body.textContent = content;
    row.append(heading, body);
    parent.append(row);
  };
  const days = Object.keys(rounds).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!days.length) {
    const p = document.createElement('p');
    p.textContent = 'ゲームの記録はありません。';
    list.append(p);
  }
  for (const day of days) {
    const r = rounds[day] || {};
    const details = document.createElement('details');
    details.className = 'online-review-day';
    if(day === days[days.length - 1]) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `${day}日目の振り返り`;
    details.append(summary);
    const content = document.createElement('div');
    content.className = 'online-review-content';
    const night = r.nightResult;
    if (night) {
      addRow(content,'朝の結果',night.victimUid ? `${displayName(night.victimUid)}が襲撃されました` : '犠牲者なし');
      if(night.eventText) addRow(content,'出来事',night.eventText);
    }
    if(r.voteResult) {
      const vr = r.voteResult;
      addRow(content,'処刑結果',vr.targetUid ? `${displayName(vr.targetUid)}が処刑されました` : (vr.skipped ? '投票スキップ・処刑者なし' : '同票・処刑者なし'));
      for (const [candidate,count] of Object.entries(vr.counts || {}).sort((a,b)=>b[1]-a[1])) {
        addRow(content,'得票',`${displayName(candidate)}：${count}票`);
      }
    }
    for (const index of Object.keys(r.votes || {}).sort((a,b)=>Number(a)-Number(b))) {
      const votes = r.votes[index] || {};
      if(Object.keys(votes).length) {
        const desc = Object.entries(votes).map(([from,to])=>`${displayName(from)} → ${displayName(to)}`).join(' ／ ');
        addRow(content,`${index==='1'?'投票':'再投票'}の内訳`,desc);
      }
    }
    const actions = r.nightActions || {};
    if(Object.keys(actions).length) {
      for (const [actor,action] of Object.entries(actions)) {
        if(!action || !action.role) continue;
        const verb = ({'人狼':'襲撃','占い師':'占い','騎士':'護衛','怪盗':'交換'})[action.role] || '行動';
        addRow(content,'夜の行動',`${displayName(actor)}（${action.role}）：${action.targetUid ? `${displayName(action.targetUid)}を${verb}` : '行動なし'}`);
      }
    }
    details.append(content);
    list.append(details);
  }
  const roleList = $('online-final-roles');
  roleList.replaceChildren();
  for(const [id, member] of Object.entries(names)) {
    const card = document.createElement('div');
    card.className = 'online-result-player';
    const identity = document.createElement('div');
    const name = document.createElement('strong');name.textContent=member.name;
    const detail=document.createElement('span');
    const changed = initialRoleMap[id] && initialRoleMap[id] !== roleMap[id];
    detail.textContent=`${roleMap[id]||'不明'}${changed ? `（開始時：${initialRoleMap[id]}）` : ''}`;
    identity.append(name, detail);
    const state=document.createElement('span');
    state.className='online-result-state';
    state.textContent=game.eliminated?.[id]===true?'脱落':'生存';
    card.append(identity,state);
    roleList.append(card);
  }
}

function renderGameOver(){
  setView('online-game-over-screen');
  $('online-winner').textContent=`${data.meta.winner||'判定待ち'}の勝利`;
  const winner=data.meta.winner || '';
  const over=$('online-game-over-screen');
  over.dataset.winner=winner==='人狼陣営'?'wolf':winner==='てるてる'?'teruteru':'villager';
  $('online-final-round').textContent=`${round()}日間の記録`;
  $('online-final-player-count').textContent=`${Object.keys(members()).length}人参加`;
  buildEndgameReview(data);
  const restart=$('online-play-again');
  restart.hidden=!host();
  restart.disabled=false;
  $('online-restart-wait').hidden=host();
}

$('online-play-again').onclick=async()=>{
  if(!host()||phase()!=='gameOver')return;
  const restart=$('online-play-again');
  restart.disabled=true;
  try {
    // Firebaseのマルチパス更新で、全員が同じ瞬間にロビーへ戻る。
    // members, settings, meta.hostUid, 招待用ルーム番号は維持する。
    // 前回の結果はロビーからも見返せるよう1試合分だけ保存する。
    const archive={
      members:data.members||{},
      initialRoles:data.initialRoles||data.roles||{},
      roles:data.roles||{},
      eliminated:data.eliminated||{},
      rounds:data.rounds||{},
      meta:{winner:data.meta.winner||'',round:round()},
      endedAt:Date.now()
    };
    const changes={
      lastGame:archive,
      roles:null,
      initialRoles:null,
      eliminated:null,
      rounds:null,
      ready:null,
      'meta/winner':null,
      'meta/round':1,
      'meta/phase':'lobby',
      'meta/gamesPlayed':Number(data.meta.gamesPlayed||0)+1
    };
    await update(roomRef(''),changes);
    notification('同じメンバーでロビーへ戻りました。設定変更や追加参加ができます。');
  } catch(e) {
    notification('再戦準備エラー：'+e.message);
    restart.disabled=false;
  }
};

$('online-last-game-review').onclick=()=>{
  if(!data?.lastGame)return;
  const panel=$('online-last-game-panel');
  panel.hidden=!panel.hidden;
  if(panel.hidden)return;
  const last=data.lastGame;
  $('online-last-winner').textContent=`前回：${last.meta?.winner||'結果なし'}の勝利`;
  // 専用の2つの一覧を利用して既存のレビュー関数を再利用する。
  const currentHistory=$('online-game-history');
  const currentRoles=$('online-final-roles');
  const historySlot=document.createElement('div');
  const rolesSlot=document.createElement('div');
  historySlot.id='online-game-history';
  rolesSlot.id='online-final-roles';
  currentHistory.id='online-game-history-current';
  currentRoles.id='online-final-roles-current';
  try {
    panel.querySelector('.online-last-role-slot').replaceChildren(rolesSlot);
    panel.querySelector('.online-last-history-slot').replaceChildren(historySlot);
    buildEndgameReview(last);
  } finally {
    rolesSlot.id='online-final-roles-archive';
    historySlot.id='online-game-history-archive';
    currentHistory.id='online-game-history';
    currentRoles.id='online-final-roles';
  }
};
function render(){if(!data)return;const p=phase();if(!['night','discussion'].includes(p)||!mvWolfChatEligible())stopWolfChat();if(p!=='discussion'&&timer){clearInterval(timer);timer=null;}
 if(p==='lobby')renderLobby();else if(p==='firstNight')renderReveal();else if(p==='night')renderNight();else if(p==='day')renderDay();else if(p==='discussion')renderDiscussion();else if(p==='voting')renderVoting();else if(p==='voteResult')renderVoteResult();else if(p==='gameOver')renderGameOver();
 lastRenderedPhase=p;
}
window.addEventListener('pagehide',()=>{stopWolfChat();if(offRoom)offRoom();if(timer)clearInterval(timer);});

function openVoteSkipConfirm() {
  return new Promise(resolve => {
    if (!voteSkipConfirmModal || !cancelVoteSkipButton || !confirmVoteSkipButton) {
      notification('確認画面が見つかりません。');
      resolve(false);
      return;
    }

    voteSkipConfirmModal.hidden = false;
    confirmVoteSkipButton.focus();
    let settled = false;

    const close = accepted => {
      if (settled) return;
      settled = true;
      voteSkipConfirmModal.hidden = true;
      cancelVoteSkipButton.removeEventListener('click', onCancel);
      confirmVoteSkipButton.removeEventListener('click', onConfirm);
      voteSkipConfirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown);
      $('online-skip-vote').focus();
      resolve(accepted);
    };

    const onCancel = () => close(false);
    const onConfirm = () => close(true);
    const onBackdrop = event => {
      if (event.target === voteSkipConfirmModal) close(false);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Tab') {
        const first = cancelVoteSkipButton;
        const last = confirmVoteSkipButton;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    cancelVoteSkipButton.addEventListener('click', onCancel);
    confirmVoteSkipButton.addEventListener('click', onConfirm);
    voteSkipConfirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);
  });
}

// Stage 9: an explicit reconnect button. No saved roles are stored in the browser;
// Firebase remains the authority, and an anonymous account must still own its membership.
(function mvOfferRoomRecovery(){
  let stored;try{stored=JSON.parse(localStorage.getItem(MV_ROOM_KEY)||'null');}catch(e){mvForgetRoom();}
  if(!stored || !/^\d{6}$/.test(stored.roomCode||'') ||
      typeof stored.displayName!=='string' || Date.now()-stored.savedAt>7*86400000) return;
  const menu=$('online-menu-screen');if(!menu)return;
  const button=document.createElement('button');button.type='button';
  button.className='online-secondary-button';button.textContent='前回のルームに再接続（'+stored.roomCode+'）';
  button.onclick=async()=>{
    if(busy)return;
    try{
      const account=await loginAnonymously();
      const old=await get(ref(db,`rooms/${stored.roomCode}/members/${account.uid}`));
      if(!old.exists()) {notification('前回と同じ参加者として認証できません。ルーム参加画面から確認してください。');return;}
      await enterRoom(stored.roomCode,old.val().name||stored.displayName,false);
    }catch(e){notification('再接続できません：'+e.message);}
  };
  menu.append(button);
})();
