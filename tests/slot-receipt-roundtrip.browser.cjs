// Run: CHROMIUM_PATH=/usr/bin/chromium node tests/slot-receipt-roundtrip.browser.cjs
// Omit CHROMIUM_PATH to use Playwright's installed Chromium in CI.
// Exercises current browser controllers → current Edge handlers → isolated PostgreSQL.
// Starts its own ephemeral local server and blocks all real external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const backend = require('./helpers/slot-receipt-fixture.cjs');
const games = [
  { game: 'midnight-monsters', prefix: 'mm', page: 'gameday-midnight-monsters-v2.html', total: 2, bonusTotal: 10 },
  { game: 'galactic-rebellion', prefix: 'gr', page: 'gameday-galactic-rebellion-v2.html', total: 1, bonusTotal: 6 },
  { game: 'lucky-7s', prefix: 'l7', page: 'gameday-slots.html', total: 1 },
];
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
  const state = { requests:[], receipts:new Map(), commits:0, reads:0, online:!['unresolved','reload','never-reload'].includes(mode), wallet:401, bonus:free ? {id:'fixture-bonus',spins_remaining:1,total_spins:g.bonusTotal,bet_per_line:g.prefix==='gr'?1/243:.1,total_bet:g.total,total_payout:8,wager_mode:'ways',math_version:'ways-v1'}:null, held:[], errors:[], unexpectedExternal:[], storedBeforeSend:[] };
  const isolated = await backend.fixture();
  await isolated.db.query('update wallets set balance=case when user_id=$1 then 401 else 999 end',[backend.user]);
  const serviceFor = owner => services.get(owner);
  const services = new Map([['owner-a', backend.handler(g.prefix==='l7'?'slots-test':'themed-slots-test',isolated.db,{owner:backend.user})],
    ['owner-b', backend.handler(g.prefix==='l7'?'slots-test':'themed-slots-test',isolated.db,{owner:backend.other})]]);
  state.db = isolated.db;
  if(free){
    state.bonus.id = require('node:crypto').randomUUID();
    await isolated.db.query("insert into themed_slot_bonus_sessions(id,user_id,game,bet_per_line,spins_remaining,total_spins,total_payout,status) values($1,$2,$3,$4,1,$5,8,'active')",[state.bonus.id,backend.user,g.game,state.bonus.bet_per_line,g.bonusTotal]);
  }
  await context.addInitScript(({blocked}) => {
    window.__slotFixture = { session:{user:{id:'owner-a'},access_token:'owner-a'}, listeners:[], switchOwner(owner){this.session=owner?{user:{id:owner},access_token:owner}:null;this.listeners.forEach(fn=>fn(owner?'SIGNED_IN':'SIGNED_OUT',this.session));} };
    if (blocked) Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('Fixture denied','SecurityError')}});
  }, { blocked:mode==='storage' });
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    state.unexpectedExternal.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({status:200,contentType:'text/javascript',body:sdk}));
  await context.route('**/__fixture-wallet?*', async route => {
    const owner = new URL(route.request().url()).searchParams.get('owner');
    const balance = await isolated.wallet(owner==='owner-a'?backend.user:backend.other);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({balance})});
  });
  const answer = (route, body, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await context.route('https://**.supabase.co/**', async route => {
    const req = route.request();
    const body = req.postDataJSON();
    const owner = req.headers().authorization.replace('Bearer ','');
    const service = serviceFor(owner);
    assert(service, 'Only isolated fixture owners can reach the Edge loader');
    if (body.action === 'status') {const out=await service.request(body);return answer(route,out.body,out.status);}
    const key = owner+':'+body.request_id;
    if (body.action === 'receipt') {
      state.reads++;
      if (!state.online) return route.abort('failed');
      const out=await service.request(body);return answer(route,out.body,out.status);
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
      const before=await isolated.counts();const out=await service.request(body);assert.deepEqual(out.body,previous.result);assert.deepEqual(await isolated.counts(),before);return answer(route,out.body,out.status);
    }
    const out = await service.request(body);
    assert.equal(out.status,200,JSON.stringify(out.body));
    const result = out.body;
    state.wallet = result.spin.balance;
    state.commits++;
    state.receipts.set(key,{body:structuredClone(body),result});
    if (mode==='switch'||mode==='switch-error') await new Promise(resolve=>state.held.push(resolve));
    if (['lost','unresolved','reload','switch-error'].includes(mode) && state.requests.length===1) return route.abort('failed');
    if (mode==='invalid' && state.requests.length===1) return answer(route,{...result,spin:{...result.spin,grid:[['INVALID']]}});
    return answer(route,result);
  });
  const page = await context.newPage();
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.goto(base+g.page,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(p=>!document.getElementById(p+'-spin').disabled,g.prefix);
  return { context,page,state,close:async()=>{state.held.forEach(fn=>fn());await context.close();await isolated.db.close();} };
}
async function waitResult(h,g) {
  await awaitState(()=>h.state.receipts.size);
  const expectedPayout=[...h.state.receipts.values()][0].result.spin.payout;
  await h.page.waitForFunction(({p,payout,game})=>document.getElementById(p+'-win').textContent==='$'+payout.toFixed(2)&&!document.getElementById(p+'-reels').classList.contains('is-spinning')&&!localStorage.getItem('gameday-slot-pending:'+game+':owner-a'),{p:g.prefix,payout:expectedPayout,game:g.game});
  const receipt = [...h.state.receipts.values()][0].result.spin;
  const symbols = await h.page.locator('.'+g.prefix+'-reel .'+g.prefix+'-symbol').evaluateAll(nodes=>nodes.map(n=>n.dataset.symbol));
  assert.deepEqual(symbols,receipt.grid.flat(),'exact receipt symbols displayed');
  assert.equal(await h.page.locator('#'+g.prefix+'-wallet').textContent(),'$'+h.state.wallet.toFixed(2));
  assert.equal(h.state.commits,1,'only one committed spin/debit');
  assert.equal((await h.state.db.query('select count(*)::int n from slot_request_receipts')).rows[0].n,1);
  assert.equal((await h.state.db.query('select (select count(*) from slot_spins)+(select count(*) from themed_slot_bonus_spins) n')).rows[0].n,1);
  assert.equal((await h.state.db.query("select count(*)::int n from wallet_transactions where transaction_type='wager_debit'")).rows[0].n,[...h.state.receipts.values()][0].result.spin.free_spin?0:1);
  assert.deepEqual(h.state.errors,[],'no browser errors');
  assert.deepEqual(h.state.unexpectedExternal,[],'all external requests were handled locally');
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
  let browser;
  try {
    browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
  } catch (error) {
    await new Promise(resolve=>server.close(resolve));
    throw error;
  }
  const checks=[];
  async function check(g,name,fn) {const h=await fixture(browser,base,g,...fn.options);try{await fn(h);assert.deepEqual(h.state.unexpectedExternal,[],'no real external requests');checks.push({game:g.game,case:name,passed:true,commits:h.state.commits,requests:h.state.requests.length});process.stdout.write('PASS '+g.game+' '+name+'\n');}finally{await h.close();}}
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
        const total=[...h.state.receipts.values()][0].result.spin.bonus_total_payout;assert((await h.page.locator('#'+g.prefix+'-status').textContent()).includes('$'+total.toFixed(2)+' total'));
      }));
    }
    process.stdout.write(JSON.stringify({passed:checks.length,productionRequests:0,cases:checks},null,2)+'\n');
    if(process.env.GD_RECEIPT_RESULTS)fs.writeFileSync(process.env.GD_RECEIPT_RESULTS,JSON.stringify({passed:checks.length,productionRequests:0,cases:checks},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
