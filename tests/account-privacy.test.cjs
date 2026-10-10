// Browser regression tests for account isolation. All SDK/network activity is mocked;
// no sign-ins, wallet mutations, or private records reach a live service.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser, server, base;
const sdk = `export function createClient(){
  const unlocked=()=>{if(window.__authLock)throw Error('SDK called inside onAuthStateChange')};
  const result=async(action,value)=>{unlocked();return __request(action,value)};
  return {auth:{
    getSession:()=>result('getSession',{data:{session:structuredClone(__session)},error:null}),
    onAuthStateChange(fn){__authCallbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},
    signOut:async()=>{const r=await result('signOut',{error:null});__emit('SIGNED_OUT',null);return r},
    signInWithPassword:async({email})=>{const session={user:{id:'A',email},access_token:'fixture-A'};const r=await result('signIn',{data:{user:session.user,session},error:__authError});if(!r.error)__emit('SIGNED_IN',session);return r},
    signUp:()=>result('signUp',{data:{session:null,user:null},error:__authError}),
    resetPasswordForEmail:()=>result('reset',{error:__authError}),
    updateUser:async()=>{const user=structuredClone(__session?.user);const r=await result('password',{data:{user},error:__authError});return r}
  },from(table){
    unlocked();const owner=__session?.user.id;const q={table,owner,filters:[],select(){return this},eq(...args){this.filters.push(args);return this},in(){return this},not(){return this},order(){return this},limit(){return this},single(){return __query(this)},then(resolve,reject){return __query(this).then(resolve,reject)}};return q
  },functions:{invoke:(name,options)=>{__calls.push({action:'refillAuthorization',authorization:options.headers.Authorization});return result('refill',{data:{ok:true,credited:976,balance:1000},error:null})}}};
}`;
test.before(async () => {
  server = http.createServer((req, res) => {
    const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
    try {res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch {res.writeHead(404).end()}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function open(t,file,{gate=[],gateActions=[],signedOut=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});t.after(()=>context.close());
  await context.addInitScript(({gate,gateActions,signedOut})=>{
    const user=id=>({user:{id,email:id+'@example.invalid'},access_token:'fixture-'+id});
    const wagers=id=>[{id,wager_type:'single',stake:5,potential_return:10,status:'accepted',placed_at:'2026-10-10T12:00:00Z',wager_selections:[{selection_name:id+' private selection',event_name:id+' private event',market_key:'h2h',american_odds:100}]}];
    window.__fixtures={A:{wallets:{balance:24},wallet_transactions:[{transaction_type:'adjustment',amount:24,note:'A private wallet note',created_at:'2026-10-10T12:00:00Z'}],wagers:wagers('A')},B:{wallets:{balance:500},wallet_transactions:[{transaction_type:'adjustment',amount:500,note:'B private wallet note',created_at:'2026-10-10T12:00:00Z'}],wagers:wagers('B')}};
    window.__user=user;window.__session=signedOut?null:user('A');window.__authCallbacks=[];window.__authLock=false;window.__calls=[];window.__gate=gate;window.__gateActions=gateActions;window.__pending=[];window.__pendingActions=[];window.__authError=null;window.__queryError=null;
    window.__request=async(action,value)=>{__calls.push({action});if(__gateActions.includes(action))await new Promise(resolve=>__pendingActions.push({action,resolve}));return value};
    window.__emit=(event,s)=>{__session=s;__authLock=true;try{for(const fn of __authCallbacks)fn(event,s)}finally{__authLock=false}};
    window.__query=async q=>{const entry={table:q.table,owner:q.owner,filters:structuredClone(q.filters)};__calls.push(entry);const data=structuredClone(__fixtures[q.owner]?.[q.table]||[]),error=__queryError;if(__gate.includes(q.owner))await new Promise(resolve=>__pending.push({owner:q.owner,resolve}));return {data,error}};
    window.__release=owner=>{__gate=__gate.filter(x=>x!==owner);for(const p of __pending.filter(x=>x.owner===owner))p.resolve();__pending=__pending.filter(x=>x.owner!==owner)};
    window.__releaseAction=action=>{__gateActions=__gateActions.filter(x=>x!==action);for(const p of __pendingActions.filter(x=>x.action===action))p.resolve();__pendingActions=__pendingActions.filter(x=>x.action!==action)};
  },{gate,gateActions,signedOut});
  await context.route('https://**/*',async route=>{
    if(route.request().url().includes('/@supabase/supabase-js@'))return route.fulfill({contentType:'text/javascript',body:sdk});
    if(route.request().url().endsWith('/auth/v1/user')){
      const response=await route.request().frame().evaluate(async authorization=>{
        const user=structuredClone(__session?.user);__calls.push({action:'passwordAuthorization',authorization});
        return __request('password',{user,error:__authError});
      },route.request().headers()['authorization']);
      return route.fulfill({status:response.error?400:200,contentType:'application/json',body:JSON.stringify(response.error||response.user)});
    }
    return route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/'+file);
  await page.waitForFunction(()=>window.__authCallbacks.length===1);
  t.after(()=>assert.deepEqual(errors,[],'no JS errors or SDK lock re-entry'));
  return page;
}
async function accountReady(page,owner='A'){await page.waitForFunction(owner=>document.querySelector('#accountEmail').textContent===owner+'@example.invalid'&&document.querySelector('#walletBalance').textContent===(owner==='A'?'$24.00':'$500.00'),owner)}
async function betsReady(page,owner='A'){await page.waitForFunction(owner=>document.querySelector('#openBets').textContent.includes(owner+' private selection'),owner)}
async function flush(page){await page.waitForTimeout(50)}
async function assertNoOwner(page,owner){const text=await page.locator('main').textContent();assert(!text.includes(owner+' private'),text);assert(!text.includes(owner+'@example.invalid'),text)}
test('Account clears A data and refill eligibility synchronously while B loads',async t=>{
  const p=await open(t,'gameday-auth.html');await accountReady(p);
  const snapshot=await p.evaluate(()=>{__gate=['B'];__emit('SIGNED_IN',__user('B'));return {email:accountEmail.textContent,wallet:walletBalance.textContent,tx:transactions.textContent,disabled:refillWallet.disabled}});
  assert.equal(snapshot.email,'B@example.invalid');assert.equal(snapshot.wallet,'—');assert(!snapshot.tx.includes('A private'));assert(snapshot.disabled);
  await p.waitForFunction(()=>__pending.length===2);await p.evaluate(()=>__release('B'));await accountReady(p,'B');
});
test('Account discards a late A wallet/history response after B loaded',async t=>{
  const p=await open(t,'gameday-auth.html',{gate:['A']});await p.waitForFunction(()=>__pending.length===2);
  await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await accountReady(p,'B');await p.evaluate(()=>__release('A'));await flush(p);await accountReady(p,'B');await assertNoOwner(p,'A');
});
test('Account signout clears all private DOM immediately and ignores pending reads',async t=>{
  const p=await open(t,'gameday-auth.html');await accountReady(p);await p.evaluate(()=>{__gate=['A']});await p.click('#refreshWallet');await p.waitForFunction(()=>__pending.length===2);
  const snapshot=await p.evaluate(()=>{__emit('SIGNED_OUT',null);return {email:accountEmail.textContent,wallet:walletBalance.textContent,tx:transactions.textContent,disabled:refillWallet.disabled,panelHidden:accountPanel.classList.contains('hidden')}});
  assert.equal(snapshot.email,'—');assert.equal(snapshot.wallet,'—');assert(!snapshot.tx.includes('A private'));assert(snapshot.disabled&&snapshot.panelHidden);
  await p.evaluate(()=>__release('A'));await flush(p);await assertNoOwner(p,'A');assert(await p.locator('#authForms').isVisible());
});
test('Account manual Sign Out clears data before the signout request resolves',async t=>{
  const p=await open(t,'gameday-auth.html',{gateActions:['signOut']});await accountReady(p);await p.click('#signoutBtn');await p.waitForFunction(()=>__pendingActions.length===1);await assertNoOwner(p,'A');assert(await p.locator('#authForms').isVisible());await p.evaluate(()=>__releaseAction('signOut'));await flush(p);await assertNoOwner(p,'A');
});
test('Account generation protects A to B to A from an older A response',async t=>{
  const p=await open(t,'gameday-auth.html',{gate:['A']});await p.waitForFunction(()=>__pending.length===2);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await accountReady(p,'B');
  await p.evaluate(()=>{__gate=[];__fixtures.A.wallets.balance=12;__fixtures.A.wallet_transactions[0].note='New A record';__emit('SIGNED_IN',__user('A'))});
  await p.waitForFunction(()=>walletBalance.textContent==='$12.00');await p.evaluate(()=>__release('A'));await flush(p);assert.equal(await p.locator('#walletBalance').textContent(),'$12.00');assert.match(await p.locator('#transactions').textContent(),/New A record/);
});
test('Account ignores an initial stale getSession response after B signs in',async t=>{
  const p=await open(t,'gameday-auth.html',{gateActions:['getSession']});await p.waitForFunction(()=>__pendingActions.length===1);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await accountReady(p,'B');await p.evaluate(()=>__releaseAction('getSession'));await flush(p);await accountReady(p,'B');await assertNoOwner(p,'A');
});
test('Account delayed refill cannot repaint a new user or launch stale wallet reads',async t=>{
  const p=await open(t,'gameday-auth.html',{gateActions:['refill']});await accountReady(p);await p.click('#refillWallet');await p.waitForFunction(()=>__pendingActions.length===1);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await accountReady(p,'B');
  const reads=await p.evaluate(()=>__calls.filter(x=>x.table).length);await p.evaluate(()=>__releaseAction('refill'));await flush(p);await accountReady(p,'B');assert.equal(await p.evaluate(()=>__calls.find(x=>x.action==='refillAuthorization').authorization),'Bearer fixture-A');assert.equal(await p.evaluate(()=>__calls.filter(x=>x.table).length),reads);assert(!await p.locator('#status').textContent().then(x=>x.includes('refilled')));
});
test('Account late password update cannot leave B in A recovery mode',async t=>{
  const p=await open(t,'gameday-auth.html',{gateActions:['password']});await accountReady(p);await p.evaluate(()=>__emit('PASSWORD_RECOVERY',__user('A')));await p.fill('#newPassword','GoodPass1!');await p.fill('#confirmPassword','GoodPass1!');await p.click('#updatePasswordBtn');await p.waitForFunction(()=>__pendingActions.length===1);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await accountReady(p,'B');await p.evaluate(()=>__releaseAction('password'));await flush(p);await accountReady(p,'B');assert.equal(await p.evaluate(()=>__calls.find(x=>x.action==='passwordAuthorization').authorization),'Bearer fixture-A');assert.equal(await p.evaluate(()=>__session.user.id),'B');assert(!await p.locator('#recoveryPanel').isVisible());assert(!await p.locator('#status').textContent().then(x=>x.includes('Password updated')));
});
test('Account recovery signout clears passwords and returns to reset/signin forms',async t=>{
  const p=await open(t,'gameday-auth.html');await accountReady(p);await p.evaluate(()=>__emit('PASSWORD_RECOVERY',__user('A')));await p.fill('#newPassword','GoodPass1!');await p.evaluate(()=>__emit('SIGNED_OUT',null));assert(!await p.locator('#recoveryPanel').isVisible());assert(await p.locator('#authForms').isVisible());assert.equal(await p.locator('#newPassword').inputValue(),'');assert.match(await p.locator('#status').textContent(),/recovery session expired/i);await assertNoOwner(p,'A');
});
test('Account reset response cannot overwrite B active-account status',async t=>{
  const p=await open(t,'gameday-auth.html',{signedOut:true,gateActions:['reset']});await p.waitForFunction(()=>document.querySelector('#status').textContent==='You are not signed in.');await p.fill('#resetEmail','A@example.invalid');await p.click('#resetEmailBtn');await p.waitForFunction(()=>__pendingActions.length===1);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await accountReady(p,'B');await p.evaluate(()=>__releaseAction('reset'));await flush(p);assert.match(await p.locator('#status').textContent(),/account is active/);assert.equal(await p.locator('#resetEmail').inputValue(),'');
});
test('My Bets clears A immediately at signout and ignores its late bets/ledger',async t=>{
  const p=await open(t,'gameday-my-bets.html',{gate:['A']});await p.waitForFunction(()=>__pending.length===2);await p.evaluate(()=>__emit('SIGNED_OUT',null));await assertNoOwner(p,'A');assert.match(await p.locator('#status').textContent(),/Sign in/);await p.evaluate(()=>__release('A'));await flush(p);await assertNoOwner(p,'A');assert.match(await p.locator('#openBets').textContent(),/No account session/);assert(await p.locator('#refresh').isEnabled());
});
test('My Bets loads B while A is pending, then rejects the late A response',async t=>{
  const p=await open(t,'gameday-my-bets.html',{gate:['A']});await p.waitForFunction(()=>__pending.length===2);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await betsReady(p,'B');await p.evaluate(()=>__release('A'));await flush(p);await betsReady(p,'B');await assertNoOwner(p,'A');
});
test('My Bets generation protects A to B to A',async t=>{
  const p=await open(t,'gameday-my-bets.html',{gate:['A']});await p.waitForFunction(()=>__pending.length===2);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await betsReady(p,'B');await p.evaluate(()=>{__gate=[];__fixtures.A.wagers[0].wager_selections[0].selection_name='New A selection';__emit('SIGNED_IN',__user('A'))});await p.waitForFunction(()=>openBets.textContent.includes('New A selection'));await p.evaluate(()=>__release('A'));await flush(p);assert.match(await p.locator('#openBets').textContent(),/New A selection/);assert(!await p.locator('#openBets').textContent().then(x=>x.includes('A private selection')));
});
test('My Bets ignores stale session lookup and runs SDK reads outside the auth callback',async t=>{
  const p=await open(t,'gameday-my-bets.html',{gateActions:['getSession']});await p.waitForFunction(()=>__pendingActions.length===1);await p.evaluate(()=>{__gateActions=[];__emit('SIGNED_IN',__user('B'))});await betsReady(p,'B');await p.evaluate(()=>__releaseAction('getSession'));await flush(p);await betsReady(p,'B');await assertNoOwner(p,'A');
});
test('My Bets latest same-owner refresh wins',async t=>{
  const p=await open(t,'gameday-my-bets.html');await betsReady(p);await p.evaluate(()=>{__gate=['A'];document.dispatchEvent(new Event('visibilitychange'))});await p.waitForFunction(()=>__pending.length===2);await p.evaluate(()=>{__gate=[];__fixtures.A.wagers[0].wager_selections[0].selection_name='Newest A selection';document.dispatchEvent(new Event('visibilitychange'))});await p.waitForFunction(()=>openBets.textContent.includes('Newest A selection'));await p.evaluate(()=>__release('A'));await flush(p);assert.match(await p.locator('#openBets').textContent(),/Newest A selection/);assert(await p.locator('#refresh').isEnabled());
});
test('normal sign-in, password update, refresh, and explicit owner filters continue working',async t=>{
  const p=await open(t,'gameday-auth.html',{signedOut:true});await p.waitForFunction(()=>document.querySelector('#status').textContent==='You are not signed in.');await p.fill('#signinEmail','A@example.invalid');await p.fill('#signinPassword','GoodPass1!');await p.click('#signinBtn');await accountReady(p);await p.evaluate(()=>__emit('PASSWORD_RECOVERY',__user('A')));await p.fill('#newPassword','GoodPass1!');await p.fill('#confirmPassword','GoodPass1!');await p.click('#updatePasswordBtn');await accountReady(p);assert(!await p.locator('#recoveryPanel').isVisible());await p.click('#refreshWallet');await accountReady(p);const queries=await p.evaluate(()=>__calls.filter(x=>x.table));assert(queries.length>=6);for(const q of queries)assert(q.filters.some(f=>f[0]==='user_id'&&f[1]===q.owner));
  const b=await open(t,'gameday-my-bets.html');await betsReady(b);const betQueries=await b.evaluate(()=>__calls.filter(x=>x.table));assert.equal(betQueries.length,2);for(const q of betQueries)assert(q.filters.some(f=>f[0]==='user_id'&&f[1]===q.owner));
});

test('My Bets old completion cannot unlock Refresh while B still loads',async t=>{
  const p=await open(t,'gameday-my-bets.html',{gate:['A','B']});await p.waitForFunction(()=>__pending.filter(x=>x.owner==='A').length===2);await p.evaluate(()=>__emit('SIGNED_IN',__user('B')));await p.waitForFunction(()=>__pending.filter(x=>x.owner==='B').length===2);await p.evaluate(()=>__release('A'));await flush(p);assert(await p.locator('#refresh').isDisabled());await assertNoOwner(p,'A');await p.evaluate(()=>__release('B'));await betsReady(p,'B');assert(await p.locator('#refresh').isEnabled());
});
test('Account password response after signout cannot restore the session or password panel',async t=>{
  const p=await open(t,'gameday-auth.html',{gateActions:['password']});await accountReady(p);await p.evaluate(()=>__emit('PASSWORD_RECOVERY',__user('A')));await p.fill('#newPassword','GoodPass1!');await p.fill('#confirmPassword','GoodPass1!');await p.click('#updatePasswordBtn');await p.waitForFunction(()=>__pendingActions.length===1);await p.evaluate(()=>__emit('SIGNED_OUT',null));await p.evaluate(()=>__releaseAction('password'));await flush(p);await assertNoOwner(p,'A');assert.equal(await p.evaluate(()=>__session),null);assert(!await p.locator('#recoveryPanel').isVisible());assert(await p.locator('#authForms').isVisible());
});
