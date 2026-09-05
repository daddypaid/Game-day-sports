from pathlib import Path

p=Path('gameday-poker.html'); s=p.read_text()
old='<div class="card disabled"><div class="art table">UTH</div><div class="info"><div class="title">Ultimate Texas Hold’em</div><div class="meta">Heads-up casino Hold’em against the house.</div><div class="foot"><span class="status">BUILDING</span></div></div></div>'
new='<a class="card" href="gameday-ultimate-texas-holdem.html" style="text-decoration:none;color:inherit"><div class="art table">UTH</div><div class="info"><div class="title">Ultimate Texas Hold’em</div><div class="meta">Heads-up casino Hold’em with staged 4× / 2× / 1× Play decisions.</div><div class="foot"><span class="status connected">CONNECTED</span><span class="play">PLAY ›</span></div></div></a>'
if old not in s and 'href="gameday-ultimate-texas-holdem.html"' not in s: raise RuntimeError('UTH lobby marker not found')
s=s.replace(old,new); p.write_text(s)

p=Path('gameday-app.js'); s=p.read_text()
old="    'gameday-deuces-wild.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'"
new="    'gameday-deuces-wild.html':'poker-game',\n    'gameday-ultimate-texas-holdem.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'"
if old not in s and "'gameday-ultimate-texas-holdem.html':'poker-game'" not in s: raise RuntimeError('App map marker not found')
s=s.replace(old,new); p.write_text(s)

p=Path('sw.js'); s=p.read_text()
s=s.replace("const CACHE='gameday-shell-v13';","const CACHE='gameday-shell-v14';")
old="  './gameday-deuces-wild.html',\n  './gameday-three-card-poker.html',"
new="  './gameday-deuces-wild.html',\n  './gameday-ultimate-texas-holdem.html',\n  './gameday-three-card-poker.html',"
if old not in s and "./gameday-ultimate-texas-holdem.html" not in s: raise RuntimeError('SW marker not found')
s=s.replace(old,new); p.write_text(s)
