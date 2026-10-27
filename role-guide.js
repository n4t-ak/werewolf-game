/* Optional role guide; read-only, does not touch live game state. */
(() => {'use strict';
 const roles=[
 ['村人','村人陣営','特別な夜の能力はありません。昼の議論と投票で人狼を探します。'],
 ['人狼','人狼陣営','最初の夜は仲間を確認します。以降の夜は生存者を襲撃します。'],
 ['占い師','村人陣営','夜に生存者を占い、人狼かどうかを調べます。'],
 ['騎士','村人陣営','夜に1人を護衛します。連続護衛はゲーム設定に従います。'],
 ['霊媒師','村人陣営','前日に処刑されたプレイヤーが人狼だったか確認します。'],
 ['狂人','人狼陣営','人狼の勝利を助ける役職です。仲間が見えるかどうかはゲーム設定に従います。'],
 ['怪盗','特殊役職','最初の夜に他のプレイヤーの役職を交換する特殊役職です。'],
 ['てるてる','第三陣営','投票で処刑されることを目指す、特殊な勝利条件を持つ役職です。']
 ];
 const nav=document.querySelector('.mv-mode-nav');
 const header=document.querySelector('.app-header');if(!header)return;
 const button=document.createElement('button');button.type='button';button.className='mv-guide-button';button.textContent='役職図鑑';
 const dialog=document.createElement('dialog');dialog.className='mv-guide-dialog';
 const close=document.createElement('button');close.type='button';close.textContent='閉じる';close.onclick=()=>dialog.close();
 const title=document.createElement('h2');title.textContent='役職図鑑';
 const lead=document.createElement('p');lead.textContent='役職の一般的な説明です。現在の試合の配役や秘密情報は表示しません。';
 const list=document.createElement('div');list.className='mv-guide-list';
 for(const [role,team,desc] of roles){
   const entry=document.createElement('section');entry.className='mv-guide-entry';
   const heading=document.createElement('h3');heading.textContent=role;
   const camp=document.createElement('small');camp.textContent=team;
   const note=document.createElement('p');note.textContent=desc;
   entry.append(heading,camp,note);list.append(entry);
 }
 dialog.append(close,title,lead,list);
 const open=()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');};
 button.onclick=open;header.append(button);document.body.append(dialog);
 // Hide guide button during a match so no new controls interrupt existing UI.
 const observe=()=>{button.hidden=nav?.hidden || (document.getElementById('online-mode-nav')?.hidden??false);};
 if(nav)new MutationObserver(observe).observe(nav,{attributes:true,attributeFilter:['hidden']});observe();
})();
