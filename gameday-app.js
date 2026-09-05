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
    'gameday-slots.html':'casino-game',
    'gameday-poker.html':'poker',
    'gameday-video-poker.html':'poker-game',
    'gameday-bonus-poker.html':'poker-game',
    'gameday-deuces-wild.html':'poker-game',
    'gameday-ultimate-texas-holdem.html':'poker-game',
    'gameday-caribbean-stud.html':'poker-game',
    'gameday-three-card-poker.html':'poker-game'
  };
  const gameMap = {
    'gameday-blackjack.html':'blackjack',
    'gameday-roulette.html':'roulette',
    'gameday-baccarat.html':'baccarat',
    'gameday-slots.html':'slots'
  };
  document.documentElement.dataset.gamedayPage = pageMap[path] || 'other';
  if (gameMap[path]) document.documentElement.dataset.gamedayGame = gameMap[path];

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

    html[data-gameday-page="casino-game"] body{overflow:hidden!important;height:100dvh!important;padding-bottom:0!important}
    html[data-gameday-page="casino-game"] header{position:relative!important;padding-bottom:7px!important}
    html[data-gameday-page="casino-game"] header h1{font-size:20px!important;line-height:1.05!important;max-width:58%}
    html[data-gameday-page="casino-game"] header .badge{padding:5px 8px!important;font-size:9px!important}
    html[data-gameday-page="casino-game"] .account-row{margin-top:5px!important}
    html[data-gameday-page="casino-game"] main{height:calc(100dvh - 146px - env(safe-area-inset-bottom));overflow:hidden!important;padding-top:6px!important;padding-bottom:0!important}
    html[data-gameday-page="casino-game"] main>.notice{display:none!important}
    html[data-gameday-page="casino-game"] .history-title,html[data-gameday-page="casino-game"] #history{display:none!important}
    html[data-gameday-page="casino-game"] #message{position:absolute;z-index:125;left:12px;right:12px;top:96px;pointer-events:none}
    html[data-gameday-page="casino-game"] #message .notice,html[data-gameday-page="casino-game"] #message .error,html[data-gameday-page="casino-game"] #message .success{padding:8px 10px!important;margin:0!important;font-size:11px!important;line-height:1.25!important;box-shadow:0 7px 25px rgba(0,0,0,.35)}
    html[data-gameday-page="casino-game"] .control-card,html[data-gameday-page="casino-game"] .controls{position:fixed!important;z-index:130!important;left:10px!important;right:10px!important;bottom:calc(66px + env(safe-area-inset-bottom))!important;margin:0!important;padding:9px!important;border-radius:14px 14px 0 0!important;max-height:31dvh!important;overflow:hidden!important;background:rgba(13,20,15,.98)!important;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 -8px 24px rgba(0,0,0,.32)}
    html[data-gameday-page="casino-game"] label{margin-bottom:3px!important;font-size:10px!important}
    html[data-gameday-page="casino-game"] input{padding:8px 10px!important;font-size:15px!important;min-height:36px!important}
    html[data-gameday-page="casino-game"] button{min-height:36px!important}

    html[data-gameday-game="blackjack"] .table{min-height:0!important;height:calc(69dvh - 92px)!important;padding:9px 10px!important;border-radius:20px!important}
    html[data-gameday-game="blackjack"] .hand-area{min-height:0!important;height:43%!important}
    html[data-gameday-game="blackjack"] .card{width:54px!important;height:76px!important;padding:5px!important}
    html[data-gameday-game="blackjack"] .card-rank{font-size:14px!important}
    html[data-gameday-game="blackjack"] .card-suit{font-size:23px!important}
    html[data-gameday-game="blackjack"] .total{margin-top:5px!important;font-size:12px!important}
    html[data-gameday-game="blackjack"] .divider{margin:4px 0!important}
    html[data-gameday-game="blackjack"] .quick-bets{grid-template-columns:repeat(4,1fr)!important;margin-top:5px!important;gap:5px!important}
    html[data-gameday-game="blackjack"] .actions{margin-top:6px!important;gap:5px!important}
    html[data-gameday-game="blackjack"] .result-card{display:none!important}

    html[data-gameday-game="roulette"] main{display:flex!important;flex-direction:column!important;height:calc(100dvh - 146px - env(safe-area-inset-bottom))!important;padding:3px 8px 0!important}
    html[data-gameday-game="roulette"] .gameday-roulette-stage{display:grid!important;grid-template-rows:174px minmax(0,1fr)!important;gap:4px!important;min-height:0!important;height:100%!important}
    html[data-gameday-game="roulette"] .gameday-roulette-top{min-height:0!important;position:relative!important}
    html[data-gameday-game="roulette"] .wheel{width:164px!important;height:164px!important;margin:2px auto!important;border-width:5px!important}
    html[data-gameday-game="roulette"] .wheel-label{font-size:6px!important;width:18px!important;height:13px!important;margin-left:-9px!important;margin-top:-6.5px!important}
    html[data-gameday-game="roulette"] .roulette-ball{width:9px!important;height:9px!important;margin-left:-4.5px!important;margin-top:-4.5px!important}
    html[data-gameday-game="roulette"] .wheel-result{width:54px!important;height:54px!important;font-size:22px!important;border-width:2px!important}
    html[data-gameday-game="roulette"] .result-text{font-size:11px!important;margin:-1px 0 2px!important;line-height:1.15!important}
    html[data-gameday-game="roulette"] .control-card{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;z-index:1!important;max-height:none!important;height:100%!important;overflow:hidden!important;padding:5px!important;border-radius:8px!important;box-shadow:none!important;display:grid!important;grid-template-rows:minmax(0,1fr) 40px!important;gap:4px!important;background:linear-gradient(#0e2d18,#09150d)!important;border:1px solid #2f6943!important}
    html[data-gameday-game="roulette"] .control-card>label,html[data-gameday-game="roulette"] .control-card>input,html[data-gameday-game="roulette"] .control-card>.chips,html[data-gameday-game="roulette"] .control-card>.bet-title,html[data-gameday-game="roulette"] .control-card>.outside{display:none!important}
    html[data-gameday-game="roulette"] .gameday-roulette-table{display:grid!important;grid-template-columns:52px minmax(0,1fr)!important;gap:3px!important;min-height:0!important;height:100%!important}
    html[data-gameday-game="roulette"] .gameday-outside-rail{display:grid!important;grid-template-rows:repeat(6,1fr)!important;gap:2px!important;min-height:0!important}
    html[data-gameday-game="roulette"] .gameday-outside-rail .bet-button{min-height:0!important;height:auto!important;padding:2px!important;font-size:10px!important;border-radius:2px!important;writing-mode:vertical-rl!important;transform:rotate(180deg)!important;border:1px solid rgba(255,255,255,.35)!important}
    html[data-gameday-game="roulette"] .number-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;grid-template-rows:30px repeat(12,minmax(0,1fr))!important;gap:2px!important;min-height:0!important;height:100%!important}
    html[data-gameday-game="roulette"] .number{min-height:0!important;height:auto!important;font-size:12px!important;border-radius:1px!important;padding:0!important;border:1px solid rgba(255,255,255,.38)!important}
    html[data-gameday-game="roulette"] .number.zero{grid-column:1/-1!important;min-height:0!important;background:#12672e!important}
    html[data-gameday-game="roulette"] .gameday-roulette-actions{display:grid!important;grid-template-columns:70px 1fr 92px!important;gap:4px!important;align-items:center!important;min-height:40px!important}
    html[data-gameday-game="roulette"] .gameday-stake-display{display:flex!important;align-items:center!important;justify-content:center!important;height:38px!important;background:#08110b!important;border:1px solid #365a42!important;border-radius:6px!important;font-size:11px!important;font-weight:800!important}
    html[data-gameday-game="roulette"] .gameday-quick-chips{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:3px!important}
    html[data-gameday-game="roulette"] .gameday-quick-chips button{min-height:38px!important;height:38px!important;padding:0!important;border-radius:20px!important;background:#26312a!important;color:#fff!important;font-size:10px!important}
    html[data-gameday-game="roulette"] .spin{margin:0!important;min-height:38px!important;height:38px!important;font-size:12px!important;border-radius:7px!important}

    html[data-gameday-game="baccarat"] .table{min-height:0!important;height:calc(69dvh - 92px)!important;padding:8px 10px!important;border-radius:20px!important;display:grid!important;grid-template-columns:1fr 1fr!important;grid-template-rows:auto 1fr auto!important;gap:4px 8px!important;align-items:center!important}
    html[data-gameday-game="baccarat"] .table-title{grid-column:1/-1!important}
    html[data-gameday-game="baccarat"] .side{margin:0!important;min-width:0!important}
    html[data-gameday-game="baccarat"] .side-title{font-size:14px!important;margin-bottom:4px!important}
    html[data-gameday-game="baccarat"] .versus{display:none!important}
    html[data-gameday-game="baccarat"] .card{width:48px!important;height:68px!important;padding:4px!important}
    html[data-gameday-game="baccarat"] .rank{font-size:12px!important}
    html[data-gameday-game="baccarat"] .suit{font-size:20px!important}
    html[data-gameday-game="baccarat"] .total{margin-top:4px!important;font-size:11px!important}
    html[data-gameday-game="baccarat"] .result{grid-column:1/-1!important;font-size:15px!important;margin:0!important}
    html[data-gameday-game="baccarat"] .controls{max-height:31dvh!important}
    html[data-gameday-game="baccarat"] .quick-bets{grid-template-columns:repeat(4,1fr)!important;margin:4px 0 5px!important;gap:4px!important}
    html[data-gameday-game="baccarat"] .bet-options{gap:4px!important}
    html[data-gameday-game="baccarat"] .bet-btn{min-height:44px!important;font-size:11px!important}
    html[data-gameday-game="baccarat"] .play-btn{margin-top:5px!important;min-height:38px!important;font-size:14px!important}

    html[data-gameday-game="slots"] .machine{padding:10px!important;border-radius:18px!important}
    html[data-gameday-game="slots"] .machine-title{font-size:20px!important;margin-bottom:7px!important}
    html[data-gameday-game="slots"] .reel{min-height:82px!important;font-size:42px!important}
    html[data-gameday-game="slots"] .result{font-size:15px!important;margin-top:7px!important}
    html[data-gameday-game="slots"] .controls{max-height:25dvh!important}
    html[data-gameday-game="slots"] .chips{margin:4px 0 5px!important;gap:4px!important}
    html[data-gameday-game="slots"] .spin{min-height:40px!important;font-size:15px!important}
    html[data-gameday-game="slots"] .paytable{display:none!important}

    html[data-gameday-page="mybets"] header,html[data-gameday-page="account"] header{padding-bottom:10px!important}
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
      html[data-gameday-page="casino-game"] header h1{font-size:19px!important}
    }
  `;
  document.head.appendChild(style);

  const immersiveStyle = document.createElement('style');
  immersiveStyle.textContent = `
    html[data-gameday-page="casino-game"] header{background:linear-gradient(180deg,rgba(18,18,18,.98),rgba(8,10,8,.96))!important;border-bottom:1px solid rgba(255,255,255,.14)!important}
    html[data-gameday-page="casino-game"] header h1{letter-spacing:.01em;text-shadow:0 2px 8px rgba(0,0,0,.6)}
    html[data-gameday-page="casino-game"] .badge{background:#3a2c0e!important;border-color:#9f7f22!important;color:#ffe68f!important}
    html[data-gameday-page="casino-game"] .balance{background:rgba(5,55,27,.88)!important;border-color:#2b9a55!important;box-shadow:inset 0 0 12px rgba(0,0,0,.25)}
    html[data-gameday-page="casino-game"] .account{opacity:.8}
    html[data-gameday-page="casino-game"] .gameday-app-nav{background:rgba(4,8,5,.96)!important;border-top-color:rgba(255,255,255,.12)!important}

    html[data-gameday-game="blackjack"] body{background:radial-gradient(circle at 50% 36%,#0c5a31 0,#073d23 35%,#031d11 72%,#020b07 100%)!important}
    html[data-gameday-game="blackjack"] main{padding:4px 8px 0!important}
    html[data-gameday-game="blackjack"] .table{background:radial-gradient(ellipse at center,#0e6a3a 0%,#064522 60%,#032616 100%)!important;border:3px solid #b6953e!important;border-radius:34px 34px 18px 18px!important;box-shadow:inset 0 0 45px rgba(0,0,0,.52),0 12px 30px rgba(0,0,0,.35)!important;position:relative!important}
    html[data-gameday-game="blackjack"] .table::before{content:'BLACKJACK PAYS 3 TO 2';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:11px;font-weight:800;letter-spacing:.18em;color:rgba(236,218,150,.45);white-space:nowrap}
    html[data-gameday-game="blackjack"] .table-label{color:#e7d593!important;letter-spacing:.22em!important}
    html[data-gameday-game="blackjack"] .hand-title{font-size:13px!important;letter-spacing:.08em;text-transform:uppercase;color:#f2e8c0!important}
    html[data-gameday-game="blackjack"] .control-card{background:linear-gradient(180deg,rgba(13,22,16,.96),rgba(5,10,7,.99))!important;border:1px solid #8d7330!important;box-shadow:0 -12px 30px rgba(0,0,0,.5)!important}
    html[data-gameday-game="blackjack"] .quick-bets button{border-radius:20px!important;background:radial-gradient(circle,#305a36,#17271b)!important;border:1px solid #b4943d!important}
    html[data-gameday-game="blackjack"] .deal-btn{background:#f2e6b1!important}
    html[data-gameday-game="blackjack"] .hit-btn{background:#166b39!important}
    html[data-gameday-game="blackjack"] .stand-btn{background:#7c2b2b!important}

    html[data-gameday-game="roulette"] body{background:radial-gradient(circle at 50% 18%,#183120 0,#07140c 50%,#030805 100%)!important}
    html[data-gameday-game="roulette"] .gameday-roulette-top{background:radial-gradient(ellipse at center,#1c2d20 0%,#060b08 70%)!important;border-radius:12px!important;border:1px solid rgba(218,190,99,.4)!important;box-shadow:inset 0 0 25px rgba(0,0,0,.65)!important}
    html[data-gameday-game="roulette"] .wheel{box-shadow:inset 0 0 34px rgba(0,0,0,.75),0 0 0 3px #463a1b,0 8px 18px rgba(0,0,0,.5)!important}
    html[data-gameday-game="roulette"] .control-card{background:linear-gradient(180deg,#0c3b20,#04190d)!important;border-color:#b29236!important}
    html[data-gameday-game="roulette"] .number,html[data-gameday-game="roulette"] .gameday-outside-rail .bet-button{font-weight:800!important;text-shadow:0 1px 2px #000}
    html[data-gameday-game="roulette"] .spin{background:#f0df9b!important;box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)!important}

    html[data-gameday-game="baccarat"] body{background:radial-gradient(circle at 50% 32%,#7f1619 0,#4d0e10 40%,#210608 78%,#0b0203 100%)!important}
    html[data-gameday-game="baccarat"] main{padding:4px 7px 0!important}
    html[data-gameday-game="baccarat"] .table{height:calc(70dvh - 86px)!important;background:radial-gradient(ellipse at center,#9c2024 0%,#731418 58%,#480a0d 100%)!important;border:3px solid #c4a54d!important;border-radius:18px!important;box-shadow:inset 0 0 45px rgba(0,0,0,.38),0 12px 30px rgba(0,0,0,.38)!important;position:relative!important;overflow:hidden!important}
    html[data-gameday-game="baccarat"] .table::before{content:'GAMEDAY BACCARAT';position:absolute;left:50%;top:16px;transform:translateX(-50%);font-size:10px;font-weight:900;letter-spacing:.24em;color:rgba(248,222,147,.58);white-space:nowrap}
    html[data-gameday-game="baccarat"] .table-title{opacity:0!important}
    html[data-gameday-game="baccarat"] .player-side,html[data-gameday-game="baccarat"] .banker-side{height:100%!important;display:flex!important;flex-direction:column!important;justify-content:center!important;border:2px solid rgba(224,190,91,.5)!important;border-radius:12px!important;padding:7px!important;box-shadow:inset 0 0 18px rgba(0,0,0,.2)!important}
    html[data-gameday-game="baccarat"] .player-side{background:linear-gradient(180deg,rgba(22,55,132,.35),rgba(41,20,54,.14))!important}
    html[data-gameday-game="baccarat"] .banker-side{background:linear-gradient(180deg,rgba(145,24,37,.36),rgba(65,12,19,.15))!important}
    html[data-gameday-game="baccarat"] .side-title{font-size:18px!important;letter-spacing:.12em;text-transform:uppercase;color:#f7e8b8!important}
    html[data-gameday-game="baccarat"] .result{background:rgba(0,0,0,.3)!important;border:1px solid rgba(236,210,122,.45)!important;border-radius:999px!important;padding:5px 10px!important;color:#ffe79a!important}
    html[data-gameday-game="baccarat"] .controls{background:linear-gradient(180deg,rgba(47,8,10,.97),rgba(16,3,4,.99))!important;border:1px solid #b58e34!important;box-shadow:0 -12px 30px rgba(0,0,0,.5)!important}
    html[data-gameday-game="baccarat"] .bet-btn{border:1px solid #d2b25b!important;border-radius:8px!important;font-weight:900!important;letter-spacing:.03em!important}
    html[data-gameday-game="baccarat"] .player-btn{background:linear-gradient(#254f94,#173364)!important}
    html[data-gameday-game="baccarat"] .banker-btn{background:linear-gradient(#9e2834,#65131c)!important}
    html[data-gameday-game="baccarat"] .tie-btn{background:linear-gradient(#2a8147,#14532c)!important}
    html[data-gameday-game="baccarat"] .play-btn{background:#f0df9c!important}

    html[data-gameday-game="slots"] body{background:radial-gradient(circle at 50% 18%,#372256 0,#161128 38%,#070812 72%,#020207 100%)!important}
    html[data-gameday-game="slots"] main{padding:3px 7px 0!important}
    html[data-gameday-game="slots"] .machine{height:calc(73dvh - 90px)!important;display:flex!important;flex-direction:column!important;justify-content:center!important;background:linear-gradient(180deg,#3b205f 0%,#17122c 24%,#090b18 100%)!important;border:4px solid #d9af45!important;border-radius:22px!important;box-shadow:0 0 0 3px #4d2a72,0 0 24px rgba(213,86,255,.35),inset 0 0 35px rgba(0,0,0,.55)!important;position:relative!important;overflow:hidden!important}
    html[data-gameday-game="slots"] .machine::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 10% 8%,rgba(255,209,83,.5) 0 2px,transparent 3px),radial-gradient(circle at 90% 8%,rgba(255,209,83,.5) 0 2px,transparent 3px),radial-gradient(circle at 10% 92%,rgba(255,209,83,.4) 0 2px,transparent 3px),radial-gradient(circle at 90% 92%,rgba(255,209,83,.4) 0 2px,transparent 3px);background-size:18px 18px;pointer-events:none;opacity:.7}
    html[data-gameday-game="slots"] .machine-title{font-size:26px!important;text-transform:uppercase!important;letter-spacing:.06em!important;color:#ffe17b!important;text-shadow:0 0 10px rgba(255,206,61,.6),0 3px 0 #6b3f0b!important;z-index:1}
    html[data-gameday-game="slots"] .reels{gap:5px!important;z-index:1;padding:8px;background:#070811;border:3px solid #d7b04d;border-radius:12px;box-shadow:inset 0 0 18px #000}
    html[data-gameday-game="slots"] .reel{min-height:132px!important;font-size:60px!important;border:3px solid #b8a3d5!important;border-radius:8px!important;background:linear-gradient(180deg,#f8f7ff,#cbd6ee,#f8f7ff)!important;box-shadow:inset 0 0 16px rgba(58,52,107,.25)!important}
    html[data-gameday-game="slots"] .result{z-index:1;background:rgba(0,0,0,.42);border:1px solid rgba(241,218,136,.45);border-radius:999px;padding:7px 12px!important;color:#ffe79a!important}
    html[data-gameday-game="slots"] .controls{background:linear-gradient(180deg,rgba(15,12,27,.97),rgba(5,5,11,.99))!important;border:1px solid #9f7832!important;box-shadow:0 -12px 30px rgba(0,0,0,.55)!important}
    html[data-gameday-game="slots"] .chips button{border-radius:18px!important;background:linear-gradient(#4b2e68,#261934)!important;border:1px solid #caa74e!important}
    html[data-gameday-game="slots"] .spin{height:48px!important;border-radius:24px!important;background:radial-gradient(circle,#ffe373,#d5a826 70%,#8d6812)!important;color:#1b1200!important;font-size:18px!important;letter-spacing:.12em!important;box-shadow:0 0 16px rgba(255,205,45,.45),inset 0 -4px 0 rgba(0,0,0,.22)!important}
  `;
  document.head.appendChild(immersiveStyle);

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

  if (path === 'gameday-roulette.html') {
    const main = document.querySelector('main');
    const wheel = document.querySelector('.wheel');
    const result = document.querySelector('.result-text');
    const controls = document.querySelector('.control-card');
    const outside = controls?.querySelector('.outside');
    const numbers = controls?.querySelector('#numbers');
    const spin = controls?.querySelector('#spinBtn');
    const stake = controls?.querySelector('#stake');
    if (main && wheel && result && controls && outside && numbers && spin && stake) {
      const stage = document.createElement('section');
      stage.className = 'gameday-roulette-stage';
      const top = document.createElement('div');
      top.className = 'gameday-roulette-top';
      wheel.parentNode.insertBefore(stage, wheel);
      stage.appendChild(top);
      top.appendChild(wheel);
      top.appendChild(result);
      stage.appendChild(controls);

      const table = document.createElement('div');
      table.className = 'gameday-roulette-table';
      const rail = document.createElement('div');
      rail.className = 'gameday-outside-rail';
      const ordered = ['low','even','red','black','odd','high'];
      ordered.forEach(type => {
        const button = outside.querySelector(`[data-type="${type}"]`);
        if (button) rail.appendChild(button);
      });
      table.appendChild(rail);
      table.appendChild(numbers);

      const actions = document.createElement('div');
      actions.className = 'gameday-roulette-actions';
      const stakeDisplay = document.createElement('div');
      stakeDisplay.className = 'gameday-stake-display';
      const quick = document.createElement('div');
      quick.className = 'gameday-quick-chips';
      [10,25,50,100].forEach(value => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = value;
        b.addEventListener('click', () => {
          stake.value = String(value);
          stake.dispatchEvent(new Event('input', { bubbles:true }));
        });
        quick.appendChild(b);
      });
      const syncStake = () => { stakeDisplay.textContent = `$${Number(stake.value || 0).toFixed(0)}`; };
      stake.addEventListener('input', syncStake);
      syncStake();
      spin.textContent = 'SPIN';
      actions.append(stakeDisplay, quick, spin);
      controls.append(table, actions);
      outside.remove();
    }
  }

  let activeHref = path;
  if (['gameday-blackjack.html','gameday-roulette.html','gameday-baccarat.html','gameday-slots.html','gameday-poker.html','gameday-video-poker.html','gameday-three-card-poker.html'].includes(path)) activeHref = 'gameday-casino-v2.html';
  const nav = document.createElement('nav');
  nav.className = 'gameday-app-nav';
  nav.setAttribute('aria-label','GameDay app navigation');
  nav.innerHTML = canonical.map(([label,href,icon]) => {
    const active = activeHref === href;
    return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ''}><span class="gameday-nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
  }).join('');
  document.body.appendChild(nav);
})();