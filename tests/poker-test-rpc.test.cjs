const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { user, other, migration, setupSQL, engineExports } = require('./helpers/poker-test-fixture.cjs');
let PGlite;
try { ({ PGlite } = require(process.env.GAMEDAY_PGLITE_MODULE || '@electric-sql/pglite')); }
catch (_) { /* SQL tests can run with a separately installed PGlite module. */ }
const engine = engineExports();
let counter = 1;
const requestId = () => '00000000-0000-4000-8000-' + String(counter++).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(setupSQL);
  await db.exec('begin;\n' + fs.readFileSync(migration, 'utf8') + '\ncommit;');
  async function commit({ owner = user, game = 'holdem', key = requestId(), payload, hand = null, count = -1, balance = 1000, transition }) {
    const result = await db.query('select * from public.commit_poker_test_hand_atomic($1::uuid,$2::text,$3::uuid,$4::jsonb,$5::uuid,$6::integer,$7::numeric,$8::jsonb,$9::numeric,$10::numeric)',
      [owner, game, key, JSON.stringify(payload || { game, action: 'deal', stake: transition.state.stakeCents / 100 }), hand, count, balance, JSON.stringify(transition.state), transition.debitCents / 100, transition.payoutCents / 100]);
    return result.rows[0];
  }
  const wallet = async owner => Number((await db.query('select balance from wallets where user_id=$1', [owner || user])).rows[0].balance);
  const ledger = async () => (await db.query('select count(*)::int as count from wallet_transactions')).rows[0].count;
  return { db, commit, wallet, ledger };
}
const sqlTest = (name, callback) => test(name, { skip: PGlite ? false : 'Install @electric-sql/pglite or set GAMEDAY_PGLITE_MODULE to run PostgreSQL verification.' }, callback);

sqlTest('Poker migration applies with RLS, service-only RPC and no browser access to private tables', async () => {
  const f = await fixture();
  const rights = await f.db.query(`select
    has_function_privilege('anon','public.commit_poker_test_hand_atomic(uuid,text,uuid,jsonb,uuid,integer,numeric,jsonb,numeric,numeric)','EXECUTE') as anon,
    has_function_privilege('authenticated','public.commit_poker_test_hand_atomic(uuid,text,uuid,jsonb,uuid,integer,numeric,jsonb,numeric,numeric)','EXECUTE') as authenticated,
    has_function_privilege('service_role','public.commit_poker_test_hand_atomic(uuid,text,uuid,jsonb,uuid,integer,numeric,jsonb,numeric,numeric)','EXECUTE') as service,
    has_table_privilege('authenticated','poker_test_hands','SELECT') as private_hands,
    has_table_privilege('anon','poker_test_actions','SELECT') as private_receipts`);
  assert.deepEqual(rights.rows[0], { anon: false, authenticated: false, service: true, private_hands: false, private_receipts: false });
  assert((await f.db.query("select relrowsecurity from pg_class where relname in ('poker_test_hands','poker_test_actions')")).rows.every(row => row.relrowsecurity));
  await f.db.close();
});
sqlTest('Repeated and parallel deal requests create one hand, debit once and replay exact response', async () => {
  const f = await fixture(), key = requestId(), transition = engine.startGame('holdem', 500, 100000);
  const first = await f.commit({ key, transition });
  assert.equal(Number(first.balance), 995); assert.equal(await f.ledger(), 1);
  await f.db.query('update wallets set balance=994 where user_id=$1', [user]);
  const repeats = await Promise.all(Array.from({ length: 12 }, () => f.commit({ key, balance: 1000, transition: engine.startGame('holdem', 500, 100000) })));
  assert(repeats.every(row => row.hand_id === first.hand_id && Number(row.balance) === 995));
  assert.deepEqual(repeats[0].private_state, first.private_state); assert.equal(await f.wallet(), 994); assert.equal(await f.ledger(), 1);
  assert.equal((await f.db.query('select count(*)::int as count from poker_test_hands')).rows[0].count, 1);
  const otherOwner = await f.commit({ owner: other, key, transition: engine.startGame('holdem', 500, 100000) });
  assert.notEqual(otherOwner.hand_id, first.hand_id); assert.equal(await f.wallet(other), 995);
  await assert.rejects(f.commit({ key, balance: 994, transition: engine.startGame('holdem', 1000, 99400) }), /REQUEST_CONFLICT/);
  await assert.rejects(f.commit({ balance: 994, transition: engine.startGame('holdem', 500, 99400) }), /ACTIVE_HAND_EXISTS/);
  await f.db.close();
});
sqlTest('Poker actions enforce owner, hand version and current wallet before any debit or settlement', async () => {
  const f = await fixture(), initial = engine.startGame('holdem', 500, 100000);
  const first = await f.commit({ transition: initial });
  const action = engine.actGame(initial.state, 'fold', 0, [], 99500);
  const payload = { game: 'holdem', action: 'fold', hand_id: first.hand_id, action_count: 0, amount: 0, discards: [] };
  await assert.rejects(f.commit({ owner: other, hand: first.hand_id, count: 0, transition: action, payload }), /HAND_NOT_FOUND/);
  await assert.rejects(f.commit({ hand: first.hand_id, count: 1, balance: 995, transition: action, payload }), /HAND_CHANGED/);
  await f.db.query('update wallets set balance=994 where user_id=$1', [user]);
  await assert.rejects(f.commit({ hand: first.hand_id, count: 0, balance: 995, transition: action, payload }), /WALLET_CHANGED/);
  assert.equal(await f.ledger(), 1);
  assert.equal((await f.db.query('select status,action_count from poker_test_hands where id=$1', [first.hand_id])).rows[0].status, 'active');
  const key = requestId();
  const settled = await f.commit({ key, hand: first.hand_id, count: 0, balance: 994, transition: action, payload });
  assert.equal(settled.private_state.status, 'settled'); assert.equal(Number(settled.balance), 994);
  const replay = await f.commit({ key, hand: first.hand_id, count: 0, balance: 994, transition: action, payload });
  assert.deepEqual(replay, settled);
  await assert.rejects(f.commit({ hand: first.hand_id, count: 0, balance: 994, transition: action, payload }), /HAND_CHANGED/);
  await f.db.close();
});
sqlTest('Poker RPC rejects overdraw, forged commitment or payout and rolls the entire transaction back', async () => {
  const f = await fixture(), transition = engine.startGame('holdem', 500, 100000);
  await f.db.query('update wallets set balance=1 where user_id=$1', [user]);
  await assert.rejects(f.commit({ balance: 1, transition }), /INSUFFICIENT_BALANCE/);
  await f.db.query('update wallets set balance=1000 where user_id=$1', [user]);
  const forged = clone(transition); forged.state.potCents++;
  await assert.rejects(f.commit({ transition: forged }), /INVALID_STATE/);
  const paid = clone(transition); paid.payoutCents = 100; paid.state.payoutCents = 100;
  await assert.rejects(f.commit({ transition: paid }), /INVALID_STATE/);
  await f.db.exec("alter table wallet_transactions add constraint force_ledger_failure check (note <> 'GameDay test poker wager debit')");
  await assert.rejects(f.commit({ transition }), /force_ledger_failure/);
  assert.equal(await f.wallet(), 1000); assert.equal(await f.ledger(), 0);
  assert.equal((await f.db.query('select count(*)::int as count from poker_test_hands')).rows[0].count, 0);
  assert.equal((await f.db.query('select count(*)::int as count from poker_test_actions')).rows[0].count, 0);
  await f.db.close();
});
sqlTest('All four engines persist through completion with one settlement and full-bankroll initial runouts', async () => {
  const f = await fixture();
  for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
    await f.db.query('update wallets set balance=1000 where user_id=$1', [user]);
    let transition = engine.startGame(game, 500, 100000), row = await f.commit({ game, transition });
    let balance = Number(row.balance), steps = 0;
    while (transition.state.status === 'active' && steps++ < 30) {
      const wire = engine.publicHand(transition.state, Math.round(balance * 100));
      const action = wire.legal_actions.includes('bring-in') ? 'bring-in' : wire.legal_actions.includes('draw') ? 'draw' : wire.legal_actions.includes('call') ? 'call' : 'check';
      const payload = { game, action, hand_id: row.hand_id, action_count: transition.state.action_count, amount: 0, discards: [] };
      const next = engine.actGame(transition.state, action, 0, [], Math.round(balance * 100));
      row = await f.commit({ game, hand: row.hand_id, count: transition.state.action_count, balance, payload, transition: next });
      transition = next; balance = Number(row.balance);
    }
    assert.equal(transition.state.status, 'settled', game);
    const sums = (await f.db.query('select coalesce(sum(amount) filter(where transaction_type=\'wager_debit\'),0) as debits, coalesce(sum(amount) filter(where transaction_type=\'wager_credit\'),0) as credits from wallet_transactions')).rows[0];
    assert(Number(sums.debits) > 0);
    assert.equal(await f.wallet(), 1000 - transition.state.committedCents / 100 + transition.state.payoutCents / 100);
    await f.db.query('delete from wallet_transactions');
  }
  for (const game of ['holdem', 'omaha', 'stud']) {
    await f.db.query('update wallets set balance=5 where user_id=$1', [user]);
    const transition = engine.startGame(game, 500, 500);
    assert.equal(transition.state.status, 'settled');
    const row = await f.commit({ game, balance: 5, transition });
    assert.equal(Number(row.balance), transition.payoutCents / 100);
    const dbHand = (await f.db.query('select settled_at from poker_test_hands where id=$1', [row.hand_id])).rows[0];
    assert(dbHand.settled_at);
  }
  await f.db.close();
});
