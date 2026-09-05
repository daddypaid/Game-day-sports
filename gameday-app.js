(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    });
  }

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  document.documentElement.dataset.gamedayApp = standalone ? 'standalone' : 'browser';
  if (!standalone) return;

  const path = location.pathname.split('/').pop() || 'gameday-sportsbook.html';
  const pageMap = {
    'gameday-sportsbook.html':'sportsbook',
    'gameday-casino-v2.html':'casino',
    'gameday-my-bets.html':'mybets',
    'gameday-auth.html':'account',
    'gameday-blackjack.html':'casino-game',
    'gameday-roulette.html':'casino-game',
    'gameday-baccarat.html':'casino-game',
    'gameday-slots.html':'casino-game'
  };
  document.documentElement.dataset.gamedayPage = pageMap[path] || 'other';

  const style = document.createElement('style');
  style.textContent = `
    html[data-gameday-app="standalone"]{-webkit-text-size-adjust:100%;background:#090e0b}
    html[data-gameday-app="standalone"] body{padding-bottom:calc(92px + env(safe-area-inset-bottom))!important}
    html[data-gameday-app="standalone"] header{padding-top:max(9px,env(safe-area-inset-top));padding-bottom:11px!important;box-shadow:0 1px 0 rgba(255,255,255,.025)}
    html[data-gameday-app="standalone"] .gameday-legacy-nav{display:none!important}
    html[data-gameday-app="standalone"] main{padding-left:max(14px,env(safe-area-inset-left));padding-right:max(14px,env(safe-area-inset-right))}
    html[data-gameday-app="standalone"] .featured,html[data-gameday-app="standalone"] .market-tabs{scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity}
    html[data-gameday-app="standalone"] .featured::-webkit-scrollbar,html[data-gameday-app="standalone"] .market-tabs::-webkit-scrollbar{display:none}
    html[data-gameday-app="standalone"] .featured .sport,html[data-gameday-app="standalone"] .market-tabs .market{flex:0 0 auto;scroll-snap-align:start}
    html[data-gameday-app="standalone"] .card{border-radius:18px}
    html[data-gameday-app="standalone"] .world{min-height:50px}
    html[data-gameday-app="standalone"] .view{min-height:46px}
    html[data-gameday-app="standalone"] .slipbar{bottom:calc(66px + env(safe-area-inset-bottom));padding:8px 14px;background:rgba(9,14,11,.96);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-top:1px solid #26372d}
    html[data-gameday-app="standalone"] .slipbar button{min-height:50px;border-radius:15px;font-size:15px}

    html[data-gameday-page="casino"] main{padding-top:10px!important}
    html[data-gameday-page="casino"] .hero{padding:16px!important;border-radius:16px!important;margin-bottom:10px!important}
    html[data-gameday-page="casino"] .hero h2{font-size:25px!important;margin-bottom:5px!important}
    html[data-gameday-page="casino"] .hero p{font-size:13px!important;line-height:1.35!important}
    html[data-gameday-page="casino"] .notice{padding:10px 12px!important;margin-bottom:12px!important;font-size:13px!important;line-height:1.35!important}
    html[data-gameday-page="casino"] .games{gap:10px!important}
    html[data-gameday-page="casino"] .game{min-height:126px!important;padding:14px!important;border-radius:15px!important}
    html[data-gameday-page="casino"] .icon{font-size:31px!important}
    html[data-gameday-page="casino"] .name{font-size:19px!important;margin-top:6px!important}
    html[data-gameday-page="casino"] .copy{font-size:11px!important;margin-top:4px!important;line-height:1.35!important}
    html[data-gameday-page="casino"] .status{margin-top:9px!important}

    html[data-gameday-page="casino-game"] header h1{font-size:20px!important;line-height:1.05!important;max-width:58%;}
    html[data-gameday-page="casino-game"] header .badge{padding:5px 8px!important;font-size:9px!important}
    html[data-gameday-page="casino-game"] .account-row{margin-top:6px!important}
    html[data-gameday-page="casino-game"] main{padding-top:10px!important}
    html[data-gameday-page="casino-game"] .notice,
    html[data-gameday-page="casino-game"] .error,
    html[data-gameday-page="casino-game"] .success{padding:10px 12px!important;margin-bottom:10px!important;font-size:13px!important;line-height:1.35!important;border-radius:10px!important}

    html[data-gameday-page="mybets"] header,
    html[data-gameday-page="account"] header{padding-bottom:10px!important}

    .gameday-app-nav{position:fixed;z-index:140;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(4,1fr);gap:2px;padding:7px max(8px,env(safe-area-inset-right)) calc(7px + env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));background:rgba(15,23,18,.97);border-top:1px solid #2b3a31;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
    .gameday-app-nav a{min-width:0;text-decoration:none;color:#8fa096;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:52px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.01em}
    .gameday-app-nav a .gameday-nav-icon{font-size:20px;line-height:1}
    .gameday-app-nav a.active{color:#eef5f0;background:#17321f}
    .gameday-app-nav a:active{transform:scale(.97)}
    @media(max-width:430px){
      html[data-gameday-app="standalone"] header{padding-left:14px;padding-right:14px}
      html[data-gameday-app="standalone"] header h1{font-size:22px;line-height:1.08}
      html[data-gameday-app="standalone"] header .sub{font-size:11px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      html[data-gameday-app="standalone"] .account-row{margin-top:7px!important}
      html[data-gameday-app="standalone"] .balance{font-size:12px!important;padding:7px 9px!important}
      html[data-gameday-app="standalone"] .section{margin-top:14px!important}
      html[data-gameday-page="casino-game"] header h1{font-size:20px!important}
    }
  `;
  document.head.appendChild(style);

  const canonical = [
    ['Sportsbook','gameday-sportsbook.html','◉'],
    ['Casino','gameday-casino-v2.html','♠'],
    ['My Bets','gameday-my-bets.html','✓'],
    ['Account','gameday-auth.html','●']
  ];

  document.querySelectorAll('.nav').forEach(nav => {
    const hrefs = [...nav.querySelectorAll('a')].map(a => a.getAttribute('href') || '');
    if (canonical.every(([,href]) => hrefs.includes(href))) nav.classList.add('gameday-legacy-nav');
  });

  let activeHref = path;
  if (['gameday-blackjack.html','gameday-roulette.html','gameday-baccarat.html','gameday-slots.html'].includes(path)) activeHref = 'gameday-casino-v2.html';

  const nav = document.createElement('nav');
  nav.className = 'gameday-app-nav';
  nav.setAttribute('aria-label','GameDay app navigation');
  nav.innerHTML = canonical.map(([label,href,icon]) => {
    const active = activeHref === href;
    return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ''}><span class="gameday-nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
  }).join('');
  document.body.appendChild(nav);
})();
