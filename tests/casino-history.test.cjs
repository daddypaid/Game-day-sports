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
const cards=(...ranks)=>ranks.map((rank,index)=>({rank,suit:['♠','♥','♦','♣'][index%4]}));
function tableRow(id,game='blackjack',overrides={}){
 const results={
  blackjack:{main_stake:10,main_payout:20,insurance_status:'not_offered',insurance_stake:0,insurance_payout:0,player_cards:cards('K','A'),dealer_cards:cards('7','10','5'),player_total:21,dealer_total:22,player_hands:null},
  baccarat:{bet_type:'banker',player_cards:cards('2','4'),banker_cards:cards('4','3'),player_total:6,banker_total:7},
  roulette:{bet_type:'red',bet_value:null,winning_number:30,winning_color:'red'},
  'jacks-or-better':{initial_hand:cards('J','2','3','4','J'),final_hand:cards('J','Q','K','A','10'),multiplier:4},
  holdem:{ante:2,committed:10,opponent_committed:10,pot:20,player_cards:cards('K','A'),opponent_cards:cards('2','3'),board:cards('4','5','8','9','Q'),showdown:true,player_rank:'Pair of kings',opponent_rank:'High card'},
  omaha:{ante:2,committed:10,opponent_committed:10,pot:20,player_cards:cards('K','A','2','3'),opponent_cards:cards('4','5','6','7'),board:cards('8','9','10','J','Q'),showdown:true,player_rank:'Straight',opponent_rank:'Pair of fours'},
  stud:{ante:2,committed:10,opponent_committed:10,pot:20,player_cards:cards('K','A','2','3','4','5','6'),opponent_cards:cards('7','8','9','10','J','Q','K'),board:[],showdown:true,player_rank:'Straight',opponent_rank:'Pair of kings'},
  draw:{ante:2,committed:10,opponent_committed:10,pot:20,player_cards:cards('K','A','2','3','4'),opponent_cards:cards('5','6','7','8','9'),board:[],showdown:true,player_rank:'High card',opponent_rank:'Straight'}
 };
 return{id,game,created_at:'2026-10-10T12:00:00.000Z',settled_at:'2026-10-10T12:02:00.000Z',stake:10,payout:20,outcome:'won',result:results[game],...overrides};
}
test.before(async()=>{
  server=http.createServer((req,res)=>{const filename=path.join(root,decodeURIComponent(new URL(req.url,'http://fixture').pathname));if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'})[path.extname(filename)]||'text/html');res.end(fs.readFileSync(filename))}catch{res.writeHead(404).end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function open(t,{rows=[row('A-private-spin')],pages={},tables={},gate=[],gameGate=[],sdkFailures=0,nestedSdkFailures=0,sessionError=null,holdSession=false,signedOut=false,viewport=390}={}){
  const context=await browser.newContext({viewport:{width:viewport,height:844},serviceWorkers:'block'});t.after(()=>context.close());
  await context.addInitScript(({rows,pages,tables,gate,gameGate,sessionError,holdSession,signedOut})=>{
    window.__user=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});window.__session=signedOut?null:__user('A');window.__sdkClients=0;window.__authCallbacks=[];window.__authLock=false;window.__calls=[];window.__pending=[];window.__gate=gate;window.__sessionError=sessionError;window.__holdSession=holdSession;window.__pendingSessions=[];window.__failure=null;
    const b=structuredClone(rows[0]||{id:'B-private-spin',game:'lucky-7s',created_at:'2026-10-10T12:00:00.000Z',spin:{grid:[['RED7','FOOTBALL','BASKETBALL'],['BLUE7','SOCCER','BOXING'],['GOLD7','HOCKEY','GOALPOST']],stake:1,payout:10}});b.id='B-private-spin';
    window.__fixtures={A:{start:{ok:true,receipts:rows,next_cursor:null},...pages},B:{start:{ok:true,receipts:[b],next_cursor:null}}};
    window.__tableFixtures={A:tables,B:structuredClone(tables)};window.__gameGate=gameGate;
    for(const stream of Object.values(__tableFixtures.B))for(const batch of Object.values(stream))for(const receipt of batch.rounds||[])receipt.id='B-'+receipt.id;
    window.__emit=(event,session)=>{__session=session;__authLock=true;try{for(const fn of __authCallbacks)fn(event,session)}finally{__authLock=false}};
    window.__historyQuery=async({authorization,body,table=false})=>{if(__authLock)throw Error('API called inside auth notification');const owner=authorization?.replace('Bearer fixture-',''),key=body.before?typeof body.before==='object'?JSON.stringify(body.before):body.before:'start',result=structuredClone(table?__tableFixtures[owner]?.[body.game]?.[key]:__fixtures[owner]?.[key]),failure=__failure;__calls.push({kind:table?'table-history':'history',owner,authorization,body});if(__gate.includes(owner)||__gameGate.includes(body.game))await new Promise(resolve=>__pending.push({owner,game:body.game,resolve}));return{result,failure}};
    window.__release=owner=>{__gate=__gate.filter(x=>x!==owner);for(const p of __pending.filter(x=>x.owner===owner))p.resolve();__pending=__pending.filter(x=>x.owner!==owner)};
    window.__releaseGame=game=>{__gameGate=__gameGate.filter(x=>x!==game);for(const p of __pending.filter(x=>x.game===game))p.resolve();__pending=__pending.filter(x=>x.game!==game)};
    window.__releaseSessions=()=>{__holdSession=false;for(const resolve of __pendingSessions)resolve();__pendingSessions=[]};
  },{rows,pages,tables,gate,gameGate,sessionError,holdSession,signedOut});
  const sdkRequests=[];
  const nestedSdk = nestedSdkFailures > 0;
  await context.route('https://**/*',async route=>{
    const request=route.request();
    if(request.url().includes('fixture-history-sdk-child.js')){if(nestedSdkFailures-->0)return route.abort();return route.fulfill({contentType:'text/javascript',body:'export const ready = true;'})}
    if(request.url().includes('/@supabase/supabase-js@')){sdkRequests.push(request.url());if(sdkFailures-->0)return route.abort();return route.fulfill({contentType:'text/javascript',body:(nestedSdk ? "import 'https://cdn.jsdelivr.net/fixture-history-sdk-child.js';\n" : '')+sdk})}
    if(request.url().includes('/functions/v1/themed-slots-test')||request.url().includes('/functions/v1/casino-history-test')||request.url().includes('/functions/v1/casinoHistory')){
      const answer=await request.frame().evaluate(args=>__historyQuery(args),{authorization:request.headers()['authorization'],body:request.postDataJSON(),table:!request.url().includes('/themed-slots-test')});
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
test('history Retry reloads a failed nested SDK graph and creates one working client',async t=>{
 const {page,sdkRequests}=await open(t,{nestedSdkFailures:1});
 await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('reconnect'));
 assert.equal(await page.evaluate(()=>__sdkClients),0);
 await page.click('#history-refresh');await ready(page);
 assert.equal(sdkRequests.length,2);assert.equal(await page.evaluate(()=>__sdkClients),1);
 assert.equal(await page.evaluate(()=>__authCallbacks.length),1);
});
test('history ignores a former token response after the same account refreshes its session',async t=>{
 const {page}=await open(t,{gate:['A']});
 await page.waitForFunction(()=>__pending.length===1);
 await page.evaluate(()=>{
  const receipt=structuredClone(__fixtures.A.start.receipts[0]);receipt.id='A-refreshed-spin';
  __fixtures['A-fresh']={start:{ok:true,receipts:[receipt],next_cursor:null}};
  __emit('TOKEN_REFRESHED',{...__user('A'),access_token:'fixture-A-fresh'});
 });
 await ready(page,'A-refreshed-spin');await page.evaluate(()=>__release('A'));await flush(page);
 assert.equal(await page.locator('[data-receipt-id="A-private-spin"]').count(),0);
 assert.equal(await page.locator('[data-receipt-id="A-refreshed-spin"]').count(),1);
});
function tableStreams(...rounds){
 const result={};for(const receipt of rounds){result[receipt.game]??={start:{ok:true,rounds:[],next_cursor:null}};result[receipt.game].start.rounds.push(receipt)}return result;
}
async function chooseTable(page,game,id){await page.selectOption('#history-game',game);await ready(page,id)}
const tableNames={blackjack:'Blackjack',baccarat:'Baccarat',roulette:'Roulette','jacks-or-better':'Jacks or Better',holdem:'Texas Hold’em',omaha:'Omaha',stud:'Seven-Card Stud',draw:'Five-Card Draw'};
for(const [game,name] of Object.entries(tableNames)){
 test(`history ${game} shows saved settled cards, outcome and financial totals`,async t=>{
  const receipt=tableRow('A-'+game,game),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,game,receipt.id);
  assert.equal(await page.locator('.receipt h2').textContent(),name);assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$10.00','$20.00','Won']);
  assert.equal(await page.locator('.receipt time').getAttribute('datetime'),receipt.settled_at);
  const call=await page.evaluate(()=>__calls.filter(c=>c.kind==='table-history').at(-1));assert.deepEqual(call.body,{game,limit:20,before:null});assert.equal(call.authorization,'Bearer fixture-A');
  const expected=game==='blackjack'?[receipt.result.dealer_cards,receipt.result.player_cards]:game==='baccarat'?[receipt.result.player_cards,receipt.result.banker_cards]:game==='roulette'?[]:game==='jacks-or-better'?[receipt.result.final_hand,receipt.result.initial_hand]:[receipt.result.board,receipt.result.player_cards,receipt.result.opponent_cards];
  const suitNames={'♠':'spades','♥':'hearts','♦':'diamonds','♣':'clubs'};
  assert.deepEqual(await page.locator('.receipt-card').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label'))),expected.flat().map(c=>c.rank+' of '+suitNames[c.suit]));
  if(game==='roulette'){assert.equal(await page.locator('.receipt-roulette-result').textContent(),'30 Red');assert.equal(await page.locator('.receipt-details').first().textContent(),'Bet: Red')}
  if(game==='baccarat')assert.match(await page.locator('.receipt-details').first().textContent(),/Bet on Banker/);
  if(game==='jacks-or-better')assert.match(await page.locator('.receipt-details').first().textContent(),/multiplier: 4×/);
  assert(!await page.locator('.receipt').textContent().then(text=>/balance/i.test(text)),'no invented historical balance');
 });
}
test('history blackjack includes insurance in totals and itemizes its exact saved return',async t=>{
 const original=tableRow('A-insurance'),receipt={...original,stake:15,payout:15,outcome:'lost',result:{...original.result,main_payout:0,insurance_status:'accepted',insurance_stake:5,insurance_payout:15,dealer_cards:cards('A','K'),dealer_total:21,player_cards:cards('7','K'),player_total:17}};
 const {page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);
 assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$15.00','$15.00','Lost']);
 assert.deepEqual(await page.locator('.receipt-summary dt').allTextContents(),['Wager','Returned','Main result']);
 assert.match(await page.locator('.receipt').textContent(),/Main wager \$10\.00 · Returned \$0\.00.*Insurance wager \$5\.00 · Returned \$15\.00 · Won/);
});
test('history split blackjack shows each hand stake/status and exact aggregate return',async t=>{
 const original=tableRow('A-split'),receipt={...original,stake:30,payout:40,outcome:'mixed',result:{...original.result,main_stake:30,main_payout:40,player_hands:[{cards:cards('8','K'),stake:10,total:18,status:'lost',doubled:false},{cards:cards('8','3','10'),stake:20,total:21,status:'won',doubled:true}]}};
 const {page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);
 assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$30.00','$40.00','Mixed result']);
 const groups=await page.locator('.receipt-hand h3').allTextContents();assert(groups.includes('Hand 1 · Total 18 · Lost · Wager $10.00'));assert(groups.includes('Hand 2 · Total 21 · Won · Wager $20.00'));
 assert.equal(await page.locator('.receipt-hand').filter({hasText:'Returned'}).count(),0,'no invented per-hand split payouts');
});
for(const [outcome,payout] of [['lost',0],['push',10]]){
 test(`history table ${outcome} keeps saved return without treating all nonzero returns as wins`,async t=>{
  const receipt=tableRow('A-'+outcome,'blackjack',{outcome,payout});receipt.result.main_payout=payout;
  const {page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);
  assert.deepEqual(await page.locator('.receipt-summary dd').allTextContents(),['$10.00','$'+payout.toFixed(2),outcome==='push'?'Push':'Lost']);
 });
}
test('history roulette zero is shown as green with the exact number bet',async t=>{
 const receipt=tableRow('A-zero','roulette',{payout:360,result:{bet_type:'number',bet_value:0,winning_number:0,winning_color:'green'}});
 const {page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'roulette',receipt.id);
 assert.equal(await page.locator('.receipt-roulette-result.green').textContent(),'0 Green');assert.equal(await page.locator('.receipt-details').first().textContent(),'Bet: Number 0');
});
for(const [bet_type,label] of Object.entries({red:'Red',black:'Black',odd:'Odd',even:'Even',low:'1–18',high:'19–36',column1:'Column 1',column2:'Column 2',column3:'Column 3'})){
 test(`history roulette ${bet_type} accepts the actual stored null bet value`,async t=>{
  const receipt=tableRow('A-null-'+bet_type,'roulette',{result:{bet_type,bet_value:null,winning_number:30,winning_color:'red'}}),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'roulette',receipt.id);
  assert.equal(await page.locator('.receipt-details').first().textContent(),'Bet: '+label);assert(!await page.locator('.receipt-details').allTextContents().then(lines=>lines.some(text=>text.includes('null'))));
 });
}
for(const game of ['holdem','stud']){
 test(`history folded ${game} preserves card concealment and never renders private shoe fields`,async t=>{
  const original=tableRow('A-fold-'+game,game),hidden={rank:'?',suit:''},opponent=game==='stud'?[hidden,hidden,...original.result.opponent_cards.slice(2,6),hidden]:[hidden,hidden];
  const receipt={...original,payout:0,outcome:'Computer won',result:{...original.result,opponent_cards:opponent,showdown:false,player_rank:undefined,opponent_rank:undefined,deck:[{rank:'A',suit:'♦',secret:'PRIVATE-DECK'}],shoe:'PRIVATE-SHOE'}};
  const {page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,game,receipt.id);
  assert.equal(await page.locator('.receipt-card.is-hidden').count(),game==='stud'?3:2);
  assert((await page.locator('.receipt-card.is-hidden').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label')))).every(label=>label==='Unrevealed card'));
  assert(!await page.locator('body').textContent().then(text=>/PRIVATE-DECK|PRIVATE-SHOE/.test(text)));
 });
}
test('history table pagination sends the opaque cursor, deduplicates and refreshes from the beginning',async t=>{
 const first=tableRow('A-first'),second=tableRow('A-second'),third=tableRow('A-third'),cursor={created_at:first.created_at,id:first.id},tables=tableStreams(first,second);
 tables.blackjack.start.next_cursor=cursor;tables.blackjack[JSON.stringify(cursor)]={ok:true,rounds:[second,third],next_cursor:null};
 const {page}=await open(t,{tables});await ready(page);await chooseTable(page,'blackjack',first.id);await page.click('#history-more');await ready(page,third.id);assert.deepEqual(await ids(page),[first.id,second.id,third.id]);
 assert(!await page.locator('#history-more').isVisible());const calls=await page.evaluate(()=>__calls.filter(c=>c.kind==='table-history'));assert.deepEqual(calls[1].body,{game:'blackjack',limit:20,before:cursor});
 await page.evaluate(()=>{__tableFixtures.A.blackjack.start={ok:true,rounds:[__tableFixtures.A.blackjack.start.rounds[0]],next_cursor:null}});await page.click('#history-refresh');await ready(page,first.id);assert.deepEqual(await ids(page),[first.id]);
 assert.deepEqual(await page.evaluate(()=>__calls.filter(c=>c.kind==='table-history').at(-1).body),{game:'blackjack',limit:20,before:null});
});
test('history switching games ignores a late former game response and resets its cursor',async t=>{
 const black=tableRow('A-black'),baccarat=tableRow('A-baccarat','baccarat'),{page}=await open(t,{tables:tableStreams(black,baccarat),gameGate:['blackjack']});await ready(page);
 await page.selectOption('#history-game','blackjack');await page.waitForFunction(()=>__pending.some(p=>p.game==='blackjack'));await chooseTable(page,'baccarat',baccarat.id);await page.evaluate(()=>__releaseGame('blackjack'));await flush(page);
 assert.deepEqual(await ids(page),[baccarat.id]);assert.equal(await page.locator('.receipt h2').textContent(),'Baccarat');assert(await page.locator('#history-refresh').isEnabled());assert(!await page.locator('#history-more').isVisible());
});
test('history blackjack-baccarat-blackjack switch rejects the first same-game reply and its finally',async t=>{
 const black=tableRow('A-old-black'),baccarat=tableRow('A-baccarat','baccarat'),{page}=await open(t,{tables:tableStreams(black,baccarat),gameGate:['blackjack']});await ready(page);
 await page.selectOption('#history-game','blackjack');await page.waitForFunction(()=>__pending.some(p=>p.game==='blackjack'));await chooseTable(page,'baccarat',baccarat.id);
 await page.evaluate(()=>{__gameGate=[];__tableFixtures.A.blackjack.start.rounds[0].id='A-new-black'});await chooseTable(page,'blackjack','A-new-black');await page.evaluate(()=>__releaseGame('blackjack'));await flush(page);assert.deepEqual(await ids(page),['A-new-black']);
});
test('history filter changes while the first session loads still load the selected table',async t=>{
 const receipt=tableRow('A-initial-black'),{page}=await open(t,{tables:tableStreams(receipt),holdSession:true});await page.waitForFunction(()=>__pendingSessions.length===1);await page.selectOption('#history-game','blackjack');await page.evaluate(()=>__releaseSessions());await ready(page,receipt.id);
 assert.equal(await page.locator('#history-game').inputValue(),'blackjack');assert.deepEqual(await ids(page),[receipt.id]);
});
test('history table signout clears results immediately and rejects a late settled round',async t=>{
 const receipt=tableRow('A-private-table'),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);
 await page.evaluate(()=>{__gate=['A']});await page.click('#history-refresh');await page.waitForFunction(()=>__pending.length===1);const immediate=await page.evaluate(()=>{__emit('SIGNED_OUT',null);return document.querySelector('#history-list').textContent});assert(!immediate.includes('A-private'));
 await page.evaluate(()=>__release('A'));await flush(page);assert.equal(await page.locator('.receipt').count(),0);assert(await page.locator('#history-signin').isVisible());assert(await page.locator('#history-refresh').isEnabled());
});
test('history table account A-B-A rejects an earlier response from the same owner',async t=>{
 const receipt=tableRow('A-old-table'),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);await page.evaluate(()=>{__gate=['A']});await page.click('#history-refresh');await page.waitForFunction(()=>__pending.length===1);
 await page.evaluate(()=>__emit('SIGNED_IN',__user('B')));await ready(page,'B-'+receipt.id);
 await page.evaluate(()=>{__gate=[];__tableFixtures.A.blackjack.start.rounds[0].id='A-new-table';__emit('SIGNED_IN',__user('A'))});await ready(page,'A-new-table');await page.evaluate(()=>__release('A'));await flush(page);assert.deepEqual(await ids(page),['A-new-table']);
});
test('history table token refresh clears old receipts and rejects the prior token reply',async t=>{
 const receipt=tableRow('A-old-token'),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);await page.evaluate(()=>{__gate=['A']});await page.click('#history-refresh');await page.waitForFunction(()=>__pending.length===1);
 await page.evaluate(()=>{__tableFixtures['A-fresh']=structuredClone(__tableFixtures.A);__tableFixtures['A-fresh'].blackjack.start.rounds[0].id='A-new-token';__emit('TOKEN_REFRESHED',{...__user('A'),access_token:'fixture-A-fresh'})});await ready(page,'A-new-token');await page.evaluate(()=>__release('A'));await flush(page);assert.deepEqual(await ids(page),['A-new-token']);
});
test('history malformed table batch is atomic and recovers without an invented zero payout',async t=>{
 const good=tableRow('A-good-table'),bad=tableRow('A-bad-table','blackjack',{payout:null}),{page}=await open(t,{tables:tableStreams(good,bad)});await ready(page);await page.selectOption('#history-game','blackjack');await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('incomplete'));assert.equal(await page.locator('.receipt').count(),0);
 await page.evaluate(()=>{__tableFixtures.A.blackjack.start.rounds.pop()});await page.click('#history-refresh');await ready(page,good.id);assert.equal(await page.locator('.receipt').count(),1);
});
test('history table stream rejects a response for another selected game',async t=>{
 const wrong=tableRow('A-wrong-game','baccarat'),tables={blackjack:{start:{ok:true,rounds:[wrong],next_cursor:null}}},{page}=await open(t,{tables});await ready(page);await page.selectOption('#history-game','blackjack');await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('incomplete'));assert.equal(await page.locator('.receipt').count(),0);
});
test('history table request failure and expired session remain actionable',async t=>{
 const receipt=tableRow('A-reconnect-table'),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);
 await page.evaluate(()=>{__failure={status:503}});await page.click('#history-refresh');await page.waitForFunction(()=>document.querySelector('#history-status').classList.contains('is-error'));assert(await page.locator('#history-refresh').isEnabled());
 await page.evaluate(()=>{__failure=null});await page.click('#history-refresh');await ready(page,receipt.id);
 await page.evaluate(()=>{__failure={status:401}});await page.click('#history-refresh');await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('expired'));assert.equal(await page.locator('.receipt').count(),0);assert(await page.locator('#history-signin').isVisible());
 await page.evaluate(()=>{__failure=null;__emit('SIGNED_IN',__user('A'))});await ready(page,receipt.id);
});
test('history table session-read failure clears private results and Refresh reconnects',async t=>{
 const receipt=tableRow('A-session-table'),{page}=await open(t,{tables:tableStreams(receipt)});await ready(page);await chooseTable(page,'blackjack',receipt.id);
 await page.evaluate(()=>{__sessionError={message:'Fixture temporary auth failure'}});await page.click('#history-refresh');await page.waitForFunction(()=>document.querySelector('#history-status').textContent.includes('Unable to verify'));assert.equal(await page.locator('.receipt').count(),0);
 await page.evaluate(()=>{__sessionError=null});await page.click('#history-refresh');await ready(page,receipt.id);
});
test('history tables fit narrow screens, escape saved text and explain an empty selected game',async t=>{
 const receipt=tableRow('A-mobile-stud','stud',{outcome:'<img src=x onerror="throw Error(1)">'});receipt.result.player_rank='<script>PRIVATE</script>';
 const tables=tableStreams(receipt);tables.baccarat={start:{ok:true,rounds:[],next_cursor:null}};
 const {page}=await open(t,{tables,viewport:320});await ready(page);await chooseTable(page,'stud',receipt.id);assert.equal(await page.locator('.receipt img,.receipt script').count(),0);assert.match(await page.locator('.receipt').textContent(),/<img src=x/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.selectOption('#history-game','baccarat');await page.waitForFunction(()=>document.querySelector('#history-list').textContent.includes('No settled Baccarat'));assert(await page.locator('#history-refresh').isEnabled());assert(!await page.locator('#history-more').isVisible());
 await page.selectOption('#history-game','slots');await ready(page);assert.deepEqual(await ids(page),['A-private-spin']);assert.equal(await page.evaluate(()=>__calls.filter(c=>c.kind==='history').at(-1).body.action),'history');
});
