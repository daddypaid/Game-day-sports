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

  const actions = {
    'gameday-blackjack.html': [[5, ['Hit', 'Stand', 'Double', 'Split', 'Deal']]],
    'gameday-baccarat.html': [[4, ['Player', 'Banker', 'Tie', 'Deal']]],
    'gameday-jacks-or-better.html': [[5, ['Hold 1', 'Hold 2', 'Hold 3', 'Hold 4', 'Hold 5']], [2, ['Deal', 'Draw']]],
    'gameday-texas-holdem.html': [[1, ['Deal']], [3, ['Fold', 'Check', 'Call', 'Bet', 'Raise', 'All In']]],
    'gameday-omaha.html': [[1, ['Deal']], [3, ['Fold', 'Check', 'Call', 'Bet', 'Raise', 'Pot']]],
    'gameday-seven-card-stud.html': [[1, ['Deal']], [4, ['Bring In', 'Complete', 'Fold', 'Check', 'Call', 'Bet', 'Raise']]],
    'gameday-five-card-draw.html': [[4, ['Deal', 'Discard', 'Draw', 'Fold', 'Check', 'Call', 'Bet', 'Raise']]],
    'gameday-roulette.html': [[2, ['Select Bet', 'Spin', 'Clear', 'Repeat Bet']]]
  };

  const chips = [[1, 'white'], [5, 'red'], [10, 'blue'], [25, 'green'], [100, 'black'], [500, 'purple']];
  const x = [16, 29.6, 43.2, 56.8, 70.4, 84];
  const curve = [-2.8, -0.8, 0, 0, -0.8, -2.8];
  const storageKey = `gameday:wager-draft:${game}`;
  let amount = 0;
  let selectedChip = null;
  let chipDraftStarted = false;
  let lastCompletedRound = null;
  let feedbackText = '';
  let locked = false;
  const maxWager = game === 'gameday-jacks-or-better.html' ? 1000 : 10000;
  const validAmount = value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(Math.round(value * 100) / 100 - value) < 1e-9;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && validAmount(saved.amount) && (saved.selectedChip === null || chips.some(([value]) => value === saved.selectedChip))) {
      amount = saved.amount;
      selectedChip = saved.selectedChip;
      chipDraftStarted = saved.chipDraftStarted === true;
      lastCompletedRound = typeof saved.lastCompletedRound === 'string' ? saved.lastCompletedRound : null;
    }
  } catch (_) { /* Wager adjustments also work without browser storage. */ }

  document.body.classList.add('gd-table-wager-page');
  stage.classList.add('gd-wager-surface');
  const artwork = [...stage.children].find(element => element.tagName === 'IMG');
  let artworkWrapper;
  if (artwork && rail[game] !== null) {
    artworkWrapper = document.createElement('div');
    artworkWrapper.className = 'gd-wager-artwork';
    stage.insertBefore(artworkWrapper, artwork);
    artworkWrapper.appendChild(artwork);
  } else {
    stage.classList.add('gd-wager-no-art');
  }
  const row = document.createElement('div');
  row.className = 'gd-wager-chip-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Add chips to your wager');
  row.innerHTML = chips.map(([value, color], index) => `<button type="button" class="gd-wager-chip" data-wager-chip="${value}" style="--gd-chip-x:${x[index]}%;--gd-chip-curve:${curve[index]}%" aria-label="Add $${value} ${color} chip to wager" aria-pressed="false"><img src="assets/chips/gameday-${value}.webp" width="150" height="150" alt="" draggable="false"></button>`).join('');
  if (artworkWrapper) {
    row.classList.add('gd-wager-on-table');
    stage.style.setProperty('--gd-chip-rail-y', `${rail[game]}%`);
  }
  (artworkWrapper || stage).appendChild(row);
  const buttons = [...row.querySelectorAll('[data-wager-chip]')];

  const panel = document.createElement('section');
  panel.className = 'gd-table-wager-panel';
  panel.setAttribute('aria-label', 'Wager and game actions');
  const existingStatus = stage.parentElement.querySelector('.note');
  const statusId = existingStatus?.id || 'gd-table-actions-status';
  if (existingStatus) existingStatus.id = statusId;
  panel.innerHTML = `<div class="gd-wager-bar"><button type="button" class="gd-wager-adjust" data-wager-adjust="increase" aria-label="Increase wager by $1"><span aria-hidden="true">&#8593;</span></button><div class="gd-wager-display"><span id="gd-table-wager-label">TOTAL BET</span><output class="gd-wager-total" aria-labelledby="gd-table-wager-label" aria-live="polite" aria-atomic="true"></output></div><button type="button" class="gd-wager-adjust" data-wager-adjust="decrease" aria-label="Decrease wager by $1"><span aria-hidden="true">&#8595;</span></button></div>
    <div class="gd-table-action-groups" role="group" aria-label="Game actions">${actions[game].map(([columns, labels]) => `<div class="gd-table-action-row" style="--gd-action-columns:${columns}">${labels.map(label => `<button type="button" class="gd-table-action" data-table-action="${label.toLowerCase().replaceAll(' ', '-')}" aria-describedby="${statusId}" disabled>${label}</button>`).join('')}</div>`).join('')}</div>
    ${existingStatus ? '' : `<p id="${statusId}" class="gd-table-actions-status">Gameplay is still building.</p>`}`;
  stage.appendChild(panel);
  const output = panel.querySelector('.gd-wager-total');
  const feedback = document.createElement('span');
  feedback.className = 'gd-wager-feedback';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  output.after(feedback);
  const increase = panel.querySelector('[data-wager-adjust="increase"]');
  const decrease = panel.querySelector('[data-wager-adjust="decrease"]');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  function render() {
    stage.dataset.wagerAmount = String(amount);
    output.value = money.format(amount);
    feedback.textContent = feedbackText;
    feedback.hidden = !feedbackText;
    increase.disabled = locked || amount >= maxWager;
    decrease.disabled = locked || amount === 0;
    buttons.forEach(button => {
      button.disabled = locked;
      button.setAttribute('aria-pressed', String(Number(button.dataset.wagerChip) === selectedChip));
    });
  }
  function save() {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ amount, selectedChip, chipDraftStarted, lastCompletedRound })); } catch (_) {}
  }
  function changed() {
    render();
    save();
    stage.dispatchEvent(new CustomEvent('gameday:wager-change', {bubbles:true, detail:{amount}}));
  }
  stage.gamedayWager = Object.freeze({
    getAmount: () => amount,
    setAmount(value) {
      if (!validAmount(value)) throw new TypeError('Invalid wager amount');
      amount = Math.round(value * 100) / 100;
      selectedChip = chips.some(([chip]) => chip === value) ? value : null;
      chipDraftStarted = false;
      feedbackText = '';
      changed();
    },
    setLocked(value) { locked = Boolean(value); render(); },
    startNextWager(roundId, value = amount) {
      // Reading the same completed result again must preserve the customer's next wager.
      if (roundId && roundId === lastCompletedRound) return;
      if (!validAmount(value)) throw new TypeError('Invalid wager amount');
      lastCompletedRound = roundId || null;
      amount = Math.round(value * 100) / 100;
      selectedChip = chips.some(([chip]) => chip === amount) ? amount : null;
      chipDraftStarted = false;
      feedbackText = '';
      changed();
    },
    onChange(callback) {
      const listener = event => callback(event.detail.amount);
      stage.addEventListener('gameday:wager-change', listener);
      return () => stage.removeEventListener('gameday:wager-change', listener);
    }
  });
  buttons.forEach(button => button.addEventListener('click', () => {
    if (locked || button.disabled) return;
    selectedChip = Number(button.dataset.wagerChip);
    // The first chip starts the next wager; every further tap adds another chip.
    const nextAmount = chipDraftStarted ? Math.round((amount + selectedChip) * 100) / 100 : selectedChip;
    amount = Math.min(maxWager, nextAmount);
    chipDraftStarted = true;
    feedbackText = nextAmount > maxWager ? `Maximum wager ${money.format(maxWager)}` : '';
    changed();
  }));
  increase.addEventListener('click', () => {
    if (locked || amount >= maxWager) return;
    amount = Math.min(maxWager, Math.round((amount + 1) * 100) / 100);
    chipDraftStarted = true;
    feedbackText = '';
    changed();
  });
  decrease.addEventListener('click', () => {
    if (locked || amount === 0) return;
    amount = Math.max(0, Math.round((amount - 1) * 100) / 100);
    chipDraftStarted = amount > 0;
    feedbackText = '';
    changed();
  });
  render();
  stage.dispatchEvent(new CustomEvent('gameday:wager-ready', {bubbles:true}));

  if (artworkWrapper) {
    function placePanel() {
      const imageHeight = artwork.getBoundingClientRect().height;
      if (!imageHeight) return;
      stage.style.minHeight = `${imageHeight}px`;
      const chipRadius = Math.max(...buttons.map(button => button.getBoundingClientRect().height)) / 2;
      const panelTop = imageHeight * rail[game] / 100 + chipRadius + 8;
      stage.style.setProperty('--gd-panel-overlap', `${Math.max(0, imageHeight - panelTop)}px`);
    }
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(placePanel);
      observer.observe(artworkWrapper, { box: 'border-box' });
    }
    artwork.addEventListener('load', placePanel);
    window.addEventListener('resize', placePanel, { passive: true });
    requestAnimationFrame(placePanel);
  }
})();
