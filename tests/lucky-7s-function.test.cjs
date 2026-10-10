const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { test } = require('node:test');

const source = path.join(__dirname, '../supabase/functions/slots-test/index.ts');
const baseline = path.join(__dirname, 'fixtures/slots-test-v3.ts');
const symbols = ['RED7', 'BLUE7', 'GOLD7', 'FOOTBALL', 'SOCCER', 'HOCKEY', 'BASKETBALL', 'BOXING', 'GOALPOST'];
const lines = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
const pays = [200, 150, 100, 40, 40, 40, 40, 40, 40];
const request = (extra = {}) => ({ game: 'lucky-7s', math_version: 'five-lines-v1', total_bet: 1, ...extra });
const clone = (value) => JSON.parse(JSON.stringify(value));

function load(file = source, options = {}) {
  const state = { authenticated: true, rpcError: null, missingRow: false, ...options };
  const calls = [];
  let sequence = [];
  let seed = 123456789;
  let handler;
  const context = vm.createContext({
    console, Response, Request, Error, Uint32Array, JSON, Number, Math, Set,
    crypto: {
      getRandomValues(array) {
        for (let i = 0; i < array.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          array[i] = sequence.length ? sequence.shift() : seed;
        }
        return array;
      },
    },
    Deno: {
      env: { get: (name) => ({ SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[name] },
      serve: (fn) => { handler = fn; },
    },
    createClient(_url, key, config) {
      calls.push({ operation: 'client', key, authorization: config?.global?.headers?.Authorization });
      if (key === 'anon') return {
        auth: { async getUser() {
          calls.push({ operation: 'auth' });
          return state.authenticated
            ? { data: { user: { id: 'owned-user' } }, error: null }
            : { data: { user: null }, error: new Error('Invalid JWT') };
        } },
      };
      return { async rpc(name, args) {
        calls.push({ operation: 'rpc', name, args: clone(args) });
        assert.equal(name, 'play_slot_test_spin_atomic');
        return {
          data: state.missingRow ? [] : [{ spin_id: 'spin-id', payout: args.p_payout, balance: 401 - args.p_stake + args.p_payout }],
          error: state.rpcError ? new Error(state.rpcError) : null,
        };
      } };
    },
  });
  const text = fs.readFileSync(file, 'utf8').replace(/^import .*\n/gm, '');
  vm.runInContext(stripTypeScriptTypes(text), context, { filename: file });
  return {
    calls, state,
    setSequence(values) { sequence = [...values]; },
    evaluate(code) { return clone(vm.runInContext(code, context)); },
    async request(body, method = 'POST', rawBody) {
      const response = await handler(new Request('https://test.invalid/slots-test', {
        method,
        headers: { Authorization: 'Bearer test-jwt', 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(body) } : {}),
      }));
      const text = await response.text();
      return { status: response.status, body: text === 'ok' ? text : JSON.parse(text) };
    },
  };
}

test('existing v3 requests retain every legacy reel outcome, payout and settlement argument', async () => {
  const current = load(), original = load(baseline);
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
    current.setSequence([a, b, c]);
    original.setSequence([a, b, c]);
    const payload = { stake: 1.37, user_id: 'other-user', payout: 99999 };
    assert.deepEqual(await current.request(payload), await original.request(payload), `${a},${b},${c}`);
    assert.deepEqual(current.calls.at(-1), original.calls.at(-1));
  }
  for (const stake of [0, -1, 1000.01, null, '', '2', 1000]) {
    current.setSequence([0, 1, 2]);
    original.setSequence([0, 1, 2]);
    assert.deepEqual(await current.request({ stake }), await original.request({ stake }));
  }
});

test('all five lines pay only three identical symbols and use row-major winning cell coordinates', () => {
  const game = load();
  for (const [symbolIndex, symbol] of symbols.entries()) {
    for (const [lineIndex, rows] of lines.entries()) {
      const grid = Array.from({ length: 3 }, () => ['', '', '']);
      rows.forEach((row, column) => { grid[column][row] = symbol; });
      const award = game.evaluate(`evaluateLucky(${JSON.stringify(grid)},100)`);
      assert.equal(award.payout, pays[symbolIndex] / 5);
      assert.deepEqual(award.activeLines, [lineIndex]);
      assert.deepEqual(award.winCells, rows.map((row, column) => row * 3 + column));
      assert.equal(award.lineWins[0].multiplier, pays[symbolIndex]);
      grid[2][rows[2]] = symbols[(symbolIndex + 1) % symbols.length];
      assert.equal(game.evaluate(`evaluateLucky(${JSON.stringify(grid)},100)`).payout, 0);
    }
  }
});

test('crossing winning lines each pay once, share cells once, and all-nine RED7 returns 200 times total', () => {
  const game = load();
  const crossing = [['RED7', 'FOOTBALL', 'RED7'], ['SOCCER', 'RED7', 'HOCKEY'], ['RED7', 'BASKETBALL', 'RED7']];
  const award = game.evaluate(`evaluateLucky(${JSON.stringify(crossing)},100)`);
  assert.equal(award.payout, 80);
  assert.deepEqual(award.activeLines, [3, 4]);
  assert.deepEqual(award.winCells, [0, 4, 8, 6, 2]);
  const grid = Array.from({ length: 3 }, () => ['RED7', 'RED7', 'RED7']);
  const all = game.evaluate(`evaluateLucky(${JSON.stringify(grid)},20000)`);
  assert.equal(all.payout, 40000);
  assert.deepEqual(all.activeLines, [0, 1, 2, 3, 4]);
  assert.deepEqual([...all.winCells].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('exact base return follows from all 729 equally likely three-symbol combinations', () => {
  const game = load();
  let multiplierSum = 0;
  for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) for (let c = 0; c < 9; c++) {
    const grid = [[symbols[a], '', ''], [symbols[b], '', ''], [symbols[c], '', '']];
    const award = game.evaluate(`evaluateLucky(${JSON.stringify(grid)},500)`);
    multiplierSum += award.payout;
  }
  assert.equal(multiplierSum, 690);
  const config = game.evaluate('luckyConfig');
  assert.equal(config.rtp, 690 / 729);
  assert.equal(config.rtp_fraction, '690/729');
  assert.deepEqual(config.paylines, lines);
  assert.deepEqual(config.symbols, symbols);
  assert.equal(config.free_spins, 0);
  assert(!config.symbols.some((symbol) => /WILD|SCATTER/.test(symbol)));
});

test('new Lucky RNG rejects the four biased tail values without altering the legacy picker', () => {
  const game = load();
  for (const value of [4294967292, 4294967293, 4294967294, 4294967295]) {
    game.setSequence([value, 0]);
    assert.equal(game.evaluate('pickLuckySymbol()'), 'RED7');
  }
  game.setSequence([4294967291]);
  assert.equal(game.evaluate('pickLuckySymbol()'), 'GOALPOST');
});

test('status authenticates and returns configuration without any database or wallet writes', async () => {
  const game = load();
  const response = await game.request(request({ action: 'status', total_bet: undefined }));
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.bonus, null);
  assert.deepEqual(response.body.game_config, game.evaluate('luckyConfig'));
  assert.deepEqual(game.calls.map((call) => call.operation), ['client', 'auth']);
});

test('settlement uses verified ownership, server-generated 3x3 grid and exact configured awards', async () => {
  const game = load();
  game.setSequence([0, 1, 2, 0, 3, 4, 0, 5, 6]);
  const response = await game.request(request({ user_id: 'other-user', payout: 99999, grid: [['RED7']] }));
  assert.equal(response.status, 200);
  const spin = response.body.spin;
  assert.deepEqual(spin.grid, [['RED7', 'BLUE7', 'GOLD7'], ['RED7', 'FOOTBALL', 'SOCCER'], ['RED7', 'HOCKEY', 'BASKETBALL']]);
  assert.equal(spin.payout, 40);
  assert.equal(spin.balance, 440);
  assert.equal(spin.total_bet, 1);
  assert.equal(spin.bet_per_line, .2);
  assert.equal(spin.lines, 5);
  assert.equal(spin.math_version, 'five-lines-v1');
  assert.deepEqual(spin.win_lines, [0]);
  assert.deepEqual(spin.active_lines, [0]);
  assert.deepEqual(spin.win_cells, [0, 1, 2]);
  assert.equal(spin.free_spin, false);
  assert.equal(spin.bonus_triggered, false);
  const rpc = game.calls.filter((call) => call.operation === 'rpc');
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0].args, {
    p_user_id: 'owned-user', p_stake: 1, p_payout: 40, p_result: 'won',
    p_reels: ['lucky-7s:0:0:RED7', 'lucky-7s:0:1:BLUE7', 'lucky-7s:0:2:GOLD7', 'lucky-7s:1:0:RED7', 'lucky-7s:1:1:FOOTBALL', 'lucky-7s:1:2:SOCCER', 'lucky-7s:2:0:RED7', 'lucky-7s:2:1:HOCKEY', 'lucky-7s:2:2:BASKETBALL'],
  });
});

test('every supported total produces a whole-cent line unit and settlement once; invalid totals settle zero times', async () => {
  for (const total of [.1, .3, 1, 23.7, 199.9, 200]) {
    const game = load();
    game.setSequence(Array(9).fill(3));
    const response = await game.request(request({ total_bet: total }));
    assert.equal(response.status, 200, String(total));
    assert.equal(response.body.spin.payout, total * 40);
    assert.equal(response.body.spin.stake, total);
    const unitCents = response.body.spin.bet_per_line * 100;
    assert(Math.abs(unitCents - Math.round(unitCents)) < 1e-8);
    assert.equal(game.calls.filter((call) => call.operation === 'rpc').length, 1);
  }
  for (const total of [undefined, null, '1', '', 0, -.1, .01, .11, .125, 200.1, 1e8]) {
    const game = load();
    const response = await game.request(request({ total_bet: total }));
    assert.equal(response.status, 400, String(total));
    assert.match(response.body.error, /Total bet/);
    assert.equal(game.calls.filter((call) => call.operation === 'rpc').length, 0);
  }
});

test('version mismatch, unknown actions and malformed payload cannot fall through to old math', async () => {
  for (const body of [request({ math_version: undefined, stake: 1 }), request({ math_version: 'five-lines-v2' }), request({ game: 'midnight-monsters' }), request({ action: 'bonus_spin' }), request({ action: 'config' })]) {
    const game = load();
    assert.equal((await game.request(body)).status, 400);
    assert.equal(game.calls.filter((call) => call.operation === 'rpc').length, 0);
  }
  const game = load();
  assert.equal((await game.request({}, 'POST', '{broken')).status, 400);
  assert.equal(game.calls.filter((call) => call.operation === 'rpc').length, 0);
});

test('unauthenticated clients cannot read config or spin; HTTP preflight performs no auth or settlement', async () => {
  for (const action of ['status', 'spin']) {
    const game = load(source, { authenticated: false });
    assert.equal((await game.request(request({ action }))).status, 401);
    assert(!game.calls.some((call) => call.key === 'service'));
    assert(!game.calls.some((call) => call.operation === 'rpc'));
  }
  const game = load();
  assert.deepEqual(await game.request({}, 'OPTIONS'), { status: 200, body: 'ok' });
  assert.equal((await game.request({}, 'GET')).status, 405);
  assert.equal(game.calls.length, 0);
});

test('settlement errors and missing rows return no success and never automatically retry a wager', async () => {
  for (const options of [{ rpcError: 'Insufficient test balance' }, { rpcError: 'Network unavailable' }, { missingRow: true }]) {
    const game = load(source, options);
    const response = await game.request(request());
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, undefined);
    assert.equal(response.body.spin, undefined);
    assert.equal(game.calls.filter((call) => call.operation === 'rpc').length, 1);
  }
});
