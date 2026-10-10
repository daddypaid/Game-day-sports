const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,settlement,monitoring,uuid,NOW}=require('./helpers/operator-api-fixture.cjs');
const slugs=['gameday-operator-metrics','gameday-operator-analytics','gameday-operator-health'];
const user=(app_metadata={},user_metadata={})=>({id:uuid(100),app_metadata,user_metadata});
const casinoRow=(n,values={})=>({id:uuid(n),is_test:true,created_at:NOW,stake:'1.00',payout:'0.00',status:'settled',result:'loss',...values});
for(const slug of slugs){
  test(slug+': ordinary customer and forged editable metadata denied before privileged client or queries',async()=>{
    for(const person of [user({role:'customer'}),user({}, {role:'operator',operator:true,is_admin:true}),user({role:'customer'},{role:'admin'}),user({role:'authenticated',operator:true})]){
      const f=fixture(slug,{user:person}),{response,data}=await f.request();
      assert.equal(response.status,403);assert.equal(data.code,'OPERATOR_REQUIRED');assert.deepEqual(f.trace.clients,['fixture-anon']);assert.equal(f.trace.queries.length,0);assert.equal(f.trace.rpcs.length,0);assert.equal(f.trace.auth.length,1);
    }
  });
  test(slug+': role in untrusted JWT cannot override freshly revoked app metadata',async()=>{
    const forged=Buffer.from(JSON.stringify({role:'admin',app_metadata:{role:'operator'}})).toString('base64url');
    const f=fixture(slug,{user:user({role:'customer'})}),{response}=await f.request({token:'eyJhbGciOiJIUzI1NiJ9.'+forged+'.forged'});
    assert.equal(response.status,403);assert.equal(f.trace.auth.length,1);assert.deepEqual(f.trace.clients,['fixture-anon']);assert.equal(f.trace.queries.length,0);
  });
  test(slug+': missing or malformed bearer, method, and preflight cannot perform reads',async()=>{
    for(const authorization of ['', 'Basic nope','Bearer one two']){const f=fixture(slug),r=await f.request({authorization});assert.equal(r.response.status,401);assert.equal(f.trace.clients.length,0);}
    const f=fixture(slug);assert.equal((await f.request({method:'OPTIONS',token:null})).response.status,200);assert.equal((await f.request({method:'DELETE'})).response.status,405);assert.equal(f.trace.clients.length,0);assert.equal(f.trace.queries.length,0);
  });
  test(slug+': expired tokens rejected; temporary auth errors and stalled body return retryable errors',async()=>{
    for(const options of [{user:null},{authError:{status:401,code:'bad_jwt'}}]){const f=fixture(slug,options),r=await f.request();assert.equal(r.response.status,401);assert.equal(f.trace.queries.length,0);assert.deepEqual(f.trace.clients,['fixture-anon']);}
    for(const options of [{authError:{status:503}},{authHang:true},{authThrow:true}]){const f=fixture(slug,options),r=await f.request();assert.equal(r.response.status,503);assert.match(r.data.error,/unavailable|timed out/i);assert.doesNotMatch(JSON.stringify(r.data),/private-/);assert.equal(f.trace.queries.length,0);assert.deepEqual(f.trace.clients,['fixture-anon']);}
  });
  test(slug+': both fresh operator and admin may perform only read operations',async()=>{
    for(const role of ['operator','admin']){
      const f=fixture(slug,{user:user({role})}),r=await f.request();assert.equal(r.response.status,200);assert.equal(r.data.ok,true);assert.deepEqual(f.trace.clients,['fixture-anon','fixture-service']);assert.equal(r.response.headers.get('cache-control'),'no-store');
      assert(f.trace.queries.length>0);assert(f.trace.queries.every(q=>['GET','HEAD'].includes(q.method)&&q.authorization==='Bearer fixture-service'));
      assert(f.trace.queries.every(q=>!/(?:private_state|player_hand|dealer_hand|deck_remaining|email|shoe|reels|grid|payload)/.test(q.columns)));
      assert(f.trace.rpcs.every(q=>['get_test_wager_settlement_health','get_operator_alert_health'].includes(q.name)));
      assert.doesNotMatch(JSON.stringify(r.data),/fixture-service|private_state|user_id/);
    }
  });
}
test('metrics includes modern poker and free spins once, while excluding non-test wagers, selections and casino rows',async()=>{
  const rows={wagers:[{id:uuid(1),is_test:true},{id:uuid(2),is_test:false}],wager_selections:[{id:uuid(1),wager_id:uuid(1)},{id:uuid(2),wager_id:uuid(2)}],poker_test_hands:[casinoRow(1),casinoRow(2),casinoRow(3,{is_test:false})],blackjack_hands:[casinoRow(1)],themed_slot_bonus_spins:[{id:uuid(1),created_at:NOW,payout:4,game:'midnight-monsters'}]};
  const f=fixture(slugs[0],{rows}),r=await f.request();assert.equal(r.response.status,200);assert.equal(r.data.status,'measured');assert.equal(r.data.wagers,1);assert.equal(r.data.wager_selections,1);assert.equal(r.data.poker_rounds,2);assert.equal(r.data.bonus_spins,1);assert.equal(r.data.casino_rounds,4);
  assert.equal(f.trace.queries.find(q=>q.table==='odds_response_cache').columns,'cache_key');
});
test('metrics failed or missing counts fail closed instead of falsely reporting healthy zero',async()=>{
  for(const options of [{failTables:['poker_test_hands']},{missingCounts:['wallets']},{hangTables:['sports_events']}]){
    const f=fixture(slugs[0],options),r=await f.request();assert.equal(r.response.status,503);assert.equal(r.data.ok,false);assert(!('casino_rounds'in r.data));assert.doesNotMatch(JSON.stringify(r.data),/private-table/);
  }
});
test('analytics traverses more than 1000 records with keyset pages, excludes late/non-test rows and joins test selections',async()=>{
  const wagers=Array.from({length:1203},(_,n)=>({id:uuid(n+1),stake:'1.00',potential_return:'2.00',status:'pending',placed_at:NOW,is_test:true}));
  wagers.push({id:uuid(1300),stake:999,potential_return:1000,status:'pending',placed_at:'2026-10-10T14:00:01.000Z',is_test:true},{id:uuid(1301),stake:999,potential_return:1000,status:'pending',placed_at:NOW,is_test:false});
  const selections=[{id:uuid(1),wager_id:uuid(1),sport_key:'basketball_nba',market_key:'h2h',result:'pending',created_at:NOW},{id:uuid(2),wager_id:uuid(1301),sport_key:'private-production',market_key:'h2h',created_at:NOW}];
  const f=fixture(slugs[1],{rows:{wagers,wager_selections:selections}}),r=await f.request();assert.equal(r.response.status,200);assert.equal(r.data.sportsbook.wagers,1203);assert.equal(r.data.sportsbook.handle,1203);assert.equal(r.data.sportsbook.potential_return,2406);assert.deepEqual(r.data.sportsbook.top_sports,[{name:'basketball_nba',count:1}]);
  const pages=f.trace.queries.filter(q=>q.table==='wagers');assert.equal(pages.length,3);assert.equal(pages[1].params.id,'gt.'+uuid(500));assert.equal(pages[2].params.id,'gt.'+uuid(1000));assert(pages.every(q=>q.params.limit==='500'&&q.params.order==='id.asc'));
});
test('analytics totals insurance, split/double stake, committed poker, legacy additional wagers and bonus payouts without duplication',async()=>{
  const rows={
    blackjack_hands:[casinoRow(1,{stake:4,payout:6,insurance_stake:0.5,insurance_payout:1.5}),casinoRow(2,{stake:2,payout:0,insurance_stake:0,insurance_payout:0})],
    poker_test_hands:[casinoRow(1,{game:'holdem',committed:3,payout:6}),casinoRow(2,{game:'omaha',committed:7,payout:0}),casinoRow(3,{game:'stud',committed:2,payout:4}),casinoRow(4,{game:'draw',committed:3,payout:0})],
    three_card_poker_rounds:[casinoRow(1,{ante:2,decision:'play',payout:8}),casinoRow(2,{ante:2,decision:'fold',payout:0})],
    ultimate_texas_holdem_rounds:[casinoRow(1,{ante:1,blind:1,play_bet:4,payout:12})],caribbean_stud_rounds:[casinoRow(1,{ante:2,raise_bet:4,payout:12})],
    slot_spins:[casinoRow(1,{stake:2,payout:3})],themed_slot_bonus_spins:[{id:uuid(1),created_at:NOW,game:'midnight-monsters',payout:8}],
    wallet_transactions:[{id:uuid(1),transaction_type:'refund',amount:2,created_at:NOW},{id:uuid(2),transaction_type:'wager_debit',amount:1,created_at:NOW}],
  };
  const f=fixture(slugs[1],{rows}),r=await f.request();assert.equal(r.response.status,200);assert.equal(r.data.casino.handle,41.5);assert.equal(r.data.casino.payout,60.5);assert.equal(r.data.casino.simulated_net,-19);assert.equal(r.data.casino.rounds,12);assert.equal(r.data.casino.poker_rounds,4);assert.equal(r.data.casino.bonus_spins,1);assert.equal(r.data.wallet.refund_amount,2);
  assert.equal(r.data.casino.game_mix.find(row=>row.name==='Texas Hold’em').count,1);
});
test('analytics query failure, invalid amounts and repeated cursor yield no partial totals or private errors',async()=>{
  for(const options of [{failTables:['poker_test_hands']},{rows:{blackjack_hands:[casinoRow(1,{stake:'invalid'})]}},{rows:{wagers:Array.from({length:500},(_,n)=>({id:uuid(n+1),stake:1,potential_return:2,status:'pending',placed_at:NOW,is_test:true}))},repeatPage:true}]){
    const r=await fixture(slugs[1],options).request();assert.equal(r.response.status,503);assert.equal(r.data.ok,false);assert(!('casino'in r.data));assert.doesNotMatch(JSON.stringify(r.data),/private-/);
  }
});
test('health uses captured_at and cache_key plus expiry, with truthful measured checks and poker activity',async()=>{
  const f=fixture(slugs[2],{rows:{poker_test_hands:[casinoRow(1),casinoRow(2,{is_test:false})],themed_slot_bonus_spins:[{id:uuid(1),created_at:NOW}]}}),r=await f.request();assert.equal(r.response.status,200);assert.equal(r.data.overall,'healthy');assert.equal(r.data.totals.casino_rounds_24h,2);assert.equal(r.data.checks.find(c=>c.key==='database').status,'healthy');assert(r.data.checks.every(c=>c.measured===true));
  assert.equal(f.trace.queries.find(q=>q.table==='sports_provider_snapshots').columns,'id,captured_at');assert.equal(f.trace.queries.find(q=>q.table==='odds_response_cache').columns,'cache_key,updated_at,expires_at');assert.match(r.data.scope,/not verified/);
});
test('health source read failures expose unavailable nulls, not zero or falsely healthy database',async()=>{
  const f=fixture(slugs[2],{failTables:['poker_test_hands','sports_markets','sports_provider_snapshots']}),r=await f.request();assert.equal(r.response.status,200);assert.equal(r.data.overall,'degraded');assert.equal(r.data.totals.casino_rounds_24h,null);assert.equal(r.data.totals.markets,null);assert.equal(r.data.totals.provider_snapshots,null);assert.equal(r.data.checks.find(c=>c.key==='database').status,'degraded');assert.doesNotMatch(JSON.stringify(r.data),/private-table/);
});
test('health expired, absent, old or implausibly future stored data produce attention',async()=>{
  for(const rows of [
    {odds_response_cache:[{cache_key:'expired',updated_at:NOW,expires_at:NOW}]},
    {odds_response_cache:[],sports_provider_snapshots:[]},
    {sports_provider_snapshots:[{id:1,captured_at:'2026-10-10T13:49:59.000Z'}]},
    {sports_provider_snapshots:[{id:1,captured_at:'2026-10-10T14:02:00.000Z'}]},
  ]){const r=await fixture(slugs[2],{rows}).request();assert.equal(r.response.status,200);assert.equal(r.data.overall,'attention');assert.equal(r.data.checks.find(c=>c.key==='database').status,'healthy');}
});
test('settlement review and stalled grading alert, but pending ticket age alone does not',async()=>{
  const scenarios=[
    [settlement({pending_count:1,review_required_count:1}),'stale'],
    [settlement({pending_count:1,provider_error_count:1,last_check_at:NOW}),'stale'],
    [settlement({pending_count:1,check_error_count:1,last_check_at:NOW}),'stale'],
    [settlement({pending_count:1,max_pending_age_seconds:864000,oldest_unresolved_at:'2026-09-01T00:00:00.000Z'}),'healthy'],
    [settlement({pending_count:1,retry_due_count:1,last_check_at:'2026-10-10T13:44:59.000Z'}),'stale'],
    [settlement({pending_count:1,retry_due_count:1,last_check_at:null,oldest_unresolved_at:'2026-10-10T13:59:00.000Z'}),'healthy'],
    [settlement({pending_count:1,retry_due_count:1,last_check_at:null,oldest_unresolved_at:'2026-10-10T13:44:59.000Z'}),'stale'],
  ];
  for(const [value,status]of scenarios){const r=await fixture(slugs[2],{settlement:value}).request();assert.equal(r.data.checks.find(c=>c.key==='settlement').status,status);assert.match(r.data.checks.find(c=>c.key==='settlement').detail,/age alone/);}
  for(const options of [{rpcErrors:['get_test_wager_settlement_health']},{settlement:settlement({pending_count:-1})}]){const r=await fixture(slugs[2],options).request();assert.equal(r.data.overall,'degraded');assert.equal(r.data.settlement,null);assert.equal(r.data.checks.find(c=>c.key==='settlement').status,'degraded');assert.equal(r.data.checks.find(c=>c.key==='database').status,'degraded');}
});
test('monitoring check distinguishes unconfigured, stalled, exhausted and unavailable alert delivery',async()=>{
  for(const options of [
    {monitoring:monitoring({delivery_configured:false})},
    {monitoring:monitoring({last_monitor_at:'2026-10-10T13:44:59.000Z'})},
    {monitoring:monitoring({dead_count:1})},
    {monitoring:monitoring({pending_count:1,max_pending_age_seconds:901})},
  ]){const r=await fixture(slugs[2],options).request();assert.equal(r.data.overall,'attention');assert.equal(r.data.checks.find(c=>c.key==='monitoring').status,'stale');if(options.monitoring.delivery_configured===false)assert.match(r.data.checks.find(c=>c.key==='monitoring').detail,/not configured/);}
  for(const options of [{rpcErrors:['get_operator_alert_health']},{monitoring:monitoring({pending_count:-1})}]){const r=await fixture(slugs[2],options).request();assert.equal(r.data.overall,'degraded');assert.equal(r.data.monitoring,null);assert.equal(r.data.checks.find(c=>c.key==='monitoring').status,'degraded');}
});
test('scheduled shared collector has no monitor RPC dependency or write side effects',async()=>{
  const f=fixture(slugs[2]),db=f.context.createClient('https://operator-fixture.invalid','fixture-service',{global:{fetch:f.context.fetch},auth:{persistSession:false,autoRefreshToken:false}});
  const result=await f.context.collectOperatorHealth(db,new Date(NOW));assert.equal(result.overall,'healthy');assert.deepEqual(f.trace.rpcs.map(r=>r.name),['get_test_wager_settlement_health']);assert(f.trace.queries.every(q=>q.method==='GET'));assert(!result.checks.some(c=>c.key==='monitoring'));
});

test('SDK transport buffers full body with a deadline and aborts a stalled response after headers',async()=>{
  const f=fixture(slugs[0]);let observedSignal,aborted=false;
  f.context.fetch=async (_input,init)=>{
    observedSignal=init.signal;
    return new Response(new ReadableStream({start(controller){
      observedSignal.addEventListener('abort',()=>{aborted=true;controller.error(new Error('transport-body-aborted'));},{once:true});
    }}),{status:200,headers:{'content-type':'application/json'}});
  };
  await assert.rejects(f.context.operatorFetch('https://transport-fixture.invalid'),/transport-body-aborted|timed out/);
  assert.equal(aborted,true);assert.equal(observedSignal.aborted,true);
});
test('SDK buffered transport preserves body, status, count headers, and no-body HEAD responses',async()=>{
  const f=fixture(slugs[0]);f.context.fetch=async()=>new Response(JSON.stringify({ok:true}),{status:206,statusText:'Partial Content',headers:{'content-type':'application/json','content-range':'0-2/3'}});
  const response=await f.context.operatorFetch('https://transport-fixture.invalid');assert.equal(response.status,206);assert.equal(response.statusText,'Partial Content');assert.equal(response.headers.get('content-range'),'0-2/3');assert.deepEqual(await response.json(),{ok:true});
  f.context.fetch=async()=>new Response(null,{status:204,headers:{'content-range':'0-0/0'}});
  const empty=await f.context.operatorFetch(new Request('https://transport-fixture.invalid',{method:'HEAD'}));assert.equal(empty.status,204);assert.equal(empty.body,null);assert.equal(empty.headers.get('content-range'),'0-0/0');
});
test('SDK transport forwards caller abort through a Request input until its body completes',async()=>{
  const f=fixture(slugs[0]),upstream=new AbortController();let observedSignal;
  f.context.fetch=async(_input,init)=>{observedSignal=init.signal;return new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(new Error('caller-aborted')),{once:true});}}));};
  const operation=f.context.operatorFetch(new Request('https://transport-fixture.invalid',{signal:upstream.signal}));upstream.abort();await assert.rejects(operation,/caller-aborted/);assert.equal(observedSignal.aborted,true);
});
