(() => {
  const path = location.pathname.split('/').pop() || '';

  function loadStyleOnce(href,key){
    if(document.querySelector(`link[data-${key}]`)) return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href=href;
    link.setAttribute(`data-${key}`,'true');
    document.head.appendChild(link);
  }

  function loadV2Styles(){
    loadStyleOnce('gameday-premium-casino-v2.css','gameday-premium-v2');
  }

  const slotMap = {
    '💎':'diamond',
    '7️⃣':'seven',
    '⭐':'star',
    '🔔':'bell',
    '🍒':'cherry',
    '🍋':'lemon'
  };

  function enhanceBlackjack(){
    loadV2Styles();
    document.body.classList.add('gameday-premium-blackjack');
    const table = document.querySelector('.table');
    if(table && !table.querySelector('.gd-blackjack-rules')){
      const rules = document.createElement('div');
      rules.className='gd-blackjack-rules';
      rules.setAttribute('aria-hidden','true');
      table.appendChild(rules);
    }
  }

  function decorateSlotReel(el){
    if(!el) return;
    [...el.classList].filter(c=>c.startsWith('gd-symbol-')).forEach(c=>el.classList.remove(c));
    const key = slotMap[(el.textContent||'').trim()];
    if(key) el.classList.add('gd-symbol-'+key);
  }

  function enhanceSlots(){
    loadV2Styles();
    loadStyleOnce('gameday-lucky7s.css','gameday-lucky7s');
    document.body.classList.add('gameday-premium-slots','gameday-lucky-7s');

    const pageTitle=document.querySelector('h1');
    if(pageTitle) pageTitle.textContent='GameDay Lucky 7s';
    document.title='GameDay Lucky 7s';

    const nav=document.querySelector('.nav');
    if(nav && !document.querySelector('.gd-slots-lobby-link')){
      const lobby=document.createElement('a');
      lobby.className='gd-slots-lobby-link';
      lobby.href='gameday-slots-lobby.html';
      lobby.textContent='‹ Slots Lobby';
      nav.insertAdjacentElement('afterend',lobby);
    } else if(!nav && !document.querySelector('.gd-slots-lobby-link')){
      const main=document.querySelector('main');
      if(main){
        const lobby=document.createElement('a');
        lobby.className='gd-slots-lobby-link';
        lobby.href='gameday-slots-lobby.html';
        lobby.textContent='‹ Slots Lobby';
        main.insertBefore(lobby,main.firstChild);
      }
    }

    const machine=document.querySelector('.machine');
    const machineTitle=document.querySelector('.machine-title');
    if(machineTitle) machineTitle.textContent='★ GAMEDAY LUCKY 7s ★';

    if(machine && !machine.querySelector('.gd-lucky-marquee')){
      const marquee=document.createElement('div');
      marquee.className='gd-lucky-marquee';
      marquee.setAttribute('aria-hidden','true');
      marquee.innerHTML='<span>LUCKY 7s</span><small>CLASSIC • 3 REEL • SINGLE LINE</small>';
      machine.insertBefore(marquee,machine.firstChild);
    }

    const reels=[document.getElementById('reel1'),document.getElementById('reel2'),document.getElementById('reel3')].filter(Boolean);
    reels.forEach(r=>{
      decorateSlotReel(r);
      new MutationObserver(()=>decorateSlotReel(r)).observe(r,{childList:true,characterData:true,subtree:true});
    });

    const reelBox=document.querySelector('.reels');
    if(reelBox && !reelBox.querySelector('.gd-payline')){
      const line=document.createElement('div');
      line.className='gd-payline';
      line.setAttribute('aria-hidden','true');
      reelBox.appendChild(line);
    }

    if(machine && !machine.querySelector('.gd-coin-tray')){
      const tray=document.createElement('div');
      tray.className='gd-coin-tray';
      tray.setAttribute('aria-hidden','true');
      tray.innerHTML='<span>COIN TRAY</span><i></i>';
      machine.appendChild(tray);
    }

    const balance=document.getElementById('balance');
    const result=document.getElementById('result');
    if(machine && !machine.querySelector('.gd-slot-hud')){
      const hud=document.createElement('div');
      hud.className='gd-slot-hud';
      hud.innerHTML='<div>Balance<strong id="gdSlotHudBalance">—</strong></div><div>Result<strong id="gdSlotHudResult">Ready</strong></div>';
      const tray=machine.querySelector('.gd-coin-tray');
      if(tray) machine.insertBefore(hud,tray); else machine.appendChild(hud);
      const sync=()=>{
        const b=document.getElementById('gdSlotHudBalance');
        const r=document.getElementById('gdSlotHudResult');
        if(b) b.textContent=(balance?.textContent||'Balance: —').replace(/^Balance:\s*/i,'');
        if(r) r.textContent=(result?.textContent||'Ready').slice(0,28);
      };
      sync();
      if(balance) new MutationObserver(sync).observe(balance,{childList:true,characterData:true,subtree:true});
      if(result) new MutationObserver(sync).observe(result,{childList:true,characterData:true,subtree:true});
    }
  }

  if(path==='gameday-blackjack.html') enhanceBlackjack();
  if(path==='gameday-slots.html') enhanceSlots();
})();
