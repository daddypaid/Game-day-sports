const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const source = stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname, '../supabase/functions/poker-test/engine.ts'), 'utf8')).replace(/^export /gm, '');
const context = vm.createContext({ crypto: webcrypto, Uint32Array });
vm.runInContext(source, context);
const { startGame, actGame, publicHand } = context;
const plain = object => JSON.parse(JSON.stringify(object));
const card = (rank, suit = '♠') => ({ rank: String(rank), suit });
const allCards = ['♣', '♦', '♥', '♠'].flatMap(suit => ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map(rank => card(rank, suit)));
function shoe(prefix = []) {
  const keys = new Set(prefix.map(card => card.rank + card.suit));
  assert.equal(keys.size, prefix.length, 'Test deck prefix must be distinct');
  return [...prefix, ...allCards.filter(card => !keys.has(card.rank + card.suit))];
}
function verifyLedger(state, wallet, initial) {
  assert.equal(state.potCents, state.committedCents + state.opponentCommittedCents);
  assert.ok(Number.isSafeInteger(state.potCents));
  assert.ok(state.committedCents <= state.stackCents);
  assert.ok(state.opponentCommittedCents <= state.stackCents);
  assert.ok(state.payoutCents >= 0 && state.payoutCents <= state.potCents);
  assert.equal(wallet, initial - state.committedCents + state.payoutCents);
  if (state.status === 'settled') {
    assert.equal(state.payoutCents + state.opponentPayoutCents, state.potCents);
    assert.deepEqual(plain(publicHand(state, wallet).legal_actions), []);
  }
}
function finish(transition, initial, choose) {
  let wallet = initial - transition.debitCents + transition.payoutCents;
  let state = transition.state;
  let count = 0;
  while (state.status === 'active') {
    assert.ok(count++ < 30, 'Every hand must finish without an endless betting cycle');
    const hand = publicHand(state, wallet);
    const selected = choose ? choose(hand, count, state) : null;
    const action = selected?.action || (hand.legal_actions.includes('draw') ? 'draw' : hand.legal_actions.includes('check') ? 'check'
      : hand.legal_actions.includes('call') ? 'call' : hand.legal_actions.includes('bring-in') ? 'bring-in' : 'fold');
    const amount = selected?.amount || 0;
    const before = JSON.stringify(state);
    const next = actGame(state, action, amount, selected?.discards || [], wallet);
    assert.equal(JSON.stringify(state), before, 'Accepted transitions must not mutate the previous state');
    assert.equal(next.state.action_count, state.action_count + 1);
    assert.equal(next.state.committedCents - state.committedCents, next.debitCents);
    assert.equal(next.payoutCents, next.state.payoutCents);
    wallet = wallet - next.debitCents + next.payoutCents;
    state = next.state;
    verifyLedger(state, wallet, initial);
  }
  return { state, wallet, count };
}

test('All four ante poker games complete their full streets and preserve wallet accounting', () => {
  const expected = { holdem: [2, 5], omaha: [4, 5], stud: [7, 0], draw: [5, 0] };
  for (const game of Object.keys(expected)) {
    const started = startGame(game, 100, 10000, shoe());
    const done = finish(started, 10000);
    assert.equal(done.state.status, 'settled');
    assert.equal(done.state.showdown, true);
    assert.equal(done.state.player.length, expected[game][0]);
    assert.equal(done.state.opponent.length, expected[game][0]);
    assert.equal(done.state.board.length, expected[game][1]);
    assert.ok(done.state.playerRank && done.state.opponentRank);
    assert.throws(() => actGame(done.state, 'check', 0, [], done.wallet), /finished/);
  }
});

test('Spending the entire bankroll on the ante runs out or offers a free draw instead of stuck controls', () => {
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    const started = startGame(game, 100, 100, shoe());
    if (game === 'draw') {
      assert.equal(started.state.street, 'draw');
      assert.deepEqual(plain(publicHand(started.state, 0).legal_actions), ['discard', 'draw']);
      const next = actGame(started.state, 'draw', 0, [0, 1, 2, 3, 4], 0);
      assert.equal(next.debitCents, 0);
      assert.equal(next.state.status, 'settled');
      verifyLedger(next.state, next.payoutCents, 100);
    } else {
      assert.equal(started.state.status, 'settled');
      verifyLedger(started.state, started.payoutCents, 100);
    }
  }
});

test('The public view hides the shoe, computer decisions and down cards, including after a fold', () => {
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    const state = startGame(game, 100, 10000, shoe()).state;
    const publicState = publicHand(state, 9900);
    for (const key of ['deck', 'player', 'opponent', 'stackCents', 'botActed', 'botRaised', 'roundOpponentCents']) assert.equal(Object.hasOwn(publicState, key), false);
    publicState.opponent_cards.forEach((card, index) => assert.equal(card.rank === '?', game !== 'stud' || index < 2));
    publicState.player_cards[0].rank = 'changed';
    assert.notEqual(state.player[0].rank, 'changed', 'Wire cards cannot modify the private state');
    const folded = actGame(state, 'fold', 0, [], 9900).state;
    assert.equal(folded.payoutCents, 0);
    assert.equal(folded.showdown, false);
    publicHand(folded, 9900).opponent_cards.forEach((card, index) => assert.equal(card.rank === '?', game !== 'stud' || index < 2));
  }
});

test('Stud keeps its seventh down card hidden until showdown and chooses the low up-card bring-in', () => {
  const prefix = [card('A'), card('K'), card('Q'), card('J'), card('2', '♣'), card('3', '♣')];
  let state = startGame('stud', 100, 10000, shoe(prefix)).state;
  assert.deepEqual(plain(publicHand(state, 9900).legal_actions), ['fold', 'bring-in', 'complete']);
  let wallet = 9900;
  for (let count = 0; count < 12 && state.street !== 'seventh'; count++) {
    const hand = publicHand(state, wallet);
    const action = hand.legal_actions.includes('bring-in') ? 'bring-in' : hand.legal_actions.includes('check') ? 'check' : 'call';
    const next = actGame(state, action, 0, [], wallet);
    wallet -= next.debitCents;
    state = next.state;
  }
  assert.equal(state.street, 'seventh');
  assert.equal(state.status, 'active');
  const cards = publicHand(state, wallet).opponent_cards;
  assert.equal(cards.length, 7);
  assert.equal(cards[0].rank, '?');
  assert.equal(cards[1].rank, '?');
  assert.equal(cards[6].rank, '?');
  assert.ok(cards.slice(2, 6).every(card => card.rank !== '?'));
  const done = finish({ state, debitCents: state.committedCents, payoutCents: 0 }, 10000);
  assert.ok(publicHand(done.state, done.wallet).opponent_cards.every(card => card.rank !== '?'));
});

test('A player bet, computer raise and player re-raise all use additional-debit amounts', () => {
  const deck = shoe([card('2', '♣'), card('A'), card('3', '♦'), card('A', '♥')]);
  const initial = startGame('holdem', 100, 10000, deck).state;
  const bet = actGame(initial, 'bet', 100, [], 9900);
  assert.equal(bet.debitCents, 100);
  assert.equal(bet.state.street, 'preflop');
  assert.equal(publicHand(bet.state, 9800).to_call, 1);
  assert.ok(publicHand(bet.state, 9800).legal_actions.includes('raise'));
  const raised = actGame(bet.state, 'raise', 200, [], 9800);
  assert.equal(raised.debitCents, 200);
  assert.equal(raised.state.street, 'flop', 'The computer does not endlessly re-raise');
  assert.equal(raised.state.committedCents, 400);
  assert.equal(raised.state.opponentCommittedCents >= 400, true); // The computer may open the next street.
});

test('Omaha enforces pot-limit bets and pot raises including the outstanding call', () => {
  const state = startGame('omaha', 100, 10000, shoe()).state;
  const wire = publicHand(state, 9900);
  assert.equal(wire.max_bet, 2);
  assert.ok(wire.legal_actions.includes('pot'));
  assert.throws(() => actGame(state, 'bet', 201, [], 9900), /from/);
  const facing = plain(state);
  facing.roundOpponentCents = 100;
  facing.opponentCommittedCents += 100;
  facing.potCents += 100;
  const facingWire = publicHand(facing, 9900);
  assert.equal(facingWire.to_call, 1);
  assert.equal(facingWire.max_raise, 5); // $3 in the pot + twice the $1 call.
  assert.throws(() => actGame(facing, 'raise', 501, [], 9900), /from/);
  const pot = actGame(facing, 'pot', 0, [], 9900);
  assert.equal(pot.debitCents, 500);
  assert.equal(pot.state.committedCents, 600);
});

test('Hold’em all-in is matched, deals all community cards and returns a single final payout', () => {
  const state = startGame('holdem', 100, 1000, shoe([card('2', '♣'), card('A'), card('3', '♦'), card('A', '♥')])).state;
  const allin = actGame(state, 'all-in', 0, [], 900);
  assert.equal(allin.debitCents, 900);
  assert.equal(allin.state.status, 'settled');
  assert.equal(allin.state.board.length, 5);
  verifyLedger(allin.state, allin.payoutCents, 1000);
  assert.throws(() => actGame(allin.state, 'all-in', 0, [], allin.payoutCents), /finished/);
});

test('Short calls caused by an externally reduced balance return only the computer’s unmatched chips', () => {
  const state = startGame('holdem', 100, 10000, shoe()).state;
  state.roundOpponentCents = 500;
  state.opponentCommittedCents += 500;
  state.potCents += 500;
  const next = actGame(state, 'call', 0, [], 125);
  assert.equal(next.debitCents, 125);
  assert.equal(next.state.committedCents, 225);
  assert.equal(next.state.opponentCommittedCents, 225);
  assert.equal(next.state.potCents, 450);
  assert.equal(next.state.status, 'settled');
  assert.ok(next.state.payoutCents <= 450);
  assert.deepEqual(plain(publicHand(state, 0).legal_actions), ['fold']);
});

test('Draw replacements happen once, preserve five unique cards per player and finish a final betting round', () => {
  const initial = startGame('draw', 100, 10000, shoe()).state;
  const first = actGame(initial, 'check', 0, [], 9900);
  // This deterministic computer has three of a kind and can open after Check.
  let state = first.state, wallet = 9900;
  while (state.street !== 'draw') {
    const next = actGame(state, 'call', 0, [], wallet);
    wallet -= next.debitCents;
    state = next.state;
  }
  const previous = plain(state.player);
  const next = actGame(state, 'draw', 0, [0, 2, 4], wallet);
  assert.equal(next.debitCents, 0);
  assert.equal(next.state.street, 'final');
  assert.equal(next.state.player.length, 5);
  assert.deepEqual(plain(next.state.player[1]), previous[1]);
  assert.deepEqual(plain(next.state.player[3]), previous[3]);
  for (const index of [0, 2, 4]) assert.notDeepEqual(plain(next.state.player[index]), previous[index]);
  const occupied = [...next.state.player, ...next.state.opponent, ...next.state.deck];
  assert.equal(new Set(occupied.map(card => card.rank + card.suit)).size, occupied.length);
  assert.throws(() => actGame(next.state, 'draw', 0, [], wallet), /not available/);
  const done = finish({ state: next.state, debitCents: next.state.committedCents, payoutCents: 0 }, 10000);
  assert.equal(done.state.status, 'settled');
});

test('Illegal actions, invalid discard indices and invalid amounts leave the prior hand untouched', () => {
  const state = startGame('holdem', 100, 10000, shoe()).state;
  const before = JSON.stringify(state);
  for (const [action, amount, discards] of [['call', 0, []], ['draw', 0, []], ['bet', 99, []], ['raise', 100, []], ['bet', -1, []], ['bet', 10000, []], ['bet', 100, [0]], ['check', 0, [1, 1]], ['check', 0, [5]], ['check', 0, ['0']]]) {
    assert.throws(() => actGame(state, action, amount, discards, 9900));
    assert.equal(JSON.stringify(state), before);
  }
  assert.throws(() => startGame('baccarat', 100, 1000));
  assert.throws(() => startGame('holdem', 0, 1000));
  assert.throws(() => startGame('holdem', 1001, 1000));
  assert.throws(() => startGame('holdem', 100, 1000, shoe().slice(1)));
});

test('Omaha showdown uses exactly two hole cards and three board cards, never a board royal flush', () => {
  const base = startGame('omaha', 100, 10000, shoe()).state;
  base.player = [card('2', '♣'), card('3', '♦'), card('4', '♣'), card('5', '♦')];
  base.opponent = [card('A', '♥'), card('A', '♦'), card('6', '♣'), card('7', '♦')];
  base.board = [card('A'), card('K'), card('Q'), card('J'), card('10')];
  base.street = 'river';
  base.botActed = true;
  const done = actGame(base, 'check', 0, [], 9900);
  assert.equal(done.state.result, 'Computer won');
  assert.equal(done.state.playerRank, 'High card');
  assert.equal(done.state.opponentRank, 'Three of a kind');
});

test('A tied pot is split in whole cents with the odd cent allocated to the computer', () => {
  const base = startGame('holdem', 100, 10000, shoe()).state;
  base.player = [card('2', '♣'), card('3', '♦')];
  base.opponent = [card('4', '♣'), card('5', '♦')];
  base.board = [card('A'), card('K'), card('Q'), card('J'), card('10')];
  base.street = 'river';
  base.botActed = true;
  base.opponentCommittedCents += 1;
  base.potCents += 1;
  const done = actGame(base, 'check', 0, [], 9900);
  assert.equal(done.state.result, 'Split pot');
  assert.equal(done.payoutCents, 100);
  assert.equal(done.state.opponentPayoutCents, 101);
});

test('Showdowns compare standard categories, wheel straights, full-house pairs and kickers', () => {
  const cases = [
    [['A', 'K', 'Q', 'J', '9'], ['A', 'K', 'Q', 'J', '8'], 'High card', true],
    [['J', 'J', 'A', 'K', 'Q'], ['J', 'J', 'A', 'K', '10'], 'One pair', true],
    [['A', 'A', '2', '2', 'K'], ['K', 'K', 'Q', 'Q', 'A'], 'Two pair', true],
    [['3', '3', '3', 'K', 'J'], ['2', '2', '2', 'A', 'Q'], 'Three of a kind', true],
    [['A', '2', '3', '4', '5'], ['K', 'K', 'A', 'Q', 'J'], 'Straight', true],
    [['2', '2', '2', 'A', 'A'], ['3', '3', '3', 'K', 'K'], 'Full house', false],
    [['5', '5', '5', '5', 'A'], ['4', '4', '4', '4', 'A'], 'Four of a kind', true],
  ];
  for (const [player, opponent, label, win] of cases) {
    const used = new Set();
    const handCards = ranks => ranks.map((rank, index) => {
      const suits = ['♣', '♦', '♥', '♠'];
      const suit = [...suits.slice(index % 4), ...suits.slice(0, index % 4)].find(suit => !used.has(rank + suit));
      used.add(rank + suit);
      return card(rank, suit);
    });
    const base = startGame('draw', 100, 10000, shoe()).state;
    base.player = handCards(player);
    base.opponent = handCards(opponent);
    base.street = 'final';
    base.botActed = true;
    const done = actGame(base, 'check', 0, [], 9900);
    assert.equal(done.state.playerRank, label);
    assert.equal(done.state.result, win ? 'You won' : 'Computer won');
    assert.equal(done.payoutCents, win ? 200 : 0);
  }
  const fullhouse = startGame('stud', 100, 10000, shoe()).state;
  fullhouse.player = [card('2', '♣'), card('2', '♦'), card('2', '♥'), card('A', '♣'), card('A', '♦'), card('3', '♣'), card('4', '♣')];
  fullhouse.opponent = [card('3', '♦'), card('3', '♥'), card('3', '♠'), card('K', '♣'), card('K', '♦'), card('4', '♥'), card('6', '♣')];
  fullhouse.street = 'seventh';
  fullhouse.botActed = true;
  fullhouse.bringInPending = false;
  fullhouse.completionAvailable = false;
  fullhouse.roundPlayerCents = fullhouse.roundOpponentCents = 0;
  const done = actGame(fullhouse, 'check', 0, [], 9900);
  assert.equal(done.state.playerRank, 'Full house');
  assert.equal(done.state.opponentRank, 'Full house');
  assert.equal(done.state.result, 'Computer won', 'A full house compares trips before its pair');
});

test('Random standard decks and varied legal actions always terminate with a conserved pot', () => {
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    for (let round = 0; round < 30; round++) {
      const started = startGame(game, 100, 2500);
      finish(started, 2500, (hand, count) => {
        if (hand.legal_actions.includes('draw')) return { action: 'draw', discards: round % 2 ? [0, 2] : [] };
        if (round % 7 === 0 && hand.legal_actions.includes('all-in')) return { action: 'all-in' };
        if (round % 5 === 0 && hand.legal_actions.includes('pot')) return { action: 'pot' };
        if (round % 4 === 0 && count === 1 && hand.legal_actions.includes('complete')) return { action: 'complete' };
        if (round % 3 === 0 && hand.legal_actions.includes('raise')) return { action: 'raise', amount: Math.round(hand.min_raise * 100) };
        if (round % 2 === 0 && hand.legal_actions.includes('bet')) return { action: 'bet', amount: Math.round(hand.min_bet * 100) };
        return null;
      });
    }
  }
});

test('1,200 mixed-action hands including wallet reductions have bounded completion and safe ledger arithmetic', t => {
  const coverage = new Set();
  let maximumActions = 0;
  let showdowns = 0;
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    for (let round = 0; round < 300; round++) {
      const initial = 101 + (round % 17) * 113;
      const ante = 1 + round % Math.min(initial, 200);
      const started = startGame(game, ante, initial);
      let state = started.state;
      let wallet = initial - started.debitCents + started.payoutCents;
      let externalSpend = 0;
      let actions = 0;
      while (state.status === 'active') {
        assert.ok(actions++ < 100, `${game} hand ${round} did not finish`);
        if (round % 11 === 0 && actions === 2) {
          const spend = Math.floor(wallet * .83);
          externalSpend += spend;
          wallet -= spend;
        }
        const wire = publicHand(state, wallet);
        const legal = wire.legal_actions.filter(action => action !== 'discard' && (round % 5 === 0 || action !== 'fold') &&
          (round % 7 === 0 || !['all-in', 'pot'].includes(action)));
        if (!legal.length) legal.push('fold'); // A separately exhausted wallet can still finish by folding.
        assert.ok(legal.length > 0, 'An active hand must offer an action even with no spendable balance');
        const action = legal[(round + actions * 7) % legal.length];
        coverage.add(action);
        const amount = action === 'bet' ? Math.round((round % 13 ? wire.min_bet : wire.max_bet) * 100)
          : action === 'raise' ? Math.round((round % 13 ? wire.min_raise : wire.max_raise) * 100) : 0;
        const before = JSON.stringify(state);
        const transition = actGame(state, action, amount, action === 'draw' && round % 2 ? [0, 1, 2, 3, 4] : [], wallet);
        assert.equal(JSON.stringify(state), before);
        assert.equal(transition.state.action_count, state.action_count + 1);
        wallet = wallet - transition.debitCents + transition.payoutCents;
        state = transition.state;
        verifyLedger(state, wallet + externalSpend, initial);
      }
      if (state.showdown) showdowns++;
      maximumActions = Math.max(maximumActions, actions);
    }
  }
  for (const action of ['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'pot', 'bring-in', 'complete', 'draw']) assert.ok(coverage.has(action), `Missing coverage: ${action}`);
  assert.ok(maximumActions < 100);
  assert.ok(showdowns > 500, 'Mixed-action coverage should include full showdowns, not just folds');
  t.diagnostic(`1,200 completed hands (${showdowns} showdowns); maximum ${maximumActions} customer actions; all 10 actions covered.`);
});
