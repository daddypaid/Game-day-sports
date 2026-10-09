(() => {
  const games = new Set([
    'gameday-blackjack.html', 'gameday-baccarat.html', 'gameday-roulette.html',
    'gameday-jacks-or-better.html', 'gameday-texas-holdem.html',
    'gameday-omaha.html', 'gameday-seven-card-stud.html', 'gameday-five-card-draw.html'
  ]);
  const game = location.pathname.split('/').pop();
  if (!games.has(game) || !document.querySelector('main') || document.querySelector('.gd-table-wager')) return;

  const chips = [[1, 'white'], [5, 'red'], [10, 'blue'], [25, 'green'], [100, 'black'], [500, 'purple']];
  const storageKey = `gameday:wager-draft:${game}`;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  let amount = 0;
  let selectedChip = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && Number.isSafeInteger(saved.amount) && saved.amount >= 0) {
      amount = saved.amount;
      if (amount > 0 && chips.some(([value]) => value === saved.selectedChip)) selectedChip = saved.selectedChip;
    }
  } catch (_) { /* Wager selection also works when browser storage is unavailable. */ }

  document.body.classList.add('gd-table-wager-page');
  const panel = document.createElement('section');
  panel.className = 'gd-table-wager';
  panel.setAttribute('aria-label', 'Set your wager');
  panel.innerHTML = `<div class="gd-wager-inner">
    <div class="gd-wager-chip-row" role="group" aria-label="Add chips to your wager">
      ${chips.map(([value, color]) => `<button type="button" class="gd-wager-chip" data-wager-chip="${value}" aria-label="Add $${value} ${color} chip to wager" aria-pressed="false"><img src="assets/chips/gameday-${value}.webp" width="150" height="150" alt="" draggable="false"><span>$${value}</span></button>`).join('')}
    </div>
    <div class="gd-wager-summary"><div><span class="gd-wager-label">TOTAL WAGER</span><output class="gd-wager-total" aria-label="Total wager" aria-live="polite" aria-atomic="true"></output></div><button type="button" class="gd-wager-clear" data-wager-clear aria-label="Clear wager">Clear</button></div>
  </div>`;
  document.body.appendChild(panel);
  const output = panel.querySelector('.gd-wager-total');
  const clear = panel.querySelector('[data-wager-clear]');
  const buttons = [...panel.querySelectorAll('[data-wager-chip]')];

  function render() {
    output.value = money.format(amount);
    panel.dataset.wagerAmount = String(amount);
    clear.disabled = amount === 0;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.wagerChip) === selectedChip)));
  }

  function save() {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ amount, selectedChip })); } catch (_) {}
  }

  buttons.forEach(button => button.addEventListener('click', () => {
    const value = Number(button.dataset.wagerChip);
    if (!Number.isSafeInteger(amount + value)) return;
    amount += value;
    selectedChip = value;
    render();
    save();
  }));
  clear.addEventListener('click', () => {
    amount = 0;
    selectedChip = null;
    render();
    save();
  });
  render();

  const nav = document.querySelector('.gameday-app-nav');
  function updateOffsets() {
    const navHeight = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
    document.body.style.setProperty('--gd-wager-nav-height', `${navHeight}px`);
    document.body.style.setProperty('--gd-wager-safe-bottom', navHeight > 0 ? '0px' : 'env(safe-area-inset-bottom)');
    document.body.style.setProperty('--gd-wager-panel-height', `${Math.ceil(panel.getBoundingClientRect().height)}px`);
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateOffsets);
    observer.observe(panel, { box: 'border-box' });
    if (nav) observer.observe(nav, { box: 'border-box' });
  }
  window.addEventListener('resize', updateOffsets, { passive: true });
  requestAnimationFrame(updateOffsets);
})();
