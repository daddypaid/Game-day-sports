const CACHE='gameday-shell-v6';
const SHELL=[
  './gameday-sportsbook.html',
  './gameday-casino-v2.html',
  './gameday-my-bets.html',
  './gameday-auth.html',
  './gameday-blackjack.html',
  './gameday-roulette.html',
  './gameday-baccarat.html',
  './gameday-slots.html',
  './offline.html',
  './manifest.webmanifest',
  './gameday-app.js',
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
        return cached||caches.match('./offline.html');
      })
    );
    return;
  }

  event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
