const CACHE='gameday-shell-v110';
const SHELL=[
  './',
  './index.html',
  './gameday-premium.html',
  './gameday-live.html',
  './gameday-sportsbook.html',
  './gameday-casino-v2.html',
  './gameday-my-bets.html',
  './gameday-auth.html',
  './gameday-blackjack.html',
  './gameday-roulette.html',
  './gameday-roulette-game.js',
  './gameday-roulette-game.css',
  './gameday-roulette-spinner.js',
  './gameday-roulette-spinner.css',
  './assets/roulette/wheel.webp',
  './assets/roulette/betting-table.webp',
  './gameday-baccarat.html',
  './gameday-slots-lobby.html',
  './gameday-slots.html',
  './gameday-lucky-7s-game.js',
  './gameday-lucky-7s-game.css',
  './assets/lucky-7s/symbols-atlas.webp',
  './assets/lucky-7s/stadium-cabinet.webp',
  './assets/lucky-7s/lobby-preview.webp',
  './gameday-midnight-monsters-v2.html',
  './gameday-midnight-monsters.html',
  './gameday-midnight-monsters-game.js',
  './gameday-midnight-monsters-game.css',
  './gameday-galactic-rebellion-v2.html',
  './gameday-galactic-rebellion.html',
  './gameday-galactic-rebellion-game.js',
  './gameday-galactic-rebellion-game.css',
  './assets/galactic-rebellion/space-background.webp',
  './assets/galactic-rebellion/symbols-atlas.webp',
  './assets/galactic-rebellion/galactic-rebellion-title.webp',
  './gameday-poker.html',
  './gameday-jacks-or-better.html',
  './gameday-texas-holdem.html',
  './gameday-omaha.html',
  './gameday-seven-card-stud.html',
  './gameday-five-card-draw.html',
  './assets/poker-premium/texas-holdem-approved.jpg',
  './assets/poker-premium/omaha-approved.jpg',
  './assets/poker-premium/seven-card-stud-approved.jpg',
  './assets/poker-premium/five-card-draw-approved.jpg',
  './assets/poker-premium/jacks-or-better-approved.jpg',
  './gameday-control-center.html',
  './gameday-operator-analytics.html',
  './gameday-system-health.html',
  './gameday-buyer-demo.html',
  './gameday-admin-takeover.html',
  './gameday-config-check.html',
  './offline.html',
  './manifest.webmanifest',
  './gameday-config.js',
  './gameday-app.js',
  './gameday-light-theme.css',
  './gameday-team-logos.js',
  './gameday-team-logos.css',
  './assets/sportsbook/team-logos.json',
  './gameday-table-wager.css',
  './gameday-table-wager.js',
  './gameday-table-dealing.js',
  './gameday-blackjack-game.js',
  './gameday-blackjack-game.css',
  './gameday-baccarat-game.js',
  './gameday-baccarat-game.css',
  './gameday-jacks-game.js',
  './gameday-poker-hand-evaluation.js',
  './gameday-table-dealing.css',
  './gameday-standard-deck.css',
  './assets/deck/gameday-approved-back.png',
  './gameday-app.js?v=12',
  './gameday-home.css?v=2',
  './gameday-home.js?v=1',
  './gameday-card-wager-ui.js?v=34',
  './gameday-standard-deck.css?v=1',
  './assets/deck/gameday-standard-deck.png',
  './gameday-live-card-tables.js?v=2',
  './gameday-live-card-tables.css?v=8',
  './gameday-blackjack-live.css?v=40',
  './gameday-roulette-spinner.css?v=3',
  './assets/card-tables/blackjack-empty-approved.webp',
  './assets/card-tables/blackjack-clean-reference.webp',
  './assets/chips/gameday-1.webp',
  './assets/chips/gameday-5.webp',
  './assets/chips/gameday-10.webp',
  './assets/chips/gameday-25.webp',
  './assets/chips/gameday-100.webp',
  './assets/chips/gameday-500.webp',
  './gameday-live-clock.js',
  './gameday-themed-slots.js?v=31',
  './gameday-premium-casino.css',
  './gameday-premium-casino-v2.css',
  './gameday-premium-casino.js',
  './gameday-premium-app.css',
  './gameday-premium-game-art.css',
  './gameday-premium-roulette-poker.css',
  './gameday-premium-baccarat-poker.css',
  './gameday-premium-account-bets.css',
  './gameday-premium-sportsbook.css',
  './gameday-sportsbook-approved.css',
  './gameday-premium-in-shell.css',
  './gameday-premium-spin.css',
  './gameday-themed-slots.css',
  './gameday-themed-slots-premium-art.css',
  './gameday-midnight-monsters-premium.css?v=3',
  './gameday-lucky7s.css',
  './art/gameday-sportsbook-hero.svg',
  './art/gameday-sportsbook-approved-hero.jpg',
  './assets/homepage/gameday-home-hero.webp',
  './assets/homepage/gameday-home-banner.webp',
  './assets/homepage/gameday-homepage-approved.jpeg',
  './assets/gameday-blackjack-table-premium.svg',
  './assets/gameday-roulette-room.svg',
  './assets/gameday-poker-room.svg',
  './assets/gameday-baccarat-room.svg',
  './assets/gameday-poker-table-room.svg',
  './assets/gameday-my-bets-premium.svg',
  './assets/gameday-account-premium.svg',
  './assets/midnight-monsters-card.svg',
  './assets/galactic-rebellion-card.svg',
  './assets/lucky-7s-card.svg',
  './assets/casino/gameday-casino-hero.svg',
  './assets/casino/blackjack-lobby.svg',
  './assets/casino/roulette-lobby.svg',
  './assets/casino/baccarat-lobby.svg',
  './assets/casino/poker-lobby.svg',
  './assets/casino/midnight-monsters-lobby.svg',
  './assets/casino/galactic-rebellion-lobby.svg',
  './assets/casino-premium/blackjack.webp',
  './assets/casino-premium/roulette.webp',
  './assets/casino-premium/baccarat.webp',
  './assets/casino-premium/midnight-monsters.webp',
  './assets/casino-premium/galactic-rebellion.webp',
  './assets/casino-premium/lucky-7s.webp',
  './assets/casino-premium/poker-room.webp',
  './assets/card-tables/blackjack.webp',
  './assets/card-tables/baccarat.webp',
  './assets/card-tables/gameday-baccarat-table.png',
  './assets/card-tables/gameday-blackjack-table.png',
  './assets/card-tables/gameday-jacks-or-better-table.png',
  './assets/card-tables/gameday-texas-holdem-table.png',
  './assets/card-tables/gameday-omaha-table.png',
  './assets/card-tables/gameday-seven-card-stud-table.png',
  './assets/card-tables/gameday-five-card-draw-table.png',
  './assets/casino-premium/casino-lobby-hero.webp',
  './assets/casino-premium/poker-hero.webp',
  './assets/casino-premium/slots-hero.webp',
  './assets/midnight-monsters/castle-background.webp',
  './assets/midnight-monsters/vampire.webp',
  './assets/midnight-monsters/werewolf.webp',
  './assets/midnight-monsters/zombie.webp',
  './assets/midnight-monsters/potion.webp',
  './assets/midnight-monsters/bat.webp',
  './assets/midnight-monsters/candle.webp',
  './assets/midnight-monsters/wild.webp',
  './assets/midnight-monsters/scatter.webp',
  './assets/midnight-monsters/extended-symbols-atlas.webp',
  './assets/midnight-monsters/midnight-monsters-title.webp',
  './assets/casino/lucky-7s-lobby.svg',
  './icons/gameday-192.png',
  './icons/gameday-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(path=>path==='./'||/(?:index\.html|gameday-(?:app\.js|premium-app\.css|light-theme\.css|team-logos\.(?:js|css)|(?:midnight-monsters|galactic-rebellion|lucky-7s|blackjack|baccarat|jacks|roulette)-game\.(?:js|css)|table-(?:wager|dealing)\.(?:js|css)|poker-hand-evaluation\.js|roulette-spinner\.(?:js|css)|home\.css|(?:sportsbook|my-bets|auth|premium|casino-v2|slots-lobby|slots|(?:midnight-monsters|galactic-rebellion)(?:-v2)?|blackjack|baccarat|roulette|poker|jacks-or-better|texas-holdem|omaha|seven-card-stud|five-card-draw)\.html))(?:\?.*)?$/.test(path)||/\/assets\/sportsbook\/team-logos\.json$/.test(path)?new Request(path,{cache:'reload'}):path))).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req,/\/gameday-(?:casino-v2|slots-lobby|slots|galactic-rebellion(?:-v2)?)\.html$/.test(url.pathname)?{cache:'no-cache'}:undefined).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy));
        return res;
      }).catch(async()=>{
        const cached=await caches.match(req);
        return cached||caches.match('./index.html')||caches.match('./offline.html');
      })
    );
    return;
  }

  const tableWagerRuntime=/\/gameday-table-(?:wager|dealing)\.(?:js|css)$/.test(url.pathname);
  const themeRuntime=/\/(?:gameday-light-theme\.css|gameday-app\.js|gameday-premium-app\.css)$/.test(url.pathname);
  const logoRuntime=/\/(?:gameday-team-logos\.(?:js|css)|assets\/sportsbook\/team-logos\.json)$/.test(url.pathname);
  const slotRuntime=/\/gameday-(?:midnight-monsters|galactic-rebellion|lucky-7s|blackjack|baccarat|jacks|roulette)-game\.(?:js|css)$/.test(url.pathname);
  const pokerRuntime=/\/gameday-poker-hand-evaluation\.js$/.test(url.pathname);
  const rouletteSpinnerRuntime=/\/gameday-roulette-spinner\.(?:js|css)$/.test(url.pathname);
  const criticalRuntime=rouletteSpinnerRuntime||pokerRuntime||tableWagerRuntime||themeRuntime||logoRuntime||slotRuntime||/\/(?:gameday-config|gameday-card-wager-ui|gameday-standard-deck|gameday-live-card-tables|gameday-blackjack-live|gameday-roulette-spinner|gameday-app|gameday-home)\.(?:js|css)$/.test(url.pathname);
  if(criticalRuntime){
    event.respondWith(fetch(req,rouletteSpinnerRuntime||pokerRuntime||tableWagerRuntime||themeRuntime||logoRuntime||slotRuntime?{cache:'no-cache'}:undefined).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(cache=>cache.put(req,copy));
      return res;
    }).catch(()=>caches.match(req)));
    return;
  }

  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{
    const copy=res.clone();
    caches.open(CACHE).then(cache=>cache.put(req,copy));
    return res;
  })));
});
