/* MOONLIT VILLAGE - offline/online shared role cards */
(() => {
  'use strict';
  const info = {
    '村人':   { symbol:'✦', roman:'THE VILLAGER',    faction:'village', number:'I',     motif:'☼' },
    '人狼':   { symbol:'☾', roman:'THE WEREWOLF',   faction:'wolf',    number:'XVIII', motif:'◆' },
    '占い師': { symbol:'✧', roman:'THE SEER',       faction:'village', number:'II',    motif:'✶' },
    '騎士':   { symbol:'⚔', roman:'THE GUARDIAN',   faction:'village', number:'VII',   motif:'◇' },
    '霊媒師': { symbol:'☽', roman:'THE MEDIUM',     faction:'village', number:'XIII',  motif:'✧' },
    '狂人':   { symbol:'♠', roman:'THE MADMAN',     faction:'wolf',    number:'0',     motif:'✥' },
    '怪盗':   { symbol:'◈', roman:'THE THIEF',      faction:'neutral', number:'X',     motif:'◆' },
    'てるてる':{ symbol:'☀',roman:'THE TRICKSTER', faction:'neutral', number:'XIX',   motif:'✷' }
  };
  const make = (tag, className, value) => {
    const el=document.createElement(tag);el.className=className;
    if(value !== undefined)el.textContent=value;
    return el;
  };
  function create(role, {compact=false, animate=true}={}) {
    const i=info[role]||info['村人'];
    const card=make('div','mv-tarot'+(compact?' mv-tarot--compact':'')+(animate?' mv-tarot--reveal':''));
    card.dataset.role=role;card.dataset.faction=i.faction;
    card.setAttribute('role','img');card.setAttribute('aria-label',`役職カード：${role}`);
    const inner=make('div','mv-tarot-inner');
    const back=make('div','mv-tarot-back');back.setAttribute('aria-hidden','true');
    back.append(make('div','mv-card-back-star','✧'),make('div','mv-card-back-text','MOONLIT VILLAGE'));
    const face=make('div','mv-tarot-face');
    // Approved full illustrations (including printed card title and gold border).
    const fullArt=make('img','mv-full-card-image');
    fullArt.src='./role-art/'+encodeURIComponent(info[role]?role:'村人')+'.webp';
    fullArt.alt='';fullArt.decoding='async';fullArt.loading='eager';
    fullArt.addEventListener('load',()=>{card.classList.add('mv-tarot--fullart');});
    fullArt.addEventListener('error',()=>{fullArt.hidden=true;});
    face.append(fullArt);
    face.append(make('div','mv-tarot-number',i.number),make('div','mv-tarot-roman',i.roman));
    const emblem=make('div','mv-tarot-emblem');
    const artwork=make('img','mv-role-art');artwork.src='./role-art/'+encodeURIComponent(info[role]?role:'村人')+'.webp';artwork.alt=role+'のイラスト';artwork.loading='eager';artwork.decoding='async';
    artwork.addEventListener('error',()=>{artwork.hidden=true;});
    emblem.append(make('span','mv-emblem-halo'),artwork,make('span','mv-role-symbol',i.symbol));
    face.append(emblem,make('div','mv-tarot-scroll',i.motif+'  ✦  '+i.motif),make('strong','mv-tarot-name',role));
    face.append(make('div','mv-tarot-bottom','✦  THE FATE IS IN YOUR HANDS  ✦'));
    inner.append(back,face);card.append(inner);return card;
  }
  function mount(target, role, opts={}) {
    if(!target)return;
    const old=target.querySelector('.mv-tarot');
    if(old?.dataset.role===role)return;
    const card=create(role,opts);target.replaceChildren(card);
  }
  window.MVRoleCard={create,mount,info};
})();
