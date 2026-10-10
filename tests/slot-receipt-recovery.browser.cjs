// Run: CHROMIUM_PATH=/usr/bin/chromium node tests/slot-receipt-recovery.browser.cjs
// Omit CHROMIUM_PATH to use Playwright's installed Chromium in CI.
// Uses local pages and isolated owner/receipt fixtures; no production requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const games = [
  { game: 'midnight-monsters', prefix: 'mm', page: 'gameday-midnight-monsters-v2.html', codes: ['VAMP','WOLF','ZOMB','POTION','BAT','CANDLE','WILD','SCATTER','SPADE','CLUB','HEART','DIAMOND','SKULL','BOOK','RING'], total: 2, bonusTotal: 10 },
  { game: 'galactic-rebellion', prefix: 'gr', page: 'gameday-galactic-rebellion-v2.html', codes: ['STARFIGHTER','STATION','PLANET','ASTEROID','GALAXY','PILOT','QUEEN','BOT','CHEST','COMPASS','REDPLANET','RINGED','BLACKHOLE','CANNON','WILD'], total: 1, bonusTotal: 6 },
  { game: 'lucky-7s', prefix: 'l7', page: 'gameday-slots.html', codes: ['RED7','BLUE7','GOLD7','FOOTBALL','SOCCER','HOCKEY','BASKETBALL','BOXING','GOALPOST'], total: 1 },
];
const paylines = [[0,0,0],[1,1,1],[2,2,2],[0,1,2],[2,1,0]];
function config(g) {
  if (g.prefix === 'mm') return undefined;
  const base = { min_total_bet: .1, max_total_bet: 200, total_bet_step: .1, default_total_bet: 1 };
  return g.prefix === 'gr' ? { ...base, mode:'ways', ways:243, payout_divisor:243, free_spins:6, scatter_multiplier:10, pays:Object.fromEntries(g.codes.map(code => [code,[0,0,1,3,10]])) } :
    { ...base, mode:'lines', math_version:'five-lines-v1', reels:3, rows:3, lines:5, paylines, free_spins:0, pays:Object.fromEntries(g.codes.map(code => [code,40])) };
}
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:window.__slotFixture.session},error:null}),onAuthStateChange:callback=>{window.__slotFixture.listeners.push(callback);return {data:{subscription:{unsubscribe(){}}}}}},from:()=>({select:()=>({eq:(column,owner)=>({single:async()=>({data:await (await fetch('/__fixture-wallet?owner='+owner)).json(),error:null})})})})}};`;
async function awaitState(check) {
  const deadline = Date.now()+10000;
  while (!check()) {
    if (Date.now()>deadline) throw new Error('Timed out waiting for fixture request');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
async function fixture(browser, base, g, mode, free = false) {
  const context = await browser.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block', reducedMotion:'reduce' });
  const state = { requests:[], receipts:new Map(), commits:0, reads:0, online:!['unresolved','reload','never-reload'].includes(mode), wallet:401, bonus:free ? {id:'fixture-bonus',spins_remaining:1,total_spins:g.bonusTotal,bet_per_line:g.prefix==='gr'?1/243:.1,total_bet:g.total,total_payout:8,wager_mode:'ways',math_version:'ways-v1'}:null, held:[], errors:[], storedBeforeSend:[] };
  await context.addInitScript(({blocked}) => {
    window.__slotFixture = { session:{user:{id:'owner-a'},access_token:'owner-a'}, listeners:[], switchOwner(owner){this.session=owner?{user:{id:owner},access_token:owner}:null;this.listeners.forEach(fn=>fn(owner?'SIGNED_IN':'SIGNED_OUT',this.session));} };
    if (blocked) Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('Fixture denied','SecurityError')}});
  }, { blocked:mode==='storage' });
  await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({status:200,contentType:'text/javascript',body:sdk}));
  await context.route('**/__fixture-wallet?*', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({balance:route.request().url().includes('owner-b')?999:state.wallet})}));
  const answer = (route, body, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await context.route('https://**.supabase.co/**', async route => {
    const req = route.request();
    const body = req.postDataJSON();
    const owner = req.headers().authorization.replace('Bearer ','');
    if (body.action === 'status') return answer(route,{ok:true,bonus:owner==='owner-a'?state.bonus:null,game_config:config(g)});
    const key = owner+':'+body.request_id;
    if (body.action === 'receipt') {
      state.reads++;
      if (!state.online) return route.abort('failed');
      const saved = state.receipts.get(key);
      return answer(route,saved?{ok:true,found:true,...saved.result}:{ok:true,found:false});
    }
    state.requests.push(structuredClone(body));
    const stored = await req.frame().evaluate(({game,owner}) => JSON.parse(localStorage.getItem('gameday-slot-pending:'+game+':'+owner)), {game:g.game,owner});
    state.storedBeforeSend.push(stored);
    assert.equal(stored.request_id,body.request_id,'UUID persisted before network request');
    assert.deepEqual(stored.body,body,'exact immutable payload persisted before send');
    if (mode === 'reject') return answer(route,{error:'Fixture wager rejected'},400);
    if ((mode==='never'||mode==='never-reload') && state.requests.length===1) return route.abort('failed');
    const previous = state.receipts.get(key);
    if (previous) {
      assert.deepEqual(previous.body,body,'replay uses identical request');
      return answer(route,previous.result);
    }
    state.commits++;
    const payout = 3.75;
    const requestedTotal = free ? g.total : body.total_bet ?? body.bet_per_line*20;
    state.wallet = +(state.wallet-(free?0:requestedTotal)+payout).toFixed(2);
    const grid = Array.from({length:g.prefix==='l7'?3:5},(_,col) => Array.from({length:3},(_,row) => g.codes[(col*3+row+2)%g.codes.length]));
    const spin = {id:'fixture-'+body.request_id,game:g.game,grid,payout,balance:state.wallet,win_cells:[0,1,2],feature_cells:[],active_lines:[0],total_bet:requestedTotal,stake:free?0:requestedTotal,bet_per_line:g.prefix==='l7'?requestedTotal/5:g.prefix==='gr'?requestedTotal/243:requestedTotal/20,lines:g.prefix==='l7'?5:20,math_version:g.prefix==='l7'?'five-lines-v1':'ways-v1',wager_mode:'ways',free_spin:free,bonus_triggered:false};
    if (free) { Object.assign(spin,{bonus_spins_remaining:0,bonus_total_spins:g.bonusTotal,bonus_total_payout:11.75,bonus_complete:true}); state.bonus=null; }
    const result = {ok:true,spin,game_config:config(g)};
    state.receipts.set(key,{body:structuredClone(body),result});
    if (mode==='switch'||mode==='switch-error') await new Promise(resolve=>state.held.push(resolve));
    if (['lost','unresolved','reload','switch-error'].includes(mode) && state.requests.length===1) return route.abort('failed');
    if (mode==='invalid' && state.requests.length===1) return answer(route,{...result,spin:{...spin,grid:[['INVALID']]}});
    return answer(route,result);
  });
  const page = await context.newPage();
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.goto(base+g.page,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(p=>!document.getElementById(p+'-spin').disabled,g.prefix);
  return { context,page,state,close:async()=>{state.held.forEach(fn=>fn());await context.close();} };
}
async function waitResult(h,g) {
  await h.page.waitForFunction(p=>document.getElementById(p+'-win').textContent==='$3.75'&&!document.getElementById(p+'-reels').classList.contains('is-spinning'),g.prefix);
  const receipt = [...h.state.receipts.values()][0].result.spin;
  const symbols = await h.page.locator('.'+g.prefix+'-reel .'+g.prefix+'-symbol').evaluateAll(nodes=>nodes.map(n=>n.dataset.symbol));
  assert.deepEqual(symbols,receipt.grid.flat(),'exact receipt symbols displayed');
  assert.equal(await h.page.locator('#'+g.prefix+'-wallet').textContent(),'$'+h.state.wallet.toFixed(2));
  assert.equal(h.state.commits,1,'only one committed spin/debit');
  assert.deepEqual(h.state.errors,[],'no browser errors');
  assert.equal(await h.page.evaluate(({game})=>localStorage.getItem('gameday-slot-pending:'+game+':owner-a'),{game:g.game}),null,'resolved request cleared');
}
async function run() {
  const server = http.createServer((req,res) => {
    const filename = path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if (!filename.startsWith(root+path.sep)) {res.writeHead(403);return res.end();}
    try { const data=fs.readFileSync(filename);const ext=path.extname(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[ext]||'application/octet-stream'});res.end(data); }
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/';
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
  const checks=[];
  async function check(g,name,fn) {const h=await fixture(browser,base,g,...fn.options);try{await fn(h);checks.push({game:g.game,case:name,passed:true,commits:h.state.commits,requests:h.state.requests.length});process.stdout.write('PASS '+g.game+' '+name+'\n');}finally{await h.close();}}
  const scenario = (options,fn) => Object.assign(fn,{options});
  try {
    for (const g of games) {
      for (const mode of ['normal','lost','never','invalid']) await check(g,mode,scenario([mode],async h=>{await h.page.locator('#'+g.prefix+'-spin').click();await waitResult(h,g);if(mode==='never')assert.deepEqual(h.state.requests[0],h.state.requests[1]);}));
      for (const mode of ['unresolved','reload','never-reload']) await check(g,mode,scenario([mode],async h=>{
        await h.page.locator('#'+g.prefix+'-auto').click();
        await h.page.waitForFunction(p=>document.getElementById(p+'-spin').textContent==='RECOVER SPIN'&&!document.getElementById(p+'-spin').disabled,g.prefix);
        assert(await h.page.locator('#'+g.prefix+'-total-plus').isDisabled());
        assert(await h.page.locator('#'+g.prefix+'-auto').isDisabled());
        const request=structuredClone(h.state.requests[0]);
        h.state.online=true;
        if (mode==='unresolved') await h.page.locator('#'+g.prefix+'-spin').click(); else await h.page.reload({waitUntil:'domcontentloaded'});
        await waitResult(h,g);
        assert.equal(h.state.requests.at(-1).request_id,request.request_id);
        assert.equal(await h.page.locator('#'+g.prefix+'-auto').getAttribute('aria-pressed'),'false');
        if(mode==='never-reload')assert.deepEqual(h.state.requests[0],h.state.requests[1]);
      }));
      await check(g,'original wager restored on reload',scenario(['reload'],async h=>{
        await h.page.locator('#'+g.prefix+'-total-plus').click();
        await h.page.locator('#'+g.prefix+'-total-plus').click();
        const wager=await h.page.locator('#'+g.prefix+'-total-bet').textContent();
        await h.page.locator('#'+g.prefix+'-spin').click();
        await h.page.waitForFunction(p=>document.getElementById(p+'-spin').textContent==='RECOVER SPIN'&&!document.getElementById(p+'-spin').disabled,g.prefix);
        h.state.online=true;await h.page.reload({waitUntil:'domcontentloaded'});await waitResult(h,g);
        assert.equal(await h.page.locator('#'+g.prefix+'-total-bet').textContent(),wager);
      }));
      await check(g,'rapid taps submit only one request',scenario(['switch'],async h=>{
        await h.page.evaluate(p=>{for(let i=0;i<20;i++)document.getElementById(p+'-spin').click();},g.prefix);
        await awaitState(()=>h.state.held.length);
        assert.equal(h.state.requests.length,1);h.state.held.shift()();await waitResult(h,g);
      }));
      await check(g,'owner switch isolates late response and recovers returning owner',scenario(['switch'],async h=>{
        await h.page.locator('#'+g.prefix+'-spin').click();
        await h.page.waitForFunction(({game})=>!!localStorage.getItem('gameday-slot-pending:'+game+':owner-a'),{game:g.game});
        await awaitState(()=>h.state.held.length);
        await h.page.evaluate(()=>window.__slotFixture.switchOwner('owner-b'));
        await h.page.waitForFunction(p=>document.getElementById(p+'-wallet').textContent==='$999.00',g.prefix);
        h.state.held.shift()();
        await h.page.waitForTimeout(100);
        assert.equal(await h.page.locator('#'+g.prefix+'-win').textContent(),'$0.00');
        assert.equal(await h.page.locator('#'+g.prefix+'-wallet').textContent(),'$999.00');
        assert.equal(h.state.reads,0,'new owner never queries prior owner receipt');
        await h.page.evaluate(()=>window.__slotFixture.switchOwner(null));
        assert.equal(await h.page.locator('#'+g.prefix+'-wallet').textContent(),'—');
        await h.page.evaluate(()=>window.__slotFixture.switchOwner('owner-a'));
        await waitResult(h,g);
      }));
      await check(g,'late error after A to B to A cannot repaint recovered result',scenario(['switch-error'],async h=>{
        await h.page.locator('#'+g.prefix+'-spin').click();
        await awaitState(()=>h.state.held.length);
        await h.page.evaluate(()=>window.__slotFixture.switchOwner('owner-b'));
        await h.page.waitForFunction(p=>document.getElementById(p+'-wallet').textContent==='$999.00',g.prefix);
        await h.page.evaluate(()=>window.__slotFixture.switchOwner('owner-a'));
        await waitResult(h,g);
        const status=await h.page.locator('#'+g.prefix+'-status').textContent();
        h.state.held.shift()();await h.page.waitForTimeout(100);
        assert.equal(await h.page.locator('#'+g.prefix+'-status').textContent(),status);
        assert.equal(h.state.requests.length,1);
      }));
      await check(g,'definite rejection releases saved request',scenario(['reject'],async h=>{
        await h.page.locator('#'+g.prefix+'-spin').click();
        await h.page.waitForFunction(p=>document.getElementById(p+'-status').textContent.includes('No new spin was placed')&&!document.getElementById(p+'-spin').disabled,g.prefix);
        assert.equal(h.state.commits,0);assert.equal(await h.page.locator('#'+g.prefix+'-spin').textContent(),'SPIN');
      }));
      // Storage failure must never allow an unrecorded paid request.
      await check(g,'storage denied submits nothing',scenario(['storage'],async h=>{
        await h.page.locator('#'+g.prefix+'-spin').click();
        await h.page.waitForFunction(p=>document.getElementById(p+'-status').textContent.includes('could not save'),g.prefix);
        assert.equal(h.state.requests.length,0);assert.equal(h.state.commits,0);
      }));
      if (g.prefix !== 'l7') for (const mode of ['lost','reload','never-reload']) await check(g,'final free spin '+mode,scenario([mode,true],async h=>{
        await h.page.locator('#'+g.prefix+'-spin').click();
        if(mode!=='lost'){await h.page.waitForFunction(p=>document.getElementById(p+'-spin').textContent==='RECOVER SPIN'&&!document.getElementById(p+'-spin').disabled,g.prefix);h.state.online=true;await h.page.reload({waitUntil:'domcontentloaded'});}
        await waitResult(h,g);
        assert.equal(await h.page.locator('#'+g.prefix+'-free-spins').textContent(),g.bonusTotal+' / '+g.bonusTotal);
        assert.equal(await h.page.locator('#'+g.prefix+'-dialog-title').textContent(),'Free spins complete');
        assert((await h.page.locator('#'+g.prefix+'-status').textContent()).includes('$11.75 total'));
      }));
    }
    process.stdout.write(JSON.stringify({passed:checks.length,productionRequests:0,cases:checks},null,2)+'\n');
    if(process.env.GD_RECEIPT_RESULTS)fs.writeFileSync(process.env.GD_RECEIPT_RESULTS,JSON.stringify({passed:checks.length,productionRequests:0,cases:checks},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
