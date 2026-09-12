const CACHE='gameday-shell-v50';
const SHELL=[
  './index.html',
  './gameday-premium.html',
  './gameday-live.html',
  './gameday-sportsbook.html',
  './gameday-casino-v2.html',
  './gameday-my-bets.html',
  './gameday-auth.html',
  './gameday-blackjack.html',
  './gameday-roulette.html',
  './gameday-baccarat.html',
  './gameday-slots-lobby.html',
  './gameday-slots.html',
  './gameday-midnight-monsters-v2.html',
  './gameday-galactic-rebellion-v2.html',
  './gameday-poker.html',
  './gameday-video-poker.html',
  './gameday-bonus-poker.html',
  './gameday-deuces-wild.html',
  './gameday-ultimate-texas-holdem.html',
  './gameday-caribbean-stud.html',
  './gameday-three-card-poker.html',
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
  './gameday-app.js?v=4',
  './gameday-card-wager-ui.js?v=32',
  './gameday-live-card-tables.js?v=2',
  './gameday-live-card-tables.css?v=8',
  './gameday-blackjack-live.css?v=9',
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
  './assets/homepage/gameday-homepage-approved.jpeg',
  './assets/gameday-blackjack-table-premium.svg',
  './assets/gameday-video-poker-premium.svg',
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
  './assets/casino-premium/video-poker.webp',
  './assets/casino-premium/three-card-poker.webp',
  './assets/casino-premium/ultimate-holdem.webp',
  './assets/casino-premium/caribbean-stud.webp',
  './assets/casino-premium/midnight-monsters.webp',
  './assets/casino-premium/galactic-rebellion.webp',
  './assets/casino-premium/lucky-7s.webp',
  './assets/casino-premium/deuces-wild.webp',
  './assets/casino-premium/bonus-poker.webp',
  './assets/casino-premium/poker-room.webp',
  './assets/card-tables/blackjack.webp',
  './assets/card-tables/three-card-poker.webp',
  './assets/card-tables/baccarat.webp',
  './assets/card-tables/video-poker.webp',
  './assets/card-tables/ultimate-holdem.webp',
  './assets/card-tables/caribbean-stud.webp',
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
  './assets/casino/lucky-7s-lobby.svg',
  './icons/gameday-192.png',
  './icons/gameday-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
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
      fetch(req).then(res=>{
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

  const criticalRuntime=/\/(?:gameday-config|gameday-card-wager-ui|gameday-live-card-tables|gameday-app)\.(?:js|css)$/.test(url.pathname);
  if(criticalRuntime){
    event.respondWith(fetch(req).then(res=>{
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
