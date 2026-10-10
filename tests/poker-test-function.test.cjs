const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { root, user, other, engineExports } = require('./helpers/poker-test-fixture.cjs');
const engine = engineExports();
const key = '00000000-0000-4000-8000-000000000001';
const handId = '00000000-0000-4000-8000-000000000002';
const otherHandId = '00000000-0000-4000-8000-000000000003';
const clone = value => JSON.parse(JSON.stringify(value));
function gameService({ authenticated = true, balance = 1000, hands = [], receipts = [], rpcError = null, queryError = null } = {}) {
  let handler;
  const calls = [], queries = [];
  const admin = {
    from(table) {
      const filters = []; let fields = [], latest = false;
      const query = {
        select(value) { fields = value.split(','); return query; },
        eq(field, value) { filters.push([field, value]); return query; },
        order() { latest = true; return query; }, limit() { return query; },
        single() { return query.maybeSingle(); },
        async maybeSingle() {
          queries.push({ table, fields, filters: clone(filters) });
          if (queryError) return { error: queryError };
          const rows = table === 'wallets' ? [{ user_id: user, balance }] : table === 'poker_test_hands' ? hands : receipts;
          let matches = rows.filter(row => filters.every(([field, value]) => row[field] === value));
          if (latest) matches = matches.toSorted((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          const row = matches[0];
          return { data: row ? clone(Object.fromEntries(fields.map(field => [field, row[field] ?? null]))) : null, error: null };
        }
      };
      return query;
    },
    async rpc(name, params) {
      calls.push({ name, params: clone(params) });
      if (rpcError) return { error: rpcError };
      assert.equal(name, 'commit_poker_test_hand_atomic');
      balance = balance - params.p_debit + params.p_payout;
      return { data: [{ hand_id: params.p_hand_id || handId, private_state: params.p_state, balance,
        started_request_id: key, last_request_id: params.p_request_id }], error: null };
    }
  };
  const engineSource = stripTypeScriptTypes(fs.readFileSync(path.resolve(root, 'supabase/functions/poker-test/engine.ts'), 'utf8')).replace(/^export /gm, '');
  const edgeSource = stripTypeScriptTypes(fs.readFileSync(path.resolve(root, 'supabase/functions/poker-test/index.ts'), 'utf8').replace(/^import .*;\n/gm, ''), { mode: 'transform' });
  const context = vm.createContext({ crypto: webcrypto, Uint32Array, structuredClone, Request, Response, AbortController, setTimeout, clearTimeout, console,
    createClient(_url, apiKey) { return apiKey === 'SUPABASE_ANON_KEY' ? { auth: { async getUser() { return { data: { user: authenticated ? { id: user } : null }, error: null }; } } } : admin; },
    Deno: { env: { get: key => key }, serve: value => { handler = value; } } });
  vm.runInContext(engineSource + '\n' + edgeSource, context);
  return {
    calls, queries,
    async request(body, { auth = true, method = 'POST', raw } = {}) {
      const request = new Request('https://test.invalid/', { method, headers: auth ? { Authorization: 'Bearer fixture-token' } : {}, ...(method === 'POST' ? { body: raw === undefined ? JSON.stringify(body) : raw } : {}) });
      const response = await handler(request);
      return { status: response.status, headers: response.headers, ...(method === 'OPTIONS' ? { text: await response.text() } : await response.json()) };
    }
  };
}
function hand(game = 'holdem', owner = user) {
  return { id: owner === user ? handId : otherHandId, user_id: owner, game, status: 'active', action_count: 0,
    private_state: clone(engine.startGame(game, 500, 100000).state), is_test: true,
    started_request_id: key, last_request_id: key, created_at: '2026-10-10T11:00:00Z' };
}

test('Poker function authenticates ownership and supports CORS without any wallet write', async () => {
  for (const auth of [false, true]) {
    const service = gameService({ authenticated: !auth });
    const result = await service.request({ action: 'latest', game: 'holdem' }, { auth });
    assert.equal(result.status, 401); assert.equal(service.calls.length, 0); assert.equal(service.queries.length, 0);
  }
  const service = gameService();
  const cors = await service.request({}, { method: 'OPTIONS', auth: false });
  assert.equal(cors.status, 200); assert.equal(cors.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await service.request({}, { method: 'GET' })).status, 405);
});
test('Poker latest and state recover only owned game state and never expose deck or hidden opponent cards', async () => {
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    const owned = hand(game), foreign = hand(game, other);
    foreign.created_at = '2026-10-10T12:00:00Z';
    const service = gameService({ hands: [owned, foreign], balance: 995 });
    const latest = await service.request({ action: 'latest', game, user_id: other });
    assert.equal(latest.status, 200); assert.equal(latest.hand.id, handId); assert.equal(latest.balance, 995);
    assert.equal(latest.hand.started_request_id, key); assert.equal(latest.hand.last_request_id, key);
    assert.equal(Object.hasOwn(latest.hand, 'deck'), false); assert.equal(Object.hasOwn(latest.hand, 'private_state'), false);
    latest.hand.opponent_cards.forEach((card, index) => assert(game === 'stud' && index === 2 ? card.rank !== '?' : card.rank === '?'));
    const foreignState = await service.request({ action: 'state', game, hand_id: otherHandId });
    assert.equal(foreignState.status, 404); assert.equal(service.calls.length, 0);
    assert(service.queries.filter(query => query.table === 'poker_test_hands').every(query => query.filters.some(([field, value]) => field === 'user_id' && value === user)));
  }
  const empty = await gameService().request({ action: 'latest', game: 'holdem' });
  assert.equal(empty.hand, null); assert.equal(empty.balance, 1000);
});
test('Poker Deal computes server cards and sends verified owner, cents, request and wallet guard to atomic RPC', async () => {
  const service = gameService();
  const result = await service.request({ action: 'deal', game: 'omaha', stake: 5, request_id: key, user_id: other, payout: 999999, cards: [], result: 'win' });
  assert.equal(result.status, 200); assert.equal(result.hand.player_cards.length, 4); assert.equal(result.balance, 995);
  assert.equal(result.hand.balance, 995); assert.equal(result.hand.payout, 0); assert.equal(result.hand.last_request_id, key);
  assert.equal(service.calls.length, 1);
  const params = service.calls[0].params;
  assert.equal(params.p_user_id, user); assert.equal(params.p_game, 'omaha'); assert.equal(params.p_debit, 5);
  assert.equal(params.p_expected_balance, 1000); assert.equal(params.p_expected_action_count, -1);
  assert.equal(params.p_hand_id, null); assert.equal(params.p_state.deck.length, 44);
  assert.deepEqual(params.p_request_payload, { game: 'omaha', action: 'deal', stake: 5 });
});
test('Poker exact receipt replay bypasses stale version and settlement, while changed payload cannot reuse a request', async () => {
  const initial = engine.startGame('holdem', 500, 100000), settled = engine.actGame(initial.state, 'fold', 0, [], 99500);
  const payload = { game: 'holdem', action: 'fold', hand_id: handId, action_count: 0, amount: 0, discards: [] };
  const receipt = { user_id: user, request_id: key, hand_id: handId, game: 'holdem',
    request_payload: { discards: [], amount: 0, action_count: 0, hand_id: handId, action: 'fold', game: 'holdem' },
    state_result: clone(settled.state), balance: 995, started_request_id: key };
  const service = gameService({ receipts: [receipt], balance: 10 });
  const replay = await service.request({ ...payload, request_id: key });
  assert.equal(replay.status, 200); assert.equal(replay.hand.status, 'settled'); assert.equal(replay.balance, 995);
  assert.equal(replay.hand.last_request_id, key); assert.equal(service.calls.length, 0);
  assert.equal(service.queries.length, 1);
  const conflict = await service.request({ ...payload, action: 'call', request_id: key });
  assert.equal(conflict.status, 409); assert.equal(conflict.code, 'REQUEST_CONFLICT');
});
test('Each poker table sends a real accepted Fold transition through the owned atomic settlement boundary', async () => {
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    const owned = hand(game), service = gameService({ hands: [owned], balance: 995 });
    const result = await service.request({ game, action: 'fold', hand_id: handId, action_count: 0, request_id: key });
    assert.equal(result.status, 200); assert.equal(result.hand.status, 'settled');
    assert.equal(result.hand.action_count, 1); assert.equal(result.balance, 995);
    assert.equal(service.calls.length, 1);
    const params = service.calls[0].params;
    assert.equal(params.p_user_id, user); assert.equal(params.p_hand_id, handId); assert.equal(params.p_expected_action_count, 0);
    assert.equal(params.p_expected_balance, 995); assert.equal(params.p_debit, 0); assert.equal(params.p_payout, 0);
    assert.equal(params.p_state.status, 'settled'); assert.equal(params.p_state.action_count, 1);
    assert(result.hand.opponent_cards.every((card, index) => game === 'stud' && index >= 2 && index <= 5 ? card.rank !== '?' : card.rank === '?'));
  }
});
test('Poker rejects invalid wagers, stale hands and unavailable actions before RPC', async () => {
  for (const stake of [0, -1, 0.99, 10000.01, 1.001, '5', null]) {
    const service = gameService();
    const result = await service.request({ action: 'deal', game: 'holdem', stake, request_id: key });
    assert.equal(result.status, 400); assert.equal(service.calls.length, 0);
  }
  const service = gameService({ hands: [hand()], balance: 995 });
  assert.equal((await service.request({ action: 'check', game: 'holdem', hand_id: handId, action_count: 1, request_id: key })).status, 409);
  assert.equal((await service.request({ action: 'raise', game: 'holdem', hand_id: handId, action_count: 0, amount: 0.01, request_id: key })).status, 400);
  assert.equal((await service.request({ action: 'draw', game: 'holdem', hand_id: handId, action_count: 0, request_id: key })).status, 400);
  assert.equal((await service.request({ action: 'check', game: 'holdem', hand_id: handId, action_count: 0, discards: [0], request_id: key })).status, 400);
  assert.equal((await service.request({ action: 'deal', game: 'holdem', stake: 5, request_id: 'bad' })).status, 400);
  assert.equal((await service.request({}, { raw: 'bad-json' })).status, 400);
  assert.equal(service.calls.length, 0);
});
test('Poker RPC races return recoverable 409 and internal failures reveal no server details', async () => {
  for (const code of ['WALLET_CHANGED', 'HAND_CHANGED', 'ACTIVE_HAND_EXISTS']) {
    const service = gameService({ rpcError: { message: code } });
    const result = await service.request({ action: 'deal', game: 'holdem', stake: 5, request_id: key });
    assert.equal(result.status, 409); assert.equal(result.code, code); assert.equal(service.calls.length, 1);
  }
  const service = gameService({ rpcError: { message: 'SQL secret private_state deck_remaining service_role failure' } });
  const result = await service.request({ action: 'deal', game: 'holdem', stake: 5, request_id: key });
  assert.equal(result.status, 503); assert.equal(result.code, 'UNAVAILABLE');
  assert(!JSON.stringify(result).includes('private_state')); assert(!JSON.stringify(result).includes('service_role'));
});
