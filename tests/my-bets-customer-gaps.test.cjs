// The real My Bets page with isolated SDK fixtures. No customer account or
// production wallet is accessed by these connection/auth/refund regressions.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser, server, base;
const sdk = `export function createClient(){
  if(__createFailure){__createFailure=false;sessionStorage.setItem('__fixtureClientFailed','1');throw Error('SDK startup failed')}
  const unlocked=()=>{if(__authLock)throw Error('SDK call under auth notification lock')};
  return {auth:{
    onAuthStateChange(fn){__callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},
    getSession(){unlocked();return __authRequest('session',structuredClone(__session))},
    getUser(token){unlocked();const session=structuredClone(__session);__tokens.push(token);return __authRequest('verify',session)},
  },from(table){unlocked();const q={table,owner:__session?.user.id,filters:[],select(){return this},eq(...a){this.filters.push(a);return this},in(){return this},not(){return this},order(){return this},then(resolve,reject){return __query(this).then(resolve,reject)}};return q}}};
`;
test.before(async()=>{
  server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://fixture').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function open(t,{sdkFailures=0,sdkHang=false,sdkNestedFailure=false,fastTimeout=false,createFailure=false,signedOut=false,verifyError=null,gateVerify=[],gateQueries=[]}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});t.after(()=>context.close());
  await context.addInitScript(({fastTimeout,createFailure,signedOut,verifyError,gateVerify,gateQueries})=>{
    if(fastTimeout){const timer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timer(fn,ms===12000?200:ms,...args)}
    window.__user=id=>({access_token:'fixture-'+id,user:{id,email:id+'@example.invalid'}});
    window.__session=signedOut?null:__user('A');window.__callbacks=[];window.__authLock=false;window.__tokens=[];window.__calls=[];window.__pending=[];window.__verifyError=verifyError;window.__ledgerError=null;window.__sessionError=null;window.__gateSession=false;window.__gateVerify=gateVerify;window.__gateQueries=gateQueries;window.__createFailure=createFailure&&sessionStorage.getItem('__fixtureClientFailed')!=='1';
    const wager=id=>({id:'wager-'+id,wager_type:'single',stake:5,potential_return:10,status:'accepted',placed_at:'2026-10-10T12:00:00Z',wager_selections:[{selection_name:id+' private pick',event_name:id+' private event',market_key:'h2h',american_odds:100}]});
    window.__fixtures={A:{wagers:[wager('A')],wallet_transactions:[]},B:{wagers:[wager('B')],wallet_transactions:[]}};
    window.__emit=(event,session)=>{__session=session;__authLock=true;try{for(const callback of __callbacks)callback(event,session)}finally{__authLock=false}};
    window.__authRequest=async(action,session)=>{const owner=session?.user.id,error=structuredClone(action==='verify'?__verifyError:__sessionError);__calls.push({action,owner});if(action==='verify'&&__gateVerify.includes(owner)||action==='session'&&__gateSession)await new Promise(resolve=>__pending.push({kind:action,owner,resolve}));return action==='verify'?{data:{user:session?.user||null},error}:{data:{session},error}};
    window.__query=async q=>{__calls.push({table:q.table,owner:q.owner,filters:structuredClone(q.filters)});const data=structuredClone(__fixtures[q.owner]?.[q.table]||[]),error=q.table==='wallet_transactions'?structuredClone(__ledgerError):null;if(__gateQueries.includes(q.owner))await new Promise(resolve=>__pending.push({kind:'query',owner:q.owner,resolve}));return {data,error}};
    window.__release=(kind,owner)=>{if(kind==='verify')__gateVerify=__gateVerify.filter(id=>id!==owner);if(kind==='query')__gateQueries=__gateQueries.filter(id=>id!==owner);if(kind==='session')__gateSession=false;for(const p of __pending.filter(p=>p.kind===kind&&p.owner===owner))p.resolve();__pending=__pending.filter(p=>p.kind!==kind||p.owner!==owner)};
  },{fastTimeout,createFailure,signedOut,verifyError,gateVerify,gateQueries});
  let imports=0,dependencyImports=0,heldRoute;const urls=[];
  await context.route('https://**/*',async route=>{if(route.request().url().includes('fixture-nested-sdk.js')){dependencyImports++;return dependencyImports===1?route.abort():route.fulfill({contentType:'text/javascript',body:'export const connected=true;'})}if(route.request().url().includes('/@supabase/supabase-js@')){imports++;urls.push(route.request().url());if(imports<=sdkFailures)return route.abort();if(sdkHang&&imports===1){heldRoute=route;return}return route.fulfill({contentType:'text/javascript',body:(sdkNestedFailure?"import './fixture-nested-sdk.js';\n":'')+sdk})}return route.abort()});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/gameday-my-bets.html',{waitUntil:'domcontentloaded'});
  t.after(()=>assert.deepEqual(errors,[],'no unhandled browser errors'));
  return {page,imports:()=>imports,urls,releaseImport:async()=>{try{await heldRoute?.fulfill({contentType:'text/javascript',body:sdk})}catch{/* Reload aborts the old document request. */}}};
}
async function ready(page,owner='A'){await page.waitForFunction(owner=>document.querySelector('#openBets').textContent.includes(owner+' private pick')&&document.querySelector('#status').textContent.includes(owner+'@example.invalid'),owner)}
async function hidden(page,owner='A'){const text=await page.locator('main').textContent();assert(!text.includes(owner+' private'),text);assert(!text.includes(owner+'@example.invalid'),text)}
async function flush(page){await page.waitForTimeout(60)}
test('failed SDK import has a usable Retry Connection that reloads the document',async t=>{
  const {page:p,imports,urls}=await open(t,{sdkFailures:1});await p.waitForFunction(()=>refresh.textContent==='Retry Connection'&&!refresh.disabled);assert.match(await p.locator('#status').textContent(),/Unable to connect/);await Promise.all([p.waitForEvent('domcontentloaded'),p.click('#refresh')]);await ready(p);assert.equal(imports(),2);assert.equal(urls[0],urls[1]);assert.equal(await p.locator('#refresh').textContent(),'Refresh Bets');
});
test('stalled SDK import times out, retries, and its late completion cannot install another client',async t=>{
  const {page:p,releaseImport}=await open(t,{sdkHang:true,fastTimeout:true});await p.waitForFunction(()=>refresh.textContent==='Retry Connection'&&!refresh.disabled);await p.click('#refresh');await ready(p);await releaseImport();await flush(p);assert.equal(await p.evaluate(()=>__callbacks.length),1);await ready(p);
});
test('SDK client initialization failure is recoverable using the same Retry Connection',async t=>{
  const {page:p}=await open(t,{createFailure:true});await p.waitForFunction(()=>refresh.textContent==='Retry Connection'&&!refresh.disabled);await p.click('#refresh');await ready(p);
});
test('failed nested SDK module recovers after Retry reloads the complete import graph',async t=>{
  const {page:p,imports}=await open(t,{sdkNestedFailure:true});await p.waitForFunction(()=>refresh.textContent==='Retry Connection'&&!refresh.disabled);assert.match(await p.locator('#status').textContent(),/Unable to connect/);await Promise.all([p.waitForEvent('domcontentloaded'),p.click('#refresh')]);await ready(p);assert.equal(imports(),2);assert.equal(await p.evaluate(()=>__callbacks.length),1);
});
test('expired cached token never exposes active-account email or bets',async t=>{
  const {page:p}=await open(t,{verifyError:{status:401,code:'bad_jwt',message:'JWT expired'}});await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Your session expired'));await hidden(p);assert(await p.locator('#refresh').isEnabled());assert.equal(await p.locator('#openBets a').getAttribute('href'),'gameday-auth.html');assert.equal(await p.evaluate(()=>__calls.filter(c=>c.table).length),0);await p.evaluate(()=>{__verifyError=null;__emit('SIGNED_IN',__user('B'))});await ready(p,'B');
});
test('failed session refresh hides a previously active account and offers sign-in',async t=>{
  const {page:p}=await open(t);await ready(p);await p.evaluate(()=>{__sessionError={status:400,code:'refresh_token_not_found'}});await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Your session expired'));await hidden(p);assert(await p.locator('#refresh').isEnabled());
});
test('verification network failure clears stale data and a successful refresh recovers',async t=>{
  const {page:p}=await open(t);await ready(p);await p.evaluate(()=>{__verifyError={status:0,message:'Offline'}});await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Unable to verify your account'));await hidden(p);assert(await p.locator('#refresh').isEnabled());await p.evaluate(()=>{__verifyError=null});await p.click('#refresh');await ready(p);
});
test('stalled getSession is bounded and does not leave Checking or Refresh locked',async t=>{
  const {page:p}=await open(t,{fastTimeout:true});await ready(p);await p.evaluate(()=>{__gateSession=true});await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Unable to verify or refresh'));await hidden(p);assert(await p.locator('#refresh').isEnabled());await p.evaluate(()=>__release('session','A'));await flush(p);await hidden(p);await p.click('#refresh');await ready(p);
});
test('stalled account verification is bounded and late completion does not reveal old data',async t=>{
  const {page:p}=await open(t,{fastTimeout:true,gateVerify:['A']});await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Unable to verify or refresh'));await hidden(p);assert(await p.locator('#refresh').isEnabled());await p.evaluate(()=>__release('verify','A'));await flush(p);await hidden(p);await p.click('#refresh');await ready(p);
});
test('cancelled Actual Return comes from refund ledger, without adding stake or potential return',async t=>{
  const {page:p}=await open(t,{signedOut:true});await p.waitForFunction(()=>__callbacks.length===1);await p.evaluate(()=>{
    const row=(id,status)=>({id,wager_type:'single',stake:7,potential_return:21,status,placed_at:'2026-10-10T12:00:00Z',wager_selections:[{selection_name:id,event_name:'Fixture',market_key:'h2h',american_odds:200}]});
    __fixtures.A.wagers=[row('Refunded','cancelled'),row('Unrefunded','cancelled'),row('Won','won'),row('Void','void'),row('Lost','lost')];
    __fixtures.A.wallet_transactions=[{wager_id:'Refunded',transaction_type:'refund',amount:7},{wager_id:'Won',transaction_type:'wager_credit',amount:17},{wager_id:'Void',transaction_type:'refund',amount:7}];__emit('SIGNED_IN',__user('A'));
  });await p.waitForFunction(()=>settledBets.querySelectorAll('.bet').length===5);
  const returns=await p.locator('#settledBets .bet').evaluateAll(cards=>Object.fromEntries(cards.map(c=>[c.querySelector('.selection-title').textContent,c.querySelectorAll('.summary .value')[1].textContent])));
  assert.deepEqual(returns,{Refunded:'$7.00',Unrefunded:'$0.00',Won:'$17.00',Void:'$7.00',Lost:'$0.00'});assert.equal(await p.locator('#settledBets .label').filter({hasText:'Actual Return'}).count(),5);
});
test('unavailable return ledger is shown as unknown with refresh guidance',async t=>{
  const {page:p}=await open(t);await ready(p);await p.evaluate(()=>{__fixtures.A.wagers[0].status='cancelled';__ledgerError={status:503,message:'Ledger offline'}});await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Return amounts unavailable'));assert.equal(await p.locator('#settledBets .summary .value').nth(1).textContent(),'—');assert(await p.locator('#refresh').isEnabled());
});
test('expired ledger response clears a verified active account instead of leaving stale bets',async t=>{
  const {page:p}=await open(t);await ready(p);await p.evaluate(()=>{__ledgerError={status:401,message:'JWT expired'}});await p.click('#refresh');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Your session expired'));await hidden(p);assert(await p.locator('#refresh').isEnabled());
});
test('late A verification cannot reveal A email or initiate A reads after switching to B',async t=>{
  const {page:p}=await open(t,{gateVerify:['A']});await p.waitForFunction(()=>__pending.some(x=>x.kind==='verify'&&x.owner==='A'));await hidden(p);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await ready(p,'B');await p.evaluate(()=>__release('verify','A'));await flush(p);await ready(p,'B');await hidden(p,'A');assert.equal(await p.evaluate(()=>__calls.filter(c=>c.table&&c.owner==='A').length),0);
});
test('an old-token 401 cannot expire the same owner newly refreshed session',async t=>{
  const {page:p}=await open(t);await ready(p);await p.evaluate(()=>{
    __gateVerify=['A'];__verifyError={status:401,code:'bad_jwt'};__statuses=[];
    new MutationObserver(()=>__statuses.push(document.querySelector('#status').textContent)).observe(document.querySelector('#status'),{childList:true,subtree:true});
  });await p.click('#refresh');await p.waitForFunction(()=>__pending.some(x=>x.kind==='verify'));
  await p.evaluate(()=>{__gateVerify=[];__verifyError=null;const next=__user('A');next.access_token='fixture-A-refreshed';__emit('TOKEN_REFRESHED',next);__release('verify','A')});
  await ready(p);assert.equal(await p.evaluate(()=>__statuses.some(text=>text.includes('session expired'))),false);assert.equal(await p.evaluate(()=>__tokens.at(-1)),'fixture-A-refreshed');
});
test('late A wagers/refunds cannot overwrite B after account switching or sign-out',async t=>{
  const {page:p}=await open(t,{gateQueries:['A']});await p.waitForFunction(()=>__pending.filter(x=>x.kind==='query'&&x.owner==='A').length===2);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await ready(p,'B');await p.evaluate(()=>__release('query','A'));await flush(p);await hidden(p,'A');await ready(p,'B');await p.evaluate(()=>__emit('SIGNED_OUT',null));await hidden(p,'B');assert.match(await p.locator('#status').textContent(),/Sign in/);
});
test('refresh verifies the captured token and all bets/refund queries explicitly filter its owner',async t=>{
  const {page:p}=await open(t);await ready(p);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await ready(p,'B');const {tokens,queries}=await p.evaluate(()=>({tokens:__tokens,queries:__calls.filter(c=>c.table)}));assert.deepEqual(tokens,['fixture-A','fixture-B']);assert.equal(queries.length,4);for(const q of queries)assert(q.filters.some(f=>f[0]==='user_id'&&f[1]===q.owner));
});
test('direct My Bets entry visibly discloses test credits for signed-out and signed-in customers',async t=>{
  const {page:p}=await open(t,{signedOut:true});await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Sign in'));assert.match(await p.locator('main').textContent(),/TEST MODE · No real money/);await p.evaluate(()=>__emit('SIGNED_IN',__user('A')));await ready(p);assert.match(await p.locator('main').textContent(),/Bets use GameDay test credits/);assert.equal(await p.locator('#status').getAttribute('aria-live'),'polite');
});
