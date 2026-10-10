const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const source = stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname, '../supabase/functions/blackjack-test/index.ts'), 'utf8').replace(/^import .*;\n/gm, ''));
const card = (rank, suit = '♠') => ({ rank: String(rank), suit });
const cards = (...ranks) => ranks.map(rank => card(rank));

function engine({ player = cards(10, 6), dealer = cards(7, 2), draws = cards(8), stake = 1, balance = 100, authenticated = true, owner = 'customer' } = {}) {
  let hand = { id: 'hand-one', user_id: owner, status: 'active', stake, payout: 0, player_cards: player,
    dealer_cards: dealer, shoe: draws.toReversed(), player_hands: null, active_hand_index: null,
    action_count: 0, player_total: 0, dealer_total: 0 };
  const calls = [];
  let handler;
  const copy = value => JSON.parse(JSON.stringify(value));
  const admin = {
    from(table) {
      const filters = [];
      const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        order() { return query; }, limit() { return query; },
        async single() { return query.maybeSingle(); },
        async maybeSingle() {
          if (table === 'wallets') return { data: { balance } };
          const found = hand && filters.every(([key, value]) => hand[key] === value);
          return { data: found ? copy(hand) : null };
        } };
      return query;
    },
    async rpc(name, p) {
      calls.push({ name, p: copy(p) });
      if (name === 'advance_blackjack_test_hand_v3') {
        if (hand.status !== 'active') return { error: { message: 'Blackjack hand already settled' } };
        if (hand.action_count !== p.p_expected_action_count) return { error: { message: 'Blackjack hand changed; refresh and try again' } };
        balance -= p.p_additional_debit;
        Object.assign(hand, { status: p.p_status, stake: p.p_stake, player_cards: p.p_player_cards,
          player_hands: p.p_player_hands, active_hand_index: p.p_active_hand_index, dealer_cards: p.p_dealer_cards,
          shoe: p.p_shoe, player_total: p.p_player_total, dealer_total: p.p_dealer_total, payout: p.p_payout,
          action_count: hand.action_count + 1 });
      } else if (name === 'start_blackjack_test_hand_v2') {
        balance -= p.p_stake;
        hand = { id: 'hand-new', user_id: 'customer', status: p.p_status, stake: p.p_stake, payout: p.p_payout,
          player_cards: p.p_player_cards, dealer_cards: p.p_dealer_cards, shoe: p.p_shoe,
          player_total: p.p_player_total, dealer_total: p.p_dealer_total, action_count: 0,
          player_hands: null, active_hand_index: null };
      } else throw new Error('Unexpected RPC: ' + name);
      if (hand.status !== 'active') balance += hand.payout;
      return { data: [{ hand_id: hand.id, hand_status: hand.status, balance, payout: hand.payout, action_count: hand.action_count }] };
    }
  };
  const context = vm.createContext({ crypto: webcrypto, Uint32Array, Response, console,
    createClient(_url, _key, options) { return options ? { auth: { async getUser() { return { data: { user: authenticated ? { id: 'customer' } : null } }; } } } : admin; },
    Deno: { env: { get: key => key }, serve: value => { handler = value; } } });
  vm.runInContext(source, context);
  hand.player_total = context.total(player);
  hand.dealer_total = context.total(dealer);
  return { context, calls, get hand() { return copy(hand); }, get balance() { return balance; },
    async action(action, extra = {}) {
      const response = await handler(new Request('https://test.invalid/', { method: 'POST', body: JSON.stringify({ action, hand_id: hand?.id, ...extra }) }));
      return { status: response.status, ...await response.json() };
    },
    initialDeal(playerCards, dealerCards, subsequent = []) {
      hand = null;
      context.shuffle = () => [...subsequent.toReversed(), dealerCards[1], dealerCards[0], playerCards[1], playerCards[0]];
    } };
}

test('Stand finishes dealer below 17, declares push, credits stake, and disables actions', async () => {
  const e = engine({ player: cards(7, 6, 4), dealer: cards(7, 2), draws: cards(8) });
  const result = await e.action('stand');
  assert.equal(result.status, 200);
  assert.equal(result.hand.status, 'push');
  assert.equal(result.hand.dealer_total, 17);
  assert.equal(result.hand.dealer_cards.length, 3);
  assert.equal(result.hand.payout, 1);
  assert.equal(result.hand.balance, 101);
  assert.equal(result.hand.can_hit, false);
  assert.equal(result.hand.can_stand, false);
});

test('Dealer hits soft 17, including a soft total with multiple aces, and stops on hard 17', async () => {
  for (const dealer of [cards('A', 6), cards('A', 'A', 5)]) {
    const e = engine({ player: cards(10, 8), dealer, draws: cards(2) });
    const result = await e.action('stand');
    assert.equal(result.hand.dealer_total, 19);
    assert.equal(result.hand.status, 'lost');
    assert.equal(result.hand.dealer_cards.length, dealer.length + 1);
  }
  for (const dealer of [cards(10, 7), cards('A', 6, 10)]) {
    const e = engine({ player: cards(10, 8), dealer, draws: cards(2) });
    const result = await e.action('stand');
    assert.equal(result.hand.dealer_total, 17);
    assert.equal(result.hand.dealer_cards.length, dealer.length);
    assert.equal(result.hand.status, 'won');
  }
});

test('Dealer reevaluates softness after each draw rather than forcing a hit on every 17', async () => {
  const e = engine({ player: cards(10, 8), dealer: cards('A', 6), draws: cards(10, 2) });
  const result = await e.action('stand');
  assert.equal(result.hand.dealer_total, 17);
  assert.equal(result.hand.dealer_cards.length, 3);
  assert.equal(result.hand.status, 'won');
});

test('A hit to 21 completes dealer and pays; a bust completes without unnecessary dealer draws', async () => {
  const winner = engine({ player: cards(10, 6), dealer: cards(10, 8), draws: cards(5) });
  const result = await winner.action('hit');
  assert.equal(result.hand.player_total, 21);
  assert.equal(result.hand.status, 'won');
  assert.equal(result.hand.payout, 2);
  const loser = engine({ player: cards(2, 9, 'A'), dealer: cards(3, 8), draws: cards(10, 6) });
  const busted = await loser.action('hit');
  assert.equal(busted.hand.player_total, 22);
  assert.equal(busted.hand.status, 'player_bust');
  assert.equal(busted.hand.payout, 0);
  assert.equal(busted.hand.can_hit, false);
  assert.equal(busted.hand.dealer_cards.length, 2);
});

test('Double debits exactly one extra stake, adds one card and settles dealer', async () => {
  const e = engine({ player: cards(5, 6), dealer: cards(7, 7), draws: cards(10, 8), stake: 25 });
  const result = await e.action('double');
  assert.equal(result.hand.status, 'dealer_bust');
  assert.equal(result.hand.player_cards.length, 3);
  assert.equal(result.hand.stake, 50);
  assert.equal(result.hand.payout, 100);
  assert.equal(result.hand.balance, 175);
});

test('Split advances to the second hand after stand and settles both after double', async () => {
  const e = engine({ player: cards(8, 8), dealer: cards(10, 7), draws: cards(10, 3, 10), stake: 5 });
  const split = await e.action('split');
  assert.equal(split.hand.status, 'active');
  assert.equal(split.hand.player_hands.length, 2);
  assert.equal(split.hand.stake, 10);
  assert.equal(split.hand.balance, 95);
  assert.equal(split.hand.dealer_total, null);
  assert.equal(split.hand.dealer_cards[1].rank, '?');
  const first = await e.action('stand');
  assert.equal(first.hand.status, 'active');
  assert.equal(first.hand.active_hand_index, 1);
  assert.equal(first.hand.player_hands[0].status, 'stood');
  assert.equal(first.hand.can_double, true);
  const final = await e.action('double');
  assert.equal(final.hand.status, 'won');
  assert.equal(final.hand.player_hands[0].status, 'won');
  assert.equal(final.hand.player_hands[1].status, 'won');
  assert.equal(final.hand.stake, 15);
  assert.equal(final.hand.payout, 30);
  assert.equal(final.hand.balance, 120);
});

test('Split aces receive one extra card each and settle without another player action', async () => {
  const e = engine({ player: cards('A', 'A'), dealer: cards(10, 7), draws: cards(10, 8), stake: 5 });
  const result = await e.action('split');
  assert.equal(result.hand.status, 'won');
  assert.equal(result.hand.player_hands.every(hand => hand.cards.length === 2), true);
  assert.equal(result.hand.payout, 20);
  assert.equal(result.hand.can_hit, false);
});

test('Naturals without an Ace upcard settle immediately with 3:2 blackjack, push, or dealer win', async () => {
  const examples = [
    [cards('A', 'K'), cards(9, 8), 'player_blackjack', 2.5],
    [cards('A', 'K'), cards('Q', 'A'), 'push', 1],
    [cards(10, 9), cards('Q', 'A'), 'lost', 0],
  ];
  for (const [player, dealer, status, payout] of examples) {
    const e = engine();
    e.initialDeal(player, dealer);
    const result = await e.action('start', { stake: 1 });
    assert.equal(result.hand.status, status);
    assert.equal(result.hand.payout, payout);
    assert.equal(result.hand.can_hit, false);
    assert.equal(result.hand.balance, 99 + payout);
  }
});

test('Reconnect restores active hidden dealer; state recovers final result without settlement replay', async () => {
  const e = engine({ player: cards(10, 8), dealer: cards(10, 7), draws: [] });
  const resumed = await e.action('resume');
  assert.equal(resumed.hand.status, 'active');
  assert.equal(resumed.hand.dealer_cards[1].rank, '?');
  assert.equal(resumed.hand.dealer_total, null);
  const stood = await e.action('stand');
  const balance = e.balance;
  const state = await e.action('state');
  assert.deepEqual(state.hand, stood.hand);
  assert.equal(e.balance, balance);
  assert.equal(e.calls.length, 1);
  const repeated = await e.action('stand');
  assert.equal(repeated.status, 400);
  assert.equal(e.balance, balance);
});

test('Concurrent actions accept one transition and reject stale CAS without a second payout', async () => {
  const e = engine({ player: cards(10, 8), dealer: cards(10, 7), draws: cards(2) });
  const results = await Promise.all([e.action('hit'), e.action('stand')]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 400]);
  assert.equal(e.hand.action_count, 1);
});

test('Expected action count makes delayed retries recover current active or terminal state without replay', async () => {
  const e = engine({ player: cards(5, 6), dealer: cards(10, 7), draws: cards(2, 3) });
  const first = await e.action('hit', { expected_action_count: 0 });
  assert.equal(first.hand.action_count, 1);
  const repeated = await e.action('hit', { expected_action_count: 0 });
  assert.equal(repeated.recovered, true);
  assert.deepEqual(repeated.hand, first.hand);
  assert.equal(e.calls.length, 1);
  const final = await e.action('stand', { expected_action_count: 1 });
  const repeatedStand = await e.action('stand', { expected_action_count: 1 });
  assert.equal(repeatedStand.recovered, true);
  assert.deepEqual(repeatedStand.hand, final.hand);
  assert.equal(e.calls.length, 2);
  assert.equal(e.balance, final.hand.balance);
});

test('Latest hand recovery returns terminal naturals on resume without changing legacy active-null shape', async () => {
  const e = engine();
  e.initialDeal(cards('A', 'K'), cards(9, 8));
  const initial = await e.action('start', { stake: 1 });
  const latest = await e.action('resume', { include_latest: true });
  assert.equal(latest.hand, null);
  assert.equal(latest.resumed, false);
  assert.deepEqual(latest.latest_hand, initial.hand);
  const legacy = await e.action('resume');
  assert.equal(legacy.hand, null);
  assert.equal(Object.hasOwn(legacy, 'latest_hand'), false);
  assert.equal(e.calls.length, 1);
  const active = engine();
  const activeLatest = await active.action('resume', { include_latest: true });
  assert.equal(activeLatest.latest_hand.dealer_cards[1].rank, '?');
  assert.equal(activeLatest.latest_hand.dealer_total, null);
});

test('Malformed expected action counts fail before any transition', async () => {
  for (const value of [-1, 0.5, '0', null]) {
    const e = engine();
    const result = await e.action('hit', { expected_action_count: value });
    assert.equal(result.status, 400);
    assert.equal(result.error, 'Invalid expected action count');
    assert.equal(e.calls.length, 0);
  }
});

test('Authentication, ownership, invalid split and insufficient balance never execute a wallet RPC', async () => {
  for (const [options, action, expectedStatus] of [
    [{ authenticated: false }, 'start', 401],
    [{ owner: 'another-customer' }, 'stand', 400],
    [{ player: cards(9, 8) }, 'split', 400],
    [{ balance: 0 }, 'double', 400],
  ]) {
    const e = engine(options);
    const result = await e.action(action, { stake: 1 });
    assert.equal(result.status, expectedStatus);
    assert.equal(e.calls.length, 0);
  }
});
