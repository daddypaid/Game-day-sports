// Owner-scoped receipt UI regressions. Every auth/API call uses fixtures only.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
let browser,server,base;
const root=path.resolve(__dirname,'..');
const sdk=`export function createClient(){
  __sdkClients++;
  return {auth:{
    async getSession(){if(__authLock)throw Error('SDK called inside auth notification');const snapshot={data:{session:structuredClone(__session)},error:__sessionError};__calls.push({kind:'session'});if(__holdSession)await new Promise(resolve=>__pendingSessions.push(resolve));return snapshot},
    onAuthStateChange(fn){__authCallbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}}
  }}
}`;
const grids={
  'midnight-monsters':[['VAMP','WILD','SPADE'],['WOLF','SCATTER','CLUB'],['ZOMB','POTION','HEART'],['BAT','CANDLE','DIAMOND'],['SKULL','BOOK','RING']],
  'galactic-rebellion':[['STARFIGHTER','GALAXY','CHEST'],['STATION','PILOT','COMPASS'],['PLANET','QUEEN','REDPLANET'],['ASTEROID','BOT','RINGED'],['BLACKHOLE','CANNON','WILD']],
  'lucky-7s':[['RED7','FOOTBALL','BASKETBALL'],['BLUE7','SOCCER','BOXING'],['GOLD7','HOCKEY','GOALPOST']]
};
const labels={
  'midnight-monsters':['Vampire','Werewolf','Zombie','Bat','Skull','Wild','Scatter','Potion','Candle','Book','Spade','Club','Heart','Diamond','Ring'],
  'galactic-rebellion':['Starfighter','Space Station','Planet','Asteroid','Black Hole','Galaxy','Space Pilot','Alien Queen','Enemy Bot','Laser Cannon','Crystal Chest','Star Compass','Red Planet','Ringed Planet','Wild'],
  'lucky-7s':['Red 7','Blue 7','Gold 7','Football','Soccer','Hockey puck','Basketball','Boxing gloves','Goalpost']
};
function row(id,game='midnight-monsters',spin={}){return{id,game,created_at:'2026-10-10T12:00:00.000Z',spin:{grid:grids[game],stake:2,payout:12.34,...spin}}}
test.before(async()=>{
  server=http.createServer((req,res)=>{const filename=path.join(root,decodeURIComponent(new URL(req.url,'http://fixture').pathname));if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'})[path.extname(filename)]||'text/html');res.end(fs.readFileSync(filename))}catch{res.writeHead(404).end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function open(t,{rows=[row('A-private-spin')],pages={},gate=[],sdkFailures=0,sessionError=null,holdSession=false,signedOut=false,viewport=390}={}){
  const context=await browser.newContext({viewport:{width:viewport,height:844},serviceWorkers:'block'});t.after(()=>context.close());
  await context.addInitScript(({rows,pages,gate,sessionError,holdSession,signedOut})=>{
    window.__user=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});window.__session=signedOut?null:__user('A');window.__sdkClients=0;window.__authCallbacks=[];window.__authLock=false;window.__calls=[];window.__pending=[];window.__gate=gate;window.__sessionError=sessionError;window.__holdSession=holdSession;window.__pendingSessions=[];window.__failure=null;
    const b=structuredClone(rows[0]||{id:'B-private-spin',game:'lucky-7s',created_at:'2026-10-10T12:00:00.000Z',spin:{grid:[['RED7','FOOTBALL','BASKETBALL'],['BLUE7','SOCCER','BOXING'],['GOLD7','HOCKEY','GOALPOST']],stake:1,payout:10}});b.id='B-private-spin';
    window.__fixtures={A:{start:{ok:true,receipts:rows,next_cursor:null},...pages},B:{start:{ok:true,receipts:[b],next_cursor:null}}};
    window.__emit=(event,session)=>{__session=session;__authLock=true;try{for(const fn of __authCallbacks)fn(event,session)}finally{__authLock=false}};
    window.__historyQuery=async({authorization,body})=>{if(__authLock)throw Error('API called inside auth notification');const owner=authorization?.replace('Bearer fixture-',''),result=structuredClone(__fixtures[owner]?.[body.before||'start']),failure=__failure;__calls.push({kind:'history',owner,authorization,body});if(__gate.includes(owner))await new Promise(resolve=>__pending.push({owner,resolve}));return{result,failure}};
    window.__release=owner=>{__gate=__gate.filter(x=>x!==owner);for(const p of __pending.filter(x=>x.owner===owner))p.resolve();__pending=__pending.filter(x=>x.owner!==owner)};
    window.__releaseSessions=()=>{__holdSession=false;for(const resolve of __pendingSessions)resolve();__pendingSessions=[]};
  },{rows,pages,gate,sessionError,holdSession,signedOut});
  const sdkRequests=[];
  await context.route('https://**/*',async route=>{
    const request=route.request();
    if(request.url().includes('/@supabase/supabase-js@')){sdkRequests.push(request.url());if(sdkFailures-->0)return route.abort();return route.fulfill({contentType:'text/javascript',body:sdk})}
    if(request.url().includes('/functions/v1/themed-slots-test')){
      const answer=await request.frame().evaluate(args=>__historyQuery(args),{authorization:request.headers()['authorization'],body:request.postDataJSON()});
      if(answer.failure==='abort')return route.abort();
      if(answer.failure)return route.fulfill({status:answer.failure.status||503,contentType:'application/json',body:JSON.stringify(answer.failure.body||{ok:false,error:'Fixture history unavailable'})});
      return route.fulfill({contentType:'application/json',body:JSON.stringify(answer.result)});
    }
    return route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/gameday-casino-history.html');
  t.after(()=>assert.deepEqual(errors,[],'no unhandled browser errors or SDK lock re-entry'));
  return{page,sdkRequests};
}
async function ready(page,id='A-private-spin'){await page.waitForFunction(id=>document.querySelector(`[data-receipt-id="${id}"]`)&&document.querySelector('#history-refresh').disabled===false,id)}
async function flush(page){await page.waitForTimeout(60)}
async function ids(page){return page.locator('.receipt').evaluateAll(els=>els.map(el=>el.dataset.receiptId))}
async function noA(page){assert(!await page.locator('#history-list').textContent().then(text=>text.includes('A-private')))}
for(const [game,payout,stake] of [['midnight-monsters',12.34,2],['galactic-rebellion',44.77,7],['lucky-7s',2.25,5]]){
 test(`history preserves exact ${game} reel positions, wager, payout, and artwork`,async t=>{
  const {page}=await open(t,{rows:[row('A-private-spin',game,{payout,stake})]});await ready(page);
  assert.deepEqual(await page.locator('.receipt-symbol').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label'))),labels[game]);
  assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$'+stake.toFixed(2),'$'+payout.toFixed(2),'Win']);
  assert.equal(await page.locator('.receipt-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),game==='lucky-7s'?3:5);
  const styles=await page.locator('.receipt-symbol').evaluateAll(els=>els.map(el=>({image:el.style.backgroundImage,position:el.style.backgroundPosition})));assert(styles.every(s=>s.image.includes('assets/'+game+'/')));assert.match(styles[0].image,game==='midnight-monsters'?/vampire\.webp/:/symbols-atlas\.webp/);
  assert.match(await page.locator('body').textContent(),/TEST MODE.*no real money/);
 });
}
test('history displays a zero payout as No win, without inventing a return',async t=>{
 const {page}=await open(t,{rows:[row('A-private-spin','lucky-7s',{stake:1,payout:0})]});await ready(page);assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$1.00','$0.00','No win']);
});
for(const flag of ['free_spin','is_free_spin','bonus_spin','spin_type']){
 test(`history ${flag} bonus receipts show Wager $0.00 and exact payout`,async t=>{
  const {page}=await open(t,{rows:[row('A-private-spin','midnight-monsters',{stake:20,total_bet:20,bet_per_line:1,payout:19.25,[flag]:flag==='spin_type'?'bonus':true,bonus_complete:true,bonus_total_payout:55.5})]});await ready(page);assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$0.00','$19.25','Win']);assert.match(await page.locator('.receipt-details').textContent(),/Free spin.*Free spins complete.*Bonus total \$55\.50/);
 });
}
test('history paging sends the server cursor and suppresses duplicates across pages',async t=>{
 const first=row('A-private-spin'),second=row('A-second'),third=row('A-third');const {page}=await open(t,{rows:[first,second],pages:{start:{ok:true,receipts:[first,second],next_cursor:'fixture-cursor'},'fixture-cursor':{ok:true,receipts:[second,third],next_cursor:null}}});await ready(page);assert(await page.locator('#history-more').isVisible());await page.click('#history-more');await ready(page,'A-third');assert.deepEqual(await ids(page),[first.id,second.id,third.id]);assert(!await page.locator('#history-more').isVisible());const calls=await page.evaluate(()=>__calls.filter(c=>c.kind==='history'));assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.body),[{action:'history',limit:20},{action:'history',limit:20,before:'fixture-cursor'}]);
});
test('history suppresses duplicate receipt IDs within a single page',async t=>{
 const first=row('A-private-spin'),second=row('A-second');const {page}=await open(t,{rows:[first,structuredClone(first),second]});await ready(page);assert.deepEqual(await ids(page),[first.id,second.id]);
});
test('history refresh replaces results and restarts pagination',async t=>{
 const first=row('A-private-spin'),second=row('A-second');const {page}=await open(t,{rows:[first],pages:{start:{ok:true,receipts:[first],next_cursor:'old-cursor'},'old-cursor':{ok:true,receipts:[second],next_cursor:null}}});await ready(page);await page.click('#history-more');await ready(page,'A-second');await page.evaluate(()=>{__fixtures.A.start={ok:true,receipts:[__fixtures.A.start.receipts[0]],next_cursor:null}});await page.click('#history-refresh');await ready(page);assert.deepEqual(await ids(page),['A-private-spin']);const last=await page.evaluate(()=>__calls.filter(c=>c.kind==='history').at(-1));assert(!('before' in last.body));
});
test('history signout synchronously removes receipts and rejects late replies',async t=>{
 const {page}=await open(t);await ready(page);await page.evaluate(()=>{__gate=['A']});await page.click('#history-refresh');await page.waitForFunction(()=>__pending.length===1);const immediate=await page.evaluate(()=>{__emit('SIGNED_OUT',null);return{rows:document.querySelector('#history-list').textContent,signin:!document.querySelector('#history-signin').hidden,status:document.querySelector('#history-status').textContent}});assert(!immediate.rows.includes('A-private'));assert(immediate.signin);assert.match(immediate.status,/Sign in/);await page.evaluate(()=>__release('A'));await flush(page);await noA(page);assert(await page.locator('#history-refresh').isEnabled());
});
test('history loads B while A is pending and rejects A results after B loaded',async t=>{
 const {page}=await open(t,{gate:['A']});await page.waitForFunction(()=>__pending.length===1);const immediate=await page.evaluate(()=>{__emit('SIGNED_IN',__user('B'));return document.querySelector('#history-list').textContent});assert(!immediate.includes('A-private'));await ready(page,'B-private-spin');await page.evaluate(()=>__release('A'));await flush(page);assert.deepEqual(await ids(page),['B-private-spin']);await noA(page);
});
test('history A-B-A generations reject a prior A receipt even when owner matches again',async t=>{
 const {page}=await open(t,{gate:['A']});await page.waitForFunction(()=>__pending.length===1);await page.evaluate(()=>__emit('SIGNED_IN',__user('B')));await ready(page,'B-private-spin');await page.evaluate(()=>{__gate=[];__fixtures.A.start.receipts[0].id='A-new-private-spin';__emit('SIGNED_IN',__user('A'))});await ready(page,'A-new-private-spin');await page.evaluate(()=>__release('A'));await flush(page);assert.deepEqual(await ids(page),['A-new-private-spin']);
});
test('history initial stale session lookup cannot restore A over B',async t=>{
 const {page}=await open(t,{holdSession:true});await page.waitForFunction(()=>__pendingSessions.length===1);await page.evaluate(()=>{__holdSession=false;__emit('SIGNED_IN',__user('B'))});await ready(page,'B-private-spin');await page.evaluate(()=>__releaseSessions());await flush(page);assert.deepEqual(await ids(page),['B-private-spin']);await noA(page);
});
test('history an older finally cannot unlock a still-pending B request',async t=>{
 const {page}=await open(t,{gate:['A','B']});await page.waitForFunction(()=>__pending.filter(p=>p.owner==='A').length===1);await page.evaluate(()=>__emit('SIGNED_IN',__user('B')));await page.waitForFunction(()=>__pending.filter(p=>p.owner==='B').length===1);await page.evaluate(()=>__release('A'));await flush(page);assert(await page.locator('#history-refresh').isDisabled());await page.evaluate(()=>__release('B'));await ready(page,'B-private-spin');
});
test('history SDK failure offers Refresh and retries the module successfully',async t=>{
 const {page,sdkRequests}=await open(t,{sdkFailures:1});await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('reconnect'));assert(await page.locator('#history-refresh').isEnabled());await page.click('#history-refresh');await ready(page);assert.equal(sdkRequests.length,2);assert.match(sdkRequests[1],/gameday-history-retry=1/);
});
for(const failure of ['abort',{status:503,body:{ok:false,error:'Fixture temporarily unavailable'}}]){
 test(`history ${typeof failure==='string'?'network interruption':'API failure'} recovers through Refresh`,async t=>{
  const {page}=await open(t);await ready(page);await page.evaluate(failure=>{__failure=failure},failure);await page.click('#history-refresh');await page.waitForFunction(()=>document.querySelector('#history-status').classList.contains('is-error'));assert(await page.locator('#history-refresh').isEnabled());await page.evaluate(()=>{__failure=null});await page.click('#history-refresh');await ready(page);assert.deepEqual(await ids(page),['A-private-spin']);
 });
}
test('history malformed receipt never renders a partial payout and can recover',async t=>{
 const good=row('A-private-spin'),bad=row('A-bad','midnight-monsters',{grid:[['VAMP']]});const {page}=await open(t,{rows:[good,bad]});await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('incomplete'));assert.equal(await page.locator('.receipt').count(),0);await page.evaluate(()=>{__fixtures.A.start.receipts=__fixtures.A.start.receipts.slice(0,1)});await page.click('#history-refresh');await ready(page);assert.equal(await page.locator('.receipt').count(),1);
});
test('history expired server session clears receipts and offers sign-in',async t=>{
 const {page}=await open(t);await ready(page);await page.evaluate(()=>{__failure={status:401,body:{ok:false,error:'Fixture expired token'}}});await page.click('#history-refresh');await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('expired'));await noA(page);assert(await page.locator('#history-signin').isVisible());assert(await page.locator('#history-refresh').isEnabled());
});
test('history signed-out and empty states remain actionable on narrow mobile',async t=>{
 const {page}=await open(t,{signedOut:true,rows:[],viewport:320});await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('Sign in'));assert(await page.locator('#history-signin').isVisible());await page.evaluate(()=>__emit('SIGNED_IN',__user('A')));await page.waitForFunction(()=>document.querySelector('#history-list').textContent.includes('No settled spins'));assert(await page.locator('#history-refresh').isEnabled());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});
test('history temporary session-read failure reconnects through Refresh',async t=>{
 const {page}=await open(t,{sessionError:{message:'Fixture temporary auth connection failure'}});await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('reconnect'));await page.evaluate(()=>{__sessionError=null});await page.click('#history-refresh');await ready(page);
});
test('history clears private receipts on a failed session read and reconnects with Refresh',async t=>{
 const {page}=await open(t);await ready(page);await page.evaluate(()=>{__sessionError={message:'Fixture temporary auth connection failure'}});await page.click('#history-refresh');await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('Unable to verify'));await noA(page);assert(await page.locator('#history-signin').isVisible());await page.evaluate(()=>{__sessionError=null});await page.click('#history-refresh');await ready(page);assert.deepEqual(await ids(page),['A-private-spin']);
});
