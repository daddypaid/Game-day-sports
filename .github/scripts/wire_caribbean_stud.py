from pathlib import Path
p=Path('gameday-poker.html');s=p.read_text()
old='<div class="card disabled"><div class="art casino">C♠ STUD</div><div class="info"><div class="title">Caribbean Stud</div><div class="meta">Five-card dealer game with qualification rules.</div><div class="foot"><span class="status">BUILDING</span></div></div></div>'
new='<a class="card" href="gameday-caribbean-stud.html" style="text-decoration:none;color:inherit"><div class="art casino">C♠ STUD</div><div class="info"><div class="title">Caribbean Stud</div><div class="meta">Five-card dealer poker with one up-card, dealer qualification and a 2× Raise decision.</div><div class="foot"><span class="status connected">CONNECTED</span><span class="play">PLAY ›</span></div></div></a>'
if old not in s and 'href="gameday-caribbean-stud.html"' not in s:raise RuntimeError('Caribbean marker not found')
s=s.replace(old,new);p.write_text(s)
p=Path('gameday-app.js');s=p.read_text();old="    'gameday-ultimate-texas-holdem.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'";new="    'gameday-ultimate-texas-holdem.html':'poker-game',\n    'gameday-caribbean-stud.html':'poker-game',\n    'gameday-three-card-poker.html':'poker-game'";
if old not in s and "'gameday-caribbean-stud.html':'poker-game'" not in s:raise RuntimeError('App marker not found')
s=s.replace(old,new);p.write_text(s)
p=Path('sw.js');s=p.read_text();s=s.replace("const CACHE='gameday-shell-v14';","const CACHE='gameday-shell-v15';");old="  './gameday-ultimate-texas-holdem.html',\n  './gameday-three-card-poker.html',";new="  './gameday-ultimate-texas-holdem.html',\n  './gameday-caribbean-stud.html',\n  './gameday-three-card-poker.html',";
if old not in s and "./gameday-caribbean-stud.html" not in s:raise RuntimeError('SW marker not found')
s=s.replace(old,new);p.write_text(s)
