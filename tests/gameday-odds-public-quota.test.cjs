const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {createClient}=require('@supabase/supabase-js');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/gameday-odds/index.ts'),'utf8');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const QUOTA={remaining:'815',used:'185',last:'10'};
function fixture({cached=null,upstreamStatus=200,upstreamThrow=false,payload,storedFallback=false}={}){
  let handler;const tasks=[],trace={cacheWrites:[],snapshots:[],upstream:[],db:[]};
  const fixturePayload=payload||{source:'live',provider:'the-odds-api',mode:'sports',count:1,sports:[{key:'basketball_nba',group:'Basketball',title:'NBA',active:true}],featured:[{key:'basketball_nba',group:'Basketball',title:'NBA',active:true}],groups:['Basketball'],quota:QUOTA};
  const stored={sports_events:[{id:'event-db',provider_event_id:'fixture-event',sport_key:'basketball_nba',sport_title:'NBA',commence_time:'2026-10-11T19:00:00.000Z',home_team:'Home',away_team:'Away',status:'scheduled',last_seen_at:'2026-10-10T00:00:00.000Z'}],sports_markets:[{id:'market-db',event_id:'event-db',provider_market_key:'h2h',market_title:'Moneyline',status:'open',line_method:'consensus_median',updated_at:'2026-10-10T00:00:00.000Z'}],sports_outcomes:[{market_id:'market-db',outcome_name:'Home',description:null,point:null,american_odds:-110,source_book_count:4,is_active:true,updated_at:'2026-10-10T00:00:00.000Z'}]};
  async function fetchFixture(input,init={}){
    const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);
    if(url.pathname==='/functions/v1/odds-engine'){
      trace.upstream.push({body:JSON.parse(await request.text()),internal:request.headers.get('x-gameday-internal')});
      if(upstreamThrow)throw new Error('fixture provider failure');return json(fixturePayload,upstreamStatus);
    }
    if(!url.pathname.startsWith('/rest/v1/'))throw new Error('Unexpected outbound URL '+url.pathname);
    const table=url.pathname.split('/').pop();trace.db.push({table,method:request.method});
    if(table==='odds_response_cache'){
      if(request.method==='GET')return json(cached);
      trace.cacheWrites.push(JSON.parse(await request.text()));return json(null);
    }
    if(table==='sports_provider_snapshots'){trace.snapshots.push(JSON.parse(await request.text()));return json(null);}
    if(['sports_events','sports_markets','sports_outcomes'].includes(table)){
      if(request.method==='GET')return json(storedFallback?stored[table]:[]);
      if(url.searchParams.get('select')==='id')return json({id:table==='sports_events'?'event-db':'market-db'});
      return json(null);
    }
    throw new Error('Unexpected DB table '+table);
  }
  const context=vm.createContext({Request,Response,Headers,URL,URLSearchParams,Map,Set,Date,Promise,console:{error(){}},fetch:fetchFixture,
    createClient:(url,key,config)=>createClient(url,key,{...config,global:{...config.global,fetch:fetchFixture}}),
    Deno:{env:{get:key=>({SUPABASE_URL:'https://odds-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-internal'})[key]},serve:callback=>handler=callback},EdgeRuntime:{waitUntil:task=>tasks.push(task)},
  });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import[^\n]+\n/gm,''),{mode:'transform'}),context,{filename:'gameday-odds/index.ts'});
  return {trace,async request({mode='sports',sport,eventId,futureKey,markets,headers={}}={}){
    const url=new URL('https://public-fixture.invalid/gameday-odds');url.searchParams.set('mode',mode);if(sport)url.searchParams.set('sport',sport);if(eventId)url.searchParams.set('event_id',eventId);if(futureKey)url.searchParams.set('future_key',futureKey);if(markets)url.searchParams.set('markets',markets);
    const response=await handler(new Request(url,{headers}));const data=await response.json();await Promise.all(tasks);return {response,data};
  }};
}
const noQuota=value=>{assert(!Object.hasOwn(value,'quota'));assert.doesNotMatch(JSON.stringify(value),/"(?:remaining|used|last)"\s*:/);};
test('fresh customer catalog removes quota while preserving provider catalog and internal cache/snapshot usage',async()=>{
  const f=fixture(),r=await f.request();assert.equal(r.response.status,200);noQuota(r.data);assert.equal(r.data.sports[0].key,'basketball_nba');assert.equal(r.data.count,1);assert.deepEqual(r.data.groups,['Basketball']);assert.deepEqual(f.trace.cacheWrites[0].payload.quota,QUOTA);assert.deepEqual(f.trace.snapshots[0].payload.quota,QUOTA);assert.equal(f.trace.upstream[0].internal,'fixture-internal');
});
test('fresh, expired and thrown-error cached paths all remove quota without changing cached market prices',async()=>{
  const payload={mode:'games',sport_key:'basketball_nba',count:1,games:[{id:'fixture-event',bookmakers:[{key:'gameday',markets:[{key:'h2h',outcomes:[{name:'Home',price:-110,point:null},{name:'Away',price:100,point:null}]}]}]}],quota:[QUOTA]};
  for(const options of [{expires_at:'2099-01-01T00:00:00.000Z'},{expires_at:'2020-01-01T00:00:00.000Z',upstreamStatus:502},{expires_at:'2020-01-01T00:00:00.000Z',upstreamThrow:true}]){
    const f=fixture({...options,cached:{payload,expires_at:options.expires_at}}),r=await f.request({mode:'games',sport:'nba'});assert.equal(r.response.status,200);noQuota(r.data);assert.deepEqual(r.data.games,payload.games);assert.equal(r.data.count,1);assert.equal(r.data.sport_key,'basketball_nba');if(options.upstreamStatus||options.upstreamThrow){assert.equal(r.data.stale,true);assert.equal(r.data.source_status,'cached');}else assert.equal(f.trace.upstream.length,0);
    assert.deepEqual(payload.quota,[QUOTA],'public sanitization does not mutate stored payload');
  }
});
test('all live public selection modes retain complete market shape with only quota excluded',async()=>{
  for(const mode of ['games','events','prop_markets','props','future_markets','futures']){
    const payload={source:'live',mode,sport_key:'basketball_nba',count:1,games:[{id:'event',sport_key:'basketball_nba'}],event:{id:'event',sport_key:'basketball_nba',bookmakers:[{key:'gameday',markets:[{key:'player_points',outcomes:[{name:'Over',description:'Player',point:20.5,price:-115}]}]}]},events:[{id:'event'}],prop_markets:['player_points'],requested_markets:['player_points'],futures:[{id:'future'}],quota:QUOTA};
    // Required customer inputs use the actual handler's normal validation.
    const f=fixture({payload});
    const r=await f.request({mode,sport:'nba',eventId:'event',futureKey:'basketball_nba_champion',markets:'player_points'});assert.equal(r.response.status,200);noQuota(r.data);const {quota,...expected}=payload;assert.deepEqual(r.data,expected);assert.deepEqual(f.trace.cacheWrites[0].payload.quota,QUOTA);
  }
});
test('stored fallback and upstream error paths expose customer context without operational quota',async()=>{
  const f=fixture({upstreamStatus:502,storedFallback:true}),r=await f.request({mode:'games',sport:'nba'});assert.equal(r.response.status,200);noQuota(r.data);assert.equal(r.data.source_status,'stored_fallback');assert.equal(r.data.games[0].bookmakers[0].markets[0].outcomes[0].price,-110);assert.equal(r.data.games[0].id,'fixture-event');
  for(const upstreamThrow of [false,true]){const value=await fixture({upstreamStatus:502,upstreamThrow,payload:{error:'provider failed',quota:QUOTA}}).request();assert.equal(value.response.status,upstreamThrow?502:503);noQuota(value.data);assert.match(value.data.error,/temporarily unavailable/);}
});
test('internal fresh bypass still caches operational quota while its HTTP response stays customer-safe',async()=>{
  const f=fixture({cached:{payload:{quota:QUOTA,error:'old data'},expires_at:'2099-01-01T00:00:00.000Z'}}),r=await f.request({headers:{'x-gameday-fresh':'fixture-internal'}});assert.equal(r.response.status,200);noQuota(r.data);assert.equal(f.trace.upstream.length,1);assert.deepEqual(f.trace.cacheWrites[0].payload.quota,QUOTA);assert.deepEqual(f.trace.snapshots[0].payload.quota,QUOTA);
});
