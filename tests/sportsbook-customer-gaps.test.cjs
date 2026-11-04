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
 functions:{async invoke(name,{body}){unlocked();__f.calls.push({name,body:structuredClone(body)});if(body.recover&&window.__acceptedFixture)return {data:window.__acceptedFixture,error:null};const failure=__f.failure;if(failure){let payload={...failure};if(!__f.legacy)payload={ok:false,state:'rejected',request_id:body.request_id,no_credits_charged:true,...payload};const context=__f.errorBodyStall?{json:()=>new Promise(()=>{})}:new Response(JSON.stringify(payload),{status:409,headers:{'Content-Type':'application/json'}});return {data:null,error:{name:'FunctionsHttpError',message:'Edge Function returned a non-2xx status code',context}}}const wallet=__f.wallets[__f.session.user.id],rr=body.wager_type==='round_robin',k=Number(body.round_robin_legs)||2,n=body.selections.length;let ways=1;if(rr)for(let i=1;i<=k;i++)ways=ways*(n-i+1)/i;const total=body.stake*ways;wallet.balance-=total;const teaser=body.wager_type==='teaser',teaserPrice=teaser?(body.teaser_points===6?-135:-150):null;const decimal=body.selections.reduce((v,s)=>v*(s.american_odds>0?1+s.american_odds/100:1+100/Math.abs(s.american_odds)),1);return {data:{ok:true,state:'accepted',request_id:body.request_id,balance:wallet.balance,wager:{id:'fixture-ticket',stake:total,stake_per_combination:body.stake,combinations:ways,legs_per_combination:k,potential_return:teaser?Math.round(total*(1+100/Math.abs(teaserPrice))*100)/100:rr?Math.round(ways*body.stake*Math.pow(decimal, k/n)*100)/100:Math.round(body.stake*decimal*100)/100,teaser_points:body.teaser_points||null,teaser_american_odds:teaserPrice}},error:null}}}};
}`;
function matchup(live=false,quote={price:-110,point:-3.5}){return {id:'fixture-event',commence_time:new Date(Date.now()+(live?-60000:3600000)).toISOString(),home_team:'Fixture Home',away_team:'Fixture Away',bookmakers:[{markets:[{key:'h2h',outcomes:[{name:'Fixture Home',price:100},{name:'Fixture Away',price:110}]},{key:'spreads',outcomes:[{name:'Fixture Home',price:quote.price,point:quote.point}]}]}]}}
function verifiedLiveState(){return {sport:'nfl',home_key:'fixture home',away_key:'fixture away',home_team:'Fixture Home',away_team:'Fixture Away',home_score:21,away_score:14,period:'Q3',clock:'05:32',period_verified:true,clock_verified:true,clock_kind:'countdown',live:true,completed:false,event_start:new Date(Date.now()-60000).toISOString(),fetched_at:new Date().toISOString(),stale:false}}
test.before(async()=>{server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']})});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r))});
async function open(t,{sdkFailures=0,sdkDependencyFailures=0,wallet=100,live=false,liveFailure=false,states=[],empty='',roundRobinEvents=0,invalidSpreadOdds=false}={}){
 const quotes={price:invalidSpreadOdds?-1:-110,point:-3.5,hold:false,waiters:[]};
 const releaseQuotes=()=>{quotes.hold=false;quotes.waiters.splice(0).forEach(resolve=>resolve())};
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});t.after(()=>{releaseQuotes();return disposeContext(context)});
 await context.addInitScript(({wallet,liveFailure,states,empty})=>{const session=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});window.__session=session;window.__f={session:session('A'),callbacks:[],authLock:false,wallets:{A:{balance:wallet},B:{balance:500}},calls:[],failure:null,legacy:false,liveFailure,states,empty};const nativeInterval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===15000)__f.liveTick=fn;return nativeInterval(fn,ms,...args)};window.__emit=s=>{__f.session=s;__f.authLock=true;try{for(const cb of __f.callbacks)cb(s?'SIGNED_IN':'SIGNED_OUT',s)}finally{__f.authLock=false}}},{wallet,liveFailure,states,empty});
 await context.route('https://**/*',r=>r.abort());
 let sdkRequests=0,dependencyRequests=0;
 await context.route('https://cdn.jsdelivr.net/**',r=>{if(r.request().url().includes('fixture-sdk-dependency.js')){dependencyRequests++;return dependencyRequests<=sdkDependencyFailures?r.abort():r.fulfill({contentType:'text/javascript',body:'export const ready=true;'})}sdkRequests++;return sdkRequests<=sdkFailures?r.abort():r.fulfill({contentType:'text/javascript',body:(sdkDependencyFailures?"import './fixture-sdk-dependency.js';\n":'')+sdk})});
 await context.route('https://qsvrvhcklnsbekxblpfo.supabase.co/**',async r=>{const b=r.request().postDataJSON(),f=await r.request().frame().evaluate(()=>({liveFailure:__f.liveFailure,states:__f.states,empty:__f.empty,delay:__f.liveDelay||0}));let data;if(b.mode==='sports')data={sports:[{key:'nfl',group:'Football',title:'NFL',active:true}]};else if(b.mode==='games'){data={games:[matchup(live,quotes),...Array.from({length:roundRobinEvents},(_,i)=>({id:'fixture-extra-'+i,commence_time:new Date(Date.now()+3600000).toISOString(),home_team:'Fixture Home '+i,away_team:'Fixture Away '+i,bookmakers:[{markets:[{key:'h2h',outcomes:[{name:'Fixture Home '+i,price:100},{name:'Fixture Away '+i,price:110}]},{key:'spreads',outcomes:[{name:'Fixture Home '+i,price:-110,point:-3.5}]}]}]}))]};if(quotes.hold)await new Promise(resolve=>quotes.waiters.push(resolve))}else if(b.mode==='alternate_lines')data={mode:'alternate_lines',source:'live',wagerable:true,event:{id:'fixture-event',bookmakers:f.empty==='alternate_lines'?[]:[{markets:[{key:'alternate_spreads',outcomes:[{name:'Fixture Home',point:-3,price:-125},{name:'Fixture Home',point:-2.5,price:-135},{name:'Fixture Home',point:-2,price:-150},{name:'Fixture Home',point:-1.5,price:-175},{name:'Fixture Home',point:-1,price:-200},{name:'Fixture Away',point:3,price:-120}]},{key:'alternate_totals',outcomes:[{name:'Over',point:42.5,price:-125},{name:'Under',point:43.5,price:-125}]}]}]}};else if(b.mode==='events')data={events:f.empty==='events'?[]:[matchup()]};else if(b.mode==='prop_markets')data={prop_markets:f.empty==='markets'?[]:['player_pass_yds']};else if(b.mode==='props')data={event:{...matchup(),bookmakers:[{markets:[{key:'player_pass_yds',outcomes:f.empty==='outcomes'?[]:[{name:'Over',description:'Fixture Player',point:250.5,price:-110}]}]}]}};else{if(f.delay)await new Promise(resolve=>setTimeout(resolve,f.delay));if(f.liveFailure){await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture live state unavailable'})});return}data={sport:b.sport,fetched_at:new Date().toISOString(),stale:false,states:f.states}}await r.fulfill({contentType:'application/json',body:JSON.stringify(data)})});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/gameday-sportsbook.html'+(live?'?view=live':''));
 await p.locator(sdkFailures||sdkDependencyFailures?'#retryConnection':'.odd').first().waitFor();t.after(()=>assert.deepEqual(errors,[],'no JS errors or auth callback lock re-entry'));
 return {p,context,quotes,releaseQuotes,get sdkRequests(){return sdkRequests}};
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
test('confirmed LINE_CHANGED refreshes a moved spread, blocks another charge and submits only the reviewed quote',async t=>{
 const {p,quotes,releaseQuotes}=await open(t);await p.locator('[data-market="spreads"]').first().click();await prepare(p);
 assert.equal(await p.locator('#return').textContent(),'$19.09');
 Object.assign(quotes,{price:-120,point:-4.5,hold:true});
 await p.evaluate(()=>__f.failure={code:'LINE_CHANGED',error:'The odds changed after you selected this line.',current_line:{point:-4.5,american_odds:-120}});
 await p.click('#place');await rejection(p);await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('REFRESHING'));
 const text=await p.locator('#slipMsg').textContent();assert.match(text,/changed/);assert.match(text,/refreshing.*automatically/i);assert.match(text,/review.*updated payout/i);assert(!text.includes('non-2xx'));
 assert(await p.locator('#place').isDisabled());assert(await p.locator('#stake').isEnabled());assert.equal(await p.locator('#stake').inputValue(),'10');assert.equal(await p.locator('#count').textContent(),'1');
 await p.evaluate(()=>document.querySelector('#place').click());assert.equal(await p.evaluate(()=>__f.calls.length),1);assert.equal(await p.locator('#balance').textContent(),'Balance: $100.00');assert.equal(await p.evaluate(()=>__f.wallets.A.balance),100);
 assert.equal(await p.evaluate(()=>localStorage.getItem('gameday.sportsbook.pending.v1.A')),null);
 releaseQuotes();await p.waitForFunction(()=>document.querySelector('#return').textContent==='$18.33'&&!document.querySelector('#place').disabled);
 assert.match(await p.locator('#slipItems').textContent(),/Fixture Home -4\.5/);assert.match(await p.locator('#slipItems').textContent(),/Spread.*-120/);assert.match(await p.locator('#slipMsg').textContent(),/automatically updated.*Review.*potential return/);
 await p.click('#closeSlip');assert.equal(await p.locator('.odd.selected').count(),1);assert.equal(await p.locator('.odd.selected .odd-point').textContent(),'-4.5');
 await p.locator('.odd.selected').click();assert.equal(await p.locator('#count').textContent(),'0');assert.equal(await p.locator('.odd.selected').count(),0);
 await p.locator('.odd').first().click();assert.equal(await p.locator('#count').textContent(),'1');assert.equal(await p.locator('.odd.selected').count(),1);await p.click('#openSlip');
 assert.equal(await p.locator('#return').textContent(),'$18.33');assert.equal(await p.locator('#stake').inputValue(),'10');assert.equal(await p.evaluate(()=>__f.calls.length),1);
 await p.evaluate(()=>__f.failure=null);await p.click('#place');await p.locator('#slipMsg .success').waitFor();
 const calls=await p.evaluate(()=>__f.calls);assert.equal(calls.length,2);assert.notEqual(calls[0].body.request_id,calls[1].body.request_id);assert.equal(calls[0].body.selections[0].point,-3.5);assert.equal(calls[0].body.selections[0].american_odds,-110);
 assert.equal(calls[1].body.wager_type,'single');assert.equal(calls[1].body.stake,10);assert.equal(calls[1].body.selections.length,1);assert.equal(calls[1].body.selections[0].market_key,'spreads');assert.equal(calls[1].body.selections[0].selection_name,'Fixture Home');assert.equal(calls[1].body.selections[0].point,-4.5);assert.equal(calls[1].body.selections[0].american_odds,-120);
 assert.match(await p.locator('#slipMsg').textContent(),/Potential Return: \$18\.33/);assert.equal(await p.locator('#balance').textContent(),'Balance: $90.00');assert.equal(await p.locator('#count').textContent(),'0');assert.equal(await p.evaluate(()=>__f.wallets.A.balance),90);assert.equal(await p.evaluate(()=>localStorage.getItem('gameday.sportsbook.pending.v1.A')),null);
});
test('real FunctionsHttpError body explains a suspended market',async t=>{
 const {p}=await open(t);await prepare(p);await p.evaluate(()=>__f.failure={code:'LINE_SUSPENDED',error:'This market is currently suspended.'});await p.click('#place');await rejection(p);assert.match(await p.locator('#slipMsg').textContent(),/currently suspended/);assert.match(await p.locator('#slipMsg').textContent(),/Remove.*refresh/);assert(await p.locator('#stake').isEnabled());
});
test('legacy rejection details remain useful while unresolved identity stays locked',async t=>{
 const {p}=await open(t);await prepare(p);await p.evaluate(()=>{__f.legacy=true;__f.failure={code:'LINE_CHANGED',error:'The line changed after you selected it.',current_line:{point:2.5,american_odds:105}}});await p.click('#place');await p.waitForFunction(()=>document.querySelector('#place').textContent==='Check Wager');assert.match(await p.locator('#slipMsg').textContent(),/line changed/);assert.match(await p.locator('#slipMsg').textContent(),/2.5 \+105/);assert(await p.locator('#stake').isDisabled());assert.match(await p.locator('#slipMsg').textContent(),/result is not yet confirmed/);
});
test('failed or empty live-state response shows Time unavailable without claiming a connected score feed',async t=>{
 const {p}=await open(t,{live:true,liveFailure:true});assert.match(await p.locator('.game-state').textContent(),/Time unavailable/);assert.equal(await p.locator('.score').first().textContent(),'—');assert(!await p.locator('#content').textContent().then(s=>s.includes('feed connected')));assert(!await p.locator('#status').textContent().then(s=>s.includes('clock ticks live')));
 await p.evaluate(()=>__f.liveFailure=false);await p.click('#refresh');await p.locator('.game-state').waitFor();assert.match(await p.locator('.game-state').textContent(),/Time unavailable/);assert.equal(await p.locator('.score').first().textContent(),'—');
});
test('verified live period/clock shows real values and clearing the feed removes them',async t=>{
 const states=[verifiedLiveState()];const {p}=await open(t,{live:true,states});assert.match(await p.locator('.game-state').textContent(),/Q3.*05:32/);assert.equal(await p.locator('.score').first().textContent(),'14');
 await p.evaluate(()=>{__f.liveFailure=true;__f.liveTick()});await p.waitForFunction(()=>document.querySelector('.game-state')?.textContent.includes('Time unavailable'));assert(!await p.locator('.game-state').textContent().then(s=>s.includes('05:32')));assert.equal(await p.locator('.score').first().textContent(),'—');
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
 const states=[verifiedLiveState()];const {p}=await open(t,{live:true,states});
 await p.evaluate(()=>{__f.liveFailure=true;__f.liveDelay=250;__f.liveTick()});await p.waitForTimeout(25);
 await p.evaluate(()=>{__f.liveFailure=false;__f.liveDelay=0;__f.states[0].period='Q4';__f.states[0].clock='02:21';__f.states[0].fetched_at=new Date().toISOString();__f.liveTick()});
 await p.waitForFunction(()=>document.querySelector('.game-state')?.textContent.includes('Q4'));await p.waitForTimeout(300);
 assert.match(await p.locator('.game-state').textContent(),/Q4.*02:21/);assert.equal(await p.locator('.score').first().textContent(),'14');
});


test('Three-pick Round Robin uses three 2-leg tickets, previews total cost and supports a single saved request',async t=>{
 const {p}=await open(t,{roundRobinEvents:2});
 await p.locator('.card').nth(0).locator('.odd').first().click();
 await p.locator('.card').nth(1).locator('.odd').first().click();
 await p.locator('.card').nth(2).locator('.odd').first().click();
 await p.click('#openSlip');await p.click('#round_robin');await p.fill('#stake','2');
 assert.match(await p.locator('#roundRobinLegs').inputValue(),/^2$/);
 assert.match(await p.locator('#roundRobinBreakdown').textContent(),/3 combinations.*\$2\.00.*\$6\.00 total/);
 assert.equal(await p.locator('#roundRobinPayoutMode').textContent(),'Round Robin — By 2s · 3 combinations');
 assert.equal(await p.locator('#returnLabel').textContent(),'Max Return (incl. stakes)');
 assert.equal(await p.locator('#totalStake').textContent(),'$6.00');
 assert.equal(await p.locator('#potentialProfit').textContent(),'$18.00');
 assert.match(await p.locator('#roundRobinPayoutNote').textContent(),/includes your original stakes/);
 assert.equal(await p.locator('#roundRobinTicketRows .rr-ticket-entry').count(),3);
 assert.deepEqual(await p.locator('#roundRobinTicketRows .rr-ticket-entry strong').allTextContents(),['$8.00','$8.00','$8.00']);
 assert.equal(await p.locator('#return').textContent(),'$24.00');
 assert(await p.locator('#place').isEnabled());
 await p.click('#place');await p.locator('#slipMsg .success').waitFor();
 const calls=await p.evaluate(()=>__f.calls);
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.wager_type,'round_robin');
 assert.equal(calls[0].body.round_robin_legs,2);
 assert.equal(calls[0].body.stake,2);
 assert.equal(calls[0].body.selections.length,3);
 assert.match(await p.locator('#slipMsg').textContent(),/3.*By 2s.*\$2\.00.*\$6\.00/);
 assert.equal(await p.locator('#balance').textContent(),'Balance: $94.00');
 assert.equal(await p.evaluate(()=>localStorage.getItem('gameday.sportsbook.pending.v1.A')),null);
});
test('Five picks keep 10 combinations but update payout mode next to return when switching By 2s to By 3s',async t=>{
 const {p}=await open(t,{roundRobinEvents:4});
 for(let i=0;i<5;i++)await p.locator('.card').nth(i).locator('.odd').first().click();
 await p.click('#openSlip');await p.click('#round_robin');await p.fill('#stake','1');
 assert.equal(await p.locator('#roundRobinPayoutMode').textContent(),'Round Robin — By 2s · 10 combinations');
 assert.equal(await p.locator('#totalStake').textContent(),'$10.00');
 assert.equal(await p.locator('#return').textContent(),'$40.00');
 assert.equal(await p.locator('#potentialProfit').textContent(),'$30.00');
 await p.locator('#roundRobinLegs').selectOption('3');
 assert.equal(await p.locator('#roundRobinPayoutMode').textContent(),'Round Robin — By 3s · 10 combinations');
 assert.equal(await p.locator('#totalStake').textContent(),'$10.00');
 assert.equal(await p.locator('#return').textContent(),'$80.00');
 assert.equal(await p.locator('#potentialProfit').textContent(),'$70.00');
 assert.equal(await p.locator('#roundRobinTicketRows .rr-ticket-entry').count(),10);
 await p.click('#single');
 assert(await p.locator('#roundRobinPayoutMode').isHidden());
 await p.click('#parlay');
 assert(await p.locator('#roundRobinPayoutMode').isHidden());
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});

test('Four-pick Round Robin changes from six 2-leg tickets to four 3-leg tickets',async t=>{
 const {p}=await open(t,{roundRobinEvents:3});
 for(let i=0;i<4;i++)await p.locator('.card').nth(i).locator('.odd').first().click();
 await p.click('#openSlip');await p.click('#round_robin');await p.fill('#stake','1');
 assert.match(await p.locator('#roundRobinBreakdown').textContent(),/6 combinations.*\$6\.00 total/);
 assert.deepEqual(await p.locator('#roundRobinLegs option').allTextContents(),['By 2s (6 wagers)','By 3s (4 wagers)']);
 await p.locator('#roundRobinLegs').selectOption('3');
 assert.match(await p.locator('#roundRobinBreakdown').textContent(),/4 combinations.*\$4\.00 total/);
 assert.equal(await p.locator('#return').textContent(),'$32.00');
 assert.equal(await p.locator('#totalStake').textContent(),'$4.00');
 assert.equal(await p.locator('#potentialProfit').textContent(),'$28.00');
 assert.equal(await p.locator('#roundRobinTicketRows .rr-ticket-entry').count(),4);
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});
test('A $100 stake per combination visibly means $300 total, not $100 total',async t=>{
 const {p}=await open(t,{roundRobinEvents:2,wallet:500});
 for(let i=0;i<3;i++)await p.locator('.card').nth(i).locator('.odd').first().click();
 await p.click('#openSlip');await p.click('#round_robin');await p.fill('#stake','100');
 assert.equal(await p.locator('#totalStake').textContent(),'$300.00');
 assert.equal(await p.locator('#return').textContent(),'$1200.00');
 assert.equal(await p.locator('#potentialProfit').textContent(),'$900.00');
 assert.equal(await p.locator('#roundRobinTicketRows .rr-ticket-entry').count(),3);
 assert.deepEqual(await p.locator('#roundRobinTicketRows .rr-ticket-entry strong').allTextContents(),['$400.00','$400.00','$400.00']);
 await p.locator('#roundRobinTicketSummary').click();
 assert(await p.locator('#roundRobinTicketDetails').evaluate(e=>e.open));
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});

test('Round Robin blocks the total if combined stake exceeds wallet without sending a wager',async t=>{
 const {p}=await open(t,{roundRobinEvents:2,wallet:5});
 for(let i=0;i<3;i++)await p.locator('.card').nth(i).locator('.odd').first().click();
 await p.click('#openSlip');await p.click('#round_robin');await p.fill('#stake','2');
 assert.equal(await p.locator('#return').textContent(),'$0.00');
 assert.equal(await p.locator('#totalStake').textContent(),'$6.00');
 assert.equal(await p.locator('#potentialProfit').textContent(),'$0.00');
 assert(await p.locator('#roundRobinTicketDetails').isHidden());
 await p.click('#place');
 assert.match(await p.locator('#slipMsg').textContent(),/Insufficient test balance/);
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});

test('Invalid -1 American odds are unavailable to wager instead of showing a false quoted price',async t=>{
 const {p}=await open(t,{invalidSpreadOdds:true});
 await p.locator('[data-market="spreads"]').first().click();
 const button=p.locator('.odd').first();
 assert(await button.isDisabled(),'Invalid price must disable selection');
 assert.match(await button.textContent(),/QUOTE UNAVAILABLE/);
 assert.match(await button.locator('.odd-price').textContent(),/—/);
 assert.equal(await p.locator('#count').textContent(),'0');
 await p.click('#openSlip');
 assert(await p.locator('#place').isDisabled());
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});

test('iPhone bet slip retains a three-column betting-mode row and properly spaced controls in light theme',async t=>{
  const {p}=await open(t,{roundRobinEvents:2});
  for(let i=0;i<3;i++)await p.locator('.card').nth(i).locator('.odd').first().click();
  await p.click('#openSlip');await p.click('#round_robin');await p.fill('#stake','2');
  const layout=await p.evaluate(()=>{
    const box=e=>e.getBoundingClientRect(),tabs=document.querySelector('.tabs'),
      buttons=[...tabs.querySelectorAll('button')].map(box),body=document.querySelector('.panel-body'),
      pick=document.querySelector('.slip-item'),settings=document.querySelector('#roundRobinSettings'),
      stake=document.querySelector('#stake'),place=document.querySelector('#place');
    return {columns:getComputedStyle(tabs).gridTemplateColumns.trim().split(/\s+/).length,display:getComputedStyle(tabs).display,
      tabs:buttons.map(x=>({top:x.top,left:x.left,right:x.right,width:x.width,height:x.height})),
      cardPadding:parseFloat(getComputedStyle(pick).paddingLeft),cardRadius:parseFloat(getComputedStyle(pick).borderTopLeftRadius),
      settingsWidth:box(settings).width,stakeWidth:box(stake).width,placeWidth:box(place).width,
      bodyWidth:box(body).width,documentWidth:document.documentElement.scrollWidth,windowWidth:window.innerWidth};
  });
  assert.equal(layout.display,'grid');assert.equal(layout.columns,3);
  assert(layout.tabs.every(x=>x.height>=40&&x.width>=60));
  assert(layout.tabs.every(x=>Math.abs(x.top-layout.tabs[0].top)<=2),'Tabs must share one horizontal row');
  assert(layout.tabs[0].right<layout.tabs[1].left&&layout.tabs[1].right<layout.tabs[2].left,'Tabs must not overlap');
  assert(layout.cardPadding>=10&&layout.cardRadius>=8,'Each bet must be presented in a padded card');
  assert(layout.stakeWidth>=layout.bodyWidth-60,'Stake input should fill the card');
  assert(layout.placeWidth>=layout.bodyWidth-65,'Wager action should be a full-width tap target');
  assert(layout.documentWidth<=layout.windowWidth+2,'Mobile layout must not overflow horizontally');
  assert.equal(await p.locator('#return').textContent(),'$24.00');
});
test('iPhone Buy Points selector is vertically stacked inside the selected team card',async t=>{
  const {p}=await open(t);
  await p.locator('[data-market="spreads"]').first().click();
  await p.locator('.odd').first().click();
  await p.click('#openSlip');
  await p.locator('.slip-item .buy-points-preview select').waitFor();
  const geometry=await p.evaluate(()=>{
    const b=e=>e.getBoundingClientRect(),wrap=document.querySelector('.slip-item .buy-points-preview'),
      label=wrap.querySelector('label'),select=wrap.querySelector('select'),help=wrap.querySelector('small'),card=document.querySelector('.slip-item');
    return {wrap:b(wrap).toJSON(),label:b(label).toJSON(),select:b(select).toJSON(),help:b(help).toJSON(),
      card:b(card).toJSON(),display:getComputedStyle(wrap).display,selectDisplay:getComputedStyle(select).display};
  });
  assert.equal(geometry.display,'block');assert.equal(geometry.selectDisplay,'block');
  assert(geometry.select.top>=geometry.label.bottom+3,'Select must be below label');
  assert(geometry.help.top>=geometry.select.bottom+3,'Help must be below select');
  assert(geometry.select.width>=geometry.wrap.width-35,'Buy Points selector must span its card');
  assert(geometry.wrap.left>=geometry.card.left&&geometry.wrap.right<=geometry.card.right+1,'Buy Points must not exceed selection card');
});

test('Mobile sportsbook reveals the Buy Points dropdown inline after selecting a spread, without opening the bet slip',async t=>{
 const {p}=await open(t);
 await p.locator('[data-market="spreads"]').first().click();
 await p.locator('.odd').first().click();
 const inline=p.locator('.buy-points-inline select').first();
 await inline.waitFor({state:'visible'});
 assert.equal(await p.locator('#panel').evaluate(panel=>panel.classList.contains('open')),false);
 assert.equal(await p.locator('.buy-points-inline label').first().textContent(),'Buy Points — Fixture Home');
 await p.waitForFunction(()=>document.querySelector('.buy-points-inline select')?.options.length>=3);
 const options=await inline.locator('option').allTextContents();
 assert.match(options[1],/Buy 0.5 point.*-3.*-125/);
 await inline.selectOption('0');
 assert.equal(await p.locator('.buy-points-inline select').inputValue(),'0');
 assert.match(await p.locator('#slipItems').textContent(),/-3/);
 await p.click('#openSlip');
 await p.locator('#buy-points-0').waitFor({state:'visible'});
 assert.equal(await p.locator('#buy-points-0').inputValue(),'0');
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});
test('Buy Points offers only half-point steps through 2.0 points even when farther provider prices exist',async t=>{
 const {p}=await open(t);
 await p.locator('[data-market="spreads"]').first().click();
 await p.locator('.odd').first().click();
 const inline=p.locator('.buy-points-inline select').first();
 await p.waitForFunction(()=>document.querySelector('.buy-points-inline select')?.options.length===5);
 const choices=await inline.locator('option').allTextContents();
 assert.equal(choices.length,5);
 for(const increment of ['0.5','1.0','1.5','2.0'])assert(choices.some(label=>label.includes('Buy '+increment+' point')));
 assert(!choices.some(label=>label.includes('Buy 2.5 points')));
 await inline.selectOption('3');
 assert.match(await p.locator('#slipItems').textContent(),/-1.5/);
 await p.click('#openSlip');
 assert.equal(await p.locator('#buy-points-0').inputValue(),'3');
 assert.equal(await p.locator('#buy-points-0 option').count(),5);
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});
test('Buy Points remains visibly labeled on the game card while quotes are unavailable',async t=>{
 const {p}=await open(t,{empty:'alternate_lines'});
 await p.locator('[data-market="spreads"]').first().click();
 await p.locator('.odd').first().click();
 const inline=p.locator('.buy-points-inline select').first();
 await inline.waitFor({state:'visible'});
 await p.waitForFunction(()=>document.querySelector('.buy-points-inline small')?.textContent.includes('No verified alternate prices'));
 assert.equal(await inline.locator('option').count(),2);
 assert.match(await p.locator('.buy-points-inline').textContent(),/Buy Points/);
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
});
test('Buy Points selects verified half-point spread prices without changing the original wallet charge',async t=>{
 const {p}=await open(t);
 await p.locator('[data-market="spreads"]').first().click();
 await p.locator('.odd').first().click();
 await p.click('#openSlip');
 await p.waitForFunction(()=>document.querySelectorAll('#buy-points-0 option').length>=3);
 const list=await p.locator('#buy-points-0 option').allTextContents();
 assert.match(list[1],/Buy 0.5 point/);
 assert.match(list[1],/-3/);
 assert.match(list[1],/-125/);
 assert.match(list[2],/Buy 1.0 point/);
 await p.fill('#stake','10');
 const originalReturn=await p.locator('#return').textContent();
 await p.locator('#buy-points-0').selectOption('0');
 assert.equal(await p.locator('#buy-points-0').inputValue(),'0');
 assert.match(await p.locator('#slipItems').textContent(),/-3/);
 assert.notEqual(await p.locator('#return').textContent(),originalReturn);
 assert.equal(await p.evaluate(()=>__f.calls.length),0);
 await p.click('#place');
 await p.locator('#slipMsg .success').waitFor();
 const submitted=await p.evaluate(()=>__f.calls[0].body.selections[0]);
 assert.equal(submitted.market_key,'spreads');
 assert.equal(submitted.point,-3);
 assert.equal(submitted.american_odds,-125);
 assert.equal(submitted.buy_points,true);
 assert.equal(submitted.original_point,-3.5);
 assert.equal(await p.evaluate(()=>__f.calls.length),1);
});
test('Buy Points dropdown can revert to the original line without losing the selected team',async t=>{
 const {p}=await open(t);
 await p.locator('[data-market="spreads"]').first().click();
 await p.locator('.odd').first().click();
 await p.click('#openSlip');
 await p.waitForFunction(()=>document.querySelectorAll('#buy-points-0 option').length>=3);
 await p.locator('#buy-points-0').selectOption('0');
 await p.locator('#buy-points-0').selectOption('');
 await p.waitForFunction(()=>document.querySelector('#slipItems')?.textContent.includes('-3.5'));
 await p.fill('#stake','10');
 await p.click('#place');
 await p.locator('#slipMsg .success').waitFor();
 const submitted=await p.evaluate(()=>__f.calls[0].body.selections[0]);
 assert.equal(submitted.point,-3.5);
 assert.equal(submitted.american_odds,-110);
 assert.equal(submitted.buy_points,undefined);
});

test('football Teaser 6/7-point options preview fixed test odds and submit one verified intent',async t=>{
  const {p}=await open(t,{roundRobinEvents:1});
  await p.locator('.card').first().locator('[data-market="spreads"]').click();
  await p.locator('.card').nth(0).locator('.odd').first().click();
  await p.locator('.card').nth(1).locator('.odd').first().click();
  await p.click('#openSlip');
  await p.click('#teaser');
  assert(await p.locator('#teaserSettings').isVisible());
  await p.fill('#stake','10');
  assert.match(await p.locator('#teaserPrice').textContent(),/6 points.*2 legs.*-135/);
  assert.equal(await p.locator('#return').textContent(),'$17.41');
  assert.match(await p.locator('#slipItems').textContent(),/Teaser line: 2.5/);
  await p.locator('#teaserPoints').selectOption('7');
  assert.match(await p.locator('#teaserPrice').textContent(),/7 points.*2 legs.*-150/);
  assert.equal(await p.locator('#return').textContent(),'$16.67');
  assert.match(await p.locator('#slipItems').textContent(),/Teaser line: 3.5/);
  assert(await p.locator('#place').isEnabled());
  await p.click('#place');
  await p.locator('#slipMsg .success').waitFor();
  const calls=await p.evaluate(()=>__f.calls);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'place-test-wager');
  assert.equal(calls[0].body.wager_type,'teaser');
  assert.equal(calls[0].body.teaser_points,7);
  assert.equal(calls[0].body.stake,10);
  assert.deepEqual(calls[0].body.selections.map(x=>x.point),[3.5,3.5]);
  assert.deepEqual(calls[0].body.selections.map(x=>x.teaser_original_point),[-3.5,-3.5]);
  assert(!calls[0].body.selections.some(x=>x.buy_points));
  assert.equal(await p.locator('#balance').textContent(),'Balance: $90.00');
  assert.equal(await p.evaluate(()=>localStorage.getItem('gameday.sportsbook.pending.v1.A')),null);
});

test('football Teaser disallows ineligible moneylines and missing legs without backend calls',async t=>{
  const {p}=await open(t,{roundRobinEvents:1});
  await p.locator('.card').nth(0).locator('.odd').first().click();
  await p.locator('.card').nth(1).locator('.odd').first().click();
  await p.click('#openSlip');await p.click('#teaser');
  await p.fill('#stake','2');
  assert.match(await p.locator('#betModeHelp').textContent(),/original spread or total lines/i);
  assert(await p.locator('#place').isDisabled());
  assert.equal(await p.evaluate(()=>__f.calls.length),0);
  await p.click('#single');
  assert(await p.locator('#teaserSettings').isHidden());
  await p.click('#teaser');
  assert(await p.locator('#place').isDisabled());
});
