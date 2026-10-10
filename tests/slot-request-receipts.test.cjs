const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, randomUUID } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require(process.env.GAMEDAY_PGLITE_MODULE || '@electric-sql/pglite')); } catch (_) {}
const root = path.resolve(__dirname, '..');
const migration = path.join(root, 'supabase/migrations/20261010104859_slot_request_receipts.sql');
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const games = ['midnight-monsters', 'galactic-rebellion', 'lucky-7s'];
const clone = value => JSON.parse(JSON.stringify(value));
const sqlTest = (name, fn) => test(name, { skip: PGlite ? false : 'Set GAMEDAY_PGLITE_MODULE to run isolated PostgreSQL receipt tests.' }, fn);
async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${user}'),('${other}');
    create table wallets(user_id uuid primary key references auth.users(id),balance numeric(14,2) check(balance>=0),updated_at timestamptz default now());
    insert into wallets(user_id,balance) values('${user}',1000),('${other}',1000);
    create table wallet_transactions(id uuid primary key default gen_random_uuid(),user_id uuid,transaction_type text,amount numeric,balance_after numeric,note text);
    create table slot_spins(id uuid primary key default gen_random_uuid(),user_id uuid,stake numeric,reels jsonb,payout numeric,result text,is_test boolean);
    create table themed_slot_bonus_sessions(id uuid primary key default gen_random_uuid(),user_id uuid,game text,bet_per_line numeric,spins_remaining int,total_spins int,total_payout numeric,status text,updated_at timestamptz default now());
    create unique index active_bonus on themed_slot_bonus_sessions(user_id,game) where status='active';
    create table themed_slot_bonus_spins(id uuid primary key default gen_random_uuid(),session_id uuid,user_id uuid,game text,grid jsonb,payout numeric,feature text);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/slot-settlement-rpcs.sql'), 'utf8'));
  await db.exec('begin;\n' + fs.readFileSync(migration, 'utf8') + '\ncommit;');
  const counts = async () => (await db.query(`select
    (select count(*)::int from slot_spins) spins,
    (select count(*)::int from themed_slot_bonus_spins) bonus_spins,
    (select count(*)::int from wallet_transactions) ledger,
    (select count(*)::int from slot_request_receipts) receipts`)).rows[0];
  const wallet = async owner => Number((await db.query('select balance from wallets where user_id=$1', [owner || user])).rows[0].balance);
  const commit = async ({ owner=user, id=randomUUID(), game='lucky-7s', action='spin', payout=4, stake=1, bonus=0, session=null, payload=null, grid=null }={}) => {
    const spin = { game, grid: grid || Array.from({length:game==='lucky-7s'?3:5},()=>['WILD','RED7','SCATTER']),
      stake:action==='bonus_spin'?0:stake,payout,result:payout>0?'won':'lost',bet_per_line:0.1,
      total_bet:stake,free_spin:action==='bonus_spin',bonus_triggered:bonus>0,bonus_total_spins:bonus,
      bonus_session_id:session,feature_name:'TEST FEATURE',feature_multiplier:2,feature_cells:[0],win_cells:[0,1],active_lines:[0] };
    const normalized = payload || { game,action,...(action==='bonus_spin'?{session_id:session}:{total_bet:stake}) };
    const r = await db.query('select public.settle_slot_request_atomic($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::jsonb) value',
      [owner,id,game,action,JSON.stringify(normalized),JSON.stringify({ok:true,spin}),JSON.stringify({reels:spin.grid.flat(),bonus_spins:bonus,session_id:session})]);
    return r.rows[0].value;
  };
  return { db,counts,wallet,commit };
}
function handler(file, db, options={}) {
  const state = { owner:user, authenticated:true, ...options };
  let serve; const calls=[];
  const context = vm.createContext({ console, Response, Request, Error, Uint32Array, JSON,Number,Math,Set,crypto:webcrypto,
    Deno:{env:{get:name=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[name]},serve:fn=>{serve=fn;}},
    createClient(_url,key) {
      if(key==='anon') return {auth:{getUser:async()=>({data:{user:state.authenticated?{id:state.owner}:null},error:null})}};
      return {
        from(table) {
          const filters=[]; const builder={select(){return builder;},eq(c,v){filters.push([c,v]);return builder;},
            async single(){return read(false);},async maybeSingle(){return read(true);}};
          async function read(optional) {
            const r = await db.query(`select * from ${table} where ${filters.map(([c],i)=>`${c}=$${i+1}`).join(' and ')}`,filters.map(([,v])=>v));
            return {data:r.rows[0]||null,error:!optional&&!r.rows.length?new Error('Missing session'):null};
          }
          return builder;
        },
        async rpc(name,args) {
          calls.push({name,args:clone(args)});
          try {
            let result;
            if(name==='get_slot_request_receipt') result=await db.query('select public.get_slot_request_receipt($1::uuid,$2::uuid,$3::text,$4::jsonb) value',[args.p_user_id,args.p_request_id,args.p_game,args.p_payload===null?null:JSON.stringify(args.p_payload)]);
            else if(name==='settle_slot_request_atomic') result=await db.query('select public.settle_slot_request_atomic($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::jsonb) value',[args.p_user_id,args.p_request_id,args.p_game,args.p_action,JSON.stringify(args.p_payload),JSON.stringify(args.p_response),JSON.stringify(args.p_settlement)]);
            else if(name==='get_slot_request_history') {
              result=await db.query('select * from public.get_slot_request_history($1::uuid,$2::int,$3::timestamptz,$4::uuid)',[args.p_user_id,args.p_limit,args.p_before_created_at,args.p_before_id]);
              return {data:result.rows,error:null};
            } else throw new Error('Unexpected RPC '+name);
            return {data:result.rows[0].value,error:null};
          } catch(e) { return {data:null,error:{message:e.message}}; }
        }
      };
    }
  });
  const source=fs.readFileSync(path.join(root,'supabase/functions',file,'index.ts'),'utf8').replace(/^import .*\n/gm,'');
  vm.runInContext(stripTypeScriptTypes(source),context);
  return { state,calls,async request(body,method='POST') {
    const response=await serve(new Request('https://fixture.invalid',{method,headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
    return {status:response.status,body:await response.json()};
  }};
}

sqlTest('Receipt migration restricts all tables/RPCs to service role and enables RLS',async()=>{
  const f=await fixture();
  const rights=(await f.db.query(`select
    has_table_privilege('anon','slot_request_receipts','SELECT') anon_read,
    has_table_privilege('authenticated','slot_request_receipts','SELECT') customer_read,
    has_table_privilege('authenticated','slot_request_receipts','INSERT') customer_write,
    has_table_privilege('service_role','slot_request_receipts','SELECT') service_read,
    has_function_privilege('authenticated','public.settle_slot_request_atomic(uuid,uuid,text,text,jsonb,jsonb,jsonb)','EXECUTE') customer_settle,
    has_function_privilege('service_role','public.settle_slot_request_atomic(uuid,uuid,text,text,jsonb,jsonb,jsonb)','EXECUTE') service_settle,
    (select relrowsecurity from pg_class where relname='slot_request_receipts') rls`)).rows[0];
  assert.deepEqual(rights,{anon_read:false,customer_read:false,customer_write:false,service_read:true,customer_settle:false,service_settle:true,rls:true});
  for(const name of ['get_slot_request_receipt(uuid,uuid,text,jsonb)','get_slot_request_history(uuid,integer,timestamptz,uuid)']) {
    assert.deepEqual((await f.db.query("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') customer",['public.'+name])).rows[0],{anon:false,customer:false});
  }
  await f.db.close();
});
sqlTest('Repeated/parallel paid spins replay exact committed grids/features and debit once for all games',async()=>{
  const f=await fixture();
  for(const game of games) {
    const id=randomUUID(),first=await f.commit({id,game});
    const repeats=await Promise.all(Array.from({length:12},(_,i)=>f.commit({id,game,payout:99,grid:Array.from({length:game==='lucky-7s'?3:5},()=>['changed'+i,'changed','changed'])})));
    repeats.forEach(replay=>assert.deepEqual(replay,first));
    assert.equal(first.spin.is_free_spin,false); assert.equal(first.spin.spin_type,'paid');
    await assert.rejects(f.commit({id,game,stake:2}),/REQUEST_CONFLICT/);
  }
  assert.deepEqual(await f.counts(),{spins:3,bonus_spins:0,ledger:6,receipts:3});
  assert.equal(await f.wallet(),1009);
  await f.db.close();
});
sqlTest('Parallel paid bonus-trigger requests cannot create two bonuses or debit a rejected second request',async()=>{
  const f=await fixture();
  const r=await Promise.allSettled([f.commit({game:'midnight-monsters',bonus:10}),f.commit({game:'midnight-monsters',bonus:10})]);
  assert.equal(r.filter(v=>v.status==='fulfilled').length,1);
  assert.match(r.find(v=>v.status==='rejected').reason.message,/Finish active free spins first/);
  assert.deepEqual(await f.counts(),{spins:1,bonus_spins:0,ledger:2,receipts:1});
  await f.db.close();
});
sqlTest('Atomic receipt write failure rolls back wallet, ledger, outcome and bonus together',async()=>{
  const f=await fixture();
  await f.db.exec("alter table slot_request_receipts add constraint reject_receipt check(game <> 'midnight-monsters')");
  await assert.rejects(f.commit({game:'midnight-monsters',bonus:10}),/reject_receipt/);
  assert.equal(await f.wallet(),1000);
  assert.deepEqual(await f.counts(),{spins:0,bonus_spins:0,ledger:0,receipts:0});
  assert.equal((await f.db.query('select count(*)::int n from themed_slot_bonus_sessions')).rows[0].n,0);
  await f.db.close();
});
sqlTest('Owner-scoped requests/receipts hide other owners and allow same UUID separately',async()=>{
  const f=await fixture(),id=randomUUID();
  const first=await f.commit({id});
  assert.equal((await f.db.query('select public.get_slot_request_receipt($1::uuid,$2::uuid,$3::text) value',[other,id,'lucky-7s'])).rows[0].value,null);
  const second=await f.commit({id,owner:other}); assert.notEqual(first.spin.id,second.spin.id);
  assert.equal(await f.wallet(),1003);assert.equal(await f.wallet(other),1003);
  await assert.rejects(f.db.query('select public.get_slot_request_receipt($1::uuid,$2::uuid,$3::text) value',[user,id,'midnight-monsters']),/REQUEST_CONFLICT/);
  await f.db.close();
});
sqlTest('Current Edge handlers recover dropped paid responses, reject changed payload, and deny unauthenticated receipt reads',async()=>{
  const f=await fixture();
  for(const game of games) {
    const h=handler(game==='lucky-7s'?'slots-test':'themed-slots-test',f.db);
    const request={game,request_id:randomUUID(),...(game==='lucky-7s'?{math_version:'five-lines-v1',total_bet:1}:game==='galactic-rebellion'?{total_bet:1}:{bet_per_line:0.1})};
    const accepted=await h.request(request); assert.equal(accepted.status,200);
    const recovered=await h.request({game,action:'receipt',request_id:request.request_id});
    assert.deepEqual(recovered.body,{...accepted.body,found:true});
    const before=await f.counts();
    assert.deepEqual((await h.request(request)).body,accepted.body);assert.deepEqual(await f.counts(),before);
    const changed=await h.request({...request,...(game==='midnight-monsters'?{bet_per_line:0.2}:{total_bet:2})});
    assert.equal(changed.status,409);assert.equal(changed.body.code,'REQUEST_CONFLICT');assert.deepEqual(await f.counts(),before);
    h.state.owner=other;
    assert.deepEqual((await h.request({game,action:'receipt',request_id:request.request_id})).body,{ok:true,found:false});
    h.state.authenticated=false;
    assert.equal((await h.request({game,action:'receipt',request_id:request.request_id})).status,401);
  }
  await f.db.close();
});
sqlTest('Final bonus spin survives dropped response, completed session, parallel retries and status bonus=null',async()=>{
  const f=await fixture();
  for(const game of games.slice(0,2)) {
    const session=randomUUID(),id=randomUUID();
    await f.db.query("insert into themed_slot_bonus_sessions(id,user_id,game,bet_per_line,spins_remaining,total_spins,total_payout,status) values($1,$2,$3,$4,1,6,7,'active')",[session,user,game,game==='galactic-rebellion'?1/243:0.1]);
    const h=handler('themed-slots-test',f.db),request={game,action:'bonus_spin',session_id:session,request_id:id};
    const concurrent=await Promise.all(Array.from({length:12},()=>h.request(request)));
    const first=concurrent[0];assert.equal(first.status,200);assert.equal(first.body.spin.bonus_complete,true);
    concurrent.forEach(replay=>assert.deepEqual(replay.body,first.body));
    const replays=await Promise.all(Array.from({length:12},()=>h.request(request)));
    replays.forEach(replay=>assert.deepEqual(replay.body,first.body));
    assert.equal((await h.request({game,action:'status'})).body.bonus,null);
    assert.deepEqual((await h.request({game,action:'receipt',request_id:id})).body,{...first.body,found:true});
    assert.equal(first.body.spin.spin_type,'bonus');assert.equal(first.body.spin.is_free_spin,true);
    assert.equal(first.body.spin.stake,0);assert.equal(first.body.spin.bonus_spins_remaining,0);
  }
  assert.equal((await f.counts()).bonus_spins,2);assert.equal((await f.counts()).receipts,2);
  await f.db.close();
});
sqlTest('Unified customer history paginates equal timestamps without duplicates and excludes other owners',async()=>{
  const f=await fixture();
  for(let i=0;i<9;i++) await f.commit({game:games[i%3]});
  await f.commit({owner:other});
  await f.db.exec("update slot_request_receipts set created_at='2026-10-10T10:00:00Z'");
  const h=handler('themed-slots-test',f.db),ids=[];let before=null;
  do {
    const result=await h.request({action:'history',limit:3,...(before?{before}:{})});assert.equal(result.status,200);
    result.body.receipts.forEach(r=>{assert(r.spin.grid);assert.equal(r.spin.is_free_spin,false);ids.push(r.id);});
    before=result.body.next_cursor;
  } while(before);
  assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);
  h.state.owner=other;assert.equal((await h.request({action:'history',limit:50})).body.receipts.length,1);
  for(const body of [{action:'history',limit:0},{action:'history',limit:51},{action:'history',before:{created_at:'bad',id:randomUUID()}}]) assert.equal((await h.request(body)).status,400);
  await f.db.close();
});
