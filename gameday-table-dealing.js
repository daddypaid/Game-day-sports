/* Shared card presentation: dealing only. No wagers, settlement or backend calls. */
(() => {
  const games = {
    'gameday-blackjack.html': 'blackjack',
    'gameday-baccarat.html': 'baccarat',
    'gameday-jacks-or-better.html': 'jacks',
    'gameday-texas-holdem.html': 'holdem',
    'gameday-omaha.html': 'omaha',
    'gameday-seven-card-stud.html': 'stud',
    'gameday-five-card-draw.html': 'draw'
  };
  const game = games[location.pathname.split('/').pop()];
  const artwork = document.querySelector('.gd-wager-artwork');
  const panel = document.querySelector('.gd-table-wager-panel');
  if (!game || !artwork || !panel || artwork.querySelector('.gd-deal-layer')) return;

  const stage = artwork.parentElement;
  const actions = new Map([...panel.querySelectorAll('[data-table-action]')].map(button => [button.dataset.tableAction, button]));
  if (!actions.has('deal')) return;
  document.body.classList.add('gd-card-wager-page', 'gd-table-dealing-page');
  const layer = document.createElement('div');
  layer.className = 'gd-deal-layer';
  layer.dataset.dealGame = game;
  layer.dataset.dealPhase = 'idle';
  artwork.appendChild(layer);
  const status = document.getElementById(actions.get('deal').getAttribute('aria-describedby'));
  if (status) status.textContent = 'Card dealing is ready. Gameplay is still building.';
  const announcement = document.createElement('p');
  announcement.className = 'gd-deal-announcement';
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  panel.appendChild(announcement);

  const suitNames = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const pips = {
    2: [[50,18,0],[50,82,180]],
    3: [[50,18,0],[50,50,0],[50,82,180]],
    4: [[24,20,0],[76,20,0],[24,80,180],[76,80,180]],
    5: [[24,20,0],[76,20,0],[50,50,0],[24,80,180],[76,80,180]],
    6: [[24,18,0],[76,18,0],[24,50,0],[76,50,0],[24,82,180],[76,82,180]],
    7: [[24,16,0],[76,16,0],[50,34,0],[24,50,0],[76,50,0],[24,82,180],[76,82,180]],
    8: [[24,16,0],[76,16,0],[50,32,0],[24,43,0],[76,43,0],[50,68,180],[24,84,180],[76,84,180]],
    9: [[24,14,0],[76,14,0],[24,38,0],[76,38,0],[50,50,0],[24,62,180],[76,62,180],[24,86,180],[76,86,180]],
    10: [[24,12,0],[76,12,0],[50,27,0],[24,36,0],[76,36,0],[24,64,180],[76,64,180],[50,73,180],[24,88,180],[76,88,180]]
  };
  function centerMarkup(rank, suit) {
    if (rank === 'A' && (suit === '♠' || suit === '♥')) return `<div class="gd-card-center gd-card-signature" aria-hidden="true"><div class="gd-deck-art gd-deck-${suit === '♠' ? 'spade' : 'heart'}"></div></div>`;
    if (rank === 'A') return `<div class="gd-card-center" aria-hidden="true"><div class="gd-card-ace">${suit}</div></div>`;
    if (['J', 'Q', 'K'].includes(rank)) return `<div class="gd-card-center gd-card-court" aria-hidden="true"><div class="gd-deck-art gd-deck-${{J:'jack',Q:'queen',K:'king'}[rank]}"></div><span class="gd-court-suit">${suit}</span><span class="gd-court-suit gd-court-suit-bottom">${suit}</span></div>`;
    return `<div class="gd-card-center" aria-hidden="true"><div class="gd-card-pips">${pips[rank].map(([x,y,r]) => `<span class="gd-pip" style="--x:${x}%;--y:${y}%;--r:${r}deg">${suit}</span>`).join('')}</div></div>`;
  }

  const positions = {
    blackjack: { dealer: ['Dealer hand',50,53,86,11.5], player: ['Your hand',50,65,86,11.5] },
    baccarat: { player: ['Player hand',28,61,38,10], banker: ['Banker hand',72,61,38,10] },
    jacks: { player: ['Your hand',50,52.5,96,13.4] },
    holdem: { board: ['Community cards',50,43,57,10.4], player: ['Your hand',50,58,66,13.5] },
    omaha: { board: ['Community cards',50,47.5,59,10.5], player: ['Your hand',50,61,82,13.5] },
    stud: { player: ['Your hand',50,58,94,12.5] },
    draw: { player: ['Your hand',50,57.5,87,14] }
  };
  let groups = {};
  let deck = [];
  let phase = 'idle';
  let busy = false;
  let cancelled = false;
  let actionToken = 0;
  const waits = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set();

  function randomIndex(limit) {
    const sample = new Uint32Array(1);
    const boundary = Math.floor(0x100000000 / limit) * limit;
    do { crypto.getRandomValues(sample); } while (sample[0] >= boundary);
    return sample[0] % limit;
  }
  function newDeck() {
    deck = Object.keys(suitNames).flatMap(suit => ranks.map(rank => ({ rank, suit })));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  function resetHand() {
    newDeck();
    groups = {};
    layer.replaceChildren();
    Object.entries(positions[game]).forEach(([id, [label,x,y,width,cardWidth]]) => {
      const displayWidth = cardWidth * 1.1;
      const element = document.createElement('div');
      element.className = 'gd-deal-group';
      element.dataset.cardGroup = id;
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', label);
      element.style.cssText = `left:${x}%;top:${y}%;width:${width}%;aspect-ratio:${width / (displayWidth * 1.4)}`;
      if (id === 'board') {
        const caption = document.createElement('span');
        caption.className = 'gd-deal-caption';
        caption.textContent = label;
        caption.setAttribute('aria-hidden', 'true');
        element.appendChild(caption);
      }
      layer.appendChild(element);
      groups[id] = { id, element, cards: [], slots: 0, cardPercent: displayWidth / width * 100 };
    });
  }
  function setPhase(next) {
    phase = next;
    layer.dataset.dealPhase = next;
  }
  function paint(entry, group, index) {
    const card = entry.node;
    const selectable = group.id === 'player' && ((game === 'jacks' && phase === 'initial') || (game === 'draw' && phase === 'initial'));
    const selection = game === 'jacks' ? 'held' : 'discard';
    card.className = `card gd-deal-card ${entry.faceUp ? `gameday-detailed-card${['♥','♦'].includes(entry.card.suit) ? ' gd-red' : ''}` : 'gameday-card-back'}${entry.selected ? ' gd-card-selected' : ''}`;
    card.dataset.cardPosition = String(index + 1);
    card.dataset.cardGroup = group.id;
    card.toggleAttribute('data-card-selected', Boolean(entry.selected));
    card.dataset.selection = entry.selected ? selection : '';
    card.setAttribute('role', selectable ? 'button' : 'img');
    card.tabIndex = selectable ? 0 : -1;
    if (selectable) {
      card.setAttribute('aria-pressed', String(Boolean(entry.selected)));
      card.setAttribute('aria-disabled', String(busy));
    } else {
      card.removeAttribute('aria-pressed');
      card.removeAttribute('aria-disabled');
    }
    if (entry.faceUp) {
      card.dataset.gdRank = entry.card.rank;
      card.dataset.gdSuit = entry.card.suit;
      card.innerHTML = centerMarkup(entry.card.rank, entry.card.suit);
      const name = `${entry.card.rank} of ${suitNames[entry.card.suit]}`;
      card.setAttribute('aria-label', selectable ? `${name}, ${entry.selected ? (game === 'jacks' ? 'held' : 'selected to discard') : (game === 'jacks' ? 'not held' : 'kept')}, card ${index + 1}` : name);
    } else {
      delete card.dataset.gdRank;
      delete card.dataset.gdSuit;
      card.replaceChildren();
      card.setAttribute('aria-label', 'GameDay card back');
    }
  }
  function layoutGroup(group) {
    const count = Math.max(group.slots, group.cards.length, 1);
    const cardWidth = group.cardPercent;
    const availableStep = count > 1 ? (100 - cardWidth) / (count - 1) : 0;
    const step = group.id === 'board' || game === 'jacks' ? availableStep : Math.min(cardWidth + 2, availableStep);
    const start = (100 - step * (count - 1)) / 2;
    group.cards.forEach((entry, index) => {
      entry.slot.style.cssText = `left:${start + step * index}%;width:${cardWidth}%;z-index:${index + 1}`;
      paint(entry, group, index);
    });
  }
  function refreshCards() { Object.values(groups).forEach(layoutGroup); }
  function toggleSelection(group, entry) {
    if (busy || cancelled || phase !== 'initial' || group.id !== 'player' || !['jacks','draw'].includes(game)) return;
    entry.selected = !entry.selected;
    refreshCards();
    updateControls();
  }
  function makeEntry(group, faceUp, replaceIndex) {
    if (!deck.length) throw new Error('Card deck exhausted');
    const entry = { card: deck.pop(), faceUp, selected: false, node: document.createElement('div'), slot: document.createElement('div') };
    entry.slot.className = 'gd-deal-slot';
    entry.slot.appendChild(entry.node);
    entry.node.addEventListener('click', () => toggleSelection(group, entry));
    entry.node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        if (['jacks','draw'].includes(game) && phase === 'initial') event.preventDefault();
        toggleSelection(group, entry);
      }
    });
    if (replaceIndex === undefined) group.cards.push(entry);
    else {
      group.cards[replaceIndex].slot.remove();
      group.cards[replaceIndex] = entry;
    }
    group.element.appendChild(entry.slot);
    layoutGroup(group);
    return entry;
  }

  let soundEnabled = true;
  try { soundEnabled = sessionStorage.getItem('gameday:deal-sound') !== 'off'; } catch (_) {}
  let audio;
  let noise;
  const sources = new Set();
  const soundButton = document.createElement('button');
  soundButton.type = 'button';
  soundButton.className = 'gd-deal-sound';
  soundButton.setAttribute('aria-label', 'Card dealing sound');
  panel.appendChild(soundButton);
  function renderSound() {
    soundButton.setAttribute('aria-pressed', String(soundEnabled));
    soundButton.textContent = `Sound ${soundEnabled ? 'on' : 'off'}`;
  }
  function stopSounds() {
    sources.forEach(source => { try { source.stop(); } catch (_) {} });
    sources.clear();
  }
  function unlockAudio() {
    if (!soundEnabled || cancelled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!audio) {
        audio = new Context();
        noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * .095), audio.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
      }
      if (audio.state === 'suspended') return audio.resume().catch(() => {});
    } catch (_) { /* Card animation works when sound is unavailable. */ }
  }
  function dealSound() {
    if (!soundEnabled || !audio || audio.state !== 'running' || cancelled) return;
    try {
      const source = audio.createBufferSource();
      source.buffer = noise;
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      const gain = audio.createGain();
      const now = audio.currentTime;
      gain.gain.setValueAtTime(.001, now);
      gain.gain.linearRampToValueAtTime(.2, now + .005);
      gain.gain.exponentialRampToValueAtTime(.001, now + .09);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audio.destination);
      sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(now);
    } catch (_) {}
  }
  soundButton.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) unlockAudio();
    else stopSounds();
    try { sessionStorage.setItem('gameday:deal-sound', soundEnabled ? 'on' : 'off'); } catch (_) {}
    renderSound();
  });
  renderSound();

  function wait(milliseconds, token) {
    if (cancelled || token !== actionToken) return Promise.resolve(false);
    return new Promise(resolve => {
      const id = setTimeout(() => { waits.delete(id); resolve(!cancelled && token === actionToken); }, milliseconds);
      waits.set(id, resolve);
    });
  }
  function animate(entry) {
    if (!reducedMotion.matches && entry.node.animate) {
      const rect = entry.node.getBoundingClientRect();
      const surface = artwork.getBoundingClientRect();
      const sourceX = surface.left + surface.width * .89;
      const sourceY = surface.top + surface.height * .29;
      const animation = entry.node.animate([
        { transform: `translate(${sourceX - rect.left - rect.width / 2}px,${sourceY - rect.top - rect.height / 2}px) rotate(-18deg) scale(.45)`, opacity: 0 },
        { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 }
      ], { duration: 260, easing: 'cubic-bezier(.22,.65,.32,1)' });
      animations.add(animation);
      animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    }
    dealSound();
  }
  async function dealCards(items, token) {
    for (const item of items) {
      if (cancelled || token !== actionToken) return false;
      const entry = makeEntry(groups[item.group], item.faceUp !== false, item.replaceIndex);
      animate(entry);
      if (!await wait(reducedMotion.matches ? 35 : 110, token)) return false;
    }
    return wait(reducedMotion.matches ? 0 : 170, token);
  }
  const item = (group, faceUp = true, replaceIndex) => ({ group, faceUp, replaceIndex });
  function cards(group, count, faceUp = true) { return Array.from({ length: count }, () => item(group, faceUp)); }
  function enable(name, enabled) { if (actions.has(name)) actions.get(name).disabled = busy || !enabled; }
  function updateControls() {
    actions.forEach(button => { button.disabled = true; });
    enable('deal', true);
    let dealLabel = phase === 'idle' ? 'Deal' : 'New Deal';
    if (game === 'holdem' || game === 'omaha') dealLabel = ({ initial: 'Deal Flop', flop: 'Deal Turn', turn: 'Deal River' })[phase] || dealLabel;
    if (game === 'stud') dealLabel = ({ third: 'Deal 4th', fourth: 'Deal 5th', fifth: 'Deal 6th', sixth: 'Deal 7th', seventh: 'Show Cards' })[phase] || dealLabel;
    actions.get('deal').textContent = dealLabel;
    if (game === 'blackjack') {
      const active = phase === 'initial';
      enable('hit', active && groups.player.cards.length < 12);
      enable('stand', active);
      enable('double', active && groups.player.cards.length === 2);
    }
    if (game === 'jacks') {
      enable('draw', phase === 'initial');
      for (let i = 1; i <= 5; i++) {
        enable(`hold-${i}`, phase === 'initial');
        if (actions.has(`hold-${i}`)) actions.get(`hold-${i}`).setAttribute('aria-pressed', String(Boolean(groups.player?.cards[i - 1]?.selected)));
      }
    }
    if (game === 'draw') {
      enable('discard', phase === 'initial');
      enable('draw', phase === 'initial' && groups.player.cards.some(entry => entry.selected));
      actions.get('discard')?.setAttribute('aria-pressed', String(phase === 'initial' && groups.player.cards.every(entry => entry.selected)));
    }
    stage.dataset.dealBusy = String(busy);
    stage.setAttribute('aria-busy', String(busy));
  }
  let wagerLocks = [];
  function lockWager() {
    wagerLocks = [...stage.querySelectorAll('[data-wager-chip], [data-wager-adjust]')].map(button => [button, button.disabled]);
    wagerLocks.forEach(([button]) => { button.disabled = true; });
  }
  function unlockWager() {
    wagerLocks.forEach(([button, disabled]) => { button.disabled = disabled; });
    wagerLocks = [];
  }
  function reveal(group) {
    groups[group].cards.forEach(entry => { entry.faceUp = true; });
    refreshCards();
  }
  function baccaratValue(group) {
    return groups[group].cards.reduce((total, entry) => total + (entry.card.rank === 'A' ? 1 : Number(entry.card.rank) || 0), 0) % 10;
  }
  async function initialDeal(token) {
    resetHand();
    if (game === 'blackjack') {
      groups.player.slots = groups.dealer.slots = 2;
      setPhase('initial');
      if (!await dealCards([item('player'), item('dealer'), item('player'), item('dealer', false)], token)) return;
      announcement.textContent = 'Two cards dealt to each hand. Hit deals another card; Stand reveals the dealer card.';
    } else if (game === 'baccarat') {
      groups.player.slots = groups.banker.slots = 3;
      if (!await dealCards([item('player'), item('banker'), item('player'), item('banker')], token)) return;
      const playerTotal = baccaratValue('player');
      const bankerTotal = baccaratValue('banker');
      if (playerTotal < 8 && bankerTotal < 8) {
        let third;
        if (playerTotal <= 5) {
          if (!await dealCards([item('player')], token)) return;
          const rank = groups.player.cards[2].card.rank;
          third = rank === 'A' ? 1 : (Number(rank) || 0) % 10;
        }
        const drawBanker = third === undefined ? bankerTotal <= 5 : bankerTotal <= 2 || (bankerTotal === 3 && third !== 8) || (bankerTotal === 4 && third >= 2 && third <= 7) || (bankerTotal === 5 && third >= 4 && third <= 7) || (bankerTotal === 6 && third >= 6 && third <= 7);
        if (drawBanker && !await dealCards([item('banker')], token)) return;
      }
      setPhase('complete');
      announcement.textContent = 'Baccarat hands dealt, including third cards when required. Gameplay is still building.';
    } else if (game === 'jacks' || game === 'draw') {
      groups.player.slots = 5;
      setPhase('initial');
      if (!await dealCards(cards('player', 5), token)) return;
      announcement.textContent = game === 'jacks' ? 'Five cards dealt. Select cards to hold, then Draw.' : 'Five cards dealt. Select cards to discard, then Draw.';
    } else if (game === 'holdem' || game === 'omaha') {
      const count = game === 'omaha' ? 4 : 2;
      groups.player.slots = count;
      groups.board.slots = 5;
      setPhase('initial');
      if (!await dealCards(cards('player', count), token)) return;
      announcement.textContent = `${count} hole cards dealt. Deal Flop adds three community cards.`;
    } else {
      groups.player.slots = 7;
      setPhase('third');
      if (!await dealCards([item('player', false), item('player', false), item('player')], token)) return;
      announcement.textContent = 'Two face-down cards and one face-up card dealt. Deal 4th continues the hand.';
    }
  }
  async function perform(name, token) {
    if (name === 'deal') {
      if ((game === 'holdem' || game === 'omaha') && ['initial', 'flop', 'turn'].includes(phase)) {
        const next = { initial: 'flop', flop: 'turn', turn: 'river' }[phase];
        const count = phase === 'initial' ? 3 : 1;
        if (!await dealCards(cards('board', count), token)) return;
        setPhase(next);
        announcement.textContent = `${next[0].toUpperCase() + next.slice(1)} dealt. ${next === 'river' ? 'All five community cards are on the table.' : 'Deal continues the community cards.'}`;
      } else if (game === 'stud' && ['third','fourth','fifth','sixth','seventh'].includes(phase)) {
        if (phase === 'seventh') {
          reveal('player');
          setPhase('shown');
          announcement.textContent = 'All seven cards revealed.';
        } else {
          const next = { third:'fourth', fourth:'fifth', fifth:'sixth', sixth:'seventh' }[phase];
          if (!await dealCards([item('player', next !== 'seventh')], token)) return;
          setPhase(next);
          announcement.textContent = `${next[0].toUpperCase() + next.slice(1)} card dealt${next === 'seventh' ? ' face down. Show Cards reveals them.' : ' face up.'}`;
        }
      } else await initialDeal(token);
    } else if (name === 'hit' || name === 'double') {
      groups.player.slots = groups.player.cards.length + 1;
      if (!await dealCards([item('player')], token)) return;
      if (name === 'double') {
        reveal('dealer');
        setPhase('complete');
      }
      announcement.textContent = name === 'double' ? 'One additional card dealt. No wager was changed.' : 'One additional card dealt.';
    } else if (name === 'stand') {
      reveal('dealer');
      setPhase('complete');
      announcement.textContent = 'Dealer card revealed. Gameplay is still building.';
    } else if (name === 'draw') {
      const replacements = groups.player.cards.flatMap((entry, index) => (game === 'jacks' ? !entry.selected : entry.selected) ? [item('player', true, index)] : []);
      if (!await dealCards(replacements, token)) return;
      groups.player.cards.forEach(entry => { entry.selected = false; });
      setPhase('drawn');
      announcement.textContent = `${replacements.length} replacement ${replacements.length === 1 ? 'card' : 'cards'} dealt. Gameplay is still building.`;
    }
  }
  actions.forEach((button, name) => button.addEventListener('click', async () => {
    if (button.disabled || busy || cancelled) return;
    if (name.startsWith('hold-')) {
      toggleSelection(groups.player, groups.player.cards[Number(name.split('-')[1]) - 1]);
      return;
    }
    if (name === 'discard') {
      const select = !groups.player.cards.every(entry => entry.selected);
      groups.player.cards.forEach(entry => { entry.selected = select; });
      refreshCards();
      updateControls();
      announcement.textContent = select ? 'All five cards selected to discard. Tap a card to keep it.' : 'All five cards kept. Tap cards to select them for discard.';
      return;
    }
    if (!['deal','hit','double','stand','draw'].includes(name)) return;
    const soundReady = unlockAudio();
    busy = true;
    const token = ++actionToken;
    lockWager();
    updateControls();
    refreshCards();
    try {
      if (soundReady) await Promise.race([soundReady, wait(250, token)]);
      if (cancelled || token !== actionToken) return;
      await perform(name, token);
    }
    catch (_) {
      if (!cancelled) {
        setPhase('idle');
        announcement.textContent = 'The deal could not finish. Press Deal to start a fresh hand.';
      }
    } finally {
      busy = false;
      if (cancelled || token !== actionToken) {
        setPhase('idle');
        groups = {};
        layer.replaceChildren();
        announcement.textContent = '';
      }
      unlockWager();
      updateControls();
      refreshCards();
    }
  }));
  window.addEventListener('pagehide', () => {
    cancelled = true;
    actionToken += 1;
    waits.forEach((resolve, id) => { clearTimeout(id); resolve(false); });
    waits.clear();
    animations.forEach(animation => animation.cancel());
    animations.clear();
    stopSounds();
    try { audio?.suspend().catch(() => {}); } catch (_) {}
  });
  window.addEventListener('pageshow', () => { cancelled = false; updateControls(); });
  updateControls();
})();
