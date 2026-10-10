// Actual controllers, Edge handlers and migrated PostgreSQL; all network calls are isolated.
// Run CHROMIUM_PATH=/usr/bin/chromium node tests/card-deal-recovery.browser.cjs locally.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path'),http=require('http');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('crypto'),{chromium}=require('playwright');
const {PGlite}=require(process.env.GAMEDAY_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');let base;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const card=rank=>({rank:String(rank),suit:'♠'});
const sdk=`export function createClient(){let id=sessionStorage.getItem('fixture-owner')||'${A}',cb;window.__switchCardUser=next=>{id=next;sessionStorage.setItem('fixture-owner',id||'');cb?.(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id},access_token:id}:null)};const session=()=>id?{user:{id},access_token:id}:null;async function invoke(name,{body,signal}={}){try{const r=await fetch('https://qsvrvhcklnsbekxblpfo.supabase.co/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+id},body:JSON.stringify(body||{}),signal});const data=await r.clone().json();return r.ok?{data,error:null}:{data:null,error:{message:data.error,context:r}}}catch(e){return {data:null,error:{message:e.message}}}}return{auth:{getSession:async()=>({data:{session:session()},error:null}),onAuthStateChange:fn=>{cb=fn;return {data:{subscription:{unsubscribe(){}}}}}},functions:{invoke},from(){return {select(){return this},eq(){return this},single:async()=>{const r=await invoke('fixture-wallet');return r}}}}}`;
async function backend(game){
 const db=new PGlite();await db.waitReady;
 await db.exec(fs.readFileSync(root+'/tests/fixtures/card-deal-baseline.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/supabase/restore/historical-prerequisites/20260912060000_add_blackjack_double_split.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261010110710_card_deal_request_recovery.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261010121802_blackjack_insurance_decision.sql','utf8'));
 await db.query('insert into auth.users values($1),($2)',[A,B]);await db.query('insert into wallets(user_id,balance) values($1,1000),($2,1000)',[A,B]);
 let handler;
 const admin={from(table){const filters=[];let ordered=false,limited=false;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){ordered=true;return q},limit(){limited=true;return q},async single(){return q.maybeSingle()},async maybeSingle(){try{const r=await db.query(`select * from ${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}${ordered?' order by created_at desc':''}${limited?' limit 1':''}`,filters.map(([,v])=>v));return{data:r.rows[0]||null,error:null}}catch(e){return{data:null,error:{message:e.message}}}}};return q},async rpc(name,p){try{const r=await db.query(`select * from ${name}(${Object.keys(p).map((k,i)=>`${k}=>$${i+1}`).join(',')})`,Object.values(p).map(v=>Array.isArray(v)?JSON.stringify(v):v));return{data:r.rows,error:null}}catch(e){return{data:null,error:{message:e.message}}}}};
 const ctx=vm.createContext({Response,Request,Error,Uint32Array,crypto:webcrypto,console,Deno:{env:{get:k=>k},serve:fn=>handler=fn},createClient(_url,_key,options){if(!options)return admin;const id=options.global.headers.Authorization.replace('Bearer ','');return{auth:{getUser:async()=>({data:{user:[A,B].includes(id)?{id}:null},error:null})}}}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(root+'/supabase/functions/'+game+'-test/index.ts','utf8').replace(/^import .*;\n/gm,'')),ctx);
 if(game==='blackjack')ctx.shuffle=()=>[card(8),card(2),card(7),card(6),card(10)];
 else ctx.baccaratDeal=()=>({player:[card(9),card(10)],banker:[card(8),card(10)],playerTotal:9,bankerTotal:8});
 return{db,handler,async debits(id=A){return (await db.query("select count(*)::int as count from wallet_transactions where transaction_type='wager_debit' and user_id=$1",[id])).rows[0].count},async wallet(id=A){return Number((await db.query('select balance from wallets where user_id=$1',[id])).rows[0].balance)}};
}
(async()=>{
const server=http.createServer((req,res)=>{
 const filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!filename.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
 try{const bytes=fs.readFileSync(filename),ext=path.extname(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[ext]||'application/octet-stream'});res.end(bytes)}catch(_){res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});const report=[];
try{for(const game of ['blackjack','baccarat'])for(const scenario of ['before-auto','before-reload','commit-auto','commit-reload','before-manual','account-switch','insufficient-recovery']){
 const f=await backend(game),calls=[],errors=[];let attempts=0,allow=false;
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await context.route('https://**.supabase.co/**',async r=>{
  const req=r.request(),body=req.postDataJSON(),id=req.headers().authorization.replace('Bearer ','');calls.push({id,body});
  if(req.url().endsWith('/fixture-wallet'))return r.fulfill({contentType:'application/json',body:JSON.stringify({balance:await f.wallet(id)})});
  const dealing=game==='blackjack'?body.action==='start':!body.action;
  const lost=dealing&&id===A&&!allow&&++attempts <= (scenario.endsWith('-auto')?1:2);
  if(lost&&['before-auto','before-reload','before-manual','account-switch','insufficient-recovery'].includes(scenario))return r.abort();
  const response=await f.handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer '+id},body:JSON.stringify(body)}));
  if(lost)return r.abort();
  return r.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
 });
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'gameday-'+game+'.html');
 const chip=p.locator('[data-wager-chip="1"]'),deal=p.locator('[data-table-action="deal"]');
 const settled=()=>p.waitForFunction(game=>game==='blackjack'?document.querySelector('.gd-blackjack-result')?.hidden===false:document.querySelector('.gd-baccarat-result')?.hidden===false,game);
 const stable=()=>p.waitForFunction(game=>game==='blackjack'?document.querySelector('.gd-wager-surface')?.dataset.dealBusy==='false':document.querySelector('.gd-baccarat-retry')?.disabled===false&&document.querySelector('.game-stage')?.dataset.baccaratPhase!=='busy',game);
 const retry=p.locator(game==='blackjack'?'.gd-blackjack-recovery button':'.gd-baccarat-retry');
 await p.waitForFunction(()=>document.querySelector('[data-wager-chip="1"]')?.disabled===false);
 if(game==='baccarat')await p.locator('[data-table-action="player"]').click();await deal.click();await stable();
 if(!scenario.endsWith('-auto')){
  await retry.waitFor({state:'visible'});assert.equal(await chip.isEnabled(),false);assert.equal(await f.debits(),scenario.startsWith('commit')?1:0);
  allow=true;
  if(scenario==='insufficient-recovery'){
   const original=calls.find(c=>c.id===A&&c.body.request_id).body;
   await f.db.query('update wallets set balance=0 where user_id=$1',[A]);
   await retry.click();await stable();
   assert.equal(await chip.isEnabled(),true);assert.equal(await deal.isEnabled(),false);assert.equal(await f.debits(),0);
   assert.equal(await p.locator(game==='blackjack'?'#gd-blackjack-balance':'#balance').textContent(),'$0.00');
   assert.match(await p.locator('.gd-table-actions-status').textContent(),/not accepted.*no credits were deducted/i);
   const key=game==='blackjack'?'gameday:blackjack:pending:'+A:'gameday:baccarat-pending:'+A;
   assert.equal(await p.evaluate(k=>localStorage.getItem(k)||sessionStorage.getItem(k),key),null);
   await f.db.query('update wallets set balance=1000 where user_id=$1',[A]);
   const delayed=await f.handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer '+A},body:JSON.stringify(original)}));
   assert.equal(delayed.status,400);assert.equal(await f.debits(),0);
   await p.reload();await p.waitForFunction(()=>document.querySelector('[data-wager-chip="1"]')?.disabled===false);
   if(game==='baccarat')await p.locator('[data-table-action="player"]').click();await deal.click();await stable();
  }else if(scenario==='account-switch'){
   await p.evaluate(id=>window.__switchCardUser(id),B);await p.waitForFunction(()=>document.querySelector('[data-wager-chip="1"]')?.disabled===false);
   assert.equal(await f.debits(B),0);assert.equal(await p.locator(game==='blackjack'?'#gd-blackjack-balance':'#balance').textContent(),'$1,000.00');
   assert.equal(calls.filter(c=>c.id===B&&c.body.request_id).length,0);
   await p.evaluate(id=>window.__switchCardUser(id),A);await stable();
  }else if(scenario.endsWith('-reload')){await p.reload();await stable();}
  else{await retry.click();await stable();}
 }
 if(game==='blackjack'){
  await p.waitForFunction(()=>document.querySelector('[data-table-action="stand"]')?.disabled===false);
  assert.equal(await p.locator('.gameday-card-back').count(),1);
  await p.locator('[data-table-action="stand"]').click();await settled();await stable();
 }else await settled();
 assert.equal(await chip.isEnabled(),true);assert.equal(await f.debits(),1);
 const intents=calls.filter(c=>c.id===A&&c.body.request_id);assert(intents.length>=2);assert.equal(new Set(intents.map(c=>c.body.request_id)).size,scenario==='insufficient-recovery'?2:1);
 const target=game==='blackjack'?'blackjack_hands':'baccarat_rounds';const saved=(await f.db.query('select * from '+target+' where user_id=$1',[A])).rows[0];
 const retryResult=await f.handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer '+A},body:JSON.stringify(intents.at(-1).body)}));assert.equal(retryResult.status,200);
 const replay=await retryResult.json();assert.equal((replay.hand||replay.round).id,saved.id);assert.equal(await f.debits(),1);
 await p.reload();await settled();await stable();assert.equal(await chip.isEnabled(),true);assert.equal(await f.debits(),1);
 await chip.click();await chip.click();assert.equal(await chip.isEnabled(),true);assert.deepEqual(errors,[]);
 report.push({game,scenario,pass:true,requests:intents.length,debits:await f.debits(),wallet:await f.wallet(),actualController:true,actualEdge:true,actualSQL:true});console.log('PASS '+game+' '+scenario);
 await context.close();await f.db.close();
}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));if(process.env.GAMEDAY_CARD_REPORT)fs.writeFileSync(process.env.GAMEDAY_CARD_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.length,allPassed:report.length===14&&report.every(c=>c.pass),productionMutations:0}));}
})().catch(e=>{console.error(e);process.exitCode=1});
