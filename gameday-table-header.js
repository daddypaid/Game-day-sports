/* Project each game's existing wallet state into the shared table header.
   This presentation layer never creates an auth client or requests wallet data. */
(() => {
  'use strict';
  const games = {
    'gameday-blackjack.html': { name:'Blackjack', source:'.gd-blackjack-balance' },
    'gameday-baccarat.html': { name:'Baccarat', source:'#balance' },
    'gameday-roulette.html': { name:'Roulette', source:'#balance' },
    'gameday-jacks-or-better.html': { name:'Jacks or Better', source:'#gd-jacks-balance', poker:true },
    'gameday-texas-holdem.html': { name:'Texas Hold’em', source:'#poker-balance', poker:true },
    'gameday-omaha.html': { name:'Omaha', source:'#poker-balance', poker:true },
    'gameday-seven-card-stud.html': { name:'Seven-Card Stud', source:'#poker-balance', poker:true },
    'gameday-five-card-draw.html': { name:'Five-Card Draw', source:'#poker-balance', poker:true }
  };
  const fileFor = url => new URL(url, location.href).pathname.split('/').pop();
  function currency(value) {
    const text = String(value || '').trim();
    if (/[-−]\s*\$|\$\s*[-−]|checking|unavailable|not signed|—/i.test(text)) return '—';
    const match = text.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?![\d.])/);
    if (!match) return '—';
    return `$${match[1]}.${match[2] || '00'}`;
  }
  function makeHeader(game, inShell) {
    const header = document.createElement(inShell ? 'div' : 'header');
    header.className = 'gd-game-header';
    header.setAttribute('aria-label', `${game.name} navigation and balance`);
    const back = game.poker ? 'gameday-poker.html' : 'gameday-casino-v2.html';
    const backLabel = `Back to ${game.poker ? 'Poker Room' : 'Casino'}`;
    header.innerHTML = `<div class="gd-game-header-inner"><div class="gd-game-header-left"><a class="gd-game-header-action gd-game-header-back" href="${back}" aria-label="${backLabel}">‹</a><a class="gd-game-header-wallet" href="gameday-auth.html#accountPanel" aria-label="Open account and wallet"><span class="gd-game-header-wallet-label">BALANCE</span><output id="gd-game-header-balance" class="gd-game-header-balance">—</output></a></div><h1 class="gd-game-header-brand"><img class="gd-game-header-crown" src="assets/branding/gameday-crown.svg" alt="" aria-hidden="true"><span class="gd-game-header-wordmark">GameDay</span><span class="gd-game-header-caption"></span></h1><div class="gd-game-header-right"></div></div>`;
    header.querySelector('.gd-game-header-caption').textContent = game.name;
    header.querySelector('.gd-game-header-brand').setAttribute('aria-label', `GameDay ${game.name}`);
    return header;
  }
  function updateBalance(header, value) {
    const output = header.querySelector('.gd-game-header-balance');
    const next = currency(value);
    if (output.textContent !== next) output.textContent = next;
    header.querySelector('.gd-game-header-wallet').toggleAttribute('data-long-balance', next.length > 9);
  }
  function observeBalance(doc, selector, header) {
    let source = null;
    const observer = new MutationObserver(() => updateBalance(header, source?.textContent));
    function discover() {
      const next = doc.querySelector(selector);
      if (next === source) return;
      observer.disconnect();
      source = next;
      if (source) observer.observe(source, { childList:true, characterData:true, subtree:true });
      updateBalance(header, source?.textContent);
    }
    const discovery = new MutationObserver(discover);
    discovery.observe(doc.body, { childList:true, subtree:true });
    discover();
    return () => { observer.disconnect(); discovery.disconnect(); };
  }
  const game = games[fileFor(location.href)];
  if (game) {
    const original = document.querySelector('body > header');
    const header = makeHeader(game, false);
    original?.setAttribute('data-gd-header-source', '');
    document.body.classList.add('gd-table-header-page');
    document.body.prepend(header);
    const stop = observeBalance(document, game.source, header);
    window.addEventListener('pagehide', event => { if (!event.persisted) stop(); });
    return;
  }
  const frame = document.querySelector('#app.frame');
  const bar = document.querySelector('.bar');
  const menu = document.getElementById('menu');
  if (!frame || !bar || !menu) return;
  const menuParent = menu.parentNode, menuNext = menu.nextSibling;
  let header = null, stop = () => {};
  function restore() {
    stop();
    if (!header) return;
    menu.classList.remove('gd-game-header-action');
    menuParent.insertBefore(menu, menuNext);
    header.remove();
    header = null;
    document.body.classList.remove('gd-game-header-mode');
  }
  function syncFrame() {
    restore();
    try {
      const doc = frame.contentDocument;
      const current = games[fileFor(frame.contentWindow.location.href)];
      if (!doc?.body || !current) return;
      header = makeHeader(current, true);
      const back = header.querySelector('.gd-game-header-back');
      header.querySelector('.gd-game-header-right').append(back);
      header.querySelector('.gd-game-header-left').prepend(menu);
      menu.classList.add('gd-game-header-action');
      bar.append(header);
      document.body.classList.add('gd-game-header-mode');
      header.querySelectorAll('a').forEach(link => link.addEventListener('click', event => {
        event.preventDefault();
        frame.src = link.getAttribute('href');
        document.getElementById('shell')?.classList.remove('menu-open');
      }));
      stop = observeBalance(doc, '#gd-game-header-balance', header);
    } catch (_) { restore(); }
  }
  frame.addEventListener('load', syncFrame);
  syncFrame();
  window.addEventListener('pagehide', event => { if (!event.persisted) restore(); });
})();
