const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../supabase/functions');
const card = (rank, suit = '♠') => ({ rank: String(rank), suit });
const cards = (...ranks) => ranks.map(rank => card(rank));

function service(slug, { authenticated = true, rounds = [], hands = [], balance = 100 } = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(path.resolve(root, slug, 'index.ts'), 'utf8').replace(/^import .*;\n/gm, ''));
  let handler;
  const calls = [];
  const queries = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const admin = {
    from(table) {
      const filters = [];
      let fields = [], ordered = false, limited = false;
      const query = {
        select(value) { fields = value.split(','); return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order() { ordered = true; return query; }, limit() { limited = true; return query; },
        async single() { return query.maybeSingle(); },
        async maybeSingle() {
          queries.push({ table, filters: clone(filters), fields });
          const records = table === 'wallets' ? [{ user_id: 'customer', balance }] : table === 'baccarat_rounds' ? rounds : hands;
          let matches = records.filter(record => filters.every(([key, value]) => record[key] === value));
          if (ordered) matches = matches.toSorted((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          if (!limited && matches.length > 1) throw new Error('Mock query expected a single row');
          const record = matches[0];
          return { data: record ? clone(Object.fromEntries(fields.map(field => [field, record[field] ?? null]))) : null };
        }
      };
      return query;
    },
    async rpc(name, p) {
      calls.push({ name, p: clone(p) });
      if (name === 'place_baccarat_test_round_atomic') {
        balance = balance - p.p_stake + p.p_payout;
        return { data: [{ round_id: 'new-round', payout: p.p_payout, balance }] };
      }
      if (name === 'settle_video_poker_test_atomic') {
        const hand = hands.find(hand => hand.id === p.p_hand_id && hand.user_id === p.p_user_id && hand.status === 'active');
        if (!hand) return { error: new Error('Active hand not found') };
        balance += p.p_payout;
        Object.assign(hand, { final_hand: p.p_final_hand, result: p.p_result, multiplier: p.p_multiplier, payout: p.p_payout,
          status: 'settled', settled_at: '2026-10-10T09:01:00Z' });
        return { data: [{ hand_id: hand.id, payout: hand.payout, balance }] };
      }
      throw new Error('Unexpected RPC: ' + name);
    }
  };
  const context = vm.createContext({ crypto: webcrypto, Uint32Array, Response, console,
    createClient(_url, _key, options) { return options ? { auth: { async getUser() { return { data: { user: authenticated ? { id: 'customer' } : null } }; } } } : admin; },
    Deno: { env: { get: key => key }, serve: value => { handler = value; } } });
  vm.runInContext(source, context);
  return { context, calls, queries, get balance() { return balance; },
    async request(body) {
      const response = await handler(new Request('https://test.invalid/', { method: 'POST', body: JSON.stringify(body) }));
      return { status: response.status, ...await response.json() };
    } };
}

test('Baccarat player and banker wagers push on a tie; tie wager wins 8:1', async () => {
  for (const [bet_type, payout] of [['player', 10], ['banker', 10], ['tie', 90]]) {
    const e = service('baccarat-test');
    e.context.baccaratDeal = () => ({ player: cards(4, 4), banker: cards(5, 3), playerTotal: 8, bankerTotal: 8 });
    const result = await e.request({ stake: 10, bet_type });
    assert.equal(result.status, 200);
    assert.equal(result.round.result, 'tie');
    assert.equal(result.round.payout, payout);
    assert.equal(result.round.balance, 90 + payout);
    assert.equal(e.calls.length, 1);
  }
});

test('Baccarat player win, banker commission and losing tie wager retain existing payouts', async () => {
  for (const [bet_type, playerTotal, bankerTotal, payout] of [['player', 9, 8, 20], ['banker', 8, 9, 19.5], ['tie', 9, 8, 0]]) {
    const e = service('baccarat-test');
    e.context.baccaratDeal = () => ({ player: cards(playerTotal), banker: cards(bankerTotal), playerTotal, bankerTotal });
    const result = await e.request({ stake: 10, bet_type });
    assert.equal(result.status, 200);
    assert.equal(result.round.payout, payout);
  }
});

test('Baccarat natural and third-card tableau deal complete hands rather than leaving dealer unfinished', () => {
  const cases = [
    [[4, 4, 5, 2, 6, 7], 2, 2], // natural eight stops both
    [[3, 3, 2, 3, 4], 2, 3], // player six stands, banker five draws
    [[3, 2, 10, 3, 8, 4], 3, 2], // banker three stands on player's eight
    [[3, 2, 10, 3, 7, 4], 3, 3],
    [[3, 2, 10, 4, 1, 4], 3, 2],
    [[3, 2, 10, 4, 2, 4], 3, 3],
    [[3, 2, 10, 5, 3, 4], 3, 2],
    [[3, 2, 10, 5, 4, 4], 3, 3],
    [[3, 2, 10, 6, 5, 4], 3, 2],
    [[3, 2, 10, 6, 6, 4], 3, 3],
  ];
  for (const [ranks, playerCount, bankerCount] of cases) {
    const e = service('baccarat-test');
    e.context.shuffle = () => cards(...ranks).toReversed();
    const deal = e.context.baccaratDeal();
    assert.equal(deal.player.length, playerCount);
    assert.equal(deal.banker.length, bankerCount);
    assert.equal(deal.playerTotal, e.context.handTotal(deal.player));
    assert.equal(deal.bankerTotal, e.context.handTotal(deal.banker));
  }
});

test('Baccarat latest and known-state recovery are owner scoped and never replay wallet settlement', async () => {
  const rounds = [
    { id: 'old-round', user_id: 'customer', created_at: '2026-10-10T09:00:00Z', stake: 10, bet_type: 'player', payout: 10, result: 'tie' },
    { id: 'new-round', user_id: 'customer', created_at: '2026-10-10T09:01:00Z', stake: 25, bet_type: 'banker', payout: 48.75, result: 'banker' },
    { id: 'other-round', user_id: 'another-customer', created_at: '2026-10-10T09:02:00Z', stake: 500 },
  ];
  const e = service('baccarat-test', { rounds, balance: 123.75 });
  const latest = await e.request({ action: 'latest' });
  assert.equal(latest.round.id, 'new-round');
  assert.equal(latest.round.created_at, rounds[1].created_at);
  assert.equal(latest.balance, 123.75);
  const old = await e.request({ action: 'state', round_id: 'old-round' });
  assert.equal(old.round.id, 'old-round');
  const other = await e.request({ action: 'state', round_id: 'other-round' });
  assert.equal(other.status, 400);
  assert.equal(other.error, 'Baccarat round not found');
  assert.equal(e.calls.length, 0);
  assert.equal(e.balance, 123.75);
});

function videoHand(overrides = {}) {
  return { id: 'hand-one', user_id: 'customer', game: 'jacks_or_better', stake: 5, status: 'active',
    initial_hand: [card('J', '♠'), card('J', '♥'), card(3, '♦'), card(4, '♣'), card(5, '♠')],
    deck_remaining: [card(8, '♣'), card(9, '♦'), card(10, '♥')], created_at: '2026-10-10T09:00:00Z',
    ...overrides };
}

test('Jacks or Better draw keeps held cards, replaces others and returns settled result and authoritative credit', async () => {
  const hand = videoHand();
  const e = service('jacks-or-better-test', { hands: [hand] });
  const result = await e.request({ action: 'draw', hand_id: hand.id, holds: [0, 1] });
  assert.equal(result.status, 200);
  assert.equal(result.hand.status, 'settled');
  assert.deepEqual(result.hand.final_hand.slice(0, 2), hand.initial_hand.slice(0, 2));
  assert.deepEqual(result.hand.final_hand.slice(2), hand.deck_remaining);
  assert.equal(result.hand.result, 'Jacks or Better');
  assert.equal(result.hand.payout, 5);
  assert.equal(result.balance, 105);
  const replay = await e.request({ action: 'draw', hand_id: hand.id, holds: [0, 1] });
  assert.equal(replay.status, 400);
  assert.equal(e.calls.length, 1);
  assert.equal(e.balance, 105);
});

test('Jacks or Better state and latest recover settled draw and active deal without exposing hidden deck', async () => {
  const old = videoHand({ status: 'settled', final_hand: cards('J', 'J', 8, 9, 10), result: 'Jacks or Better', multiplier: 1, payout: 5 });
  const active = videoHand({ id: 'new-hand', created_at: '2026-10-10T09:02:00Z' });
  const other = videoHand({ id: 'other-hand', user_id: 'another-customer', created_at: '2026-10-10T09:03:00Z' });
  const e = service('jacks-or-better-test', { hands: [old, active, other], balance: 90 });
  const result = await e.request({ action: 'resume', include_latest: true });
  assert.equal(result.hand.id, 'new-hand');
  assert.equal(result.latest_hand.id, 'new-hand');
  assert.equal(result.balance, 90);
  assert.equal(Object.hasOwn(result.hand, 'deck_remaining'), false);
  assert.equal(Object.hasOwn(result.latest_hand, 'deck_remaining'), false);
  const state = await e.request({ action: 'state', hand_id: 'hand-one' });
  assert.equal(state.hand.status, 'settled');
  assert.equal(state.hand.result, 'Jacks or Better');
  assert.equal(state.hand.payout, 5);
  assert.equal(state.hand.final_hand.length, 5);
  assert.equal(Object.hasOwn(state.hand, 'deck_remaining'), false);
  const hidden = await e.request({ action: 'state', hand_id: 'other-hand' });
  assert.equal(hidden.status, 400);
  assert.equal(e.calls.length, 0);
});

test('Jacks or Better hold-all evaluates and settles one complete hand with no replacement draw', async () => {
  const hand = videoHand({ initial_hand: cards(10, 'J', 'Q', 'K', 'A') });
  const e = service('jacks-or-better-test', { hands: [hand] });
  const result = await e.request({ action: 'draw', hand_id: hand.id, holds: [0, 1, 2, 3, 4] });
  assert.equal(result.hand.result, 'Royal Flush');
  assert.equal(result.hand.payout, 4000);
  assert.deepEqual(result.hand.final_hand, hand.initial_hand);
});

test('Both games reject unauthenticated recovery and invalid round ids without a wallet RPC', async () => {
  for (const slug of ['baccarat-test', 'jacks-or-better-test']) {
    const e = service(slug, { authenticated: false });
    const result = await e.request({ action: slug === 'baccarat-test' ? 'latest' : 'resume' });
    assert.equal(result.status, 401);
    assert.equal(e.calls.length, 0);
  }
  const baccarat = service('baccarat-test');
  const result = await baccarat.request({ action: 'state' });
  assert.equal(result.status, 400);
  assert.equal(result.error, 'Round ID is required');
  assert.equal(baccarat.calls.length, 0);
});
