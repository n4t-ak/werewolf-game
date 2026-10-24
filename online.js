/* オンライン人狼：無料版（ホスト判定方式） */
import { ref, get, set, update, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js';
import { db, loginAnonymously } from './firebase-config.js';
import {validatePlayerCount,getRoundPath,getAliveUids,needsNightAction,checkGameWinner,countCompleted,calculateVotes,applyThiefSwap,getSeerResult,getMediumResult,resolveExecution,resolveNight} from './online-engine.js';

const $ = id => document.getElementById(id);
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
let entryView = 'menu', timer = null, savedSettings = '', lastRenderedPhase = '';
const roomRef = field => ref(db, field?.startsWith('rooms/') ? field : `rooms/${room}${field ? '/' + field : ''}`);
const roundField = (field, round = data?.meta?.round || 1) => getRoundPath(room, round, field);
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
const renderList = (element, rows) => { element.replaceChildren(); for (const row of rows) {const el = document.createElement('div');el.className = 'online-member';const a=document.createElement('strong');a.textContent=row[0];const b=document.createElement('span');b.textContent=row[1];el.append(a,b);element.append(el);} };
const setView = id => { for (const screen of screens) {const el=$(screen);if(el)el.hidden=screen!==id;} if(id!==currentView) { currentView=id; if(id==='entry-screen') switchEntry(entryView); } };
const opt = (select, candidates, label='相手を選択してください') => {const old=select.value;select.replaceChildren(new Option(label,''));for(const u of candidates)select.add(new Option(nameOf(u),u));if(candidates.includes(old))select.value=old;};
const randomIndex = n => {const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n;};
const shuffled = a => {const b=[...a];for(let i=b.length-1;i>0;i--){const j=randomIndex(i+1);[b[i],b[j]]=[b[j],b[i]];}return b;};
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
  history.replaceState(null,'',`${location.pathname}?room=${room}`);
  if(offRoom)offRoom();
  offRoom=onValue(roomRef(''),snap=>{if(!snap.exists()){notification('ルームが存在しません。');return;}data=snap.val();render();},err=>notification('同期エラー：'+err.message));
  notification('');
 }catch(e){console.error(e);notification('接続に失敗：'+e.message);room=null;}
 finally{busy=false;}
}
$('create-room').onclick=()=>{const n=$('online-name').value.trim();if(!n||n.length>20){notification('名前を1〜20文字で入力してください。');return;}enterRoom(String(100000+randomIndex(900000)),n,true);};
$('join-room').onclick=()=>{const n=$('online-join-name').value.trim(),c=$('room-code').value.trim();if(!n||n.length>20){notification('名前を1〜20文字で入力してください。');return;}if(!/^\d{6}$/.test(c)){notification('6桁のルーム番号を入力してください。');return;}enterRoom(c,n);};
$('copy-room-link').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);notification('招待リンクをコピーしました。');}catch(e){notification('コピーできませんでした。');}};

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
function renderLobby(){setView('lobby-screen');$('display-room-code').textContent=room;
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
  await update(roomRef(''),{settings:s,roles,'meta/phase':'firstNight'});
 }catch(e){notification('開始エラー：'+e.message);$('online-start-game').disabled=false;}
};

function renderReveal(){setView('online-role-reveal');const r=myRole();$('online-my-role').textContent=r||'確認中';
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
function renderNight(){setView('online-night-screen');$('online-night-title').textContent=round()===1?'初夜':`${round()}日目の夜`;
 const r=myRole(),rn=thisRound(),done=rn.nightDone||{},act=rn.nightActions?.[uid];const needs=living(uid)&&needsNightAction(r,round());
 $('online-night-role').textContent=living(uid)?`あなたの役職：${r}`:'あなたは脱落しています';
 let msg='夜の行動を終えてください。';
 if(!living(uid))msg='あなたは脱落しています。生存者の夜明けを待ちます。';
 else if(r==='人狼')msg='襲撃する相手を選んでください。';
 else if(r==='占い師')msg='占う相手を選んでください。';
 else if(r==='騎士')msg='護衛する相手を選んでください。自分も護衛できます。';
 else if(r==='怪盗'&&round()===1)msg='交換する相手を選ぶか、交換せずに終了してください。';
 else if(r==='霊媒師'&&round()>1){const prev=data.rounds?.[round()-1]?.voteResult?.targetUid;msg=prev?`前日処刑された${nameOf(prev)}は、${getMediumResult(data.roles,prev)}です。`:'昨日は処刑者がいませんでした。';}
 $('online-night-message').textContent=msg;
 const targets=nightTargets();opt($('online-night-target'),targets);
 const actionArea=$('online-night-action-area');actionArea.hidden=!needs||!!done[uid]||!!act;
 $('online-night-target').disabled=targets.length===0;
 $('online-submit-night').disabled=targets.length===0;
 $('online-night-skip').hidden=!(r==='怪盗'&&round()===1&&living(uid)&&!done[uid]&&!act) && !(needs&&targets.length===0&&!act&&!done[uid]);
 $('online-night-done').hidden=!living(uid)||!!done[uid]||needs&&!act;
 $('online-night-result').textContent=done[uid]?'完了しました。他の参加者を待っています。':act?'行動を送信しました。':' ';
 const status=countCompleted(done,alive());$('online-night-done-count').textContent=`夜の行動完了：${status.completed} / ${status.total}人`;
 $('online-go-day').hidden=!host();$('online-go-day').disabled=!status.allDone;
}
$('online-submit-night').onclick=async()=>{
 if(!living(uid)||phase()!=='night')return;const r=myRole(),target=$('online-night-target').value;if(!nightTargets().includes(target))return notification('相手を選択してください。');
 try{await set(roomRef(roundField(`nightActions/${uid}`)),{role:r,targetUid:target,at:Date.now()});await set(roomRef(roundField(`nightDone/${uid}`)),true);}catch(e){notification('夜の送信：'+e.message);}
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
 $('online-private-result').textContent=personal||'';
 renderList($('online-day-members'),Object.keys(members()).map(id=>[nameOf(id),living(id)?'生存':'脱落']));
 $('online-start-discussion').hidden=!host();
}
$('online-start-discussion').onclick=async()=>{if(!host()||phase()!=='day')return;try{await update(roomRef(''),{[`rounds/${round()}/discussionStartedAt`]:Date.now(),[`rounds/${round()}/discussionTimerControls`]:{paused:false,pausedAt:0,pausedMs:0,extraMs:0},'meta/phase':'discussion'});}catch(e){notification('議論開始：'+e.message);}};
function discussionLeft(){const r=thisRound(),base=(r.nightResult?.minutes||3)*60000,c=r.discussionTimerControls||{};const now=c.paused?c.pausedAt||Date.now():Date.now();const elapsed=Math.max(0,now-(r.discussionStartedAt||now)-(c.pausedMs||0));return Math.max(0,base+(c.extraMs||0)-elapsed);}
function renderTimer(){if(phase()!=='discussion')return;const sec=Math.ceil(discussionLeft()/1000);$('online-discussion-timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function renderDiscussion(){setView('online-discussion-screen');renderList($('online-discussion-members'),Object.keys(members()).map(id=>[nameOf(id),living(id)?'生存':'脱落']));
 $('online-discussion-controls').hidden=!host();$('online-start-vote').hidden=!host();$('online-skip-vote').hidden=!host();const ctrl=thisRound().discussionTimerControls||{};$('online-pause-discussion').textContent=ctrl.paused?'再開':'一時停止';
 renderTimer();if(!timer)timer=setInterval(renderTimer,500);
}
$('online-add-minute').onclick=async()=>{if(!host())return;try{const c=thisRound().discussionTimerControls||{};await update(roomRef(roundField('discussionTimerControls')),{extraMs:(c.extraMs||0)+60000});}catch(e){notification('時間追加：'+e.message);}};
$('online-pause-discussion').onclick=async()=>{if(!host())return;try{const c=thisRound().discussionTimerControls||{},now=Date.now();await update(roomRef(roundField('discussionTimerControls')),{paused:!c.paused,pausedAt:!c.paused?now:0,pausedMs:(c.pausedMs||0)+(c.paused?Math.max(0,now-(c.pausedAt||now)):0)});}catch(e){notification('一時停止：'+e.message);}};
async function startVoting(){if(!host()||phase()!=='discussion')return;await update(roomRef(''),{[roundField('voteState')]:{index:1,candidates:Object.fromEntries(alive().map(id=>[id,true]))},'meta/phase':'voting'});}
$('online-start-vote').onclick=()=>startVoting().catch(e=>notification('投票開始：'+e.message));
$('online-skip-vote').onclick=async()=>{if(!host()||phase()!=='discussion')return;try{await finishResult({counts:{},tie:true,targetUid:'',skipped:true});}catch(e){notification('スキップ：'+e.message);}};
function renderVoting(){setView('online-vote-screen');const v=thisRound().voteState||{},index=v.index||1,candidates=Object.keys(v.candidates||{}).filter(id=>v.candidates[id]);const vote=thisRound().votes?.[index]?.[uid];const done=thisRound().voteReady?.[index]||{};
 $('online-vote-title').textContent=index===1?'昼の投票':`再投票（${index}回目）`;
 opt($('online-vote-target'),candidates.filter(id=>id!==uid&&living(id)),'投票する相手を選択');
 $('online-submit-vote').disabled=!living(uid)||!!vote;
 $('online-vote-target').disabled=!living(uid)||!!vote;
 $('online-vote-message').textContent=!living(uid)?'脱落者は投票できません。':vote?'投票済みです。':index>1?'最多得票の候補者だけに再投票します。':'投票先を選択してください。';
 const status=countCompleted(done,alive());$('online-vote-count').textContent=`投票完了：${status.completed} / ${status.total}人`;
 $('online-finish-vote').hidden=!host();$('online-finish-vote').disabled=!status.allDone;
}
$('online-submit-vote').onclick=async()=>{if(!living(uid)||phase()!=='voting')return;const v=thisRound().voteState,index=v?.index||1,target=$('online-vote-target').value;if(!target||target===uid||!v.candidates?.[target])return notification('投票先を選択してください。');
 try{await set(roomRef(roundField(`votes/${index}/${uid}`)),target);await set(roomRef(roundField(`voteReady/${index}/${uid}`)),true);}catch(e){notification('投票保存：'+e.message);}};
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
function renderGameOver(){setView('online-game-over-screen');$('online-winner').textContent=`勝利：${data.meta.winner||'判定待ち'}`;
 const original=Object.entries(members()).map(([id,m])=>[m.name,`${data.roles?.[id]||'不明'} / ${living(id)?'生存':'脱落'}`]);
 renderList($('online-final-roles'),original);
 const history=[];for(let i=1;i<=round();i++){const r=data.rounds?.[i]||{};if(r.nightResult)history.push([`${i}日目・朝`,r.nightResult.victimUid?`${nameOf(r.nightResult.victimUid)}が襲撃`:'犠牲者なし']);if(r.voteResult)history.push([`${i}日目・投票`,r.voteResult.targetUid?`${nameOf(r.voteResult.targetUid)}が処刑`:'処刑者なし']);}
 renderList($('online-game-history'),history);
}
function render(){if(!data)return;const p=phase();if(p!=='discussion'&&timer){clearInterval(timer);timer=null;}
 if(p==='lobby')renderLobby();else if(p==='firstNight')renderReveal();else if(p==='night')renderNight();else if(p==='day')renderDay();else if(p==='discussion')renderDiscussion();else if(p==='voting')renderVoting();else if(p==='voteResult')renderVoteResult();else if(p==='gameOver')renderGameOver();
 lastRenderedPhase=p;
}
window.addEventListener('pagehide',()=>{if(offRoom)offRoom();if(timer)clearInterval(timer);});
