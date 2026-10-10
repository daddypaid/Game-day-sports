const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, A, B, id, stamp, games } = require('./helpers/casino-history-fixture.cjs');
let h;
test.before(async () => { h = await fixture(); });
test.after(async () => { await h?.close(); });
for (const [index, game] of games.entries()) {
  test(`${game} settled history uses actual owner/test/result database filters and redacts private state`, async () => {
    const n = 1000 + index * 100;
    const own = await h.insert(game, n);
    await h.insert(game, n + 1, { owner: B });
    await h.insert(game, n + 2, { active: true });
    // Poker's schema intentionally only allows test hands.
    if (index < 4) await h.insert(game, n + 3, { isTest: false });
    const answer = await h.send({ game, user_id: B, limit: 50 });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.rounds.map(row => row.id), [own]);
    assert.equal(answer.rounds[0].game, game); assert.equal(answer.rounds[0].settled_at, stamp);
    const encoded = JSON.stringify(answer);
    for (const secret of ['SHOE_SECRET', 'DECK_SECRET', 'STATE_SECRET', 'CARD_SECRET', 'private_state', 'deck_remaining', 'user_id']) assert(!encoded.includes(secret), secret + ' never leaves the service');
    const call = h.calls.filter(call => call.table).at(-1);
    assert(!call.columns.includes('shoe')); assert(!call.columns.includes('deck')); assert(!call.columns.split(',').includes('*'));
    assert(call.parameters.includes(A)); assert(!call.parameters.includes(B));
  });
}
test('Blackjack combined totals include exact insurance stake and payout plus settled split details', async () => {
  const insured = await h.insert('blackjack', 5001, { insurance: true, split: true });
  const answer = await h.send({ game: 'blackjack' });
  const row = answer.rounds.find(row => row.id === insured);
  assert.equal(row.stake, 25); assert.equal(row.payout, 30);
  assert.deepEqual([row.result.main_stake, row.result.main_payout, row.result.insurance_stake, row.result.insurance_payout], [20, 30, 5, 0]);
  assert.deepEqual(row.result.player_hands.map(hand => hand.status), ['won', 'push']);
  assert.equal(row.result.player_hands[0].cards[0].rank, '10'); assert(!JSON.stringify(row).includes('SPLIT_SECRET'));
  assert(!('balance' in row)); assert(!('balance_after' in row));
});
test('dealer Blackjack insurance win retains exact separate and combined returns', async () => {
  const insured = await h.insert('blackjack',5002,{insurance:true});
  const row = (await h.send({game:'blackjack'})).rounds.find(row=>row.id===insured);
  assert.equal(row.outcome,'lost'); assert.equal(row.result.dealer_total,21);
  assert.deepEqual([row.stake,row.payout,row.result.main_payout,row.result.insurance_payout],[15,15,0,15]);
});
for (const [i,bet] of ['red','black','odd','even','low','high','column1','column2','column3'].entries()) {
  test(`Roulette ${bet} retains its persisted null outside/column value`, async () => {
    const roundId = await h.insert('roulette',5500+i);
    await h.db.query("update roulette_spins set bet_type=$1,bet_value=null,winning_number=0,winning_color='green',payout=0,result='lost' where id=$2",[bet,roundId]);
    const row = (await h.send({game:'roulette',limit:50})).rounds.find(row=>row.id===roundId);
    assert.equal(row.result.bet_type,bet);assert.equal(row.result.bet_value,null);
    assert.equal(row.result.winning_number,0);assert.equal(row.payout,0);
  });
}
for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
  test(`${game} folded opponent keeps downcards private but retains public Stud upcards`, async () => {
    const roundId = await h.insert(game, 6000 + games.indexOf(game), { showdown: false });
    const row = (await h.send({ game })).rounds.find(row => row.id === roundId);
    assert.equal(row.stake, 25); assert.equal(row.result.ante, 10); assert.equal(row.payout, 0);
    assert.equal(row.result.showdown, false); assert(!('opponent_rank' in row.result));
    assert.deepEqual(row.result.opponent_cards.map(card => card.rank), game === 'stud' ? ['?', '?', '4', '5', '6', '7', '?'] : Array(game==='holdem'?2:game==='omaha'?4:5).fill('?'));
  });
}
test('equal-time keyset pagination covers all eight streams without omissions or duplicates', async () => {
  for (const [i, game] of games.entries()) {
    const n = 7000 + i * 100;
    for (let j = 0; j < 5; j++) await h.insert(game, n + j, { time: '2026-10-11T12:00:00.654321Z' });
    const found = []; let before;
    for (let page = 0; page < 20; page++) {
      const answer = await h.send({ game, limit: 2, ...(before ? { before } : {}) });
      assert.equal(answer.status, 200); found.push(...answer.rounds.map(row => row.id));
      before = answer.next_cursor; if (!before) break;
    }
    assert.equal(new Set(found).size, found.length, game + ' unique ids');
    assert.deepEqual(found.slice(0, 5), [4, 3, 2, 1, 0].map(j => id(n + j)));
    assert(found.includes(id(1000 + i * 100)), game + ' reaches prior timestamp');
  }
});
test('cursors are not authorization: another owner can only page their own stream', async () => {
  const b = await h.send({ game: 'blackjack' }, B);
  assert.equal(b.status, 200); assert.deepEqual(b.rounds.map(row => row.id), [id(1001)]);
  const aCursor = { created_at: '2026-10-11T12:00:00.654321Z', id: id(7004) };
  const answer = await h.send({ game: 'blackjack', before: aCursor }, B);
  assert.deepEqual(answer.rounds.map(row => row.id), [id(1001)]);
});
test('malformed input, unsafe cursors and unsupported games fail before any database query', async () => {
  for (const body of [[], null, '{', { game: 'wallets' }, { game: 'blackjack', limit: 0 }, { game: 'blackjack', limit: 51 }, { game: 'blackjack', limit: 1.5 }, { game: 'blackjack', before: [] }, { game: 'blackjack', before: { id: A, created_at: '2026-10-10T12:00:00Z),user_id.eq.' + B } }, { game: 'blackjack', before: { id: "x),user_id.eq." + B, created_at: stamp } }]) {
    const count = h.calls.length, answer = await h.send(body);
    assert.equal(answer.status, 400); assert.equal(h.calls.length, count);
  }
});
test('history requires verified authentication even with owner-shaped input', async () => {
  for (const owner of [null, 'invalid']) {
    const answer = await h.send({ game: 'blackjack', user_id: A }, owner);
    assert.equal(answer.status, 401); assert(!answer.rounds);
  }
  h.setAuth(false); assert.equal((await h.send({ game: 'blackjack' })).status, 401); h.setAuth(true);
});
test('temporary auth outages return retryable 503, while definite expiry returns 401', async () => {
  for (const error of [{ status: 0, message: 'network' }, { status: 500, message: 'server outage' }, { status: 503, message: 'auth unavailable' }]) {
    h.setAuthError(error); assert.equal((await h.send({ game: 'blackjack' })).status, 503);
  }
  for (const status of [401, 403]) { h.setAuthError({ status }); assert.equal((await h.send({ game: 'blackjack' })).status, 401); }
  h.setAuthError(null); assert.equal((await h.send({ game: 'blackjack' })).status, 200);
});
test('stalled auth and query JSON promises time out safely and recover on retry', async () => {
  h.setAuthHang(true); const auth = await h.send({ game: 'blackjack' }); h.setAuthHang(false);
  assert.equal(auth.status, 503); assert(!auth.rounds);
  h.setQueryHang(true); const query = await h.send({ game: 'blackjack' }); h.setQueryHang(false);
  assert.equal(query.status, 503); assert(!query.rounds);
  assert.equal((await h.send({ game: 'blackjack' })).status, 200);
});
test('database errors fail safely without raw private details and a retry succeeds', async () => {
  h.setFailure(true); const failed = await h.send({ game: 'blackjack' }); h.setFailure(false);
  assert.equal(failed.status, 503); assert(!JSON.stringify(failed).includes('SHOE_PRIVATE')); assert(!failed.rounds);
  assert.equal((await h.send({ game: 'blackjack' })).status, 200);
});
test('receipt retrieval is read-only and has no effect on wallets, ledger or settled rows', async () => {
  const before = await h.db.query(`select (select count(*) from wallets) wallets,(select count(*) from wallet_transactions) ledger,(select count(*) from blackjack_hands) blackjack,(select count(*) from poker_test_hands) poker`);
  for (const game of games) await h.send({ game });
  assert.deepEqual((await h.db.query(`select (select count(*) from wallets) wallets,(select count(*) from wallet_transactions) ledger,(select count(*) from blackjack_hands) blackjack,(select count(*) from poker_test_hands) poker`)).rows, before.rows);
});
test('service limits response size, rejects excess request bytes and serves no-store CORS', async () => {
  const answer = await h.send({ game: 'roulette', limit: 1 });
  assert.equal(answer.rounds.length, 1); assert.equal(h.calls.filter(call => call.table).at(-1).limit, 2);
  assert.equal(answer.headers['cache-control'], 'no-store');
  assert.equal((await h.send(JSON.stringify({ game: 'roulette', padding: 'x'.repeat(5000) }))).status, 413);
  assert.equal((await h.send({}, A, 'GET')).status, 405);
  assert.equal((await h.send({}, null, 'OPTIONS')).status, 200);
});
test('settled owner keyset indexes exist for all five tables without granting public access', async () => {
  const indexes = (await h.db.query("select indexname from pg_indexes where indexname like '%settled_history_idx'")).rows.map(row => row.indexname);
  assert.equal(indexes.length, 5);
  const config = fs.readFileSync(path.resolve(__dirname, '../supabase/config.toml'), 'utf8');
  assert.match(config, /\[functions\.casino-history-test\]\s*verify_jwt\s*=\s*true/);
});
