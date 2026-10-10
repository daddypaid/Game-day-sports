const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {fixture,A,B,cards}=require('./fixtures/blackjack-insurance-fixture.cjs');
const root=path.resolve(__dirname,'..');
const sdk=`export function createClient(){let id=sessionStorage.getItem('fixture-owner')||'${A}',cb;window.__switchInsuranceUser=next=>{id=next;sessionStorage.setItem('fixture-owner',id||'');cb?.(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id},access_token:id}:null)};const session=()=>id?{user:{id},access_token:id}:null;return{auth:{getSession:async()=>({data:{session:session()},error:null}),onAuthStateChange:fn=>{cb=fn;return {data:{subscription:{unsubscribe(){}}}}}},from(){return {select(){return this},eq(){return this},single:async()=>{const r=await fetch('https://fixture.invalid/wallet',{headers:{Authorization:'Bearer '+id}});return{data:await r.json(),error:null}}}}}}`;
async function server(){const server=http.createServer((req,res)=>{const relative=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1);const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}const ext=path.extname(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'}[ext]||'application/octet-stream'});res.end(data);});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};}

test('Actual blackjack page, service and SQL recover insurance decisions, hide cards and finish rounds',async t=>{
 const s=await server();const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 try{for(const scenario of ['accept','decline','reload-pending','lost-before','lost-after','no-blackjack','low-balance','account-switch'])await t.test(scenario,async()=>{
  const f=await fixture(scenario==='no-blackjack'?{player:cards(10,8),dealer:cards('A',6),draws:cards(2)}:scenario==='low-balance'?{balance:1}:{});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});let lost=false;const errors=[],requests=[];
  try{
   await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
   await context.route('https://fixture.invalid/wallet',async r=>r.fulfill({contentType:'application/json',body:JSON.stringify({balance:await f.wallet(r.request().headers().authorization.replace('Bearer ',''))})}));
   await context.route('https://**.supabase.co/**',async r=>{const body=r.request().postDataJSON(),id=r.request().headers().authorization.replace('Bearer ','');requests.push({body,id});const drop=body.action==='insure'&&!lost&&scenario.startsWith('lost-');if(drop){lost=true;if(scenario==='lost-before')return r.abort();}const response=await f.handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer '+id},body:JSON.stringify(body)}));if(drop)return r.abort();return r.fulfill({status:response.status,contentType:'application/json',body:await response.text()});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(s.url+'gameday-blackjack.html');
   const chip=page.locator('[data-wager-chip="1"]'),deal=page.locator('[data-table-action="deal"]'),insure=page.locator('[data-table-action="insure"]'),decline=page.locator('[data-table-action="decline_insurance"]');
   const stable=()=>page.waitForFunction(()=>document.querySelector('.gd-wager-surface')?.dataset.dealBusy==='false');
   const pending=()=>page.waitForFunction(()=>document.querySelector('[data-table-action="decline_insurance"]')?.disabled===false);
   const complete=()=>page.waitForFunction(()=>document.querySelector('.gd-blackjack-result')?.hidden===false);
   await page.waitForFunction(()=>document.querySelector('[data-table-action="deal"]')?.disabled===false);await deal.click();await pending();await stable();
   assert.equal(await chip.isEnabled(),false);assert.equal(await page.locator('[data-table-action="stand"]').isEnabled(),false);assert.equal(await page.locator('.gameday-card-back').count(),1);assert.equal(await f.wallet(),scenario==='low-balance'?0:99);
   assert.match(await insure.textContent(),/\$0\.50/);
   if(scenario==='reload-pending'){await page.reload();await pending();assert.equal(await f.wallet(),99);}
   if(scenario==='account-switch'){await page.evaluate(id=>window.__switchInsuranceUser(id),B);await page.waitForFunction(()=>document.querySelector('[data-table-action="deal"]')?.disabled===false);assert.equal(await page.locator('.gd-blackjack-insurance').isVisible(),false);assert.equal(await page.locator('#gd-blackjack-balance').textContent(),'$100.00');await page.evaluate(id=>window.__switchInsuranceUser(id),A);await pending();assert.equal(await f.wallet(B),100);}
   if(scenario==='low-balance'){assert.equal(await insure.isEnabled(),false);assert.equal(await decline.isEnabled(),true);await decline.click();}
   else if(scenario==='decline')await decline.click();
   else{await insure.click();await stable();if(scenario==='lost-before'){await pending();assert.equal(await f.wallet(),99);await insure.click();}}
   if(scenario==='no-blackjack'){await page.waitForFunction(()=>document.querySelector('[data-table-action="stand"]')?.disabled===false);assert.equal(await page.locator('.gameday-card-back').count(),1);await page.locator('[data-table-action="stand"]').click();}
   await complete();await stable();assert.equal(await chip.isEnabled(),true);assert.equal(await page.locator('.gd-blackjack-insurance').isVisible(),false);
   const expectedWallet=scenario==='low-balance'?0:scenario==='decline'?99:scenario==='no-blackjack'?98.5:100;assert.equal(await f.wallet(),expectedWallet);
   const result=await page.locator('.gd-blackjack-result').textContent();if(!['low-balance','decline','no-blackjack'].includes(scenario))assert.match(result,/Wager \$1\.50 · Returned \$1\.50 · Net \$0\.00/);
   await page.reload();await complete();await stable();assert.equal(await chip.isEnabled(),true);assert.equal(await f.wallet(),expectedWallet);assert.equal((await f.ledger()).filter(r=>r.note==='Blackjack test insurance wager debit').length,['low-balance','decline'].includes(scenario)?0:1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
  }finally{await context.close();await f.db.close();}
 });}finally{await browser.close();await s.close();}
});
