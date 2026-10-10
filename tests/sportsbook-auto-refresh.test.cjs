// Exercise the real page with isolated services. No account or wallet is live.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');let browser,server,base;
const sdk=`export function createClient(){
 return {
  auth:{async getSession(){return {data:{session:__f.session},error:null}},onAuthStateChange(cb){__f.callbacks.push(cb);return {data:{subscription:{unsubscribe(){}}}}}},
  from(table){let owner;const q={select(){return q},eq(k,v){if(k==='user_id')owner=v;return q},single(){return __wallet(owner)}};return q},
  functions:{async invoke(name,{body}){return {data:await __invoke({owner:__f.session.user.id,name,body}),error:null}}}
 };
}`;
function game(sport,updated=false){return {id:'event-'+sport,commence_time:new Date(Date.now()+3600000).toISOString(),home_team:sport.toUpperCase()+' Home',away_team:sport.toUpperCase()+' Away',bookmakers:[{markets:[{key:'h2h',outcomes:[{name:sport.toUpperCase()+' Home',price:updated?-120:100},{name:sport.toUpperCase()+' Away',price:110}]},{key:'spreads',outcomes:[{name:sport.toUpperCase()+' Home',price:updated?-120:-110,point:updated?-4.5:-3.5}]}]}]}}
function propEvent(sport,updated=false,missingPlayer=false){return {...game(sport),bookmakers:[{markets:[{key:'player_pass_yds',outcomes:[
 {name:'Over',description:'Other Player',point:300.5,price:500},
 ...(!missingPlayer?[{name:'Over',description:'Chosen Player',point:updated?255.5:250.5,price:updated?-120:-110}]:[])
 ]}]}]}}
test.before(async()=>{
 server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r))});
async function open(t,options={}){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const state={calls:[],queries:[],balances:{A:100,B:500},updated:false,rejectNext:true,held:[],holdQuotes:false,quoteFailure:false,missingPlayer:false,...options};
 const release=()=>{state.holdQuotes=false;state.held.splice(0).forEach(r=>r())};
 t.after(async()=>{release();await context.setOffline(true);await context.unrouteAll({behavior:'wait'});await context.close()});
 await context.addInitScript(()=>{const session=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});window.__session=session;window.__f={session:session('A'),callbacks:[]};window.__emit=s=>{__f.session=s;__f.callbacks.forEach(cb=>cb(s?'SIGNED_IN':'SIGNED_OUT',s))}});
 await context.exposeBinding('__wallet',(_,owner)=>({data:{balance:state.balances[owner]},error:null}));
 await context.exposeBinding('__invoke',(_,call)=>{
  state.calls.push(structuredClone(call));const {body,owner}=call;
  if(state.rejectNext){state.rejectNext=false;state.updated=true;return {ok:false,state:'rejected',request_id:body.request_id,no_credits_charged:true,code:'LINE_CHANGED',error:'The odds changed after you selected this line.',current_line:{point:body.selections[0].market_key==='h2h'?null:255.5,american_odds:-120}}}
  state.balances[owner]-=body.stake;return {ok:true,state:'accepted',request_id:body.request_id,balance:state.balances[owner],wager:{id:'ticket-'+body.request_id,stake:body.stake,potential_return:body.stake*2}};
 });
 await context.route('https://**/*',r=>r.abort());
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await context.route('https://qsvrvhcklnsbekxblpfo.supabase.co/**',async r=>{
  const body=r.request().postDataJSON(),updated=state.updated;state.queries.push({...structuredClone(body),updated});
  if(updated&&state.holdQuotes&&['games','props'].includes(body.mode))await new Promise(resolve=>state.held.push(resolve));
  if(updated&&state.quoteFailure&&['games','props'].includes(body.mode)){await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture quotes unavailable'})});return}
  let data;
  if(body.mode==='sports')data={sports:['nfl','nba'].map(key=>({key,group:'Fixture',title:key,active:true}))};
  else if(body.mode==='games')data={games:[game(body.sport,updated)]};
  else if(body.mode==='events')data={events:[game(body.sport)]};
  else if(body.mode==='prop_markets')data={prop_markets:['player_pass_yds']};
  else if(body.mode==='props')data={event:propEvent(body.sport,updated,updated&&state.missingPlayer)};
  else data={sport:body.sport,fetched_at:new Date().toISOString(),stale:false,states:[]};
  await r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await p.goto(base+'/gameday-sportsbook.html');await p.locator('.odd').first().waitFor();return {p,state,context,release};
}
async function pickProp(p){await p.click('[data-view="props"]');await p.locator('[data-event]').click();await p.locator('[data-prop="player_pass_yds"]').click();await p.locator('.odd').filter({hasText:'Chosen Player'}).click()}
async function showSlip(p){await p.click('#openSlip');await p.fill('#stake','10')}
async function refreshed(p){await p.waitForFunction(()=>!document.querySelector('#place').disabled&&document.querySelector('#slipMsg').textContent.includes('automatically updated'))}

test('LINE_CHANGED refreshes every sport in a parlay without replacing the current board or resubmitting',async t=>{
 const {p,state:s}=await open(t);await p.locator('.odd').first().click();await p.click('[data-sport="nba"]');await p.locator('.odd').first().click();await showSlip(p);await p.click('#place');await refreshed(p);
 assert.equal(s.calls.length,1);assert.equal(s.balances.A,100);assert.equal(await p.locator('#count').textContent(),'2');assert.equal(await p.locator('#return').textContent(),'$33.61');
 assert.match(await p.locator('#slipMsg').textContent(),/odds changed.*Current line: -120.*No credits were charged/);
 assert.deepEqual(s.queries.filter(q=>q.updated&&q.mode==='games').map(q=>q.sport).sort(),['nba','nfl']);assert.match(await p.locator('#content').textContent(),/NBA Home/);assert(!await p.locator('#content').textContent().then(x=>x.includes('NFL Home')));
 await p.click('#place');await p.locator('.success').waitFor();assert.equal(s.calls.length,2);assert.notEqual(s.calls[0].body.request_id,s.calls[1].body.request_id);assert.deepEqual(s.calls[1].body.selections.map(x=>x.american_odds),[-120,-120]);assert.equal(s.calls[1].body.wager_type,'parlay');assert.equal(s.balances.A,90);
});

test('a football prop refreshes its selected player while another sport is displayed',async t=>{
 const {p,state:s}=await open(t);await pickProp(p);await p.click('[data-view="games"]');await p.click('[data-sport="nba"]');await p.locator('.odd').first().waitFor();await showSlip(p);await p.click('#place');await refreshed(p);
 assert.equal(s.calls.length,1);assert.match(await p.locator('#slipItems').textContent(),/Chosen Player|Over 255.5/);assert.match(await p.locator('#slipItems').textContent(),/255.5.*-120/);assert.equal(await p.locator('#return').textContent(),'$18.33');assert.match(await p.locator('#content').textContent(),/NBA Home/);
 assert.deepEqual(s.queries.find(q=>q.updated&&q.mode==='props'),{mode:'props',sport:'nfl',event_id:'event-nfl',markets:['player_pass_yds'],updated:true});
 await p.click('#place');await p.locator('.success').waitFor();const pick=s.calls[1].body.selections[0];assert.equal(pick.description,'Chosen Player');assert.equal(pick.point,255.5);assert.equal(pick.american_odds,-120);assert.equal(s.balances.A,90);
});

test('a missing player stays unavailable even when another player has the same Over outcome',async t=>{
 const {p,state:s}=await open(t,{missingPlayer:true});await pickProp(p);await showSlip(p);await p.click('#place');await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('SUSPENDED'));
 assert(await p.locator('#place').isDisabled());assert.equal(s.calls.length,1);assert.equal(s.balances.A,100);assert.match(await p.locator('#slipItems').textContent(),/250.5.*-110/);assert(!await p.locator('#slipItems').textContent().then(x=>x.includes('300.5')));
});

test('failed prop quotes block a charge and Refresh retries them from a different sport',async t=>{
 const {p,state:s}=await open(t,{quoteFailure:true});await pickProp(p);await p.click('[data-view="games"]');await p.click('[data-sport="nba"]');await p.locator('.odd').first().waitFor();await showSlip(p);await p.click('#place');await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('SUSPENDED'));
 assert(await p.locator('#place').isDisabled());assert.equal(s.calls.length,1);assert.equal(s.balances.A,100);s.quoteFailure=false;await p.click('#closeSlip');await p.click('#refresh');await refreshed(p);assert.match(await p.locator('#content').textContent(),/NBA Home/);assert.match(await p.locator('#slipItems').textContent(),/255.5.*-120/);assert.equal(s.calls.length,1);
});

test('a late quote cannot restore the former account selection or modify the new account',async t=>{
 const {p,state:s,release}=await open(t,{holdQuotes:true});await p.locator('.odd').first().click();await showSlip(p);await p.click('#place');await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('REFRESHING'));
 assert(await p.locator('#place').isDisabled());await p.evaluate(()=>__emit(__session('B')));await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance: $500.00');assert.equal(await p.locator('#count').textContent(),'0');
 await p.click('#closeSlip');await p.locator('.odd').first().click();await showSlip(p);release();await p.waitForTimeout(100);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/\+100/);assert.equal(await p.locator('#slipMsg').textContent(),'');assert.equal(s.calls.length,1);assert.equal(await p.locator('#balance').textContent(),'Balance: $500.00');
});

test('removing and readding a pick prevents its old quote request from repainting it',async t=>{
 const {p,state:s,release}=await open(t,{holdQuotes:true});await p.locator('.odd').first().click();await showSlip(p);await p.click('#place');await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('REFRESHING'));
 await p.locator('[data-remove]').click();assert.equal(await p.locator('#count').textContent(),'0');await p.click('#closeSlip');await p.locator('.odd').first().click();release();await p.waitForTimeout(100);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/\+100/);assert.equal(s.calls.length,1);assert.equal(s.balances.A,100);assert(!await p.locator('#slipMsg').textContent().then(x=>x.includes('Selections were automatically updated')));
});

test('a pre-rejection board response cannot overwrite automatically refreshed lines',async t=>{
 const {p,state:s,context}=await open(t);await p.locator('.odd').first().click();await showSlip(p);let releaseOld,entered;
 const gate=new Promise(r=>releaseOld=r),started=new Promise(r=>entered=r);s.held.push(releaseOld);
 await context.route('https://qsvrvhcklnsbekxblpfo.supabase.co/**',async r=>{const body=r.request().postDataJSON();if(body.mode!=='games'||s.updated)return r.fallback();entered();await gate;await r.fulfill({contentType:'application/json',body:JSON.stringify({games:[game(body.sport,false)]})})});
 // Start a board refresh without changing the customer selection, then reject
 // and refresh that selection while the first response is still in flight.
 await p.evaluate(()=>{void document.querySelector('#refresh').onclick()});await started;await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance: $100.00');await p.click('#place');await refreshed(p);releaseOld();await p.waitForTimeout(100);
 assert.match(await p.locator('#slipItems').textContent(),/-120/);assert.match(await p.locator('#content .odd').first().textContent(),/-120/);assert.equal(s.calls.length,1);assert.equal(await p.locator('#return').textContent(),'$18.33');
});

test('opposing picks remain available while invalid automatic Parlay blocks a charge and Single preserves the other pick',async t=>{
 const {p,state:s}=await open(t,{rejectNext:false});await p.locator('.odd').first().click();await showSlip(p);await p.click('#closeSlip');await p.locator('.odd').nth(1).click();await p.click('#openSlip');
 assert.equal(await p.locator('#count').textContent(),'2');assert.equal(await p.locator('.slip-item').count(),2);assert(await p.locator('#parlay').evaluate(e=>e.classList.contains('active')));assert(await p.locator('#place').isDisabled());assert.equal(await p.locator('#place').textContent(),'Use Different Events');assert.equal(await p.locator('#return').textContent(),'$0.00');assert.match(await p.locator('#betModeHelp').textContent(),/Single/);
 await p.evaluate(()=>document.querySelector('#place').click());assert.equal(s.calls.length,0);assert.equal(s.balances.A,100);await p.click('#single');assert.equal(await p.locator('#count').textContent(),'2');assert.equal(await p.locator('input[name="singlePick"]').count(),2);assert.equal(await p.locator('#return').textContent(),'$20.00');
 await p.click('#place');await p.locator('.success').waitFor();assert.equal(s.calls.length,1);assert.equal(s.calls[0].body.wager_type,'single');assert.equal(s.calls[0].body.selections.length,1);assert.equal(s.calls[0].body.selections[0].selection_name,'NFL Home');assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('.slip-item').textContent(),/NFL Away/);
});
