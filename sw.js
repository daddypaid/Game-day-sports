const CACHE='gameday-shell-v20';
const SHELL=[
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
  './offline.html',
  './manifest.webmanifest',
  './gameday-app.js',
  './gameday-card-wager-ui.js',
  './gameday-live-clock.js',
  './gameday-themed-slots.js',
  './gameday-premium-casino.css',
  './gameday-premium-casino-v2.css',
  './gameday-premium-casino.js',
  './gameday-premium-app.css',
  './gameday-premium-game-art.css',
  './gameday-premium-roulette-poker.css',
  './gameday-premium-baccarat-poker.css',
  './gameday-premium-account-bets.css',
  './gameday-premium-sportsbook.css',
  './gameday-premium-in-shell.css',
  './gameday-premium-spin.css',
  './gameday-themed-slots.css',
  './gameday-lucky7s.css',
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
        return cached||caches.match('./gameday-premium.html')||caches.match('./offline.html');
      })
    );
    return;
  }

  event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
