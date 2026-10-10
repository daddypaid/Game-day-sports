// Run the customer-facing Sportsbook page against isolated SDK/provider fixtures.
// Every external request is intercepted; no production accounts or wagers are used.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
let browser,server,base;
const disposals=new WeakMap();
function disposeContext(context){
 if(!disposals.has(context))disposals.set(context,(async()=>{
  // Keep external traffic blocked after removing routes, and leave frames alive
  // until existing async fixture handlers have finished their evaluations.
  await context.setOffline(true);
  await context.unrouteAll({behavior:'wait'});
  await context.close();
 })());
 return disposals.get(context);
}
const sdk=`export function createClient(){
 const unlocked=()=>{if(__f.authLock)throw Error('SDK called inside auth callback')};
 return {auth:{getSession:async()=>{unlocked();return {data:{session:__f.session},error:null}},onAuthStateChange(fn){__f.callbacks.push(fn);return{data:{subscription:{unsubscribe(){}}}}}},
 from(table){unlocked();let owner;const q={select(){return q},eq(k,v){if(k==='user_id')owner=v;return q},async single(){const fixture=structuredClone(__f.wallets[owner]);if(fixture.delay)await new Promise(r=>setTimeout(r,fixture.delay));return {data:fixture.missing?null:{balance:fixture.balance},error:fixture.error?{message:'Fixture wallet failure'}:null}}};return q},
 functions:{async invoke(name,{body}){unlocked();__f.calls.push({name,body:structuredClone(body)});if(body.recover&&window.__acceptedFixture)return {data:window.__acceptedFixture,error:null};const failure=__f.failure;if(failure){let payload={...failure};if(!__f.legacy)payload={ok:false,state:'rejected',request_id:body.request_id,no_credits_charged:true,...payload};const context=__f.errorBodyStall?{json:()=>new Promise(()=>{})}:new Response(JSON.stringify(payload),{status:409,headers:{'Content-Type':'application/json'}});return {data:null,error:{name:'FunctionsHttpError',message:'Edge Function returned a non-2xx status code',context}}}return {data:{ok:true,state:'accepted',request_id:body.request_id,balance:__f.wallets[__f.session.user.id].balance-body.stake,wager:{id:'fixture-ticket',stake:body.stake,potential_return:body.stake*2}},error:null}}}};
}`;
function matchup(live=false){return {id:'fixture-event',commence_time:new Date(Date.now()+(live?-60000:3600000)).toISOString(),home_team:'Fixture Home',away_team:'Fixture Away',bookmakers:[{markets:[{key:'h2h',outcomes:[{name:'Fixture Home',price:100},{name:'Fixture Away',price:110}]}]}]}}
test.before(async()=>{server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']})});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r))});
async function open(t,{sdkFailures=0,sdkDependencyFailures=0,wallet=100,live=false,liveFailure=false,states=[],empty=''}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});t.after(()=>disposeContext(context));
 await context.addInitScript(({wallet,liveFailure,states,empty})=>{const session=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});window.__session=session;window.__f={session:session('A'),callbacks:[],authLock:false,wallets:{A:{balance:wallet},B:{balance:500}},calls:[],failure:null,legacy:false,liveFailure,states,empty};const nativeInterval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===15000)__f.liveTick=fn;return nativeInterval(fn,ms,...args)};window.__emit=s=>{__f.session=s;__f.authLock=true;try{for(const cb of __f.callbacks)cb(s?'SIGNED_IN':'SIGNED_OUT',s)}finally{__f.authLock=false}}},{wallet,liveFailure,states,empty});
 await context.route('https://**/*',r=>r.abort());
 let sdkRequests=0,dependencyRequests=0;
 await context.route('https://cdn.jsdelivr.net/**',r=>{if(r.request().url().includes('fixture-sdk-dependency.js')){dependencyRequests++;return dependencyRequests<=sdkDependencyFailures?r.abort():r.fulfill({contentType:'text/javascript',body:'export const ready=true;'})}sdkRequests++;return sdkRequests<=sdkFailures?r.abort():r.fulfill({contentType:'text/javascript',body:(sdkDependencyFailures?"import './fixture-sdk-dependency.js';\n":'')+sdk})});
 await context.route('https://qsvrvhcklnsbekxblpfo.supabase.co/**',async r=>{const b=r.request().postDataJSON(),f=await r.request().frame().evaluate(()=>({liveFailure:__f.liveFailure,states:__f.states,empty:__f.empty,delay:__f.liveDelay||0}));let data;if(b.mode==='sports')data={sports:[{key:'nfl',group:'Football',title:'NFL',active:true}]};else if(b.mode==='games')data={games:[matchup(live)]};else if(b.mode==='events')data={events:f.empty==='events'?[]:[matchup()]};else if(b.mode==='prop_markets')data={prop_markets:f.empty==='markets'?[]:['player_pass_yds']};else if(b.mode==='props')data={event:{...matchup(),bookmakers:[{markets:[{key:'player_pass_yds',outcomes:f.empty==='outcomes'?[]:[{name:'Over',description:'Fixture Player',point:250.5,price:-110}]}]}]}};else{if(f.delay)await new Promise(resolve=>setTimeout(resolve,f.delay));if(f.liveFailure){await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture live state unavailable'})});return}data={states:f.states}}await r.fulfill({contentType:'application/json',body:JSON.stringify(data)})});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/gameday-sportsbook.html'+(live?'?view=live':''));
 await p.locator(sdkFailures||sdkDependencyFailures?'#retryConnection':'.odd').first().waitFor();t.after(()=>assert.deepEqual(errors,[],'no JS errors or auth callback lock re-entry'));
 return {p,context,get sdkRequests(){return sdkRequests}};
}
async function prepare(p,amount='10'){await p.locator('.odd').first().click();await p.click('#openSlip');await p.fill('#stake',amount)}
async function rejection(p){await p.waitForFunction(()=>document.querySelector('#slipMsg').textContent.includes('No credits were charged'))}

test('fixture teardown drains an in-flight route before closing its frame',async t=>{
 const {p,context}=await open(t);let release,entered,draining,timeout,cleanupDone=false,completedMarker;
 const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),drainStarted=new Promise(resolve=>draining=resolve);
 const unrouteAll=context.unrouteAll.bind(context);context.unrouteAll=options=>{assert.deepEqual(options,{behavior:'wait'});draining();return unrouteAll(options)};
 await context.route(base+'/fixture/teardown',async route=>{
  entered();await gate;
  completedMarker=await route.request().frame().evaluate(()=>window.__teardownMarker);
  await route.fulfill({contentType:'application/json',body:JSON.stringify({marker:completedMarker})});
 });
 await p.evaluate(()=>{window.__teardownMarker='frame still alive';void fetch('/fixture/teardown').catch(()=>{})});await started;
 const cleanup=disposeContext(context).then(()=>cleanupDone=true);
 try{
  await Promise.race([drainStarted,cleanup.then(()=>{throw Error('Frame closed before route drain started')}),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Route drain never started')),3000))]);
  assert.equal(cleanupDone,false);assert.equal(p.isClosed(),false);
 }finally{clearTimeout(timeout);release()}
 await cleanup;assert.equal(completedMarker,'frame still alive');assert.equal(p.isClosed(),true);
});

test('SDK failure has a retry, blocks wagers, clears checking state and recovers once',async t=>{
 const h=await open(t,{sdkFailures:1}),{p}=h;assert.match(await p.locator('#account').textContent(),/Connection unavailable/);assert.match(await p.locator('#balance').textContent(),/unavailable/i);assert.equal(await p.locator('#slipBalance').textContent(),'Unavailable');assert(await p.locator('#place').isDisabled());
 await p.click('#retryConnection');await p.locator('.odd').first().waitFor();assert.equal(await p.locator('#balance').textContent(),'Balance: $100.00');assert.equal(h.sdkRequests,2);assert.equal(await p.evaluate(()=>__f.callbacks.length),1);await prepare(p);await p.click('#place');await p.locator('.success').waitFor();assert.equal(await p.evaluate(()=>__f.calls.length),1);
});
test('repeated SDK failure stays recoverable without permanent Connecting text',async t=>{
 const {p}=await open(t,{sdkFailures:2});await p.click('#retryConnection');await p.waitForFunction(()=>document.querySelector('#retryConnection')?.disabled===false);assert.match(await p.locator('#status').textContent(),/Connection unavailable/);await p.click('#retryConnection');await p.locator('.odd').first().waitFor();assert.equal(await p.evaluate(()=>__f.callbacks.length),1);
});
test('account switch clears available balance synchronously and ignores late former read',async t=>{
 const {p}=await open(t);await p.evaluate(()=>{__f.wallets.A.delay=300});await p.click('#refresh');
 const snapshot=await p.evaluate(()=>{__f.wallets.B.delay=100;__emit(__session('B'));return {account:account.textContent,balance:balance.textContent,available:slipBalance.textContent}});
 assert.equal(snapshot.account,'B@example.invalid');assert.equal(snapshot.available,'—');assert(!snapshot.balance.includes('$100'));await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance: $500.00');await p.waitForTimeout(350);assert.equal(await p.locator('#slipBalance').textContent(),'$500.00');
});
test('failed or missing wallet read does not retain a former amount or invent zero',async t=>{
 const {p}=await open(t);await p.evaluate(()=>{__f.wallets.B={balance:500,error:true};__emit(__session('B'))});await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance unavailable');assert.equal(await p.locator('#slipBalance').textContent(),'—');assert(await p.locator('#place').isDisabled());
 await p.evaluate(()=>{__f.wallets.B={missing:true}});await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance unavailable');assert.equal(await p.locator('#slipBalance').textContent(),'—');assert.equal(await p.evaluate(()=>__f.calls.length),0);
});
for(const value of [null,'',false,-1,'invalid'])test('invalid wallet value '+JSON.stringify(value)+' remains unavailable, never false zero',async t=>{
 const {p}=await open(t);await p.evaluate(value=>{__f.wallets.B={balance:value};__emit(__session('B'))},value);await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance unavailable');assert.equal(await p.locator('#slipBalance').textContent(),'—');assert(await p.locator('#place').isDisabled());
});
test('genuine zero balance remains a valid displayed zero',async t=>{const {p}=await open(t,{wallet:0});assert.equal(await p.locator('#balance').textContent(),'Balance: $0.00');assert.equal(await p.locator('#slipBalance').textContent(),'$0.00');await prepare(p,'0.01');await p.click('#place');assert.match(await p.locator('#slipMsg').textContent(),/Insufficient/);assert.equal(await p.evaluate(()=>__f.calls.length),0)});
test('real FunctionsHttpError body explains changed odds and the current line',async t=>{
 const {p}=await open(t);await prepare(p);await p.evaluate(()=>__f.failure={code:'LINE_CHANGED',error:'The odds changed after you selected this line.',current_line:{point:3.5,american_odds:-120}});await p.click('#place');await rejection(p);
 const text=await p.locator('#slipMsg').textContent();assert.match(text,/odds changed/);assert.match(text,/Current line: 3.5 -120/);assert.match(text,/Remove and reselect/);assert(!text.includes('non-2xx'));assert(await p.locator('#stake').isEnabled());assert.equal(await p.locator('#balance').textContent(),'Balance: $100.00');
});
test('real FunctionsHttpError body explains a suspended market',async t=>{
 const {p}=await open(t);await prepare(p);await p.evaluate(()=>__f.failure={code:'LINE_SUSPENDED',error:'This market is currently suspended.'});await p.click('#place');await rejection(p);assert.match(await p.locator('#slipMsg').textContent(),/currently suspended/);assert.match(await p.locator('#slipMsg').textContent(),/Remove.*refresh/);assert(await p.locator('#stake').isEnabled());
});
test('legacy rejection details remain useful while unresolved identity stays locked',async t=>{
 const {p}=await open(t);await prepare(p);await p.evaluate(()=>{__f.legacy=true;__f.failure={code:'LINE_CHANGED',error:'The line changed after you selected it.',current_line:{point:2.5,american_odds:105}}});await p.click('#place');await p.waitForFunction(()=>document.querySelector('#place').textContent==='Check Wager');assert.match(await p.locator('#slipMsg').textContent(),/line changed/);assert.match(await p.locator('#slipMsg').textContent(),/2.5 \+105/);assert(await p.locator('#stake').isDisabled());assert.match(await p.locator('#slipMsg').textContent(),/result is not yet confirmed/);
});
test('failed or empty live-state response does not claim a connected score feed',async t=>{
 const {p}=await open(t,{live:true,liveFailure:true});assert.match(await p.locator('.game-state').textContent(),/score and clock unavailable/);assert(!await p.locator('#content').textContent().then(s=>s.includes('feed connected')));assert(!await p.locator('#status').textContent().then(s=>s.includes('clock ticks live')));
 await p.evaluate(()=>__f.liveFailure=false);await p.click('#refresh');await p.locator('.game-state').waitFor();assert.match(await p.locator('.game-state').textContent(),/score and clock unavailable/);
});
test('verified live period/clock shows real values and clearing the feed removes them',async t=>{
 const states=[{home_key:'fixture home',away_key:'fixture away',home_team:'Fixture Home',away_team:'Fixture Away',home_score:21,away_score:14,period:'Q3',clock:'05:32'}];const {p}=await open(t,{live:true,states});assert.match(await p.locator('.game-state').textContent(),/Q3.*05:32/);assert.equal(await p.locator('.score').first().textContent(),'14');
 await p.evaluate(()=>{__f.liveFailure=true;__f.liveTick()});await p.waitForFunction(()=>document.querySelector('.game-state')?.textContent.includes('unavailable'));assert(!await p.locator('.game-state').textContent().then(s=>s.includes('05:32')));
});
test('stake bounds explain and enforce the service cent precision and cap',async t=>{
 const {p}=await open(t,{wallet:200000});await prepare(p);assert.equal(await p.locator('#stake').getAttribute('min'),'0.01');assert.equal(await p.locator('#stake').getAttribute('max'),'100000');assert.equal(await p.locator('#stake').getAttribute('step'),'0.01');assert.match(await p.locator('#stakeLimits').textContent(),/\$0.01–\$100,000/);
 for(const amount of ['0','0.001','1.001','100000.01']){await p.fill('#stake',amount);await p.click('#place');assert.match(await p.locator('#slipMsg').textContent(),/\$0.01 to \$100,000/)}assert.equal(await p.evaluate(()=>__f.calls.length),0);
 await p.fill('#stake','0.01');await p.click('#place');await p.locator('.success').waitFor();assert.equal(await p.evaluate(()=>__f.calls[0].body.stake),0.01);
});
for(const empty of ['events','markets','outcomes'])test('empty prop '+empty+' gives a useful next step without claiming wagering is available',async t=>{
 const {p}=await open(t,{empty});await p.click('[data-view="props"]');
 if(empty!=='events')await p.locator('[data-event]').click();if(empty==='outcomes')await p.locator('[data-prop]').click();await p.locator('#content .empty').waitFor();
 assert.match(await p.locator('#content .empty').textContent(),/another|Refresh/);assert.equal(await p.locator('#content [data-sel]').count(),0);assert(!await p.locator('#status').textContent().then(s=>s.includes('Test wagering available')));
});

test('Retry resets a cached failed SDK submodule and connects after recovery',async t=>{
 const h=await open(t,{sdkDependencyFailures:1}),{p}=h;assert.match(await p.locator('#status').textContent(),/Connection unavailable/);await p.click('#retryConnection');await p.locator('.odd').first().waitFor();assert.equal(await p.locator('#balance').textContent(),'Balance: $100.00');assert.equal(h.sdkRequests,2);assert.equal(await p.evaluate(()=>__f.callbacks.length),1);
});

test('SDK Retry preserves a committed wager UUID and retrieves its receipt without resubmission',async t=>{
 const h=await open(t,{sdkDependencyFailures:1,wallet:90}),{p,context}=h;
 const requestId='11111111-1111-4111-8111-111111111111';
 const receipt={ok:true,state:'accepted',request_id:requestId,balance:90,wager:{id:'already-accepted-ticket',stake:10,potential_return:20}};
 await context.addInitScript(receipt=>{window.__acceptedFixture=receipt},receipt);
 await p.evaluate(requestId=>{
  const pick={eventId:'fixture-event',event:'Fixture Away @ Fixture Home',sport:'nfl',market:'h2h',marketTitle:'Moneyline',name:'Fixture Home',point:null,price:100,id:'fixture-event|h2h|Fixture Home||',lineStatus:'ok',quotedAt:new Date().toISOString()};
  localStorage.setItem('gameday.sportsbook.pending.v1.A',JSON.stringify({version:1,ownerId:'A',requestId,selections:[pick],payload:{request_id:requestId,wager_type:'single',stake:10,selections:[]},state:'uncertain'}));
 },requestId);
 await p.click('#retryConnection');await p.locator('#slipMsg .success').waitFor();
 assert.match(await p.locator('#slipMsg').textContent(),/already-accepted-ticket/);assert.equal(await p.locator('#balance').textContent(),'Balance: $90.00');
 const calls=await p.evaluate(()=>__f.calls);assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{request_id:requestId,recover:true});
});
test('stalled Edge error response body times out and retains same-ID recovery controls',async t=>{
 const {p}=await open(t);await prepare(p);await p.evaluate(()=>{__f.failure={code:'LINE_CHANGED',error:'Fixture changed line'};__f.errorBodyStall=true;const nativeTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===15000?60:ms,...args)});
 await p.click('#place');await p.waitForFunction(()=>document.querySelector('#place').textContent==='Check Wager'&&!document.querySelector('#place').disabled);
 assert(await p.locator('#stake').isDisabled());assert.match(await p.locator('#slipMsg').textContent(),/not yet confirmed/);assert.equal(await p.evaluate(()=>__f.calls.length),1);
 assert(await p.evaluate(()=>Boolean(JSON.parse(localStorage.getItem('gameday.sportsbook.pending.v1.A')).requestId)));
});
test('older failed live refresh cannot clear a newer successful score and clock',async t=>{
 const states=[{home_key:'fixture home',away_key:'fixture away',home_team:'Fixture Home',away_team:'Fixture Away',home_score:21,away_score:14,period:'Q3',clock:'05:32'}];const {p}=await open(t,{live:true,states});
 await p.evaluate(()=>{__f.liveFailure=true;__f.liveDelay=250;__f.liveTick()});await p.waitForTimeout(25);
 await p.evaluate(()=>{__f.liveFailure=false;__f.liveDelay=0;__f.states[0].period='Q4';__f.states[0].clock='02:21';__f.liveTick()});
 await p.waitForFunction(()=>document.querySelector('.game-state')?.textContent.includes('Q4'));await p.waitForTimeout(300);
 assert.match(await p.locator('.game-state').textContent(),/Q4.*02:21/);assert.equal(await p.locator('.score').first().textContent(),'14');
});
