/** Server-owned, heads-up ante poker. No identity, persistence or wallet writes live here. */
export type Card = { rank: string; suit: string };
export type Game = 'holdem' | 'omaha' | 'stud' | 'draw';
export type EngineState = {
  game: Game;
  status: 'active' | 'settled';
  street: string;
  action_count: number;
  stakeCents: number;
  stackCents: number;
  committedCents: number;
  opponentCommittedCents: number;
  potCents: number;
  payoutCents: number;
  opponentPayoutCents: number;
  result: string;
  player: Card[];
  opponent: Card[];
  board: Card[];
  deck: Card[];
  roundPlayerCents: number;
  roundOpponentCents: number;
  lastRaiseCents: number;
  botActed: boolean;
  botRaised: boolean;
  bringInPending: boolean;
  completionAvailable: boolean;
  showdown: boolean;
  playerRank?: string;
  opponentRank?: string;
};
export type Transition = { state: EngineState; debitCents: number; payoutCents: number };

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♣', '♦', '♥', '♠'];
const STREETS: Record<Game, string[]> = {
  holdem: ['preflop', 'flop', 'turn', 'river'],
  omaha: ['preflop', 'flop', 'turn', 'river'],
  stud: ['third', 'fourth', 'fifth', 'sixth', 'seventh'],
  draw: ['opening', 'draw', 'final'],
};
const value = (card: Card) => RANKS.indexOf(card.rank) + 2;
const clone = (state: EngineState): EngineState => JSON.parse(JSON.stringify(state));
const money = (cents: number) => cents / 100;
function integer(amount: number, name: string, allowZero = true) {
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1)) throw new Error(`${name} must be a non-negative whole number of cents.`);
}
function shuffledDeck(): Card[] {
  const deck = SUITS.flatMap(suit => RANKS.map(rank => ({ rank, suit })));
  const buffer = new Uint32Array(1);
  for (let index = deck.length - 1; index > 0; index--) {
    const range = index + 1;
    const limit = Math.floor(0x100000000 / range) * range;
    do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
    const other = buffer[0] % range;
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}
function validateDeck(deck: Card[]) {
  if (!Array.isArray(deck) || deck.length !== 52 || deck.some(card => !card || !RANKS.includes(card.rank) || !SUITS.includes(card.suit)) ||
    new Set(deck.map(card => card.rank + card.suit)).size !== 52) throw new Error('A complete, distinct standard deck is required.');
}
function take(state: EngineState): Card {
  const card = state.deck.shift();
  if (!card) throw new Error('The deck is incomplete.');
  return card;
}
function combinations(cards: Card[], count: number): Card[][] {
  const result: Card[][] = [];
  function choose(start: number, chosen: Card[]) {
    if (chosen.length === count) { result.push(chosen); return; }
    for (let index = start; index <= cards.length - (count - chosen.length); index++) choose(index + 1, [...chosen, cards[index]]);
  }
  choose(0, []);
  return result;
}
function compare(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}
function rankFive(cards: Card[]): { label: string; rank: number[] } {
  const values = cards.map(value).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  values.forEach(rank => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(card => card.suit === cards[0].suit);
  const unique = [...counts.keys()];
  const straight = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0] : unique.join(',') === '14,5,4,3,2' ? 5 : 0;
  if (flush && straight) return { label: straight === 14 ? 'Royal flush' : 'Straight flush', rank: [8, straight] };
  if (groups[0][1] === 4) return { label: 'Four of a kind', rank: [7, groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { label: 'Full house', rank: [6, groups[0][0], groups[1][0]] };
  if (flush) return { label: 'Flush', rank: [5, ...values] };
  if (straight) return { label: 'Straight', rank: [4, straight] };
  if (groups[0][1] === 3) return { label: 'Three of a kind', rank: [3, groups[0][0], ...groups.slice(1).map(([rank]) => rank)] };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { label: 'Two pair', rank: [2, groups[0][0], groups[1][0], groups[2][0]] };
  if (groups[0][1] === 2) return { label: 'One pair', rank: [1, groups[0][0], ...groups.slice(1).map(([rank]) => rank)] };
  return { label: 'High card', rank: [0, ...values] };
}
function evaluate(game: Game, cards: Card[], board: Card[]) {
  const candidates = game === 'omaha'
    ? combinations(cards, 2).flatMap(hole => combinations(board, 3).map(community => [...hole, ...community]))
    : combinations([...cards, ...board], 5);
  if (!candidates.length) throw new Error('The hand is not complete.');
  return candidates.map(rankFive).reduce((best, hand) => compare(hand.rank, best.rank) > 0 ? hand : best);
}
function toCall(state: EngineState) { return Math.max(0, state.roundOpponentCents - state.roundPlayerCents); }
function playerRemaining(state: EngineState, available: number) { return Math.max(0, Math.min(available, state.stackCents - state.committedCents)); }
function opponentRemaining(state: EngineState) { return Math.max(0, state.stackCents - state.opponentCommittedCents); }
function bounds(state: EngineState, available: number) {
  const call = toCall(state);
  const remaining = playerRemaining(state, available);
  const effective = Math.min(remaining, call + opponentRemaining(state));
  const maxBet = Math.min(effective, state.game === 'omaha' ? state.potCents : effective);
  const maxRaise = Math.min(effective, state.game === 'omaha' ? state.potCents + 2 * call : effective);
  return {
    call, remaining, maxBet, maxRaise,
    minBet: Math.min(state.stakeCents, maxBet),
    minRaise: Math.min(call + state.lastRaiseCents, maxRaise),
  };
}
function legalActions(state: EngineState, available: number): string[] {
  if (state.status !== 'active') return [];
  if (state.street === 'draw') return ['discard', 'draw'];
  const b = bounds(state, available);
  if (state.bringInPending) return ['fold', ...(b.remaining > 0 ? ['bring-in', 'complete'] : [])];
  const actions = ['fold'];
  if (b.call === 0) actions.push('check');
  else if (b.remaining > 0) actions.push('call');
  if (b.call === 0 && b.maxBet > 0) actions.push('bet');
  if (b.call > 0 && b.maxRaise > b.call) actions.push('raise');
  if (state.completionAvailable && b.remaining >= Math.min(state.stakeCents - state.roundPlayerCents, b.maxRaise)) actions.push('complete');
  if (state.game === 'holdem' && b.remaining > 0 && (b.call > 0 || b.maxBet > 0)) actions.push('all-in');
  if (state.game === 'omaha' && (b.call === 0 ? b.maxBet > 0 : b.maxRaise > b.call)) actions.push('pot');
  return actions;
}
function playerPays(state: EngineState, amount: number) {
  state.roundPlayerCents += amount;
  state.committedCents += amount;
  state.potCents += amount;
}
function opponentPays(state: EngineState, amount: number) {
  state.roundOpponentCents += amount;
  state.opponentCommittedCents += amount;
  state.potCents += amount;
}
/** Decisions use only the computer's cards and the public board, never the player's hidden cards or the shoe. */
function strength(state: EngineState) {
  const cards = state.opponent;
  if ((state.game === 'omaha' && state.board.length >= 3) || (state.game !== 'omaha' && cards.length + state.board.length >= 5)) {
    const hand = evaluate(state.game, cards, state.board);
    return Math.min(100, hand.rank[0] * 15 + hand.rank[1] * 1.4);
  }
  const counts = new Map<number, number>();
  cards.forEach(card => counts.set(value(card), (counts.get(value(card)) || 0) + 1));
  const pairs = [...counts].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (pairs.length) return Math.min(100, 25 + pairs[0][0] * 3 + (pairs[0][1] - 2) * 25 + (pairs.length - 1) * 15);
  const highest = Math.max(...cards.map(value));
  const suited = cards.length === 2 && cards[0].suit === cards[1].suit ? 6 : 0;
  return highest * 1.8 + suited;
}
function settle(state: EngineState, reason?: 'player-fold' | 'opponent-fold') {
  state.status = 'settled';
  state.bringInPending = false;
  state.completionAvailable = false;
  if (reason) {
    state.result = reason === 'player-fold' ? 'You folded' : 'Computer folded';
    state.payoutCents = reason === 'opponent-fold' ? state.potCents : 0;
  } else {
    state.showdown = true;
    const player = evaluate(state.game, state.player, state.board);
    const opponent = evaluate(state.game, state.opponent, state.board);
    state.playerRank = player.label;
    state.opponentRank = opponent.label;
    const winner = compare(player.rank, opponent.rank);
    state.result = winner > 0 ? 'You won' : winner < 0 ? 'Computer won' : 'Split pot';
    state.payoutCents = winner > 0 ? state.potCents : winner < 0 ? 0 : Math.floor(state.potCents / 2);
  }
  state.opponentPayoutCents = state.potCents - state.payoutCents;
}
function resetRound(state: EngineState) {
  state.roundPlayerCents = 0;
  state.roundOpponentCents = 0;
  state.lastRaiseCents = state.stakeCents;
  state.botActed = false;
  state.botRaised = false;
  state.bringInPending = false;
  state.completionAvailable = false;
}
function botFirst(state: EngineState) {
  if (state.game === 'stud') {
    const visible = (cards: Card[]) => cards.slice(2, Math.min(cards.length, 6));
    const visibleRank = (cards: Card[]) => {
      const counts = new Map<number, number>();
      visible(cards).forEach(card => counts.set(value(card), (counts.get(value(card)) || 0) + 1));
      return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]).flatMap(([rank, count]) => [count, rank]);
    };
    return compare(visibleRank(state.opponent), visibleRank(state.player)) > 0;
  }
  return state.game === 'draw' ? state.street === 'final' : ['flop', 'river'].includes(state.street);
}
function botOpens(state: EngineState, available: number) {
  state.botActed = true;
  if (strength(state) < 40) return;
  const desired = state.stakeCents * (strength(state) >= 65 ? 2 : 1);
  const amount = Math.min(desired, playerRemaining(state, available), opponentRemaining(state), state.game === 'omaha' ? state.potCents : desired);
  if (amount > 0) {
    opponentPays(state, amount);
    state.lastRaiseCents = amount;
  }
}
/** Close only a matched betting round. With either effective stack exhausted, deal all remaining streets without another wager. */
function advanceStreet(state: EngineState, available: number) {
  while (state.status === 'active') {
    const streets = STREETS[state.game];
    const next = streets.indexOf(state.street) + 1;
    if (next >= streets.length) { settle(state); return; }
    state.street = streets[next];
    resetRound(state);
    if (state.game === 'holdem' || state.game === 'omaha') {
      take(state); // Burn a card before every community street.
      const count = state.street === 'flop' ? 3 : 1;
      for (let index = 0; index < count; index++) state.board.push(take(state));
    } else if (state.game === 'stud') {
      state.player.push(take(state));
      state.opponent.push(take(state));
    } else if (state.street === 'draw') {
      return; // Even an all-in player still chooses which cards to replace.
    }
    if (playerRemaining(state, available) === 0 || opponentRemaining(state) === 0) continue;
    if (botFirst(state)) botOpens(state, available);
    return;
  }
}
function matchShortCall(state: EngineState) {
  const excess = state.roundOpponentCents - state.roundPlayerCents;
  if (excess > 0) {
    state.roundOpponentCents -= excess;
    state.opponentCommittedCents -= excess;
    state.potCents -= excess;
  }
}
function botResponds(state: EngineState, available: number, wasBringIn = false) {
  const call = Math.max(0, state.roundPlayerCents - state.roundOpponentCents);
  const score = strength(state);
  if (call > state.stakeCents * 2 && score < 22) { settle(state, 'opponent-fold'); return; }
  opponentPays(state, Math.min(call, opponentRemaining(state)));
  state.botActed = true;
  const desiredRaise = wasBringIn && score >= 40 ? Math.max(0, state.stakeCents - state.roundOpponentCents)
    : !state.botRaised && score >= 65 && call <= state.stakeCents * 2 ? state.lastRaiseCents : 0;
  const raise = Math.min(desiredRaise, opponentRemaining(state), playerRemaining(state, available), state.game === 'omaha' ? state.potCents : desiredRaise);
  if (raise > 0 && (wasBringIn || raise >= state.lastRaiseCents)) {
    opponentPays(state, raise);
    state.lastRaiseCents = wasBringIn ? state.stakeCents : raise;
    state.botRaised = true;
    state.completionAvailable = false;
    return;
  }
  advanceStreet(state, available);
}
function botDraws(state: EngineState) {
  const cards = state.opponent;
  const hand = evaluate('draw', cards, []);
  if (hand.rank[0] >= 4) return;
  const counts = new Map<number, number>();
  cards.forEach(card => counts.set(value(card), (counts.get(value(card)) || 0) + 1));
  const keep = new Set<number>();
  cards.forEach((card, index) => { if ((counts.get(value(card)) || 0) >= 2) keep.add(index); });
  if (!keep.size) {
    const best = cards.map((card, index) => ({ index, rank: value(card) })).sort((a, b) => b.rank - a.rank).slice(0, 2);
    best.forEach(card => keep.add(card.index));
  }
  cards.forEach((_card, index) => { if (!keep.has(index)) state.opponent[index] = take(state); });
}

export function startGame(game: string, stakeCents: number, balanceCents: number, deck?: Card[]): Transition {
  if (!Object.hasOwn(STREETS, game)) throw new Error('Choose a supported poker table.');
  integer(stakeCents, 'Ante', false);
  integer(balanceCents, 'Balance');
  if (balanceCents > Math.floor(Number.MAX_SAFE_INTEGER / 2)) throw new Error('The balance is outside this table’s supported range.');
  if (stakeCents > 1000000) throw new Error('The maximum opening ante is $10,000.');
  if (stakeCents > balanceCents) throw new Error('The ante exceeds your available balance.');
  const shoe = deck ? deck.map(card => ({ ...card })) : shuffledDeck();
  validateDeck(shoe);
  const type = game as Game;
  const state: EngineState = {
    game: type, status: 'active', street: STREETS[type][0], action_count: 0,
    stakeCents, stackCents: balanceCents, committedCents: stakeCents, opponentCommittedCents: stakeCents,
    potCents: stakeCents * 2, payoutCents: 0, opponentPayoutCents: 0, result: '',
    player: [], opponent: [], board: [], deck: shoe, roundPlayerCents: 0, roundOpponentCents: 0,
    lastRaiseCents: stakeCents, botActed: false, botRaised: false, bringInPending: false, completionAvailable: false, showdown: false,
  };
  const count = { holdem: 2, omaha: 4, stud: 3, draw: 5 }[type];
  for (let index = 0; index < count; index++) { state.player.push(take(state)); state.opponent.push(take(state)); }
  const available = balanceCents - stakeCents;
  if (available === 0) {
    advanceStreet(state, available);
  } else if (type === 'stud') {
    const playerUp = state.player[2], opponentUp = state.opponent[2];
    const playerBrings = value(playerUp) < value(opponentUp) || (value(playerUp) === value(opponentUp) && SUITS.indexOf(playerUp.suit) < SUITS.indexOf(opponentUp.suit));
    if (playerBrings) state.bringInPending = true;
    else {
      const bring = Math.min(Math.ceil(stakeCents / 2), available);
      opponentPays(state, bring);
      state.botActed = true;
      state.completionAvailable = bring < stakeCents;
    }
  }
  return { state, debitCents: stakeCents, payoutCents: state.payoutCents };
}

export function actGame(input: EngineState, action: string, amountCents = 0, discards: number[] = [], availableCents = 0): Transition {
  integer(availableCents, 'Balance');
  integer(amountCents, 'Wager');
  if (!input || input.status !== 'active') throw new Error('This hand has finished. Deal a new hand.');
  if (!legalActions(input, availableCents).includes(action) || action === 'discard') throw new Error('That action is not available on this street.');
  if (!Array.isArray(discards) || discards.some(index => !Number.isInteger(index) || index < 0 || index > 4) || new Set(discards).size !== discards.length) throw new Error('Choose each discard card once.');
  if (action !== 'draw' && discards.length) throw new Error('Cards can only be discarded during the draw.');
  const state = clone(input);
  state.action_count++;
  let debit = 0;
  if (action === 'fold') {
    settle(state, 'player-fold');
  } else if (action === 'draw') {
    discards.forEach(index => { state.player[index] = take(state); });
    botDraws(state);
    advanceStreet(state, availableCents);
  } else if (action === 'check') {
    if (!state.botActed) botOpens(state, availableCents);
    if (toCall(state) === 0) advanceStreet(state, availableCents);
  } else {
    const b = bounds(state, availableCents);
    const wasBringIn = action === 'bring-in';
    if (action === 'call') debit = Math.min(b.call, b.remaining);
    else if (action === 'bring-in') debit = Math.min(Math.ceil(state.stakeCents / 2), b.maxBet);
    else if (action === 'complete') debit = Math.min(state.stakeCents - state.roundPlayerCents, b.call > 0 ? b.maxRaise : b.maxBet);
    else if (action === 'all-in') debit = Math.min(b.remaining, b.call + opponentRemaining(state));
    else if (action === 'pot') debit = b.call > 0 ? b.maxRaise : b.maxBet;
    else {
      const minimum = action === 'bet' ? b.minBet : b.minRaise;
      const maximum = action === 'bet' ? b.maxBet : b.maxRaise;
      if (amountCents < minimum || amountCents > maximum) throw new Error(`Choose a wager from $${money(minimum).toFixed(2)} to $${money(maximum).toFixed(2)}.`);
      debit = amountCents;
    }
    if (debit <= 0 || debit > b.remaining) throw new Error('Your available balance cannot cover that wager.');
    const raiseSize = debit - b.call;
    if (!wasBringIn && raiseSize > 0) state.lastRaiseCents = action === 'complete' ? state.stakeCents : raiseSize;
    state.bringInPending = false;
    state.completionAvailable = false;
    playerPays(state, debit);
    const remaining = availableCents - debit;
    if (action === 'call' || state.roundPlayerCents <= state.roundOpponentCents) {
      matchShortCall(state);
      advanceStreet(state, remaining);
    } else {
      botResponds(state, remaining, wasBringIn);
    }
  }
  if (state.potCents !== state.committedCents + state.opponentCommittedCents || state.committedCents > state.stackCents || state.opponentCommittedCents > state.stackCents) throw new Error('The hand ledger is inconsistent.');
  return { state, debitCents: debit, payoutCents: state.status === 'settled' ? state.payoutCents : 0 };
}

export function publicHand(state: EngineState, availableCents: number) {
  integer(availableCents, 'Balance');
  const b = bounds(state, availableCents);
  const copyCard = (card: Card) => ({ rank: card.rank, suit: card.suit });
  return {
    game: state.game, status: state.status, street: state.street, action_count: state.action_count,
    player_cards: state.player.map(copyCard),
    opponent_cards: state.opponent.map((card, index) => state.showdown || (state.game === 'stud' && index >= 2 && index <= 5) ? copyCard(card) : { rank: '?', suit: '' }),
    board: state.board.map(copyCard),
    pot: money(state.potCents), stake: money(state.stakeCents), committed: money(state.committedCents),
    payout: money(state.payoutCents), result: state.result,
    ...(state.showdown ? { player_rank: state.playerRank, opponent_rank: state.opponentRank } : {}),
    legal_actions: legalActions(state, availableCents), to_call: money(b.call),
    min_bet: money(b.minBet), min_raise: money(b.minRaise), max_bet: money(b.maxBet), max_raise: money(b.maxRaise),
  };
}
