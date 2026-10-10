const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {webcrypto} = require('node:crypto');
let PGlite; try { ({PGlite} = require(process.env.GAMEDAY_PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const root = path.resolve(__dirname,'..');
const user = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
let counter = 10;
const uuid = () => '00000000-0000-4000-8000-' + String(counter++).padStart(12,'0');
const clone = x => JSON.parse(JSON.stringify(x));
const selection = (event = 'event-a', extra = {}) => ({event_id:event,event_name:'Away at Home',sport_key:'americanfootball_nfl',
  market_key:'h2h',market_title:null,selection_name:'Home',description:null,point:null,american_odds:100,quoted_at:'2026-10-10T10:00:00Z',...extra});
const payload = (selections = [selection()], stake = 10, type = 'single') => ({wager_type:type,stake,
  selections:selections.map(({quoted_at,...s}) => s)});
async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/sportsbook-placement-baseline.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261010110728_sportsbook_durable_requests_and_safe_parlays.sql'),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[user,other]);
  await db.query('insert into wallets(user_id,balance) values($1,1000),($2,1000)',[user,other]);
  const rpc = async (name,args) => (await db.query(`select public.${name}(${args.map((_,i) => '$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
  const prepare = (id,token,data = payload(),owner = user) => rpc('sportsbook_test_request_prepare',[owner,id,JSON.stringify(data),token]);
  const commit = (id,token,selections = [selection()],owner = user) => rpc('sportsbook_test_request_commit',[owner,id,token,JSON.stringify(selections)]);
  const receipt = (id,owner = user) => rpc('sportsbook_test_request_receipt',[owner,id]);
  const reject = (id,token) => rpc('sportsbook_test_request_reject',[user,id,token,'LINE_CHANGED','The line changed. No credits were charged.']);
  const balance = async (owner = user) => Number((await db.query('select balance from wallets where user_id=$1',[owner])).rows[0].balance);
  const debits = async () => (await db.query('select count(*)::int as count from wallet_transactions')).rows[0].count;
  return {db,rpc,prepare,commit,receipt,reject,balance,debits};
}
const sqlTest = (name,fn) => test(name,{skip:PGlite ? false : 'Set GAMEDAY_PGLITE_MODULE for PostgreSQL verification.'},fn);
sqlTest('Sportsbook receipt storage and all privileged RPCs are inaccessible to browser roles',async () => {
  const f = await fixture();
  for (const signature of ['sportsbook_test_request_receipt(uuid,uuid)','sportsbook_test_request_prepare(uuid,uuid,jsonb,uuid)',
    'sportsbook_test_request_reject(uuid,uuid,uuid,text,text)','sportsbook_test_request_commit(uuid,uuid,uuid,jsonb)']) {
    const rights = (await f.db.query("select has_function_privilege('anon',$1,'EXECUTE') as anon,has_function_privilege('authenticated',$1,'EXECUTE') as customer,has_function_privilege('service_role',$1,'EXECUTE') as service",[signature])).rows[0];
    assert.deepEqual(rights,{anon:false,customer:false,service:true});
  }
  assert.equal((await f.db.query("select has_function_privilege('service_role','place_test_wager_atomic(uuid,wager_type,numeric,numeric,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
  assert.equal((await f.db.query("select has_table_privilege('authenticated','sportsbook_placement_requests','SELECT') as allowed")).rows[0].allowed,false);
  assert.equal((await f.db.query("select relrowsecurity from pg_class where relname='sportsbook_placement_requests'")).rows[0].relrowsecurity,true);
  await f.db.close();
});
sqlTest('Lost response and repeated placement retain one wager/debit across timestamp changes and settlement',async () => {
  const f = await fixture(), id = uuid(), token = uuid();
  assert.equal((await f.receipt(id)).state,'not_found');
  assert.equal((await f.prepare(id,token)).processing,true);
  assert.equal((await f.prepare(id,uuid())).processing,undefined);
  const first = await f.commit(id,token);
  assert.equal(first.state,'accepted'); assert.equal(first.balance,990);
  const replay = await f.prepare(id,uuid(),payload([selection('event-a',{quoted_at:'2026-10-11T00:00:00Z'})]));
  assert.equal(replay.wager.id,first.wager.id); assert.equal(replay.replayed,true);
  const repeats = await Promise.all(Array.from({length:8},() => f.commit(id,uuid())));
  assert(repeats.every(r => r.wager.id === first.wager.id));
  await f.db.query("update wagers set status='won' where id=$1",[first.wager.id]);
  await f.db.query('update wallets set balance=1010 where user_id=$1',[user]);
  const settled = await f.receipt(id); assert.equal(settled.wager.status,'won'); assert.equal(settled.balance,1010);
  assert.equal(await f.debits(),1); await f.db.close();
});
sqlTest('The request ID cannot silently change stake, odds, mode or legs and receipts cannot cross owners',async () => {
  const f = await fixture(), id = uuid(), token = uuid(); await f.prepare(id,token);
  for (const changed of [payload([selection()],20),payload([selection('different-event')]),
    payload([selection('event-a',{american_odds:-110})]),payload([selection(),selection('event-b')],10,'parlay')]) {
    const r = await f.prepare(id,uuid(),changed); assert.equal(r.code,'REQUEST_CONFLICT');
  }
  assert.equal((await f.receipt(id,other)).state,'not_found');
  await f.commit(id,token); await f.prepare(id,uuid(),payload(),other);
  const foreignToken = (await f.db.query('select processing_token from sportsbook_placement_requests where user_id=$1',[other])).rows[0].processing_token;
  const foreign = await f.commit(id,foreignToken,[selection()],other);
  assert.notEqual(foreign.wager.id,(await f.receipt(id)).wager.id);
  assert.equal(await f.balance(other),990); await f.db.close();
});
sqlTest('Expired processor takeover fences the old process and rejected requests can never charge later',async () => {
  const f = await fixture(), id = uuid(), old = uuid(), fresh = uuid(); await f.prepare(id,old);
  await f.db.query("update sportsbook_placement_requests set lease_until=now()-interval '1 second' where request_id=$1",[id]);
  assert.equal((await f.prepare(id,fresh)).processing,true);
  assert.equal((await f.commit(id,old)).state,'pending'); assert.equal(await f.debits(),0);
  assert.equal((await f.reject(id,old)).state,'pending');
  assert.equal((await f.reject(id,fresh)).state,'rejected');
  assert.equal((await f.commit(id,fresh)).state,'rejected');
  assert.equal((await f.prepare(id,uuid())).state,'rejected');
  assert.equal(await f.balance(),1000); assert.equal(await f.debits(),0); await f.db.close();
});
sqlTest('All same-event parlay combinations are rejected without debiting, distinct-event parlays work',async () => {
  const f = await fixture();
  for (const second of [selection('event-a',{selection_name:'Away'}),selection('event-a',{market_key:'totals',selection_name:'Over',point:40}),selection()]) {
    const id = uuid(), token = uuid(), legs = [selection(),second]; await f.prepare(id,token,payload(legs,10,'parlay'));
    const r = await f.commit(id,token,legs); assert.equal(r.code,'SAME_EVENT_PARLAY');
  }
  assert.equal(await f.debits(),0); assert.equal(await f.balance(),1000);
  const id = uuid(), token = uuid(), legs = [selection(),selection('event-b')];
  await f.prepare(id,token,payload(legs,10,'parlay')); const r = await f.commit(id,token,legs);
  assert.equal(r.wager.potential_return,40); assert.equal(await f.debits(),1); await f.db.close();
});
sqlTest('Insufficient funds and changed commit payload do not mutate the wallet or produce a partial ticket',async () => {
  const f = await fixture(), id = uuid(), token = uuid(); await f.prepare(id,token);
  await assert.rejects(f.commit(id,token,[selection('event-a',{american_odds:-110})]),/Request selections changed/);
  await f.db.query('update wallets set balance=5 where user_id=$1',[user]);
  assert.equal((await f.commit(id,token)).code,'INSUFFICIENT_BALANCE');
  assert.equal(await f.balance(),5); assert.equal(await f.debits(),0);
  assert.equal((await f.db.query('select count(*)::int as count from wagers')).rows[0].count,0); await f.db.close();
});
function executable(file) {
  const resolver = fs.readFileSync(path.join(root,'supabase/functions/place-test-wager/sport-keys.ts'),'utf8').replace(/export /g,'');
  const source = fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\s*$/gm,'');
  return stripTypeScriptTypes(resolver+'\n'+source,{mode:'strip'});
}
function edge(f,options = {}) {
  let handler; const calls = {freshQuotes:0,commits:0};
  const context = vm.createContext({Request,Response,URLSearchParams,Date,Map,Set,JSON,Number,String,Math,Error,AbortSignal,crypto:webcrypto,
    Deno:{env:{get:key => ({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service'})[key]},serve:fn => {handler = fn}},
    createClient(_url,key) { if (key === 'public') return {auth:{getUser:async () => options.unauthorized ? {error:new Error('Signed out'),data:{user:null}} : {data:{user:{id:options.user || user}},error:null}}};
      return {rpc:async (name,args) => {
        try {
          const values = name.endsWith('prepare') ? [args.p_user_id,args.p_request_id,JSON.stringify(args.p_payload),args.p_processing_token]
            : name.endsWith('commit') ? [args.p_user_id,args.p_request_id,args.p_processing_token,JSON.stringify(args.p_selections)]
            : name.endsWith('reject') ? [args.p_user_id,args.p_request_id,args.p_processing_token,args.p_code,args.p_message]
            : [args.p_user_id,args.p_request_id];
          const data = await f.rpc(name,values);
          if (name.endsWith('commit')) { calls.commits++; if (options.loseCommitResponse) throw new Error('Commit response was lost'); }
          return {data,error:null};
        } catch (error) {return {data:null,error};}
      }};
    },
    async fetch(_url,opts) {
      calls.freshQuotes++; const body = JSON.parse(opts.body);
      assert.equal(body.sport,'americanfootball_nfl');
      if (options.failQuotes) throw new Error('Quote provider unavailable');
      const game = {id:'event-a',home_team:'Home',away_team:'Away',bookmakers:[{markets:[{key:'h2h',outcomes:[{name:'Home',price:options.changedOdds ? -110 : 100},{name:'Away',price:100}]}]}]};
      return new Response(JSON.stringify({games:[game]}));
    },
  });
  new vm.Script(executable('supabase/functions/place-test-wager/index.ts')).runInContext(context);
  const send = async body => {const res = await handler(new Request('https://fixture.invalid/place',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)})); return {status:res.status,data:await res.json()};};
  return {send,calls};
}
sqlTest('Authenticated endpoint recovers committed response loss without fresh odds or another charge; foreign receipts remain hidden',async () => {
  const f = await fixture(), e = edge(f,{loseCommitResponse:true}), id = uuid();
  const body = {request_id:id,wager_type:'single',stake:10,selections:[selection('event-a',{sport_key:'nfl'})]};
  const first = await e.send(body); assert.equal(first.data.state,'accepted'); assert.equal(await f.debits(),1);
  const replay = await e.send({...body,selections:[selection('event-a',{quoted_at:'2026-10-11T00:00:00Z'})]});
  assert.equal(replay.data.wager.id,first.data.wager.id); assert.equal(e.calls.freshQuotes,1);
  const recovered = await e.send({request_id:id,recover:true}); assert.equal(recovered.data.wager.id,first.data.wager.id);
  const invalidReplay = await e.send({...body,stake:0});
  assert.equal(invalidReplay.data.code,'REQUEST_CONFLICT'); assert.equal(invalidReplay.data.no_credits_charged,undefined);
  const oldClient = await e.send({wager_type:'single',stake:10,selections:[selection()]});
  assert.equal(oldClient.data.code,'REQUEST_ID_REQUIRED'); assert.equal(oldClient.data.no_credits_charged,true);
  assert.equal((await edge(f,{user:other}).send({request_id:id,recover:true})).data.state,'not_found');
  assert.equal((await edge(f,{unauthorized:true}).send({request_id:id,recover:true})).status,401);
  assert.equal(await f.balance(),990); await f.db.close();
});
sqlTest('Endpoint durably rejects unsupported sports/props, same-event parlays, changed odds and quote outages without debit',async () => {
  const f = await fixture();
  for (const sport of ['boxing_boxing','mma_mixed_martial_arts','soccer_epl_winner','tennis_atp_us_open','unknown']) {
    const e = edge(f), id = uuid(); const r = await e.send({request_id:id,wager_type:'single',stake:10,selections:[selection('event-a',{sport_key:sport})]});
    assert.equal(r.data.code,'SETTLEMENT_UNAVAILABLE'); assert.equal(r.data.no_credits_charged,true); assert.equal(e.calls.freshQuotes,0);
    assert.equal((await e.send({request_id:id,recover:true})).data.state,'rejected');
  }
  const sameEvent = await edge(f).send({request_id:uuid(),wager_type:'parlay',stake:10,selections:[selection(),selection('event-a',{selection_name:'Away'})]});
  assert.equal(sameEvent.data.code,'SAME_EVENT_PARLAY');
  const prop = await edge(f).send({request_id:uuid(),wager_type:'single',stake:10,selections:[selection('event-a',{market_key:'player_points',sport_key:'nba',description:'Player',selection_name:'Over',point:20})]});
  assert.equal(prop.data.code,'SETTLEMENT_UNAVAILABLE');
  const moved = await edge(f,{changedOdds:true}).send({request_id:uuid(),wager_type:'single',stake:10,selections:[selection()]});
  assert.equal(moved.data.code,'LINE_CHANGED'); assert.equal(moved.data.current_line.american_odds,-110);
  const outage = await edge(f,{failQuotes:true}).send({request_id:uuid(),wager_type:'single',stake:10,selections:[selection()]});
  assert.equal(outage.data.state,'rejected'); assert.equal(outage.data.no_credits_charged,true);
  assert.equal(await f.balance(),1000); assert.equal(await f.debits(),0); await f.db.close();
});
test('Settlement uses one canonical provider fetch for short aliases and raw Worldwide keys',async () => {
  let handler; const calls = {fetches:[],settlements:[]};
  const game = {id:'done',completed:true,home_team:'Home',away_team:'Away',scores:[{name:'Home',score:'24'},{name:'Away',score:'21'}]};
  const keys = ['nfl','americanfootball_nfl','NBA','basketball_nba','epl','soccer_epl','soccer_germany_bundesliga','boxing_boxing'];
  const wagers = keys.map((key,i) => ({id:'wager-'+i,wager_type:'single',stake:10,wager_selections:[{id:'leg-'+i,...selection('done',{sport_key:key})}]}));
  const context = vm.createContext({Request,Response,URLSearchParams,Date,Map,Set,JSON,Number,String,Math,Error,Boolean,AbortController,AbortSignal,setTimeout,clearTimeout,crypto:webcrypto,
    Deno:{env:{get:key => ({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',ODDS_API_KEY:'fixture',API_SPORTS_KEY:'fixture'})[key]},serve:fn => {handler = fn}},
    createClient() {return {from(table) {const q = {select:() => q,eq:() => q,in:() => q,order:() => q,limit:() => q,upsert:() => q,
      single:async () => ({data:{secret:'fixture'},error:null}),then:(yes,no) => Promise.resolve({data:table==='wagers'?wagers:[],error:null}).then(yes,no)};return q;},
      rpc:async (name,args) => {
        if(name==='claim_test_wager_settlement_batch')return {data:wagers.map(w=>({wager_id:w.id})),error:null};
        if(name==='get_test_wager_settlement_health')return {data:{pending_count:1},error:null};
        if(args.p_outcome==='settled')calls.settlements.push({name,args});
        return {data:{applied:true},error:null};
      }};},
    fetch:async url => {calls.fetches.push(url);return new Response(JSON.stringify([game]));},
  });
  new vm.Script(executable('supabase/functions/auto-settle-test-wagers/index.ts')).runInContext(context);
  const res = await handler(new Request('https://fixture.invalid/settle',{method:'POST',headers:{'x-gameday-job-token':'fixture'},body:'{}'}));
  const result = await res.json(); assert.equal(res.status,200); assert.equal(result.settled,7); assert.equal(result.skipped_pending,0); assert.equal(result.skipped_unsupported,1);
  assert.equal(calls.fetches.length,4); assert(calls.fetches.some(u => u.includes('/americanfootball_nfl/scores/')));
  assert(calls.fetches.some(u => u.includes('/basketball_nba/scores/'))); assert(calls.fetches.some(u => u.includes('/soccer_germany_bundesliga/scores/')));
  assert(calls.settlements.every(({args}) => args.p_result === 'won' && args.p_credit === 20));
});
