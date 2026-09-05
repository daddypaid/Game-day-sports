from pathlib import Path

for name in ['gameday-blackjack.html','gameday-slots.html']:
    p=Path(name)
    s=p.read_text()
    css='<link rel="stylesheet" href="gameday-premium-casino.css">\n'
    if 'gameday-premium-casino.css' not in s:
        marker='<link rel="apple-touch-icon" href="icons/gameday-192.png">\n'
        if marker not in s: raise SystemExit(f'{name}: head marker missing')
        s=s.replace(marker, marker+css, 1)
    js='<script src="gameday-premium-casino.js" defer></script>\n'
    if 'gameday-premium-casino.js' not in s:
        marker='<script src="gameday-app.js" defer></script>'
        if marker not in s: raise SystemExit(f'{name}: app marker missing')
        s=s.replace(marker, js+marker, 1)
    p.write_text(s)

p=Path('sw.js')
s=p.read_text()
if "const CACHE='gameday-shell-v18';" in s:
    s=s.replace("const CACHE='gameday-shell-v18';","const CACHE='gameday-shell-v19';")
elif "const CACHE='gameday-shell-v19';" not in s:
    raise SystemExit('Unexpected cache version')
marker="  './gameday-live-clock.js',\n"
addition="  './gameday-premium-casino.css',\n  './gameday-premium-casino.js',\n"
if 'gameday-premium-casino.css' not in s:
    if marker not in s: raise SystemExit('SW asset marker missing')
    s=s.replace(marker, marker+addition, 1)
p.write_text(s)
