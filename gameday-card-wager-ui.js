(() => {
  const path = location.pathname.split('/').pop() || '';
  const cardPages = new Set([
    'gameday-blackjack.html',
    'gameday-baccarat.html',
    'gameday-video-poker.html',
    'gameday-bonus-poker.html',
    'gameday-deuces-wild.html',
    'gameday-three-card-poker.html',
    'gameday-ultimate-texas-holdem.html',
    'gameday-caribbean-stud.html'
  ]);
  const wagerPages = new Set([
    ...cardPages,
    'gameday-roulette.html',
    'gameday-slots.html'
  ]);
  if (!cardPages.has(path) && !wagerPages.has(path)) return;

  const style = document.createElement('style');
  style.textContent = `
    .gameday-detailed-card{position:relative!important;overflow:hidden!important;background:linear-gradient(145deg,#fffefa 0%,#f4f0e6 68%,#e8e1d2 100%)!important;border:1px solid #d6cfbf!important;box-shadow:0 3px 10px rgba(0,0,0,.3),inset 0 0 0 1px rgba(255,255,255,.75)!important;color:#111!important;font-family:Georgia,'Times New Roman',serif!important}
    .gameday-detailed-card.gd-red{color:#b41427!important}
    .gameday-detailed-card .rank,.gameday-detailed-card .suit,.gameday-detailed-card .card-rank,.gameday-detailed-card .card-suit{visibility:hidden!important}
    .gameday-detailed-card::before,.gameday-detailed-card::after{position:absolute;z-index:3;content:attr(data-gd-rank) '\A' attr(data-gd-suit);white-space:pre;line-height:.82;text-align:center;font-weight:900;font-family:Arial,sans-serif;font-size:clamp(8px,2.7vw,12px)}
    .gameday-detailed-card::before{left:3px;top:4px}
    .gameday-detailed-card::after{right:3px;bottom:4px;transform:rotate(180deg)}
    .gameday-detailed-card .gd-card-center{position:absolute;inset:14% 15%;display:grid;place-items:center;z-index:2;font-family:Georgia,'Times New Roman',serif}
    .gameday-detailed-card .gd-card-pips{width:100%;height:100%;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;align-items:center;justify-items:center;font-size:clamp(8px,4.6vw,18px);line-height:1}
    .gameday-detailed-card .gd-card-pips span:nth-child(3n+2){transform:scale(.9)}
    .gameday-detailed-card .gd-card-ace{font-size:clamp(20px,9vw,42px);font-weight:900;text-shadow:0 1px 0 #fff}
    .gameday-detailed-card .gd-card-face{display:grid;place-items:center;width:82%;height:78%;border:1px solid currentColor;border-radius:4px;background:linear-gradient(145deg,rgba(212,180,91,.22),rgba(255,255,255,.72));box-shadow:inset 0 0 0 2px rgba(255,255,255,.55)}
    .gameday-detailed-card .gd-card-face strong{font:900 clamp(16px,7vw,30px)/1 Arial,sans-serif;letter-spacing:-.08em}
    .gameday-detailed-card .gd-card-face span{font-size:clamp(12px,5vw,22px);margin-top:-3px}
    .gameday-detailed-card.hidden-card,.gameday-detailed-card.empty{background:repeating-linear-gradient(45deg,#173b25,#173b25 6px,#244f32 6px,#244f32 12px)!important;color:#fff!important}

    .gameday-custom-wager-input{border-color:#b99a42!important;box-shadow:0 0 0 1px rgba(215,189,98,.22)!important;font-weight:900!important}
    .gameday-custom-hint{margin-top:2px;color:#d9c36f;font-size:8px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
    .gameday-custom-button{border:1px solid #8f7630!important;background:#342a10!important;color:#f5df8e!important;font-weight:900!important}
    .gameday-custom-button:disabled{opacity:.38!important;cursor:not-allowed!important}
    .gameday-stake-display.gameday-custom-ready{cursor:pointer!important;border-color:#9e873f!important;color:#f5df8e!important;position:relative!important}
    .gameday-stake-display.gameday-custom-ready::after{content:'CUSTOM';position:absolute;right:4px;top:2px;font-size:6px;letter-spacing:.04em;color:#cdb65f}
    .gameday-stake-display.gameday-custom-ready[aria-disabled="true"]{opacity:.5!important;cursor:not-allowed!important;pointer-events:none!important}

    @media(max-width:430px){
      .gameday-detailed-card::before,.gameday-detailed-card::after{font-size:8px;left:2px;right:auto;top:3px;bottom:auto}.gameday-detailed-card::after{left:auto;right:2px;top:auto;bottom:3px}
      .gameday-detailed-card .gd-card-center{inset:17% 17%}
      .gameday-detailed-card .gd-card-pips{font-size:10px}
      .gameday-detailed-card .gd-card-ace{font-size:23px}
      .gameday-detailed-card .gd-card-face strong{font-size:16px}.gameday-detailed-card .gd-card-face span{font-size:12px}
      .gameday-custom-hint{font-size:7px}
    }
  `;
  document.head.appendChild(style);

  const validSuits = new Set(['♠','♥','♦','♣']);
  const validRanks = new Set(['2','3','4','5','6','7','8','9','10','J','Q','K','A']);
  const rankToPips = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10};

  function getRankSuit(card){
    const rankEl = card.querySelector('.card-rank,.rank');
    const suitEl = card.querySelector('.card-suit,.suit');
    const rank = rankEl?.textContent?.trim();
    const suit = suitEl?.textContent?.trim();
    if (!validRanks.has(rank) || !validSuits.has(suit)) return null;
    return {rank,suit};
  }

  function centerMarkup(rank,suit){
    if (rank === 'A') return `<div class="gd-card-center"><div class="gd-card-ace">${suit}</div></div>`;
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
      const emblem = rank === 'K' ? '♛' : rank === 'Q' ? '✦' : '◆';
      return `<div class="gd-card-center"><div class="gd-card-face"><strong>${rank}${emblem}</strong><span>${suit}</span></div></div>`;
    }
    const count = rankToPips[rank] || 0;
    const pips = Array.from({length:count},()=>`<span>${suit}</span>`).join('');
    return `<div class="gd-card-center"><div class="gd-card-pips">${pips}</div></div>`;
  }

  function decorateCards(root=document){
    if (!cardPages.has(path)) return;
    root.querySelectorAll?.('.card').forEach(card => {
      if (card.classList.contains('gameday-detailed-card')) return;
      if (card.classList.contains('hidden-card') || card.classList.contains('empty')) return;
      const rs = getRankSuit(card);
      if (!rs) return;
      card.classList.add('gameday-detailed-card');
      if (rs.suit === '♥' || rs.suit === '♦') card.classList.add('gd-red');
      card.dataset.gdRank = rs.rank;
      card.dataset.gdSuit = rs.suit;
      card.insertAdjacentHTML('beforeend', centerMarkup(rs.rank,rs.suit));
    });
  }

  function looksLikeWagerInput(input){
    if (!(input instanceof HTMLInputElement) || input.type !== 'number') return false;
    const key = `${input.id} ${input.name} ${input.getAttribute('aria-label')||''}`.toLowerCase();
    return /stake|bet|ante|wager|amount/.test(key) || wagerPages.has(path);
  }

  function inputLocked(input){
    return !input || input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true';
  }

  function normalizeAmount(input){
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || Number.MAX_SAFE_INTEGER);
    let v = Math.round(n);
    if (Number.isFinite(min)) v = Math.max(min,v);
    if (Number.isFinite(max)) v = Math.min(max,v);
    input.value = String(v);
  }

  function enhanceInputs(root=document){
    if (!wagerPages.has(path)) return;
    root.querySelectorAll?.('input[type="number"]').forEach(input => {
      if (!looksLikeWagerInput(input)) return;
      input.step = '1';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.classList.add('gameday-custom-wager-input');
      if (!input.dataset.gdCustomBound){
        input.dataset.gdCustomBound='1';
        input.addEventListener('blur',()=>normalizeAmount(input));
      }
      if (!input.nextElementSibling?.classList?.contains('gameday-custom-hint')){
        const hint=document.createElement('div');
        hint.className='gameday-custom-hint';
        hint.textContent='Custom bet: type any whole $ amount';
        input.insertAdjacentElement('afterend',hint);
      }
    });
  }

  function primaryWagerInput(){
    return [...document.querySelectorAll('input[type="number"]')].find(looksLikeWagerInput) || null;
  }

  function syncCustomLock(){
    const input = primaryWagerInput();
    const locked = inputLocked(input);
    document.querySelectorAll('.gameday-custom-button').forEach(button=>{
      button.disabled = locked;
      button.setAttribute('aria-disabled', locked ? 'true' : 'false');
    });
    document.querySelectorAll('.gameday-stake-display.gameday-custom-ready').forEach(el=>{
      el.setAttribute('aria-disabled', locked ? 'true' : 'false');
      el.tabIndex = locked ? -1 : 0;
    });
  }

  function setCustomAmount(){
    const input = primaryWagerInput();
    if (inputLocked(input)) return;
    const current = input.value || '25';
    const raw = window.prompt('Enter custom whole-dollar bet', current);
    if (raw === null) return;
    if (inputLocked(input)) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    input.value = String(Math.round(n));
    normalizeAmount(input);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelectorAll('.gameday-stake-display').forEach(el=>{el.textContent=`$${Number(input.value).toFixed(0)}`});
  }

  function enhanceCompactCustom(root=document){
    if (!wagerPages.has(path)) return;
    root.querySelectorAll?.('.gameday-stake-display').forEach(el=>{
      if (el.dataset.gdCustomBound) return;
      el.dataset.gdCustomBound='1';
      el.classList.add('gameday-custom-ready');
      el.setAttribute('role','button');
      el.setAttribute('aria-label','Set custom bet amount');
      el.addEventListener('click',setCustomAmount);
      el.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ') && el.getAttribute('aria-disabled')!=='true'){e.preventDefault();setCustomAmount()}});
    });
    root.querySelectorAll?.('.gameday-quick-chips').forEach(group=>{
      if (group.querySelector('.gameday-custom-button')) return;
      const b=document.createElement('button');
      b.type='button';
      b.className='gameday-custom-button';
      b.textContent='Custom';
      b.addEventListener('click',setCustomAmount);
      group.appendChild(b);
      group.style.gridTemplateColumns='repeat(5,1fr)';
    });
    syncCustomLock();
  }

  function refresh(root=document){
    decorateCards(root);
    enhanceInputs(root);
    enhanceCompactCustom(root);
    syncCustomLock();
  }

  let queued=false;
  const observer=new MutationObserver(mutations=>{
    if (queued) return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      for(const m of mutations){
        for(const node of m.addedNodes){
          if(node.nodeType===1) refresh(node);
        }
      }
      refresh(document);
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',()=>{
      refresh(document);
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','aria-disabled']});
      setTimeout(()=>refresh(document),500);
    },{once:true});
  } else {
    refresh(document);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','aria-disabled']});
    setTimeout(()=>refresh(document),500);
  }
})();
