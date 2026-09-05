from pathlib import Path

# Poker lobby: turn Bonus Poker from BUILDING into a real playable card.
p=Path('gameday-poker.html')
s=p.read_text()
old='<div class="card disabled"><div class="art video">BONUS</div><div class="info"><div class="title">Bonus Poker</div><div class="meta">Video poker with enhanced four-of-a-kind payouts.</div><div class="foot"><span class="status">BUILDING</span></div></div></div>'
new='<a class="card" href="gameday-bonus-poker.html" style="text-decoration:none;color:inherit"><div class="art video">BONUS</div><div class="info"><div class="title">Bonus Poker</div><div class="meta">Video poker with enhanced four-of-a-kind payouts and a server-generated deck.</div><div class="foot"><span class="status connected">CONNECTED</span><span class="play">PLAY ›</span></div></div></a>'
if old not in s and 'href="gameday-bonus-poker.html"' not in s: raise RuntimeError('Bonus Poker lobby marker not found')
s=s.replace(old,new)
p.write_text(s)

# Installed app page map.
p=Path('gameday-app.js'); s=p.read_text()
old="    'gameday-video-poker.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'"
new="    'gameday-video-poker.html':'poker-game',\n    'gameday-bonus-poker.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'"
if old not in s and "'gameday-bonus-poker.html':'poker-game'" not in s: raise RuntimeError('App page map marker not found')
s=s.replace(old,new)
p.write_text(s)

# Service worker cache + cache version.
p=Path('sw.js'); s=p.read_text()
s=s.replace("const CACHE='gameday-shell-v11';","const CACHE='gameday-shell-v12';")
old="  './gameday-video-poker.html',\n  './gameday-three-card-poker.html',"
new="  './gameday-video-poker.html',\n  './gameday-bonus-poker.html',\n  './gameday-three-card-poker.html',"
if old not in s and "./gameday-bonus-poker.html" not in s: raise RuntimeError('Service worker marker not found')
s=s.replace(old,new)
p.write_text(s)

# Permanent release guard.
p=Path('.github/workflows/deploy-pages.yml'); s=p.read_text()
old='            gameday-video-poker.html\n            gameday-three-card-poker.html'
new='            gameday-video-poker.html\n            gameday-bonus-poker.html\n            gameday-three-card-poker.html'
if old not in s and '            gameday-bonus-poker.html' not in s: raise RuntimeError('Required pages marker not found')
s=s.replace(old,new)
old='          grep -q "video-poker-test" gameday-video-poker.html\n          grep -q "Three Card Poker" gameday-three-card-poker.html'
new='          grep -q "video-poker-test" gameday-video-poker.html\n          grep -q "Bonus Poker" gameday-bonus-poker.html\n          grep -q "video-poker-test" gameday-bonus-poker.html\n          grep -q "game:GAME" gameday-bonus-poker.html\n          grep -q "Three Card Poker" gameday-three-card-poker.html'
if old not in s and 'grep -q "Bonus Poker" gameday-bonus-poker.html' not in s: raise RuntimeError('Poker validation marker not found')
s=s.replace(old,new)
old="          grep -q \"'gameday-video-poker.html':'poker-game'\" gameday-app.js\n          grep -q \"'gameday-three-card-poker.html':'poker-game'\" gameday-app.js"
new="          grep -q \"'gameday-video-poker.html':'poker-game'\" gameday-app.js\n          grep -q \"'gameday-bonus-poker.html':'poker-game'\" gameday-app.js\n          grep -q \"'gameday-three-card-poker.html':'poker-game'\" gameday-app.js"
if old not in s and "gameday-bonus-poker.html':'poker-game'" not in s: raise RuntimeError('PWA map guard marker not found')
s=s.replace(old,new)
old='          grep -q "./gameday-video-poker.html" sw.js\n          grep -q "./gameday-three-card-poker.html" sw.js'
new='          grep -q "./gameday-video-poker.html" sw.js\n          grep -q "./gameday-bonus-poker.html" sw.js\n          grep -q "./gameday-three-card-poker.html" sw.js'
if old not in s and 'grep -q "./gameday-bonus-poker.html" sw.js' not in s: raise RuntimeError('SW guard marker not found')
s=s.replace(old,new)
old='          grep -q \'href="gameday-three-card-poker.html"\' gameday-poker.html'
new='          grep -q \'href="gameday-three-card-poker.html"\' gameday-poker.html\n          grep -q \'href="gameday-bonus-poker.html"\' gameday-poker.html'
if old not in s and 'gameday-bonus-poker.html' not in s: raise RuntimeError('Lobby guard marker not found')
s=s.replace(old,new)
p.write_text(s)
