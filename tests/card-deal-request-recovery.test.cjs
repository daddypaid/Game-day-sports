const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require(process.env.GAMEDAY_PGLITE_MODULE || '@electric-sql/pglite')); } catch (_) {}
const root = path.resolve(__dirname, '..');
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const card = rank => ({ rank: String(rank), suit: '♠' });
const cards = (...ranks) => ranks.map(card);
const sqlTest = (name, callback) => test(name, { skip: PGlite ? false : 'Set GAMEDAY_PGLITE_MODULE to run isolated PostgreSQL tests.' }, callback);
async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/card-deal-baseline.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261010104826_card_deal_request_recovery.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261010120032_blackjack_insurance_decision.sql'), 'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)', [user, other]);
  await db.query('insert into wallets(user_id,balance) values($1,1000),($2,1000)', [user, other]);
  const start = (p = {}) => db.query('select * from start_blackjack_test_hand_idempotent($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,16,9,$7::blackjack_hand_status,$8)',
    [p.user || user,p.id || requestId,p.stake || 5,JSON.stringify(p.cards || cards(10,6)),JSON.stringify(cards(7,2)),JSON.stringify(cards(8)),p.status || 'active',p.payout || 0]);
  const baccarat = (p = {}) => db.query('select * from place_baccarat_test_round_idempotent($1,$2,$3,$4,$5::jsonb,$6::jsonb,9,8,\'player\',$7)',
    [p.user || user,p.id || requestId,p.stake || 5,p.side || 'player',JSON.stringify(p.cards || cards(9,10)),JSON.stringify(cards(8,10)),p.payout ?? 10]);
  const wallet = async (id = user) => Number((await db.query('select balance from wallets where user_id=$1',[id])).rows[0].balance);
  const debits = async () => (await db.query("select count(*)::int as count from wallet_transactions where transaction_type='wager_debit'")).rows[0].count;
  return { db, start, baccarat, wallet, debits };
}

sqlTest('Deal receipts have RLS and neither receipts nor privileged wrappers are exposed to browsers', async () => {
  const f = await fixture();
  for (const signature of ['start_blackjack_test_hand_idempotent(uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,blackjack_hand_status,numeric)','place_baccarat_test_round_idempotent(uuid,uuid,numeric,text,jsonb,jsonb,integer,integer,text,numeric)']) {
    const row = (await f.db.query("select has_function_privilege('anon',$1,'EXECUTE') as anon,has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,has_function_privilege('service_role',$1,'EXECUTE') as service",[signature])).rows[0];
    assert.deepEqual(row,{anon:false,authenticated:false,service:true});
  }
  assert.equal((await f.db.query("select has_table_privilege('authenticated','card_game_deal_requests','SELECT') as allowed")).rows[0].allowed,false);
  assert.equal((await f.db.query("select relrowsecurity from pg_class where relname='card_game_deal_requests'")).rows[0].relrowsecurity,true);
  await f.db.close();
});

sqlTest('Blackjack same-ID retries return one saved hand and one debit even after settlement or another hand', async () => {
  const f = await fixture();
  const first = (await f.start()).rows[0];
  const retries = await Promise.all(Array.from({length:8},() => f.start({cards:cards('A','K')})));
  assert(retries.every(result => result.rows[0].hand_id === first.hand_id && result.rows[0].replayed));
  assert.equal(await f.debits(),1); assert.equal(await f.wallet(),995);
  assert.deepEqual((await f.db.query('select player_cards from blackjack_hands where id=$1',[first.hand_id])).rows[0].player_cards,cards(10,6));
  await f.db.query("update blackjack_hands set status='lost',settled_at=now() where id=$1",[first.hand_id]);
  const next = (await f.start({id:'44444444-4444-4444-8444-444444444444'})).rows[0];
  assert.notEqual(next.hand_id,first.hand_id);
  assert.equal((await f.start()).rows[0].hand_id,first.hand_id);
  assert.equal(await f.debits(),2); assert.equal(await f.wallet(),990);
  await assert.rejects(f.start({stake:10}),/conflicts with its original wager/);
  const foreign = (await f.start({user:other})).rows[0]; assert.notEqual(foreign.hand_id,first.hand_id);
  assert.equal(await f.wallet(other),995); await f.db.close();
});

sqlTest('Baccarat replay retains exact settled cards, rejects changed payload, and returns current wallet without a second payout', async () => {
  const f = await fixture(); const first = (await f.baccarat()).rows[0];
  await f.db.query('update wallets set balance=999 where user_id=$1',[user]);
  const retries = await Promise.all(Array.from({length:8},() => f.baccarat({cards:cards(2,3),payout:0})));
  assert(retries.every(result => result.rows[0].round_id === first.round_id && result.rows[0].replayed && Number(result.rows[0].balance)===999));
  assert.equal(await f.debits(),1); assert.equal(await f.wallet(),999);
  assert.deepEqual((await f.db.query('select player_cards,payout from baccarat_rounds')).rows[0],{player_cards:cards(9,10),payout:'10'});
  await assert.rejects(f.baccarat({side:'banker'}),/conflicts with its original wager/);
  await assert.rejects(f.baccarat({stake:10}),/conflicts with its original wager/);
  assert.notEqual((await f.baccarat({user:other})).rows[0].round_id,first.round_id);
  await f.db.close();
});

sqlTest('Receipt failure rolls back hand, debit and payout; a never-accepted original intent can safely retry', async () => {
  const f = await fixture();
  await f.db.exec("alter table card_game_deal_requests add constraint reject_receipt check (stake<>5)");
  for(const play of [f.start,f.baccarat]) await assert.rejects(play(),/reject_receipt/);
  assert.equal(await f.wallet(),1000); assert.equal(await f.debits(),0);
  assert.equal((await f.db.query('select count(*)::int as count from blackjack_hands')).rows[0].count,0);
  assert.equal((await f.db.query('select count(*)::int as count from baccarat_rounds')).rows[0].count,0);
  await f.db.exec('alter table card_game_deal_requests drop constraint reject_receipt');
  await f.start(); await f.baccarat(); assert.equal(await f.debits(),2);
  assert.equal((await f.db.query('select count(*)::int as count from card_game_deal_requests')).rows[0].count,2);
  await f.db.close();
});

sqlTest('Definitive insufficient-balance rejection is durable and cannot accept a delayed copy after refill', async () => {
  const f = await fixture(); await f.db.query('update wallets set balance=0 where user_id=$1',[user]);
  for(const play of [f.start,f.baccarat]) {
    const rejected = (await play()).rows[0]; assert.equal(rejected.error,'Insufficient test balance');
    assert.equal(Object.hasOwn(rejected,'hand_id') ? rejected.hand_id : rejected.round_id,null); assert.equal(rejected.replayed,false);
  }
  await f.db.query('update wallets set balance=1000 where user_id=$1',[user]);
  for(const play of [f.start,f.baccarat]) {
    const retry = (await play()).rows[0]; assert.equal(retry.error,'Insufficient test balance'); assert.equal(retry.replayed,true);
    assert.equal(await f.wallet(),1000); assert.equal(await f.debits(),0);
    await assert.rejects(play({stake:10}),/conflicts/);
  }
  for(const play of [f.start,f.baccarat]) await play({id:'44444444-4444-4444-8444-444444444444'});
  assert.equal(await f.debits(),2); await f.db.close();
});

sqlTest('Actual Edge handlers replay owner-scoped saved state, hide the active dealer and retain final results', async () => {
  const f = await fixture();
  async function service(game) {
    let handler, owner = user;
    const admin = {
      from(table) {
        const filters = []; let ordered = false, limited = false;
        const query = {select(){return query},eq(k,v){filters.push([k,v]);return query},order(){ordered=true;return query},limit(){limited=true;return query},
          async single(){return query.maybeSingle()},async maybeSingle(){
            const result = await f.db.query(`select * from ${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}${ordered?' order by created_at desc':''}${limited?' limit 1':''}`,filters.map(([,v])=>v));
            return {data:result.rows[0] || null,error:null};
          }};return query;
      },async rpc(name,p){
        try { const result = await f.db.query(`select * from ${name}(${Object.keys(p).map((key,i)=>`${key}=>$${i+1}`).join(',')})`,Object.values(p).map(v=>Array.isArray(v)?JSON.stringify(v):v));return {data:result.rows,error:null}; }
        catch(error){return {data:null,error:{message:error.message}};}
      }
    };
    const context = vm.createContext({Response,Request,Uint32Array,crypto:webcrypto,console,Error,
      Deno:{env:{get:key=>key},serve:fn=>handler=fn},
      createClient(_url,_key,options){return options?{auth:{getUser:async()=>({data:{user:owner?{id:owner}:null}})}}:admin}});
    const source = fs.readFileSync(path.join(root,`supabase/functions/${game}-test/index.ts`),'utf8').replace(/^import .*;\n/gm,'');
    vm.runInContext(stripTypeScriptTypes(source),context);
    if(game==='blackjack') context.shuffle=()=>[card(8),card(2),card(7),card(6),card(10)];
    const send = async extra => { const response = await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({...(game==='blackjack'?{action:'start'}:{bet_type:'player'}),stake:5,request_id:requestId,...extra})}));return {status:response.status,...await response.json()}; };
    return {send,setOwner:id=>owner=id};
  }
  const blackjack = await service('blackjack'); const first = await blackjack.send({});
  assert.equal(first.status,200); assert.equal(first.request_id,requestId); assert.equal(first.hand.dealer_cards[1].rank,'?');
  assert.equal((await blackjack.send({})).hand.id,first.hand.id); assert.equal(await f.debits(),1);
  await f.db.query("update blackjack_hands set status='lost',action_count=1,settled_at=now() where id=$1",[first.hand.id]);
  const settled = await blackjack.send({}); assert.equal(settled.hand.status,'lost'); assert.equal(settled.hand.dealer_cards[1].rank,'2'); assert.equal(await f.debits(),1);
  blackjack.setOwner(other); assert.notEqual((await blackjack.send({})).hand.id,first.hand.id);
  blackjack.setOwner(null); assert.equal((await blackjack.send({})).status,401);
  const baccarat = await service('baccarat'); const round = await baccarat.send({}); assert.equal(round.status,200);
  const replay = await baccarat.send({}); assert.deepEqual(replay.round,round.round); assert.equal(replay.request_id,requestId);
  assert.match((await baccarat.send({bet_type:'banker'})).error,/conflicts/);
  const before = await f.debits(); assert.equal((await baccarat.send({request_id:'bad'})).status,400); assert.equal(await f.debits(),before);
  await f.db.close();
});
