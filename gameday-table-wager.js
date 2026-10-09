(() => {
  const rail = {
    'gameday-blackjack.html': 79.6875,
    'gameday-baccarat.html': 75.078125,
    'gameday-roulette.html': null,
    'gameday-jacks-or-better.html': 76.40625,
    'gameday-texas-holdem.html': 74.21875,
    'gameday-omaha.html': 75.078125,
    'gameday-seven-card-stud.html': 75.078125,
    'gameday-five-card-draw.html': 75.078125
  };
  const game = location.pathname.split('/').pop();
  const stage = document.querySelector('main > .game-stage, main > .stage');
  if (!Object.hasOwn(rail, game) || !stage || document.querySelector('.gd-wager-chip-row')) return;

  const chips = [[1, 'white'], [5, 'red'], [10, 'blue'], [25, 'green'], [100, 'black'], [500, 'purple']];
  const x = [16, 29.6, 43.2, 56.8, 70.4, 84];
  const curve = [-2.8, -0.8, 0, 0, -0.8, -2.8];
  const storageKey = `gameday:wager-draft:${game}`;
  let selectedChip = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && saved.amount === saved.selectedChip && chips.some(([value]) => value === saved.selectedChip)) selectedChip = saved.selectedChip;
  } catch (_) { /* Chip selection also works without browser storage. */ }

  document.body.classList.add('gd-table-wager-page');
  stage.classList.add('gd-wager-surface');
  const row = document.createElement('div');
  row.className = 'gd-wager-chip-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Choose a chip amount');
  row.innerHTML = chips.map(([value, color], index) => `<button type="button" class="gd-wager-chip" data-wager-chip="${value}" style="--gd-chip-x:${x[index]}%;--gd-chip-curve:${curve[index]}%" aria-label="Select $${value} ${color} chip for wager" aria-pressed="false"><img src="assets/chips/gameday-${value}.webp" width="150" height="150" alt="" draggable="false"></button>`).join('');
  if (stage.querySelector('img') && rail[game] !== null) {
    row.classList.add('gd-wager-on-table');
    stage.style.setProperty('--gd-chip-rail-y', `${rail[game]}%`);
  }
  stage.appendChild(row);
  const buttons = [...row.querySelectorAll('[data-wager-chip]')];

  function render() {
    stage.dataset.wagerAmount = String(selectedChip || 0);
    buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.wagerChip) === selectedChip)));
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    selectedChip = Number(button.dataset.wagerChip);
    render();
    try { sessionStorage.setItem(storageKey, JSON.stringify({ amount: selectedChip, selectedChip })); } catch (_) {}
  }));
  render();
})();
