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
  const gameNavigation = {
    'gameday-blackjack.html': { hub: 'gameday-casino-v2.html', hubLabel: 'Casino', previous: 'gameday-baccarat.html', next: 'gameday-baccarat.html' },
    'gameday-baccarat.html': { hub: 'gameday-casino-v2.html', hubLabel: 'Casino', previous: 'gameday-blackjack.html', next: 'gameday-blackjack.html' },
    'gameday-video-poker.html': { hub: 'gameday-poker.html', hubLabel: 'Poker Room', previous: 'gameday-caribbean-stud.html', next: 'gameday-bonus-poker.html' },
    'gameday-bonus-poker.html': { hub: 'gameday-poker.html', hubLabel: 'Poker Room', previous: 'gameday-video-poker.html', next: 'gameday-deuces-wild.html' },
    'gameday-deuces-wild.html': { hub: 'gameday-poker.html', hubLabel: 'Poker Room', previous: 'gameday-bonus-poker.html', next: 'gameday-three-card-poker.html' },
    'gameday-three-card-poker.html': { hub: 'gameday-poker.html', hubLabel: 'Poker Room', previous: 'gameday-deuces-wild.html', next: 'gameday-ultimate-texas-holdem.html' },
    'gameday-ultimate-texas-holdem.html': { hub: 'gameday-poker.html', hubLabel: 'Poker Room', previous: 'gameday-three-card-poker.html', next: 'gameday-caribbean-stud.html' },
    'gameday-caribbean-stud.html': { hub: 'gameday-poker.html', hubLabel: 'Poker Room', previous: 'gameday-ultimate-texas-holdem.html', next: 'gameday-video-poker.html' }
  };
  const chipValues = [1, 5, 10, 25, 100, 500];
  if (!cardPages.has(path) && !wagerPages.has(path)) return;
  if (cardPages.has(path)) document.body.classList.add('gd-card-wager-page');

  const style = document.createElement('style');
  style.textContent = `
    .gameday-detailed-card{position:relative!important;overflow:hidden!important;aspect-ratio:5/7;background:linear-gradient(145deg,#fff 0%,#fdfcf9 72%,#f2efe8 100%)!important;border:1px solid #c9c6bd!important;box-shadow:0 3px 10px rgba(0,0,0,.32),inset 0 0 0 1px #fff!important;color:#111!important;font-family:Georgia,'Times New Roman',serif!important;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
    .gameday-detailed-card.gd-red{color:#c0182b!important}
    .gameday-detailed-card .rank,.gameday-detailed-card .suit,.gameday-detailed-card .card-rank,.gameday-detailed-card .card-suit{visibility:hidden!important}
    .gameday-detailed-card::before,.gameday-detailed-card::after{position:absolute;z-index:5;content:attr(data-gd-rank)'\\A' attr(data-gd-suit);white-space:pre;line-height:.82;text-align:center;font-weight:900;font-family:Georgia,'Times New Roman',serif;font-size:clamp(9px,3vw,14px);letter-spacing:-.04em}
    .gameday-detailed-card::before{left:4px;top:4px}
    .gameday-detailed-card::after{right:4px;bottom:4px;transform:rotate(180deg)}
    .gameday-detailed-card .gd-card-center{position:absolute;inset:15% 18%;z-index:2;font-family:Georgia,'Times New Roman',serif}
    .gameday-detailed-card .gd-card-pips{position:relative;width:100%;height:100%;font-size:clamp(10px,4.8vw,21px);line-height:1}
    .gameday-detailed-card .gd-pip{position:absolute;left:var(--x);top:var(--y);transform:translate(-50%,-50%) rotate(var(--r,0deg))}
    .gameday-detailed-card .gd-card-ace{position:absolute;inset:0;display:grid;place-items:center;font-size:clamp(24px,10vw,48px);font-weight:900;text-shadow:0 1px 0 #fff}
    .gameday-detailed-card .gd-card-face{position:absolute;inset:0;border:1px solid currentColor;background:linear-gradient(135deg,#fff 0 24%,#d8bd62 24% 28%,#173b25 28% 48%,#f7f4e9 48% 52%,#173b25 52% 72%,#d8bd62 72% 76%,#fff 76%);box-shadow:inset 0 0 0 2px #fff;overflow:hidden}
    .gameday-detailed-card .gd-card-face::after{content:'';position:absolute;inset:12% 19%;border:1px solid currentColor;border-radius:50%;background:#f5dfb0}
    .gameday-detailed-card .gd-court{position:absolute;z-index:2;inset:0;display:grid;place-items:center;text-align:center;font:900 clamp(14px,6vw,28px)/.78 Georgia,'Times New Roman',serif;text-shadow:0 1px #fff}
    .gameday-detailed-card .gd-court small{display:block;font-size:.7em;margin-top:3px}
    .gameday-card-back{position:relative!important;overflow:hidden!important;aspect-ratio:5/7;background:#123923!important;border:2px solid #d8bd62!important;box-shadow:0 3px 10px rgba(0,0,0,.35),inset 0 0 0 2px #f8f3df,inset 0 0 0 4px #123923!important;color:#f5df8e!important}
    .gameday-card-back::before{content:'';position:absolute;inset:7px;border:1px solid rgba(255,255,255,.72);background:repeating-linear-gradient(45deg,transparent 0 4px,rgba(216,189,98,.22) 4px 6px),repeating-linear-gradient(-45deg,transparent 0 4px,rgba(255,255,255,.12) 4px 6px)}
    .gameday-card-back::after{content:'GD';position:absolute;inset:25%;display:grid;place-items:center;border:1px solid #d8bd62;border-radius:50%;background:#123923;font:900 clamp(11px,4vw,20px)/1 Georgia,serif;letter-spacing:-.08em;color:#f5df8e;text-shadow:0 1px #000}

    .gameday-custom-wager-input{border-color:#b99a42!important;box-shadow:0 0 0 1px rgba(215,189,98,.22)!important;font-weight:900!important}
    .gameday-custom-hint{margin-top:2px;color:#d9c36f;font-size:8px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
    .gd-game-navigation{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 9px;border-top:1px solid rgba(215,189,98,.35);background:rgba(2,4,3,.94);font:800 12px/1 Arial,sans-serif;letter-spacing:.02em}
    .gd-game-navigation a{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:0 10px;border:1px solid rgba(215,189,98,.7);border-radius:999px;color:#ffe5a0;text-decoration:none;background:rgba(19,48,30,.88);white-space:nowrap}
    .gd-game-navigation .gd-game-pager{display:flex;gap:6px}.gd-game-navigation .gd-game-pager a{min-width:42px;padding:0 8px}
    .gd-game-navigation a:focus-visible{outline:2px solid #fff;outline-offset:2px}
    .chips button.gd-selected-chip,.quick-bets button.gd-selected-chip{outline:3px solid #fff!important;outline-offset:2px!important;box-shadow:0 0 0 3px #d7bd62,0 5px 14px rgba(0,0,0,.55)!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip]{border:2px dashed #d7bd62!important;border-radius:999px!important;aspect-ratio:1;min-width:44px;color:#fff!important;font-weight:900!important;text-shadow:0 1px 2px #000!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip="1"]{background:#f7f4ea!important;color:#111!important;text-shadow:none!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip="5"]{background:#a91422!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip="10"]{background:#1254a3!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip="25"]{background:#087047!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip="100"]{background:#111!important}
    .gd-card-wager-page :is(.chips,.quick-bets) button[data-chip="500"]{background:#642090!important}

    @media(max-width:430px){
      .gameday-detailed-card::before,.gameday-detailed-card::after{font-size:9px}.gameday-detailed-card::before{left:3px;top:3px}.gameday-detailed-card::after{right:3px;bottom:3px}
      .gameday-detailed-card .gd-card-center{inset:16% 18%}
      .gameday-detailed-card .gd-card-pips{font-size:11px}
      .gameday-detailed-card .gd-card-ace{font-size:25px}
      .gameday-detailed-card .gd-court{font-size:15px}
      .gameday-custom-hint{font-size:7px}
      .gd-game-navigation{padding:4px 6px;font-size:11px}.gd-game-navigation a{min-height:28px;padding:0 8px}
    }
  `;
  document.head.appendChild(style);

  const validSuits = new Set(['♠','♥','♦','♣']);
  const validRanks = new Set(['2','3','4','5','6','7','8','9','10','J','Q','K','A']);
  const pipLayouts = {
    2:[[50,18,0],[50,82,180]],
    3:[[50,18,0],[50,50,0],[50,82,180]],
    4:[[24,20,0],[76,20,0],[24,80,180],[76,80,180]],
    5:[[24,20,0],[76,20,0],[50,50,0],[24,80,180],[76,80,180]],
    6:[[24,18,0],[76,18,0],[24,50,0],[76,50,0],[24,82,180],[76,82,180]],
    7:[[24,16,0],[76,16,0],[50,34,0],[24,50,0],[76,50,0],[24,82,180],[76,82,180]],
    8:[[24,16,0],[76,16,0],[50,32,0],[24,43,0],[76,43,0],[50,68,180],[24,84,180],[76,84,180]],
    9:[[24,14,0],[76,14,0],[24,38,0],[76,38,0],[50,50,0],[24,62,180],[76,62,180],[24,86,180],[76,86,180]],
    10:[[24,12,0],[76,12,0],[50,27,0],[24,36,0],[76,36,0],[24,64,180],[76,64,180],[50,73,180],[24,88,180],[76,88,180]]
  };

  function getRankSuit(card){
    const rankEl = card.querySelector('.card-rank,.rank');
    const suitEl = card.querySelector('.card-suit,.suit');
    const rank = rankEl?.textContent?.trim();
    const suit = suitEl?.textContent?.trim();
    if (!validRanks.has(rank) || !validSuits.has(suit)) return null;
    return {rank,suit};
  }

  function centerMarkup(rank,suit){
    if (rank === 'A' && suit === '♠') return `<div class="gd-card-center"><div class="gd-card-ace gd-signature-ace"><small>♛</small>G</div></div>`;
    if (rank === 'A') return `<div class="gd-card-center"><div class="gd-card-ace">${suit}</div></div>`;
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
      return `<div class="gd-card-center"><div class="gd-card-face"><div class="gd-court">${rank}<small>${suit}</small></div></div></div>`;
    }
    const pips = (pipLayouts[rank] || []).map(([x,y,r])=>`<span class="gd-pip" style="--x:${x}%;--y:${y}%;--r:${r}deg">${suit}</span>`).join('');
    return `<div class="gd-card-center"><div class="gd-card-pips">${pips}</div></div>`;
  }

  function decorateCards(root=document){
    if (!cardPages.has(path)) return;
    root.querySelectorAll?.('.card').forEach(card => {
      if (card.classList.contains('gameday-detailed-card') || card.classList.contains('gameday-card-back')) return;
      if (card.classList.contains('hidden-card') || card.classList.contains('back')) {
        card.classList.add('gameday-card-back');
        card.textContent='';
        card.setAttribute('aria-label','GameDay card back');
        return;
      }
      if (card.classList.contains('empty')) return;
      const rs = getRankSuit(card);
      if (!rs) return;
      card.classList.add('gameday-detailed-card');
      if (rs.suit === '♥' || rs.suit === '♦') card.classList.add('gd-red');
      card.dataset.gdRank = rs.rank;
      card.dataset.gdSuit = rs.suit;
      card.setAttribute('aria-label',`${rs.rank} of ${{'♠':'spades','♥':'hearts','♦':'diamonds','♣':'clubs'}[rs.suit]}`);
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

  function wagerInputFor(group){
    const panel = group.closest('.controls,.control-card,.decision,.stake,.stake-row') || document;
    return panel.querySelector('input[type="number"]') || primaryWagerInput();
  }

  function syncChipGroup(group){
    const input = wagerInputFor(group);
    const locked = inputLocked(input);
    const selected = Number(input?.value);
    group.querySelectorAll('button[data-chip]').forEach(button=>{
      const active = Number(button.dataset.chip) === selected;
      button.disabled = locked;
      button.classList.toggle('gd-selected-chip', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function normalizeChipGroup(group){
    if (!cardPages.has(path)) return;
    if (group.dataset.gdChipSet !== '1') {
      group.dataset.gdChipSet = '1';
      group.replaceChildren(...chipValues.map(value=>{
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.chip = String(value);
        button.textContent = `$${value}`;
        button.setAttribute('aria-label', `Set bet to $${value}`);
        button.addEventListener('click',()=>{
          const input = wagerInputFor(group);
          if (inputLocked(input)) return;
          input.value = String(path === 'gameday-blackjack.html' ? Math.min(Number(input.max || 10000), Math.max(0, Number(input.value) || 0) + value) : value);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
          syncChipGroup(group);
        });
        return button;
      }));
      const input = wagerInputFor(group);
      if (input && !input.dataset.gdChipSync) {
        input.dataset.gdChipSync = '1';
        input.addEventListener('input',()=>document.querySelectorAll('.chips,.quick-bets').forEach(syncChipGroup));
        input.addEventListener('change',()=>document.querySelectorAll('.chips,.quick-bets').forEach(syncChipGroup));
      }
    }
    syncChipGroup(group);
  }

  function normalizeCardChips(root=document){
    root.querySelectorAll?.('.chips,.quick-bets').forEach(normalizeChipGroup);
  }

  function addGameNavigation(){
    const config = gameNavigation[path];
    const header = document.querySelector('header');
    if (!config || !header || header.querySelector('.gd-game-navigation')) return;
    const nav = document.createElement('nav');
    nav.className = 'gd-game-navigation';
    nav.setAttribute('aria-label','Game navigation');
    const back = document.createElement('a');
    back.className = 'gd-game-back';
    back.href = config.hub;
    back.textContent = `‹ Back to ${config.hubLabel}`;
    const pager = document.createElement('div');
    pager.className = 'gd-game-pager';
    const previous = document.createElement('a');
    previous.href = config.previous;
    previous.setAttribute('aria-label','Previous game');
    previous.textContent = '‹ Prev';
    const next = document.createElement('a');
    next.href = config.next;
    next.setAttribute('aria-label','Next game');
    next.textContent = 'Next ›';
    pager.append(previous,next);
    nav.append(back,pager);
    header.append(nav);
  }

  function refresh(root=document){
    decorateCards(root);
    enhanceInputs(root);
    normalizeCardChips(root);
    addGameNavigation();
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
