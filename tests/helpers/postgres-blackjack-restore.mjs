import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Real restored RPCs, deterministic server-computed cards, synthetic users only.
// This verifies persistence/locking/accounting; game rules have separate Edge tests.
export async function verifyRestoredBlackjack(client) {
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const cards = (...ranks) => ranks.map(rank => ({ rank, suit: 'clubs' }));
  const rpc = async (name, args) => (await client.query(`select * from public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args)).rows[0];
  const start = (request, player, dealer, total) => rpc('start_blackjack_test_hand_insured', [owner, request, 10, JSON.stringify(player), JSON.stringify(dealer), '[]', total, 17, 'active', 0]);
  const advance = (hand, count, status, stake, player, hands, total, payout, extra = 0, user = owner) => rpc('advance_blackjack_test_hand_v3', [user, hand, count, status, stake, JSON.stringify(player), hands === null ? null : JSON.stringify(hands), hands === null ? null : 0, JSON.stringify(cards('9', '8')), '[]', total, 17, payout, extra]);
  const rejected = async (operation, message) => {
    await client.query('savepoint expected_rejection');
    try { await operation(); assert.fail('Expected restored RPC rejection'); }
    catch (error) { assert.match(error.message, message); }
    finally { await client.query('rollback to savepoint expected_rejection'); }
  };
  await client.query('begin');
  try {
    await client.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, 'blackjack-restore@example.invalid', other, 'blackjack-other@example.invalid']);
    const base = Number((await client.query('select balance from public.wallets where user_id=$1', [owner])).rows[0].balance);
    const initialEffect = Number((await client.query("select coalesce(sum(case when transaction_type='wager_debit' then -amount else amount end),0) effect from public.wallet_transactions where user_id=$1", [owner])).rows[0].effect);
    await client.query('set local role service_role');
    const request = crypto.randomUUID(), initial = cards('7', '6'), dealer = cards('9', '8');
    const first = await start(request, initial, dealer, 13);
    assert.equal(Number(first.balance), base - 10);
    const repeat = await start(request, initial, dealer, 13);
    assert.equal(repeat.hand_id, first.hand_id); assert.equal(repeat.replayed, true); assert.equal(Number(repeat.balance), base - 10);
    const hit = await advance(first.hand_id, 0, 'active', 10, cards('7', '6', '4'), null, 17, 0);
    assert.equal(hit.action_count, 1); assert.equal(Number(hit.balance), base - 10);
    await rejected(() => advance(first.hand_id, 0, 'active', 10, cards('7', '6', '4'), null, 17, 0), /changed/);
    await rejected(() => advance(first.hand_id, 1, 'push', 10, cards('7', '6', '4'), null, 17, 10, 0, other), /not found/);
    const stand = await advance(first.hand_id, 1, 'push', 10, cards('7', '6', '4'), null, 17, 10);
    assert.equal(stand.hand_status, 'push'); assert.equal(Number(stand.balance), base);
    await rejected(() => advance(first.hand_id, 2, 'push', 10, cards('7', '6', '4'), null, 17, 10), /already settled/);
    const splitDeal = await start(crypto.randomUUID(), cards('8', '8'), dealer, 16);
    const splitHands = [{ cards: cards('8', '3'), stake: 10, total: 11, status: 'active' }, { cards: cards('8', '10'), stake: 10, total: 18, status: 'active' }];
    const split = await advance(splitDeal.hand_id, 0, 'active', 20, splitHands[0].cards, splitHands, 11, 0, 10);
    assert.equal(Number(split.balance), base - 20);
    const doubleHands = [{ cards: cards('8', '3', '6'), stake: 20, total: 17, status: 'stood' }, splitHands[1]];
    const doubled = await advance(splitDeal.hand_id, 1, 'active', 30, doubleHands[0].cards, doubleHands, 17, 0, 10);
    assert.equal(Number(doubled.balance), base - 30);
    const finalHands = [{ ...doubleHands[0], status: 'push' }, { ...doubleHands[1], status: 'won' }];
    const finished = await advance(splitDeal.hand_id, 2, 'won', 30, finalHands[0].cards, finalHands, 17, 40);
    assert.equal(Number(finished.balance), base + 10); assert.equal(finished.action_count, 3);
    const saved = (await client.query('select player_hands,active_hand_index,settled_at from public.blackjack_hands where id=$1', [splitDeal.hand_id])).rows[0];
    assert.deepEqual(saved.player_hands, finalHands); assert.equal(saved.active_hand_index, 0); assert(saved.settled_at);
    const ledger = (await client.query("select sum(case when transaction_type='wager_debit' then -amount else amount end)::numeric as effect from public.wallet_transactions where user_id=$1", [owner])).rows[0];
    const balance = Number((await client.query('select balance from public.wallets where user_id=$1', [owner])).rows[0].balance);
    assert.equal(balance, base + Number(ledger.effect) - initialEffect);
    return { passed: true, dealReplay: true, hitStand: true, splitDouble: true, staleActionRejected: true, otherOwnerRejected: true, walletLedgerReconciled: true };
  } finally { await client.query('rollback'); }
}
