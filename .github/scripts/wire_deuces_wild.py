from pathlib import Path

p=Path('gameday-poker.html'); s=p.read_text()
old='<div class="card disabled"><div class="art video">2 WILD</div><div class="info"><div class="title">Deuces Wild</div><div class="meta">Twos act as wild cards with a dedicated payout table.</div><div class="foot"><span class="status">BUILDING</span></div></div></div>'
new='<a class="card" href="gameday-deuces-wild.html" style="text-decoration:none;color:inherit"><div class="art video">2 WILD</div><div class="info"><div class="title">Deuces Wild</div><div class="meta">Every 2 is wild, with its own server-side evaluator and dedicated payout table.</div><div class="foot"><span class="status connected">CONNECTED</span><span class="play">PLAY ›</span></div></div></a>'
if old not in s and 'href="gameday-deuces-wild.html"' not in s: raise RuntimeError('Deuces lobby marker not found')
s=s.replace(old,new); p.write_text(s)

p=Path('gameday-app.js'); s=p.read_text()
old="    'gameday-video-poker.html':'poker-game',\n    'gameday-bonus-poker.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'"
new="    'gameday-video-poker.html':'poker-game',\n    'gameday-bonus-poker.html':'poker-game',\n    'gameday-deuces-wild.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'"
if old not in s and "'gameday-deuces-wild.html':'poker-game'" not in s: raise RuntimeError('App map marker not found')
s=s.replace(old,new); p.write_text(s)

p=Path('sw.js'); s=p.read_text()
s=s.replace("const CACHE='gameday-shell-v12';","const CACHE='gameday-shell-v13';")
old="  './gameday-video-poker.html',\n  './gameday-bonus-poker.html',\n  './gameday-three-card-poker.html',"
new="  './gameday-video-poker.html',\n  './gameday-bonus-poker.html',\n  './gameday-deuces-wild.html',\n  './gameday-three-card-poker.html',"
if old not in s and "./gameday-deuces-wild.html" not in s: raise RuntimeError('SW marker not found')
s=s.replace(old,new); p.write_text(s)
