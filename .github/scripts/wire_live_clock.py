from pathlib import Path

p=Path('gameday-sportsbook.html')
s=p.read_text()
old="let currentSport='nfl',view='games',gameMarket='h2h',games=[],event=null,propMarkets=[],slip=[],betType='single',user=null,wallet=0,liveTimer=null,liveStates=[];"
new="let currentSport='nfl',view='games',gameMarket='h2h',games=[],event=null,propMarkets=[],slip=[],betType='single',user=null,wallet=0,liveTimer=null,liveOddsTimer=null,liveStates=[];"
if old not in s and 'liveOddsTimer=null' not in s: raise RuntimeError('timer variable marker not found')
s=s.replace(old,new)
old="function renderGames(){const list=view==='live'?games.filter(isLive):games.filter(g=>!isLive(g));content.innerHTML=list.length?list.map(renderGame).join(''):`<div class=\"empty\">${view==='live'?'No in-play games with available GameDay lines right now.':'No upcoming games are currently available.'}</div>`;status.textContent=view==='live'?`${list.length} live games • game state refresh 60s`:`${list.length} upcoming games`;document.querySelectorAll('[data-market]').forEach(b=>b.onclick=()=>{gameMarket=b.dataset.market;renderGames()});bindOdds()}"
new="function renderGames(){const list=view==='live'?games.filter(isLive):games.filter(g=>!isLive(g));content.innerHTML=list.length?list.map(renderGame).join(''):`<div class=\"empty\">${view==='live'?'No in-play games with available GameDay lines right now.':'No upcoming games are currently available.'}</div>`;status.textContent=view==='live'?`${list.length} live games • scores/state refresh 15s • clock ticks live`:`${list.length} upcoming games`;document.querySelectorAll('[data-market]').forEach(b=>b.onclick=()=>{gameMarket=b.dataset.market;renderGames()});bindOdds()}"
if old not in s and 'scores/state refresh 15s' not in s: raise RuntimeError('renderGames marker not found')
s=s.replace(old,new)
old="function manageLiveTimer(){if(liveTimer){clearInterval(liveTimer);liveTimer=null}if(view==='live')liveTimer=setInterval(()=>{if(view==='live'&&!document.hidden)loadGames()},60000)}"
new="async function refreshLiveStateOnly(){if(view!=='live'||document.hidden)return;try{const d=await liveApi();liveStates=d.states||[];games=games.map(g=>({...g,live_state:stateFor(g)}));renderGames()}catch(e){console.warn('Live state refresh skipped',e)}}\nfunction manageLiveTimer(){if(liveTimer){clearInterval(liveTimer);liveTimer=null}if(liveOddsTimer){clearInterval(liveOddsTimer);liveOddsTimer=null}if(view==='live'){liveTimer=setInterval(refreshLiveStateOnly,15000);liveOddsTimer=setInterval(()=>{if(view==='live'&&!document.hidden)loadGames()},60000)}}"
if old not in s and 'refreshLiveStateOnly' not in s: raise RuntimeError('manageLiveTimer marker not found')
s=s.replace(old,new)
old='<script src="gameday-app.js" defer></script>'
new='<script src="gameday-live-clock.js" defer></script>\n<script src="gameday-app.js" defer></script>'
if old not in s and 'gameday-live-clock.js' not in s: raise RuntimeError('script include marker not found')
s=s.replace(old,new)
p.write_text(s)

p=Path('sw.js')
s=p.read_text()
if "const CACHE='gameday-shell-v17';" in s:
    s=s.replace("const CACHE='gameday-shell-v17';","const CACHE='gameday-shell-v18';")
elif "const CACHE='gameday-shell-v18';" not in s:
    raise RuntimeError('Unexpected cache version')
marker="  './gameday-card-wager-ui.js',\n"
if marker in s and "./gameday-live-clock.js" not in s:
    s=s.replace(marker,marker+"  './gameday-live-clock.js',\n")
elif "./gameday-live-clock.js" not in s:
    raise RuntimeError('service worker asset marker not found')
p.write_text(s)
