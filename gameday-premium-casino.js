(() => {
  const path = location.pathname.split('/').pop() || '';

  function loadV2Styles(){
    if(document.querySelector('link[data-gameday-premium-v2]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='gameday-premium-casino-v2.css';
    link.dataset.gamedayPremiumV2='true';
    document.head.appendChild(link);
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
    document.body.classList.add('gameday-premium-slots');
    const reels=[document.getElementById('reel1'),document.getElementById('reel2'),document.getElementById('reel3')].filter(Boolean);
    reels.forEach(r=>{
      decorateSlotReel(r);
      new MutationObserver(()=>decorateSlotReel(r)).observe(r,{childList:true,characterData:true,subtree:true});
    });
    const machine=document.querySelector('.machine');
    const balance=document.getElementById('balance');
    const result=document.getElementById('result');
    if(machine && !machine.querySelector('.gd-slot-hud')){
      const hud=document.createElement('div');
      hud.className='gd-slot-hud';
      hud.innerHTML='<div>Balance<strong id="gdSlotHudBalance">—</strong></div><div>Result<strong id="gdSlotHudResult">Ready</strong></div>';
      machine.appendChild(hud);
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
