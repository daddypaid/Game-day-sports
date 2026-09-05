from pathlib import Path

pages = [
    'gameday-blackjack.html',
    'gameday-roulette.html',
    'gameday-baccarat.html',
    'gameday-slots.html',
    'gameday-video-poker.html',
    'gameday-bonus-poker.html',
    'gameday-deuces-wild.html',
    'gameday-three-card-poker.html',
    'gameday-ultimate-texas-holdem.html',
    'gameday-caribbean-stud.html',
]
needle = '<script src="gameday-app.js" defer></script>'
insert = '<script src="gameday-card-wager-ui.js" defer></script>\n' + needle
for name in pages:
    p = Path(name)
    s = p.read_text()
    if 'src="gameday-card-wager-ui.js"' not in s:
        if needle not in s:
            raise RuntimeError(f'app script marker missing in {name}')
        s = s.replace(needle, insert, 1)
        p.write_text(s)

p = Path('sw.js')
s = p.read_text()
import re
s = re.sub(r"const CACHE='gameday-shell-v(\d+)';", lambda m: f"const CACHE='gameday-shell-v{int(m.group(1))+1}';", s, count=1)
if "./gameday-card-wager-ui.js" not in s:
    marker = "  './gameday-app.js',"
    if marker not in s:
        raise RuntimeError('service worker app marker missing')
    s = s.replace(marker, marker + "\n  './gameday-card-wager-ui.js',", 1)
p.write_text(s)
