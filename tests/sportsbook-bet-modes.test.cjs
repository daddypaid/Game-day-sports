// Exercise the customer page and an isolated, idempotent wager ledger.
// Every external request is intercepted; no real accounts or wagers are used.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');let browser,server,base;
const clone=value=>structuredClone(value);
const sdk=`export function createClient(){return {
 auth:{async getSession(){return {data:{session:__f.session},error:null}},onAuthStateChange(cb){__f.callbacks.push(cb);return {data:{subscription:{unsubscribe(){}}}}}},
 from(table){let owner;const q={select(){return q},eq(key,value){if(key==='user_id')owner=value;return q},single(){return __wallet({table,owner})}};return q},
 functions:{async invoke(name,{body}){try{return {data:await __invoke({owner:__f.session?.user.id,name,body}),error:null}}catch(error){return {data:null,error:{message:error.message}}}}}
}}`;
function game(sport,index,options={}){
 const home=`${sport.toUpperCase()} Home ${index}`,away=`${sport.toUpperCase()} Away ${index}`;
 const updated=options.updated&&(options.updatedIndex===undefined||options.updatedIndex===index),initial=options.prices?.[index]??[100,200,-110][index],price=updated?-120:initial;
 return {id:`event-${sport}-${index}`,commence_time:new Date(Date.now()+3600000).toISOString(),home_team:home,away_team:away,bookmakers:[{markets:[
  {key:'h2h',outcomes:options.missing===index?[]:[{name:home,price},{name:away,price:110}]},
  {key:'spreads',outcomes:[{name:home,price:updated?-120:-110,point:updated?-4.5:-3.5}]}
 ]}]};
}
test.before(async()=>{
 server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function open(t,options={}){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const state={balances:{A:100,B:500},calls:[],requests:new Map(),held:[],heldQuotes:[],heldBoards:[],queries:[],missing:null,updated:false,...options};
 const releaseBoard=()=>{state.holdBoardSport=null;state.heldBoards.splice(0).forEach(resolve=>resolve())};
 const releaseQuotes=()=>{state.holdQuotes=false;state.heldQuotes.splice(0).forEach(resolve=>resolve())};
 const release=()=>{state.holdInitial=false;state.held.splice(0).forEach(resolve=>resolve())};
 t.after(async()=>{release();releaseQuotes();releaseBoard();await context.setOffline(true);await context.unrouteAll({behavior:'wait'});await context.close()});
 const commit=record=>{
  if(record.state==='accepted')return clone(record.receipt);
  const {payload,owner}=record;assert.equal(payload.wager_type==='single'?payload.selections.length===1:payload.selections.length>=2,true,'service contract must receive the intended leg count');
  if(payload.wager_type==='parlay')assert.equal(new Set(payload.selections.map(x=>x.event_id.toLowerCase())).size,payload.selections.length,'uncorrelated parlay service contract');
  assert(payload.stake>0&&payload.stake<=state.balances[owner]);state.balances[owner]-=payload.stake;
  const decimal=payload.selections.reduce((n,x)=>n*(x.american_odds>0?1+x.american_odds/100:1+100/Math.abs(x.american_odds)),1);
  // Rounding-edge fixtures supply a fixed receipt expected from PostgreSQL numeric
  // round(stake * decimal_odds, 2), independently of the browser preview algorithm.
  const potentialReturn=state.expectedReturn??Math.round(payload.stake*decimal*100)/100;
  record.state='accepted';record.receipt={ok:true,state:'accepted',request_id:payload.request_id,balance:state.balances[owner],wager:{id:'ticket-'+payload.request_id,stake:payload.stake,potential_return:potentialReturn}};
  return clone(record.receipt);
 };
 await context.exposeBinding('__wallet',(_,{table,owner})=>{assert.equal(table,'wallets');return {data:{balance:state.balances[owner]},error:null}});
 await context.exposeBinding('__acceptedCount',()=>acceptedCount(state));
 await context.exposeBinding('__invoke',async(_,call)=>{
  state.calls.push(clone(call));const {owner,body}=call,key=owner+'|'+body.request_id;assert.match(body.request_id,/^[0-9a-f-]{36}$/);const existing=state.requests.get(key);
  if(body.recover){if(state.recoveryDown)throw Error('Fixture recovery unavailable');if(!existing)return {ok:false,state:'not_found',request_id:body.request_id,retry_same_request:true};return existing.state==='pending'?{ok:false,state:'pending',request_id:body.request_id,retry_same_request:true}:clone(existing.receipt)}
  if(existing){assert.deepEqual(body,existing.payload,'retries must retain the exact frozen payload');return existing.state==='pending'&&state.resumeLease?commit(existing):existing.state==='pending'?{ok:false,state:'pending',request_id:body.request_id,retry_same_request:true}:clone(existing.receipt)}
  if(state.dropBeforeAccept){state.dropBeforeAccept=false;throw Error('Fixture lost request before acceptance')}
  const record={owner,payload:clone(body),state:'pending'};state.requests.set(key,record);
  if(state.rejectNext){state.rejectNext=false;state.updated=true;record.state='rejected';record.receipt={ok:false,state:'rejected',request_id:body.request_id,no_credits_charged:true,code:'LINE_CHANGED',error:'The odds changed after selection.'};return clone(record.receipt)}
  if(state.holdInitial)await new Promise(resolve=>state.held.push(resolve));const receipt=commit(record);if(state.loseInitial){state.loseInitial=false;throw Error('Fixture lost accepted response')}return receipt;
 });
 await context.addInitScript(()=>{const session=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});window.__session=session;window.__f={session:session('A'),callbacks:[]};window.__emit=value=>{__f.session=value;__f.callbacks.forEach(cb=>cb(value?'SIGNED_IN':'SIGNED_OUT',value))}});
 await context.route('https://**/*',route=>route.abort());
 await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
 await context.route('https://qsvrvhcklnsbekxblpfo.supabase.co/**',async route=>{
  const body=route.request().postDataJSON();state.queries.push({...clone(body),updated:state.updated});let data;
  if(body.mode==='games'&&body.sport===state.holdBoardSport)await new Promise(resolve=>state.heldBoards.push(resolve));
  if(body.mode==='games'&&state.updated&&state.holdQuotes)await new Promise(resolve=>state.heldQuotes.push(resolve));
  if(body.mode==='sports')data={sports:['nfl','nba'].map(key=>({key,group:'Fixture',title:key,active:true}))};
  else if(body.mode==='games')data={games:[0,1,2].map(index=>game(body.sport,index,state))};
  else data={sport:body.sport,fetched_at:new Date().toISOString(),stale:false,states:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[],'no JavaScript errors'));
 await p.goto(base+'/gameday-sportsbook.html');await p.locator('.odd').first().waitFor();return {p,state,context,release,releaseQuotes,releaseBoard,commit};
}
async function add(p,index,name){await p.locator('.odd').filter({hasText:name||`NFL Home ${index}`}).first().click()}
async function show(p){await p.click('#openSlip');await p.fill('#stake','10')}
async function mode(p,name){assert(await p.locator('#'+name).evaluate(e=>e.classList.contains('active')))}
async function accepted(p){await p.locator('#slipMsg .success').waitFor()}
const choices=p=>p.locator('input[type="radio"][data-single-pick]');
function submissions(s){return s.calls.filter(x=>!x.body.recover)}
function acceptedCount(s){return [...s.requests.values()].filter(x=>x.state==='accepted').length}
async function waitUnknown(p){await p.waitForFunction(()=>document.querySelector('#place').textContent==='Check Wager'&&!document.querySelector('#place').disabled)}

test('automatic parlay combines all distinct-event picks and a single stake',async t=>{
 const {p,state:s}=await open(t);await add(p,0);await add(p,1);await add(p,2);await show(p);await mode(p,'parlay');
 assert.equal(await p.locator('#count').textContent(),'3');assert.equal(await p.locator('.slip-item').count(),3);assert.equal(await p.locator('#return').textContent(),'$114.55');assert.equal(s.calls.length,0);
 await p.click('#place');await accepted(p);const calls=submissions(s);assert.equal(calls.length,1);assert.equal(calls[0].body.wager_type,'parlay');assert.equal(calls[0].body.stake,10);
 assert.deepEqual(calls[0].body.selections.map(x=>({event:x.event_id,name:x.selection_name,odds:x.american_odds})),[0,1,2].map(index=>({event:'event-nfl-'+index,name:'NFL Home '+index,odds:[100,200,-110][index]})));
 assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);assert.equal(await p.locator('#count').textContent(),'0');assert.equal(await p.locator('.odd.selected').count(),0);
});

test('Single preserves three picks, uses only the chosen payout and removes only the accepted choice',async t=>{
 const {p,state:s}=await open(t);for(const index of [0,1,2])await add(p,index);await show(p);await p.click('#single');await mode(p,'single');
 assert.equal(await choices(p).count(),3);await choices(p).nth(1).check();assert.equal(await p.locator('#return').textContent(),'$30.00');assert.equal(await p.locator('#count').textContent(),'3');
 assert.match(await p.locator('#betModeHelp').textContent(),/single|individual|only/i);
 await p.click('#place');await accepted(p);const calls=submissions(s);assert.equal(calls.length,1);assert.equal(calls[0].body.wager_type,'single');assert.equal(calls[0].body.stake,10);assert.equal(calls[0].body.selections.length,1);assert.equal(calls[0].body.selections[0].event_id,'event-nfl-1');
 assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);assert.match(await p.locator('#slipMsg').textContent(),/Potential Return: \$30\.00/);assert.equal(await p.locator('#count').textContent(),'2');await mode(p,'single');
 const remaining=await p.locator('#slipItems').textContent();assert.match(remaining,/NFL Home 0/);assert.match(remaining,/NFL Home 2/);assert(!remaining.includes('NFL Home 1'));assert.equal(await p.locator('.odd.selected').count(),2);
 await p.fill('#stake','7');assert.equal(await p.locator('#return').textContent(),'$14.00');await p.click('#place');await accepted(p);
 assert.equal(submissions(s).length,2);assert.equal(submissions(s)[1].body.selections[0].event_id,'event-nfl-0');assert.equal(s.balances.A,83);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/NFL Home 2/);
});

test('switching Single to Parlay and back retains every saved pick and the chosen individual',async t=>{
 const {p,state:s}=await open(t);await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();assert.equal(await p.locator('#return').textContent(),'$30.00');
 await p.click('#parlay');await mode(p,'parlay');assert.equal(await p.locator('#return').textContent(),'$60.00');assert.equal(await p.locator('#count').textContent(),'2');
 await p.click('#single');await mode(p,'single');assert(await choices(p).nth(1).isChecked());assert.equal(await p.locator('#return').textContent(),'$30.00');assert.equal(await p.locator('.slip-item').count(),2);assert.equal(s.calls.length,0);assert.equal(s.balances.A,100);
});

test('explicit Single survives amount changes, adding another pick, account reads and removing an unchosen pick',async t=>{
 const {p,state:s}=await open(t);await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.fill('#stake','12');
 await p.click('#closeSlip');await add(p,2);await p.click('#openSlip');await mode(p,'single');assert(await choices(p).nth(1).isChecked());assert.equal(await p.locator('#return').textContent(),'$36.00');
 await p.locator('[data-remove]').first().click();await mode(p,'single');assert.equal(await p.locator('#count').textContent(),'2');assert(await choices(p).first().isChecked());assert.equal(await p.locator('#return').textContent(),'$36.00');
 await p.click('#closeSlip');await p.click('#refresh');await p.locator('.odd').first().waitFor();await p.click('#openSlip');await mode(p,'single');assert(await choices(p).first().isChecked());assert.equal(await p.locator('#return').textContent(),'$36.00');assert.equal(s.calls.length,0);
});

test('removing the chosen individual selects the next saved pick and an empty slip cannot charge',async t=>{
 const {p,state:s}=await open(t);await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.locator('[data-remove]').nth(1).click();
 await mode(p,'single');assert.equal(await p.locator('#count').textContent(),'1');assert(await choices(p).first().isChecked());assert.equal(await p.locator('#return').textContent(),'$20.00');
 await p.locator('[data-remove]').first().click();assert.equal(await p.locator('#count').textContent(),'0');assert.equal(await p.locator('#return').textContent(),'$0.00');await p.evaluate(()=>document.querySelector('#place').click());assert.equal(s.calls.length,0);assert.equal(s.balances.A,100);
});

test('explicit Parlay with one retained pick blocks placement until the customer switches to Single',async t=>{
 const {p,state:s}=await open(t);await add(p,0);await add(p,1);await show(p);await p.click('#parlay');await p.locator('[data-remove]').nth(1).click();await mode(p,'parlay');
 assert(await p.locator('#place').isDisabled());assert.equal(await p.locator('#return').textContent(),'$0.00');await p.evaluate(()=>document.querySelector('#place').click());assert.equal(s.calls.length,0);
 await p.click('#single');assert(await p.locator('#place').isEnabled());assert.equal(await p.locator('#return').textContent(),'$20.00');await p.click('#place');await accepted(p);assert.equal(s.balances.A,90);assert.equal(submissions(s)[0].body.selections.length,1);
});

test('same-event picks stay saved, block Parlay and can each be wagered individually',async t=>{
 const {p,state:s}=await open(t);await p.locator('.odd').nth(0).click();await p.locator('.odd').nth(1).click();await show(p);await mode(p,'parlay');assert.equal(await p.locator('#count').textContent(),'2');assert.equal(await p.locator('.slip-item').count(),2);
 assert(await p.locator('#place').isDisabled());assert.equal(await p.locator('#return').textContent(),'$0.00');await p.evaluate(()=>document.querySelector('#place').click());assert.equal(s.calls.length,0);
 await p.click('#single');await choices(p).nth(1).check();assert.equal(await p.locator('#return').textContent(),'$21.00');await p.click('#place');await accepted(p);assert.equal(submissions(s)[0].body.selections[0].selection_name,'NFL Away 0');assert.equal(submissions(s)[0].body.selections.length,1);assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'1');
 await p.fill('#stake','10');await p.click('#place');await accepted(p);assert.equal(submissions(s)[1].body.selections[0].selection_name,'NFL Home 0');assert.equal(s.balances.A,80);assert.equal(acceptedCount(s),2);
});

test('an unchosen suspended pick does not block a valid Single, while choosing it prevents a charge',async t=>{
 const {p,state:s}=await open(t);await add(p,0);await add(p,1);await show(p);await p.click('#single');s.missing=1;
 await p.evaluate(()=>document.querySelector('#refresh').click());await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('SUSPENDED'));
 assert.equal(await p.locator('#count').textContent(),'2');assert(await choices(p).first().isChecked());assert(await p.locator('#place').isEnabled());assert.equal(await p.locator('#return').textContent(),'$20.00');
 await choices(p).nth(1).check();assert(await p.locator('#place').isDisabled());assert.equal(await p.locator('#return').textContent(),'$0.00');await p.evaluate(()=>document.querySelector('#place').click());assert.equal(s.calls.length,0);
 await choices(p).first().check();await p.click('#place');await accepted(p);assert.equal(submissions(s)[0].body.selections[0].event_id,'event-nfl-0');assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/NFL Home 1.*SUSPENDED/s);
});

test('a moved spread keeps the chosen Single identity while refreshing only that ticket',async t=>{
 const {p,state:s}=await open(t,{rejectNext:true});await add(p,0);await p.locator('[data-market="spreads"]').nth(1).click();await p.locator('.odd').filter({hasText:'NFL Home 1'}).first().click();await show(p);await p.click('#single');await choices(p).nth(1).check();assert.equal(await p.locator('#return').textContent(),'$19.09');
 const before=await p.locator('#slipItems [data-remove]').nth(1).getAttribute('data-remove');assert.equal(before,'1');await p.click('#place');
 await p.waitForFunction(()=>!document.querySelector('#place').disabled&&document.querySelector('#slipMsg').textContent.includes('automatically updated'));
 await mode(p,'single');assert(await choices(p).nth(1).isChecked());assert.equal(await p.locator('#count').textContent(),'2');assert.equal(await p.locator('#return').textContent(),'$18.33');assert.match(await p.locator('.slip-item').nth(1).textContent(),/NFL Home 1.*-4\.5.*-120/s);
 assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);await p.click('#place');await accepted(p);const pick=submissions(s)[1].body.selections[0];assert.equal(pick.event_id,'event-nfl-1');assert.equal(pick.point,-4.5);assert.equal(pick.american_odds,-120);assert.equal(submissions(s)[1].body.selections.length,1);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/NFL Home 0/);assert.equal(s.balances.A,90);
});

test('pending Single locks the full slip and reload retries only its immutable chosen ticket',async t=>{
 const {p,state:s}=await open(t,{dropBeforeAccept:true});for(const index of [0,1,2])await add(p,index);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.click('#place');await waitUnknown(p);
 const initial=clone(submissions(s)[0].body),saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('gameday.sportsbook.pending.v1.A')));
 assert.equal(saved.version,2);assert.equal(saved.payload.wager_type,'single');assert.equal(saved.payload.selections.length,1);assert.equal(saved.selections.length,1);assert.equal(saved.slipSelections.length,3);assert.equal(saved.modePreference,'single');assert.equal(saved.singlePickKey,saved.selections[0].pickKey);
 for(const selector of ['#single','#parlay','#stake','[data-remove]','input[data-single-pick]'])assert(await p.locator(selector).first().isDisabled());
 await p.evaluate(()=>{document.querySelector('#parlay').click();document.querySelectorAll('[data-single-pick]')[2].click();document.querySelectorAll('[data-remove]')[0].click()});assert.equal(await p.locator('#count').textContent(),'3');assert(await choices(p).nth(1).isChecked());assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);
 await p.reload();await p.waitForFunction(()=>document.querySelector('#place').textContent==='Retry This Wager'&&!document.querySelector('#place').disabled);
 await mode(p,'single');assert.equal(await p.locator('#count').textContent(),'3');assert(await choices(p).nth(1).isChecked());assert.equal(await p.locator('#stake').inputValue(),'10');assert(await choices(p).first().isDisabled());
 await p.click('#place');await accepted(p);const sends=submissions(s);assert.equal(sends.length,2);assert.deepEqual(sends[1].body,initial);assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);assert.equal(await p.locator('#count').textContent(),'2');
 const remaining=await p.locator('#slipItems').textContent();assert.match(remaining,/NFL Home 0/);assert.match(remaining,/NFL Home 2/);assert(!remaining.includes('NFL Home 1'));assert.equal(await p.evaluate(()=>localStorage.getItem('gameday.sportsbook.pending.v1.A')),null);
});

test('a lost accepted Single response reloads all saved picks and recovery removes only the paid choice',async t=>{
 const {p,state:s}=await open(t,{loseInitial:true,recoveryDown:true});for(const index of [0,1,2])await add(p,index);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.click('#place');await waitUnknown(p);
 assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);const requestId=submissions(s)[0].body.request_id;await p.reload();await waitUnknown(p);
 await mode(p,'single');assert.equal(await p.locator('#count').textContent(),'3');assert(await choices(p).nth(1).isChecked());assert(await choices(p).first().isDisabled());assert.equal(await p.locator('#return').textContent(),'$30.00');
 s.recoveryDown=false;await p.click('#place');await accepted(p);assert.equal(submissions(s).length,1);assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);assert.match(await p.locator('#slipMsg').textContent(),new RegExp('ticket-'+requestId));assert.equal(await p.locator('#count').textContent(),'2');await mode(p,'single');
 assert.match(await p.locator('#slipItems').textContent(),/NFL Home 0.*NFL Home 2/s);assert(!await p.locator('#slipItems').textContent().then(value=>value.includes('NFL Home 1')));
});

test('a legacy version-one pending Single remains recoverable without new slip metadata',async t=>{
 const {p,state:s}=await open(t,{dropBeforeAccept:true});await add(p,0);await show(p);await p.click('#place');await waitUnknown(p);
 const original=clone(submissions(s)[0].body);await p.evaluate(()=>{const key='gameday.sportsbook.pending.v1.A',saved=JSON.parse(localStorage.getItem(key));const legacy={version:1,ownerId:saved.ownerId,requestId:saved.requestId,payload:saved.payload,selections:saved.selections,createdAt:saved.createdAt,state:saved.state};legacy.selections.forEach(x=>delete x.pickKey);localStorage.setItem(key,JSON.stringify(legacy))});
 await p.reload();await p.waitForFunction(()=>document.querySelector('#place').textContent==='Retry This Wager'&&!document.querySelector('#place').disabled);await mode(p,'single');assert.equal(await p.locator('#count').textContent(),'1');
 await p.click('#place');await accepted(p);assert.deepEqual(submissions(s)[1].body,original);assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);assert.equal(await p.locator('#count').textContent(),'0');
});

test('switching accounts clears saved selections and prevents a late Single receipt from repainting the other customer',async t=>{
 const {p,state:s,release}=await open(t,{holdInitial:true});await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.click('#place');await p.waitForFunction(()=>document.querySelector('#place').disabled);
 await p.evaluate(()=>__emit(__session('B')));await p.waitForFunction(()=>document.querySelector('#balance').textContent==='Balance: $500.00');assert.equal(await p.locator('#count').textContent(),'0');assert.equal(await p.locator('#slipMsg').textContent(),'');assert.equal(await choices(p).count(),0);
 release();await p.waitForFunction(async()=>await __acceptedCount()===1);assert.equal(s.balances.A,90);assert.equal(s.balances.B,500);assert.equal(await p.locator('#slipBalance').textContent(),'$500.00');assert.equal(await p.locator('#count').textContent(),'0');assert.equal(await p.locator('#slipMsg').textContent(),'');
 await p.click('#closeSlip');await add(p,0);await add(p,1);await p.click('#openSlip');await mode(p,'parlay');assert.equal(await p.locator('#count').textContent(),'2');assert.equal(submissions(s).length,1);
});

test('changing the chosen Single while its rejected quote refresh is in flight cannot replace the new ticket',async t=>{
 const {p,state:s,releaseQuotes}=await open(t,{rejectNext:true,holdQuotes:true,updatedIndex:1});await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.click('#place');
 await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('REFRESHING'));assert(await p.locator('#place').isDisabled());assert.equal(s.balances.A,100);await choices(p).first().check();
 assert(await p.locator('#place').isEnabled());assert.equal(await p.locator('#return').textContent(),'$20.00');assert.equal(submissions(s).length,1);
 releaseQuotes();await p.waitForTimeout(75);assert(await choices(p).first().isChecked());assert.equal(await p.locator('#return').textContent(),'$20.00');assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);
 await p.click('#place');await accepted(p);const acceptedPick=submissions(s)[1].body.selections;assert.equal(acceptedPick.length,1);assert.equal(acceptedPick[0].event_id,'event-nfl-0');assert.equal(acceptedPick[0].american_odds,100);assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/NFL Home 1/);
});

test('a legacy version-one pending Parlay retains both immutable legs through reload and retry',async t=>{
 const {p,state:s}=await open(t,{dropBeforeAccept:true});await add(p,0);await add(p,1);await show(p);await p.click('#place');await waitUnknown(p);const original=clone(submissions(s)[0].body);
 await p.evaluate(()=>{const key='gameday.sportsbook.pending.v1.A',saved=JSON.parse(localStorage.getItem(key));const legacy={version:1,ownerId:saved.ownerId,requestId:saved.requestId,payload:saved.payload,selections:saved.selections,createdAt:saved.createdAt,state:saved.state};legacy.selections.forEach(x=>delete x.pickKey);localStorage.setItem(key,JSON.stringify(legacy))});
 await p.reload();await p.waitForFunction(()=>document.querySelector('#place').textContent==='Retry This Wager'&&!document.querySelector('#place').disabled);await mode(p,'parlay');assert.equal(await p.locator('#count').textContent(),'2');assert.equal(await p.locator('#return').textContent(),'$60.00');
 await p.click('#place');await accepted(p);assert.deepEqual(submissions(s)[1].body,original);assert.equal(submissions(s)[1].body.selections.length,2);assert.equal(s.balances.A,90);assert.equal(acceptedCount(s),1);assert.equal(await p.locator('#count').textContent(),'0');
});

test('returning to an individual whose old quote refresh was cancelled retries its current quote without another wager',async t=>{
 const {p,state:s,releaseQuotes}=await open(t,{rejectNext:true,holdQuotes:true,updatedIndex:1});await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.click('#place');
 await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('REFRESHING'));await choices(p).first().check();assert(await p.locator('#place').isEnabled());assert.equal(await p.locator('#return').textContent(),'$20.00');
 await choices(p).nth(1).check();assert(await p.locator('#place').isDisabled());assert.equal(await p.locator('#return').textContent(),'$0.00');assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);
 releaseQuotes();await p.waitForFunction(()=>document.querySelector('#return').textContent==='$18.33'&&!document.querySelector('#place').disabled);assert(await choices(p).nth(1).isChecked());assert.equal(s.queries.filter(x=>x.mode==='games'&&x.updated).length,2);assert.equal(submissions(s).length,1);
 await p.click('#place');await accepted(p);assert.equal(submissions(s)[1].body.selections.length,1);assert.equal(submissions(s)[1].body.selections[0].event_id,'event-nfl-1');assert.equal(submissions(s)[1].body.selections[0].american_odds,-120);assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/NFL Home 0/);
});

test('removing the chosen refreshing individual restores the valid fallback and ignores the removed quote response',async t=>{
 const {p,state:s,releaseQuotes}=await open(t,{rejectNext:true,holdQuotes:true,updatedIndex:1});await add(p,0);await add(p,1);await show(p);await p.click('#single');await choices(p).nth(1).check();await p.click('#place');
 await p.waitForFunction(()=>document.querySelector('#slipItems').textContent.includes('REFRESHING'));await p.locator('[data-remove]').nth(1).click();assert.equal(await p.locator('#count').textContent(),'1');await mode(p,'single');assert(await choices(p).first().isChecked());assert(await p.locator('#place').isEnabled());assert.equal(await p.locator('#return').textContent(),'$20.00');
 releaseQuotes();await p.waitForTimeout(75);assert.equal(await p.locator('#count').textContent(),'1');assert(!await p.locator('#slipItems').textContent().then(value=>value.includes('NFL Home 1')));assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);
 await p.click('#place');await accepted(p);assert.equal(submissions(s)[1].body.selections.length,1);assert.equal(submissions(s)[1].body.selections[0].event_id,'event-nfl-0');assert.equal(submissions(s)[1].body.selections[0].american_odds,100);assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'0');
});

test('removing a refreshing chosen Single also refreshes a surviving fallback that still needs a quote',async t=>{
 const {p,state:s,releaseQuotes}=await open(t,{rejectNext:true,holdQuotes:true});await add(p,0);await add(p,1);await show(p);await p.click('#place');await p.waitForFunction(()=>document.querySelectorAll('.slip-item.stale').length===2);
 await p.click('#single');assert(await choices(p).first().isChecked());await p.locator('[data-remove]').first().click();assert.equal(await p.locator('#count').textContent(),'1');assert(await choices(p).first().isChecked());assert(await p.locator('#place').isDisabled());assert.equal(await p.locator('#return').textContent(),'$0.00');
 releaseQuotes();await p.waitForFunction(()=>document.querySelector('#return').textContent==='$18.33'&&!document.querySelector('#place').disabled);assert.match(await p.locator('#slipItems').textContent(),/NFL Home 1.*-120/s);assert(!await p.locator('#slipItems').textContent().then(value=>value.includes('NFL Home 0')));assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);
 await p.click('#place');await accepted(p);assert.equal(submissions(s)[1].body.wager_type,'single');assert.equal(submissions(s)[1].body.selections.length,1);assert.equal(submissions(s)[1].body.selections[0].event_id,'event-nfl-1');assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'0');
});

test('refreshing a chosen NFL Single cannot cancel an NBA board load merely because an unsubmitted NBA pick is saved',async t=>{
 const {p,state:s,releaseBoard}=await open(t,{rejectNext:true,updatedIndex:0});await add(p,0);await p.click('[data-sport="nba"]');await p.locator('.odd').filter({hasText:'NBA Home 0'}).first().waitFor();await add(p,0,'NBA Home 0');await show(p);await p.click('#single');assert(await choices(p).first().isChecked());
 await p.click('#closeSlip');s.holdBoardSport='nba';await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Loading NBA'));await p.click('#openSlip');await p.click('#place');
 await p.waitForFunction(()=>document.querySelector('#return').textContent==='$18.33'&&!document.querySelector('#place').disabled);assert.equal(submissions(s).length,1);assert.equal(s.balances.A,100);assert.equal(await p.locator('#count').textContent(),'2');
 releaseBoard();await p.waitForFunction(()=>document.querySelector('#content .odd .odd-price')?.textContent==='-120');assert.match(await p.locator('#content').textContent(),/NBA Home 0/);assert(!await p.locator('#status').textContent().then(value=>value.includes('Loading')));assert.equal(await p.locator('#return').textContent(),'$18.33');assert(await choices(p).first().isChecked());
 await p.click('#place');await accepted(p);const chosen=submissions(s)[1].body.selections;assert.equal(chosen.length,1);assert.equal(chosen[0].sport_key,'nfl');assert.equal(chosen[0].event_id,'event-nfl-0');assert.equal(s.balances.A,90);assert.equal(await p.locator('#count').textContent(),'1');assert.match(await p.locator('#slipItems').textContent(),/NBA Home 0/);
});

for(const fixture of [{name:'Single',legs:1,stake:'0.03',balance:99.97},{name:'Parlay',legs:2,stake:'0.02',balance:99.98}])test(fixture.name+' half-cent payout preview agrees with the exact service receipt',async t=>{
 const {p,state:s}=await open(t,{prices:[-200,-200,-110],expectedReturn:0.05});await add(p,0);if(fixture.legs===2)await add(p,1);await p.click('#openSlip');await p.fill('#stake',fixture.stake);
 assert.equal(await p.locator('#return').textContent(),'$0.05');await mode(p,fixture.name.toLowerCase());await p.click('#place');await accepted(p);
 const call=submissions(s)[0];assert.equal(call.body.selections.length,fixture.legs);assert.equal(call.body.stake,Number(fixture.stake));assert(call.body.selections.every(x=>x.american_odds===-200));assert.match(await p.locator('#slipMsg').textContent(),/Potential Return: \$0\.05/);assert.equal(s.balances.A,fixture.balance);assert.equal(acceptedCount(s),1);
});
