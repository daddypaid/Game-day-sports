(()=>{
const path=(location.pathname.split('/').pop()||'').toLowerCase();
const page=path.includes('sportsbook')?'sportsbook':path.includes('casino')?'casino':path.includes('my-bets')?'bets':path.includes('auth')?'account':'';
if(!page)return;
document.body.classList.add('gd-premium','gd-with-side',`gd-${page}`);
if(!document.querySelector('link[href="gameday-premium-app.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='gameday-premium-app.css';document.head.appendChild(l)}
const links=[
 ['sportsbook','◉','Sportsbook','gameday-sportsbook.html'],['casino','♛','Casino','gameday-casino-v2.html'],['bets','▤','My Bets','gameday-my-bets.html'],['account','●','My Account','gameday-auth.html']
];
const side=document.createElement('aside');side.className='gd-side';side.innerHTML=`<div class="gd-side-logo">♛ GAMEDAY<small>SPORTS & CASINO</small></div>${links.map(([id,ico,label,href])=>`<a class="${page===id?'active':''}" href="${href}"><span class="ico">${ico}</span>${label}</a>`).join('')}<div class="gd-side-divider"></div><a href="gameday-slots-lobby.html"><span class="ico">777</span>Slots</a><a href="gameday-blackjack.html"><span class="ico">A♠</span>Blackjack</a><a href="gameday-roulette.html"><span class="ico">◉</span>Roulette</a><a href="gameday-poker.html"><span class="ico">♠</span>Poker</a><div class="gd-side-divider"></div><div class="gd-responsible"><strong>PLAY RESPONSIBLY</strong>TEST MODE<br>NO REAL MONEY</div>`;document.body.appendChild(side);
function hero(){
 if(document.querySelector('.gd-premium-hero'))return;
 const h=document.createElement('section');h.className='gd-premium-hero';
 if(page==='sportsbook')h.innerHTML=`<div class="copy"><div class="kicker">Bigger games • bigger moments</div><h2>GameDay Sportsbook</h2><p>Live lines, props, futures and in-play action from the same GameDay test wallet.</p><div class="gd-athletes"><span>Wemby</span><span>Patrick Mahomes</span><span>Aaron Judge</span><span>Lionel Messi</span></div><a class="gd-hero-action" href="#content">VIEW LIVE LINES ›</a></div>`;
 else if(page==='casino')h.innerHTML=`<div class="copy"><div class="kicker">GameDay premium casino</div><h2>Slots. Blackjack. Roulette. Poker.</h2><p>Only the games already inside GameDay — rebuilt with one premium black-and-gold visual system.</p><div class="gd-athletes"><span>Midnight Monsters</span><span>Galactic Rebellion</span><span>Lucky 7s</span><span>Poker Room</span></div><a class="gd-hero-action" href="#featured">BROWSE GAMES ›</a></div>`;
 else return;
 const main=document.querySelector('main');if(main)main.insertBefore(h,main.firstChild);
}
function banner(){
 if(page==='sportsbook'||page==='casino'||document.querySelector('.gd-page-banner'))return;
 const b=document.createElement('section');b.className='gd-page-banner';
 b.innerHTML=page==='bets'?`<div class="eyebrow">TRACK • SETTLE • REVIEW</div><h2>My Bets</h2><p>Your open and settled GameDay test wagers in one premium ticket view.</p>`:`<div class="eyebrow">ACCOUNT • WALLET • SECURITY</div><h2>My GameDay Account</h2><p>Manage your sign-in and shared GameDay test wallet from the same premium app shell.</p>`;
 const main=document.querySelector('main');if(main)document.body.insertBefore(b,main);
}
hero();banner();
})();
