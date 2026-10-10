const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
let server, browser, base;
const pages = {metrics:'gameday-control-center.html',analytics:'gameday-operator-analytics.html',health:'gameday-system-health.html'};
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:__session},error:null}),getUser:async()=>{const session=structuredClone(__session);if(__userHold)await new Promise(r=>__userWait=r);return{data:{user:session?.user},error:null}},onAuthStateChange(fn){__callbacks.push(fn);return{data:{subscription:{unsubscribe(){}}}}}}}}`;
const fixture = kind => kind==='metrics' ? {generated_at:new Date().toISOString(),sports_events:101,casino_rounds:9} : kind==='analytics' ? {generated_at:new Date().toISOString(),sportsbook:{wagers:101,handle:3,top_sports:[{name:'<img src=x onerror=alert(1)>',count:1}]},casino:{rounds:9,handle:12},wallet:{transactions:1}} : {ok:true,generated_at:new Date().toISOString(),overall:'attention',totals:{markets:101},checks:[{label:'Settlement ageing',status:'stale',detail:'One ticket requires review.'}]};
test.before(async()=>{
  server=http.createServer((request,response)=>{const name=path.join(root,new URL(request.url,'http://local').pathname);if(!name.startsWith(root+path.sep))return response.writeHead(403).end();try{response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');response.end(fs.readFileSync(name))}catch{return response.writeHead(404).end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function open(t,kind,{role='operator',forged=false,signedOut=false,hold=false,userHold=false,sdkFail=false,fakeClock=false,apiStatus=200,bodyHold=false}={}) {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});t.after(()=>context.close());
  await context.addInitScript(({role,forged,signedOut,userHold,bodyHold,payload})=>{
    window.__callbacks=[];window.__userHold=userHold;window.__userWait=null;
    window.__make=(owner,role)=>({access_token:'fixture-'+owner,user:{id:owner,app_metadata:{role},user_metadata:{role:'operator'}}});
    window.__session=signedOut?null:__make('A',role);
    if(forged)__session.user.app_metadata={};
    window.__emit=(event,session)=>{__session=session;for(const callback of __callbacks)callback(event,session)};
    if(bodyHold){const originalFetch=window.fetch;window.__bodyHold=true;window.__bodyStarted=false;window.fetch=(url,options)=>{
      if(String(url).includes('/functions/v1/gameday-operator-')){
        if(!__bodyHold)return Promise.resolve(new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}}));
        __bodyStarted=true;return Promise.resolve(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"ok":true,'))}}),{headers:{'Content-Type':'application/json'}}));
      }return originalFetch(url,options);
    }}
  },{role,forged,signedOut,userHold,bodyHold,payload:fixture(kind)});
  let requests=0, release, first=true;
  await context.route('https://**/*',async route=>{
    if(route.request().url().includes('@supabase/supabase-js@')) { if(sdkFail)return route.abort();return route.fulfill({contentType:'text/javascript',body:sdk}) }
    if(route.request().url().includes('/functions/v1/gameday-operator-')) {
      requests++;if(hold&&first){first=false;await new Promise(resolve=>release=resolve)}
      try{return await route.fulfill({status:apiStatus,contentType:'application/json',body:JSON.stringify(apiStatus===200?fixture(kind):{error:'Fixture data unavailable'})})}catch{return}
    }
    return route.abort();
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));if(fakeClock)await page.clock.install();
  await page.goto(base+'/'+pages[kind],{waitUntil:'commit'});t.after(()=>assert.deepEqual(errors,[]));
  return{page,get requests(){return requests},get release(){return release}};
}
async function notice(page,expression){await page.waitForFunction(source=>new RegExp(source).test(document.querySelector('#operatorNotice').textContent),expression.source)}
async function requestHeld(context){const until=Date.now()+10000;while(!context.release&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert(context.release,'operator request reached local fixture')}
for(const kind of Object.keys(pages)) {
  test(kind+': customer and forged metadata cannot request operator data',async t=>{
    const context=await open(t,kind,{role:'customer',forged:true});await notice(context.page,/Operator access required/);assert.equal(context.requests,0);assert.equal(await context.page.locator('.v').first().textContent(),'—');
  });
  test(kind+': signed-out customer receives usable sign-in guidance',async t=>{
    const context=await open(t,kind,{signedOut:true});await notice(context.page,/Sign in with an operator/);assert.equal(context.requests,0);assert(await context.page.locator('#operatorRetry').isEnabled());assert(await context.page.locator('a[href="gameday-auth.html"]').count());
  });
  test(kind+': trusted operator sees measured data',async t=>{
    const context=await open(t,kind);await notice(context.page,kind==='health'?/System needs attention/:kind==='metrics'?/Metrics loaded/:/Updated/);assert.equal(context.requests,1);assert.equal(await context.page.locator('.v').first().textContent(),'101');
    if(kind==='analytics'){assert.equal(await context.page.locator('#sportsMix img').count(),0);assert.match(await context.page.locator('#sportsMix').textContent(),/<img/);assert.equal(await context.page.locator('#casinoHandle').textContent(),'$12.00')}
    if(kind==='health'){assert.match(await context.page.locator('#checks').textContent(),/requires review/);assert.doesNotMatch(await context.page.locator('#overallText').textContent(),/operating normally/)}
  });
  test(kind+': sign-out clears data and late previous-operator reply stays hidden',async t=>{
    const context=await open(t,kind,{hold:true});await requestHeld(context);
    await context.page.evaluate(()=>__emit('SIGNED_OUT',null));await notice(context.page,/Sign in with an operator/);context.release();await context.page.waitForTimeout(30);assert.equal(await context.page.locator('.v').first().textContent(),'—');assert.match(await context.page.locator('#operatorNotice').textContent(),/Sign in with an operator/);
  });
  test(kind+': late role verification cannot paint switched customer',async t=>{
    const context=await open(t,kind,{userHold:true});await context.page.waitForFunction(()=>__userWait!==null);await context.page.evaluate(()=>{__userHold=false;__emit('SIGNED_IN',__make('B','customer'));__userWait()});await notice(context.page,/Operator access required/);assert.equal(context.requests,0);assert.equal(await context.page.locator('.v').first().textContent(),'—');
  });
  test(kind+': server role revocation denies access without showing aggregate data',async t=>{
    const context=await open(t,kind,{apiStatus:403});await notice(context.page,/permission may have changed/);assert.equal(context.requests,1);assert.equal(await context.page.locator('.v').first().textContent(),'—');assert(await context.page.locator('#operatorRetry').isEnabled());
  });
}
test('operator SDK import failure exposes a retry instead of indefinite Checking',async t=>{const context=await open(t,'metrics',{sdkFail:true});await notice(context.page,/Unable to connect/);assert(await context.page.locator('#operatorRetry').isEnabled());assert.equal(context.requests,0)});
test('operator stalled response is bounded and can retry',async t=>{
  const context=await open(t,'metrics',{hold:true,fakeClock:true});await requestHeld(context);await context.page.clock.fastForward(13000);await notice(context.page,/timed out/);assert(await context.page.locator('#operatorRetry').isEnabled());context.release();await context.page.click('#operatorRetry');await notice(context.page,/Metrics loaded/);assert.equal(context.requests,2);
});
test('operator partial JSON body times out and can retry without displaying incomplete data',async t=>{
  const context=await open(t,'metrics',{bodyHold:true,fakeClock:true});await context.page.waitForFunction(()=>__bodyStarted);await context.page.clock.fastForward(13000);await notice(context.page,/timed out/);assert.equal(await context.page.locator('.v').first().textContent(),'—');await context.page.evaluate(()=>__bodyHold=false);await context.page.click('#operatorRetry');await notice(context.page,/Metrics loaded/);
});
