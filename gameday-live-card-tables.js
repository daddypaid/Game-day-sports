(() => {
  const page = (location.pathname.split('/').pop() || '').toLowerCase();
  const games = {
    'gameday-blackjack.html': 'blackjack',
    'gameday-three-card-poker.html': 'three-card-poker',
    'gameday-baccarat.html': 'baccarat',
    'gameday-video-poker.html': 'video-poker',
    'gameday-ultimate-texas-holdem.html': 'ultimate-holdem',
    'gameday-caribbean-stud.html': 'caribbean-stud'
  };
  const game = games[page];
  if (!game) return;

  const chipValues = [1, 5, 10, 25, 100, 500];
  const body = document.body;
  body.classList.add('gd-live-card-game', `gd-game-${game}`);

  function addShoe() {
    const table = document.querySelector('.table,.game,.board,.poker-table');
    if (!table || table.querySelector('.gd-shoe')) return;
    const shoe = document.createElement('div');
    shoe.className = 'gd-shoe';
    shoe.setAttribute('aria-hidden', 'true');
    table.prepend(shoe);
  }

  function wagerInputFor(group) {
    const panel = group.closest('.controls,.control-card,.decision,.stake,.stake-row') || document;
    return panel.querySelector('input[type="number"]') || document.querySelector('input[type="number"]');
  }

  function normalizeChipGroup(group) {
    if (group.dataset.gdChipSet === '1') return;
    group.dataset.gdChipSet = '1';
    group.classList.add('chips');
    group.replaceChildren(...chipValues.map(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.chip = String(value);
      button.textContent = `$${value}`;
      button.setAttribute('aria-label', `Select $${value} chip`);
      button.addEventListener('click', () => {
        const input = wagerInputFor(group);
        if (input && !input.disabled && !input.readOnly) {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        button.classList.remove('gd-chip-pop');
        requestAnimationFrame(() => button.classList.add('gd-chip-pop'));
      });
      button.addEventListener('animationend', () => button.classList.remove('gd-chip-pop'));
      return button;
    }));
  }

  function normalizeChips(root = document) {
    root.querySelectorAll?.('.chips,.quick-bets').forEach(normalizeChipGroup);
  }

  const seenCards = new WeakSet();
  function animateCard(card, delay = 0, reveal = false) {
    if (!(card instanceof HTMLElement) || seenCards.has(card)) return;
    seenCards.add(card);
    card.style.setProperty('--gd-delay', `${delay}ms`);
    requestAnimationFrame(() => card.classList.add(reveal ? 'gd-reveal' : 'gd-deal'));
    card.addEventListener('animationend', () => {
      card.classList.remove('gd-deal', 'gd-reveal');
      card.style.removeProperty('--gd-delay');
    }, { once: true });
  }

  document.querySelectorAll('.card').forEach(card => seenCards.add(card));
  addShoe();
  normalizeChips();

  let sequence = 0;
  new MutationObserver(records => {
    const cards = [];
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches('.card')) cards.push(node);
        node.querySelectorAll?.('.card').forEach(card => cards.push(card));
      }
      if (record.type === 'attributes' && record.target instanceof HTMLElement && record.target.matches('.card')) {
        const card = record.target;
        if (!seenCards.has(card)) cards.push(card);
      }
    }
    cards.forEach((card, index) => {
      const faceUp = !card.classList.contains('hidden-card') && !card.classList.contains('gameday-card-back');
      animateCard(card, index * 90, faceUp && card.classList.contains('revealing'));
    });
    sequence += cards.length;
    if (sequence > 1000) sequence = 0;
    normalizeChips();
    addShoe();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
