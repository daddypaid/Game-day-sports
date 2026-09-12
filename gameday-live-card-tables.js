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
    addShoe();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
