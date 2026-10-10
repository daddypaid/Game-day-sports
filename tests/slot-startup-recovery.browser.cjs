// Local browser checks for bounded SDK startup, reconnect, wager guidance and history.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { fixture, waitResult, games, sdk, config } = require('./slot-receipt-recovery.browser.cjs');
const root = path.resolve(__dirname, '..');
const limits = g => g.prefix === 'mm' ? '$2.00–$200.00' : '$0.10–$200.00';
function shortConnections() {
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => timeout(fn, [8000,10000].includes(ms) ? 500 : ms, ...args);
}
async function run() {
  const server = http.createServer((req,res) => {
    const filename = path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if (!filename.startsWith(root+path.sep)) {res.writeHead(403);return res.end();}
    try { const data=fs.readFileSync(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(filename)]||'application/octet-stream'});res.end(data); }
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/';
  let browser;
  try {browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});}
  catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
  const checks=[];
  async function check(g,name,fn,mode='normal') {
    const h=await fixture(browser,base,g,mode);
    try {await h.context.addInitScript(shortConnections);await fn(h);assert.deepEqual(h.state.errors,[],'no page errors');checks.push({game:g.game,case:name,passed:true});process.stdout.write('PASS '+g.game+' '+name+'\n');}
    finally{await h.close();}
  }
  const retry = (h,g) => h.page.locator('#'+g.prefix+'-status').getByRole('button',{name:'RETRY CONNECTION'});
  const ready = (h,g) => h.page.waitForFunction(p=>!document.getElementById(p+'-spin').disabled&&document.getElementById(p+'-wallet').textContent!=='—',g.prefix);
  try {
    for(const g of games){
      await check(g,'failed SDK import has usable retry and visible reels',async h=>{
        let blocked=true;const urls=[];
        await h.context.route('https://cdn.jsdelivr.net/**',r=>{urls.push(r.request().url());return blocked?r.abort('failed'):r.fulfill({status:200,contentType:'text/javascript',body:sdk});});
        await h.page.reload({waitUntil:'domcontentloaded'});
        await retry(h,g).waitFor();
        assert.equal(await h.page.locator('.'+g.prefix+'-reel .'+g.prefix+'-symbol').count(),g.prefix==='l7'?9:15);
        assert(await h.page.locator('#'+g.prefix+'-spin').isDisabled());assert(await h.page.locator('#'+g.prefix+'-auto').isDisabled());
        blocked=false;await retry(h,g).click();await ready(h,g);
        assert.equal(urls.length,2,'retry starts a new document and fresh SDK dependency graph');assert.equal(h.state.requests.length,0);
      });
      await check(g,'hung SDK import times out and late import cannot create duplicate client',async h=>{
        let release;let first=true;
        const instrumented=sdk.replace('return {auth:', 'window.__slotFixture.clients=(window.__slotFixture.clients||0)+1;return {auth:');
        await h.context.route('https://cdn.jsdelivr.net/**',async r=>{if(first){first=false;await new Promise(resolve=>release=resolve);}await r.fulfill({status:200,contentType:'text/javascript',body:instrumented});});
        await h.page.reload({waitUntil:'domcontentloaded'});await retry(h,g).waitFor();
        await retry(h,g).click();await ready(h,g);release();await h.page.waitForTimeout(100);
        assert.equal(await h.page.evaluate(()=>window.__slotFixture.clients),1);assert.equal(await h.page.evaluate(()=>window.__slotFixture.listeners.length),1);
        assert.equal(h.state.requests.length,0);
      });
      await check(g,'SDK retry preserves committed pending UUID and recovers exact receipt',async h=>{
        await h.page.locator('#'+g.prefix+'-spin').click();
        await h.page.waitForFunction(p=>document.getElementById(p+'-spin').textContent==='RECOVER SPIN'&&!document.getElementById(p+'-spin').disabled,g.prefix);
        const saved=await h.page.evaluate(game=>localStorage.getItem('gameday-slot-pending:'+game+':owner-a'),g.game);
        let blocked=true;
        await h.context.route('https://cdn.jsdelivr.net/**',r=>blocked?r.abort('failed'):r.fulfill({status:200,contentType:'text/javascript',body:sdk}));
        await h.page.reload({waitUntil:'domcontentloaded'});await retry(h,g).waitFor();
        assert.equal(await h.page.evaluate(game=>localStorage.getItem('gameday-slot-pending:'+game+':owner-a'),g.game),saved);
        blocked=false;h.state.online=true;await retry(h,g).click();await waitResult(h,g);
        assert.equal(h.state.requests.length,1);assert.equal(h.state.commits,1);
      },'unresolved');
      await check(g,'hung session read clears balance and reconnects without wagers',async h=>{
        const sessionSdk=sdk.replace('getSession:async()=>({', "getSession:async()=>{if(window.__slotFixture.sessionBlocked)await new Promise(()=>{});return ({").replace('error:null}),onAuthStateChange:', 'error:null});},onAuthStateChange:');
        await h.context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:sessionSdk}));
        await h.page.reload({waitUntil:'domcontentloaded'});await ready(h,g);
        await h.page.evaluate(()=>{window.__slotFixture.sessionBlocked=true;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
        await retry(h,g).waitFor();assert.equal(await h.page.locator('#'+g.prefix+'-wallet').textContent(),'—');assert(await h.page.locator('#'+g.prefix+'-spin').isDisabled());
        await h.page.evaluate(()=>window.__slotFixture.sessionBlocked=false);await retry(h,g).click();await ready(h,g);assert.equal(h.state.requests.length,0);
      });
      await check(g,'expired server session clears balance and locks wagers until retry',async h=>{
        let expired=true;
        await h.context.route('https://**.supabase.co/**',r=>{
          if(r.request().postDataJSON()?.action==='status'&&expired)return r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Sign in again to reconnect.'})});
          return r.fallback();
        });
        await h.page.reload({waitUntil:'domcontentloaded'});await retry(h,g).waitFor();
        assert.equal(await h.page.locator('#'+g.prefix+'-wallet').textContent(),'—');assert(await h.page.locator('#'+g.prefix+'-spin').isDisabled());
        expired=false;await retry(h,g).click();await ready(h,g);assert.equal(h.state.requests.length,0);
      });
      if(g.prefix!=='mm')await check(g,'wager limits follow loaded service configuration',async h=>{
        const changed={...config(g),min_total_bet:.5,max_total_bet:20,total_bet_step:.5,default_total_bet:1};
        await h.context.route('https://**.supabase.co/**',r=>r.request().postDataJSON()?.action==='status'?r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,bonus:null,game_config:changed})}):r.fallback());
        await h.page.reload({waitUntil:'domcontentloaded'});await ready(h,g);
        assert((await h.page.locator('#'+g.prefix+'-total-bet').getAttribute('title')).includes('$0.50–$20.00'));
        await h.page.locator('#'+g.prefix+'-info').click();assert((await h.page.locator('#'+g.prefix+'-dialog-content').textContent()).includes('$0.50–$20.00 in $0.50 steps'));
      });
      await check(g,'wager limits and history are discoverable in existing Info and Menu',async h=>{
        assert((await h.page.locator('#'+g.prefix+'-total-bet').getAttribute('title')).includes(limits(g)));
        await h.page.locator('#'+g.prefix+'-info').click();assert((await h.page.locator('#'+g.prefix+'-dialog-content').textContent()).includes(limits(g)));
        await h.page.locator('#'+g.prefix+'-dialog-close').click();await h.page.locator('#'+g.prefix+'-menu').click();
        assert((await h.page.getByRole('link',{name:'Casino history',exact:true}).getAttribute('href')).endsWith('gameday-casino-history.html'));
      });
    }
    const context=await browser.newContext({serviceWorkers:'block'});await context.route('https://**/*',r=>r.abort('blockedbyclient'));const page=await context.newPage();await page.goto(base+'gameday-slots-lobby.html');
    const hero=await page.locator('.hero').textContent();assert(hero.includes('5 paylines'));assert(hero.includes('20 paylines'));assert(hero.includes('243 ways'));
    assert.equal(await page.locator('.game').count(),3);assert((await page.locator('.art.classic').evaluate(el=>getComputedStyle(el).backgroundImage)).includes('assets/lucky-7s/lobby-preview.webp'));
    checks.push({game:'slots-lobby',case:'accurate payline and ways descriptions with original previews',passed:true});await context.close();
    const result={passed:checks.length,productionRequests:0,cases:checks};process.stdout.write(JSON.stringify(result,null,2)+'\n');if(process.env.GD_SLOT_STARTUP_RESULTS)fs.writeFileSync(process.env.GD_SLOT_STARTUP_RESULTS,JSON.stringify(result,null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
