const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {randomUUID,webcrypto} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const root = path.resolve(__dirname,'..');
const migration = 'supabase/migrations/20261010131537_fair_settlement_queue_and_score_receipts.sql';
const owner = '11111111-1111-4111-8111-111111111111';
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const hoursAgo = hours => new Date(Date.now()-hours*3600000).toISOString();
const finalGame = (id,extra={}) => ({id,completed:true,commence_time:hoursAgo(4),home_team:'Home',away_team:'Away',
  scores:[{name:'Home',score:'24'},{name:'Away',score:'21'}],...extra});

async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(read('tests/fixtures/sportsbook-placement-baseline.sql'));
  await db.exec("alter type wager_status add value 'void'");
  await db.exec("create type transaction_type as enum('refund','wager_credit'); alter table wagers add column settled_at timestamptz, add column updated_at timestamptz; create table sports_events(provider_event_id text primary key, commence_time timestamptz, home_team text, away_team text, status text)");
  await db.exec(read('supabase/migrations/20260905052111_add_atomic_auto_wager_settlement.sql'));
  await db.exec(read('supabase/migrations/20260905062733_harden_auto_settlement_grade_integrity.sql'));
  await db.exec(read(migration));
  await db.query('insert into wallets(user_id,balance) values($1,1000)',[owner]);
  const rpc = async (name,args=[]) => {
    const result = await db.query(`select * from public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
    return name==='claim_test_wager_settlement_batch' ? result.rows : Object.values(result.rows[0])[0];
  };
  const add = async (options={}) => {
    const id = randomUUID(), event = options.event || randomUUID(), placed = options.placed || hoursAgo(1);
    const legs = options.legs || [{event,sport:options.sport||'nfl',market:options.market||'h2h',side:options.side||'Home',point:options.point??null}];
    await db.query("insert into wagers(id,user_id,wager_type,stake,potential_return,status,placed_at,is_test) values($1,$2,$3,10,$4,'accepted',$5,true)",[id,owner,legs.length>1?'parlay':'single',options.potential||10*2**legs.length,placed]);
    for (const leg of legs) {
      await db.query('insert into wager_selections(id,wager_id,event_id,event_name,sport_key,market_key,selection_name,description,point,american_odds) values($1,$2,$3,$4,$5,$6,$7,$8,$9,100)',[randomUUID(),id,leg.event,'Away at Home',leg.sport||'nfl',leg.market||'h2h',leg.side||'Home',leg.player||null,leg.point??null]);
      await db.query("insert into sports_events values($1,$2,'Home','Away',$3) on conflict(provider_event_id) do nothing",[leg.event,leg.kickoff||options.kickoff||hoursAgo(4),leg.status||'scheduled']);
    }
    return {id,event,legs};
  };
  const due = async () => db.exec("update test_wager_settlement_checks set next_check_at=now()-interval '1 second', lease_until=null,processing_token=null");
  const balance = async () => Number((await db.query('select balance from wallets where user_id=$1',[owner])).rows[0].balance);
  const credits = async () => (await db.query('select count(*)::integer as count from wallet_transactions')).rows[0].count;
  return {db,rpc,add,due,balance,credits};
}

function endpoint(f,options={}) {
  let handler; const calls={fetches:[],claims:[],finishes:[]};
  const admin = {
    from(table) {
      const filters=[];let single=false,upsert=null;
      const q={select:()=>q,eq:(key,value)=>{filters.push([key,'=',value]);return q},
        in:(key,values)=>{filters.push([key,'in',values]);return q},single:()=>{single=true;return q},
        upsert:rows=>{upsert=rows;return q},
        then:(yes,no)=>run().then(yes,no)};
      async function run(){
        try{
          if(table==='internal_job_secrets'){
            if(options.failSecret)throw new Error('Secret query rejected');
            return {data:{secret:'fixture'},error:null};
          }
          if(options.failRead===table)return {data:null,error:new Error('Read failed')};
          if(upsert){
            if(options.failSave)return {data:null,error:new Error('Save failed')};
            for(const row of upsert)await f.db.query('insert into test_wager_final_scores values($1,$2,$3,$4) on conflict(sport_key,provider_event_id) do update set game=excluded.game,captured_at=excluded.captured_at',[row.sport_key,row.provider_event_id,JSON.stringify(row.game),row.captured_at]);
            return {data:null,error:null};
          }
          const args=[],where=filters.map(([key,op,value])=>{args.push(op==='in'?JSON.stringify(value):value);return op==='in'?`${key}::text in (select jsonb_array_elements_text($${args.length}::jsonb))`:`${key}=$${args.length}`}).join(' and ');
          const rows=(await f.db.query(`select * from ${table}${where?' where '+where:''}`,args)).rows;
          if(table==='wagers')for(const wager of rows)wager.wager_selections=(await f.db.query('select * from wager_selections where wager_id=$1 order by id',[wager.id])).rows;
          return {data:single?rows[0]:rows,error:null};
        }catch(error){if(process.env.GAMEDAY_SETTLEMENT_DEBUG)console.error('Query error',table,error.message);return {data:null,error}}
      }
      return q;
    },
    async rpc(name,args={}) {
      try{
        if(options.failRPC===name)return {data:null,error:new Error('RPC unavailable')};
        let data;
        if(name==='claim_test_wager_settlement_batch'){
          data=await f.rpc(name,[args.p_processing_token,args.p_limit]);calls.claims.push(data.map(row=>row.wager_id));
        }else if(name==='finish_test_wager_settlement_check'){
          calls.finishes.push(args);
          data=await f.rpc(name,[args.p_wager_id,args.p_processing_token,args.p_outcome,args.p_reason,args.p_result??null,args.p_credit??null,args.p_grades?JSON.stringify(args.p_grades):null]);
          if(options.loseFinishResponse&&args.p_outcome==='settled')return {data:null,error:new Error('Response lost after commit')};
        }else data=await f.rpc(name);
        return {data,error:null};
      }catch(error){if(process.env.GAMEDAY_SETTLEMENT_DEBUG)console.error('RPC error',name,error.message);return {data:null,error}}
    },
  };
  const context=vm.createContext({Request,Response,URL,URLSearchParams,Date:options.Date||Date,Map,Set,JSON,Number,String,Math,Error,Boolean,
    AbortController,AbortSignal,crypto:webcrypto,setTimeout:options.setTimeout||setTimeout,clearTimeout,
    Deno:{env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',ODDS_API_KEY:'fixture',API_SPORTS_KEY:options.noFootballKey?undefined:'fixture'})[key]},serve:fn=>{handler=fn}},
    createClient:()=>admin,
    async fetch(input,init){
      const url=String(input);calls.fetches.push(url);
      if(options.fetch)return options.fetch(url,init,calls);
      const sport=new URL(url).pathname.split('/')[3];
      if(options.failSports?.includes(sport))throw new Error('Provider offline');
      const wanted=(new URL(url).searchParams.get('eventIds')||'').split(',');
      return new Response(JSON.stringify((options.games||[]).filter(game=>wanted.includes(game.id))));
    },
  });
  const executable=read('supabase/functions/place-test-wager/sport-keys.ts').replace(/^export /gm,'')+'\n'+read('supabase/functions/auto-settle-test-wagers/index.ts').replace(/^import .*;\s*$/gm,'');
  new vm.Script(stripTypeScriptTypes(executable,{mode:'strip'})).runInContext(context);
  const send=async (token='fixture',method='POST')=>{const res=await handler(new Request('https://fixture.invalid/settle',{method,headers:{'x-gameday-job-token':token},...(method==='POST'?{body:'{}'}:{})}));return {status:res.status,data:await res.json()}};
  return {send,calls,context};
}

test('Service-only grading queue, score receipts and health cannot be read or invoked by customers',async()=>{
  const f=await fixture();
  for(const table of ['test_wager_settlement_checks','test_wager_final_scores']){
    const row=(await f.db.query("select relrowsecurity,has_table_privilege('anon',$1,'SELECT') as anon,has_table_privilege('authenticated',$1,'SELECT') as customer from pg_class where relname=$1",[table])).rows[0];
    assert.deepEqual(row,{relrowsecurity:true,anon:false,customer:false});
  }
  for(const signature of ['claim_test_wager_settlement_batch(uuid,integer)','finish_test_wager_settlement_check(uuid,uuid,text,text,text,numeric,jsonb)','get_test_wager_settlement_health()']){
    const rights=(await f.db.query("select has_function_privilege('anon',$1,'EXECUTE') as anon,has_function_privilege('authenticated',$1,'EXECUTE') as customer,has_function_privilege('service_role',$1,'EXECUTE') as service",[signature])).rows[0];
    assert.deepEqual(rights,{anon:false,customer:false,service:true});
  }
  const bad=finalGame('bad',{completed:false});
  await assert.rejects(f.db.query('insert into test_wager_final_scores(sport_key,provider_event_id,game) values($1,$2,$3)',['nfl','bad',JSON.stringify(bad)]),/check constraint/);
  await f.db.close();
});

test('Over 100 old unresolved wagers cannot starve a fresh completed ticket; backlog rotates and stays visible',async()=>{
  const f=await fixture(),older=[];
  for(let i=0;i<135;i++)older.push(await f.add({placed:hoursAgo(240+i),kickoff:hoursAgo(120)}));
  const fresh=await f.add(),e=endpoint(f,{games:[finalGame(fresh.event)]});
  const first=await e.send();assert.equal(first.status,200);assert.equal(first.data.claimed,100);assert.equal(first.data.settled,1);
  assert.equal(first.data.review_required,99);assert.equal(first.data.backlog.pending_count,135);assert.equal(first.data.backlog.review_required_count,99);
  assert.equal(first.data.backlog.review_reasons.score_missing_beyond_provider_window,99);assert.equal(await f.balance(),1020);
  const second=await endpoint(f).send();assert.equal(second.data.checked,36);assert.equal(second.data.review_required,36);
  assert.equal(second.data.backlog.review_required_count,135);assert(second.data.backlog.oldest_unresolved_at);assert(second.data.backlog.last_success_at);
  assert.equal(await f.credits(),1);await f.db.close();
});

test('The newest ticket also finishes immediately when a large untouched backlog is within the three-day window',async()=>{
  const f=await fixture();for(let i=0;i<165;i++)await f.add({placed:hoursAgo(24+i/100),kickoff:hoursAgo(4)});
  const fresh=await f.add({placed:hoursAgo(.5)}),e=endpoint(f,{games:[finalGame(fresh.event)]});
  const result=await e.send();assert.equal(result.status,200);assert.equal(e.calls.claims[0][0],fresh.id);
  assert.equal(result.data.settled,1);assert.equal(result.data.skipped_pending,99);assert.equal(result.data.backlog.review_required_count,0);
  assert.equal(await f.credits(),1);await f.db.close();
});

test('Leased batches are disjoint, capped for odd limits and can be reclaimed after a crash without an old worker credit',async()=>{
  const f=await fixture();
  for(let i=0;i<18;i++)await f.add({placed:hoursAgo(i%2?240:1)});
  const old=randomUUID(),fresh=randomUUID(),first=await f.rpc('claim_test_wager_settlement_batch',[old,7]);
  const second=await f.rpc('claim_test_wager_settlement_batch',[fresh,7]);
  assert.equal(first.length,7);assert.equal(second.length,7);assert(!second.some(row=>first.some(one=>one.wager_id===row.wager_id)));
  await f.db.query("update test_wager_settlement_checks set lease_until=now()-interval '1 second',next_check_at=now()-interval '1 minute' where processing_token=$1",[old]);
  const takeover=randomUUID(),third=await f.rpc('claim_test_wager_settlement_batch',[takeover,100]);
  assert(third.some(row=>row.wager_id===first[0].wager_id));
  const stale=await f.rpc('finish_test_wager_settlement_check',[first[0].wager_id,old,'settled',null,'won',20,'[]']);
  assert.equal(stale.applied,false);assert.equal(await f.balance(),1000);await f.db.close();
});

test('A final parlay leg is retained beyond the provider window until a later leg finishes',async()=>{
  const f=await fixture(),early=randomUUID(),later=randomUUID();
  await f.add({legs:[{event:early,kickoff:hoursAgo(12)},{event:later,kickoff:new Date(Date.now()+3600000).toISOString()}]});
  const first=await endpoint(f,{games:[finalGame(early)]}).send();
  assert.equal(first.data.settled,0);assert.equal(first.data.skipped_pending,1);assert.equal(await f.credits(),0);
  assert.equal((await f.db.query('select count(*)::integer as count from test_wager_final_scores')).rows[0].count,1);
  await f.db.exec("update wagers set placed_at=now()-interval '8 days'");
  await f.db.query("update sports_events set commence_time=now()-interval '5 days' where provider_event_id=$1",[early]);
  await f.due();
  const second=await endpoint(f,{games:[finalGame(later)]}).send();
  assert.equal(second.data.settled,1);assert.equal(second.data.review_required,0);assert.equal(await f.balance(),1040);assert.equal(await f.credits(),1);
  await f.due();const repeat=await endpoint(f,{games:[]}).send();assert.equal(repeat.data.checked,0);assert.equal(await f.credits(),1);await f.db.close();
});

test('A provider outage is isolated by canonical sport and retained finals remain usable',async()=>{
  const f=await fixture(),a=await f.add({sport:'nfl'}),b=await f.add({sport:'NBA'}),cached=await f.add({sport:'americanfootball_nfl'});
  await f.db.query('insert into test_wager_final_scores(sport_key,provider_event_id,game) values($1,$2,$3)',['americanfootball_nfl',cached.event,JSON.stringify(finalGame(cached.event))]);
  const e=endpoint(f,{games:[finalGame(b.event)],failSports:['americanfootball_nfl']});
  const result=await e.send();assert.equal(result.data.settled,2);assert.equal(result.data.provider_errors,1);assert.equal(result.data.backlog.pending_count,1);
  assert.equal(result.data.backlog.review_required_count,0);assert.equal(e.calls.fetches.length,2);assert.equal(await f.balance(),1040);
  await f.due();const retry=await endpoint(f,{games:[finalGame(a.event)]}).send();assert.equal(retry.data.settled,1);assert.equal(await f.credits(),3);await f.db.close();
});

test('Missing scores do not become zero scores, and future/ongoing old tickets are not misclassified as overdue results',async()=>{
  const f=await fixture(),malformed=await f.add(),future=await f.add({placed:hoursAgo(240),kickoff:new Date(Date.now()+86400000).toISOString()}),ongoing=await f.add({placed:hoursAgo(240),kickoff:hoursAgo(120)});
  const bad=finalGame(malformed.event,{scores:[{name:'Home',score:null},{name:'Away',score:'21'}]});
  const result=await endpoint(f,{games:[bad,finalGame(ongoing.event,{completed:false})]}).send();
  assert.equal(result.data.settled,0);assert.equal(result.data.review_required,1);assert.equal(result.data.skipped_pending,2);
  assert.equal(result.data.backlog.review_reasons.invalid_final_scores,1);assert.equal(await f.balance(),1000);assert.equal(await f.credits(),0);
  assert.equal((await f.db.query('select count(*)::integer as count from test_wager_final_scores')).rows[0].count,0);await f.db.close();
});

test('Lost atomic settlement response and repeated finish cannot issue two wallet credits',async()=>{
  const f=await fixture(),wager=await f.add(),e=endpoint(f,{games:[finalGame(wager.event)],loseFinishResponse:true});
  const first=await e.send();assert.equal(first.status,503);assert.equal(first.data.check_errors,1);assert.equal(first.data.settled,0);assert.equal(first.data.backlog.pending_count,0);assert.equal(await f.balance(),1020);assert.equal(await f.credits(),1);
  const args=e.calls.finishes.find(one=>one.p_outcome==='settled');
  const replay=await f.rpc('finish_test_wager_settlement_check',[args.p_wager_id,args.p_processing_token,args.p_outcome,null,args.p_result,args.p_credit,JSON.stringify(args.p_grades)]);
  assert.equal(replay.applied,false);assert.equal(await f.credits(),1);assert.equal((await endpoint(f).send()).data.checked,0);await f.db.close();
});

test('Invalid or partial leg grading rolls back queue completion and wallet changes',async()=>{
  const f=await fixture(),wager=await f.add(),token=randomUUID();await f.rpc('claim_test_wager_settlement_batch',[token,100]);
  await assert.rejects(f.rpc('finish_test_wager_settlement_check',[wager.id,token,'settled',null,'won',20,'[]']),/grade every wager selection/);
  assert.equal(await f.balance(),1000);assert.equal(await f.credits(),0);
  const state=(await f.db.query('select * from test_wager_settlement_checks where wager_id=$1',[wager.id])).rows[0];
  assert.equal(state.processing_token,token);assert.equal(state.last_checked_at,null);await f.db.close();
});

test('Score-receipt persistence failures leave the wager pending and recoverable without a guessed payout',async()=>{
  const f=await fixture(),wager=await f.add();
  const failed=await endpoint(f,{games:[finalGame(wager.event)],failSave:true}).send();assert.equal(failed.status,503);assert.equal(await f.balance(),1000);assert.equal(await f.credits(),0);
  await f.due();const recovered=await endpoint(f,{games:[finalGame(wager.event)]}).send();assert.equal(recovered.data.settled,1);assert.equal(await f.credits(),1);await f.db.close();
});

test('Atomic settlement failures remain visible to operators while fresh valid wagers still finish',async()=>{
  const f=await fixture(),invalid=await f.add({potential:10}),valid=await f.add();
  const result=await endpoint(f,{games:[finalGame(invalid.event),finalGame(valid.event)]}).send();
  assert.equal(result.status,503);assert.equal(result.data.check_errors,1);assert.equal(result.data.settled,1);assert.equal(result.data.backlog.review_required_count,1);
  assert.equal(result.data.backlog.check_error_count,1);assert.equal(result.data.backlog.review_reasons.atomic_settlement_failed,1);
  assert(result.data.backlog.last_attempt_at);assert.equal(await f.credits(),1);assert.equal(await f.balance(),1020);await f.db.close();
});

test('Previously checked ongoing tickets rotate behind never-checked tickets on the next due batch',async()=>{
  const f=await fixture();for(let i=0;i<115;i++)await f.add({placed:hoursAgo(240+i),kickoff:new Date(Date.now()+86400000).toISOString()});
  const first=await endpoint(f).send();assert.equal(first.data.checked,100);assert.equal(first.data.skipped_pending,100);assert.equal(first.data.review_required,0);
  const second=await endpoint(f).send();assert.equal(second.data.checked,15);assert.equal(second.data.backlog.unchecked_count,0);
  await f.due();const third=await endpoint(f).send();assert.equal(third.data.checked,100);assert.equal(third.data.backlog.pending_count,115);assert.equal(await f.credits(),0);await f.db.close();
});

test('Job authentication remains mandatory and runs use the supported three-day score window',async()=>{
  const f=await fixture(),wager=await f.add(),e=endpoint(f,{games:[finalGame(wager.event)]});
  assert.equal((await e.send('')).status,401);assert.equal((await e.send('wrong')).status,401);assert.equal((await e.send('fixture','GET')).status,405);assert.equal(e.calls.claims.length,0);assert.equal(await f.credits(),0);
  const secretFailure=await endpoint(f,{failSecret:true}).send();assert.equal(secretFailure.status,503);assert.equal(await f.credits(),0);
  const result=await e.send();assert.equal(result.data.settled,1);const url=new URL(e.calls.fetches[0]);assert.equal(url.searchParams.get('daysFrom'),'3');assert.equal(url.searchParams.get('eventIds'),wager.event);
  const config=read('supabase/config.toml');assert.match(config,/\[functions\.auto-settle-test-wagers\]\s*verify_jwt = false/);await f.db.close();
});

test('A stalled scores response body is aborted, releases checked work for retry, and does not stop another sport',async()=>{
  const f=await fixture(),a=await f.add(),b=await f.add({sport:'nba'});
  const e=endpoint(f,{setTimeout:(fn,ms)=>setTimeout(fn,ms===10000?25:ms),fetch:async(url,init)=>{
    if(url.includes('/americanfootball_nfl/'))return {status:200,statusText:'OK',headers:new Headers(),text:()=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))};
    return new Response(JSON.stringify([finalGame(b.event)]));
  }});
  const result=await e.send();assert.equal(result.status,200);assert.equal(result.data.provider_errors,1);assert.equal(result.data.settled,1);assert.equal(await f.credits(),1);
  const state=(await f.db.query('select * from test_wager_settlement_checks where wager_id=$1',[a.id])).rows[0];assert.equal(state.processing_token,null);assert.equal(state.last_outcome,'provider_error');await f.db.close();
});

test('A function budget cutoff preserves final receipts and recoverable leases without charging the wallet',async()=>{
  const f=await fixture(),wager=await f.add();let clock=Date.now();
  class JobDate extends Date {static now(){return clock}}
  const e=endpoint(f,{Date:JobDate,fetch:async()=>{clock+=100001;return new Response(JSON.stringify([finalGame(wager.event)]))}});
  const result=await e.send();assert.equal(result.status,200);assert.equal(result.data.checked,0);assert.equal(result.data.deferred,1);
  assert.equal(result.data.backlog.active_lease_count,1);assert.equal(await f.balance(),1000);assert.equal(await f.credits(),0);
  assert.equal((await f.db.query('select count(*)::integer as count from test_wager_final_scores')).rows[0].count,1);
  await f.due();const retry=await endpoint(f,{games:[]}).send();assert.equal(retry.data.settled,1);assert.equal(await f.credits(),1);await f.db.close();
});
