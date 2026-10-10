// Real browser checks with all remote activity blocked or replaced by fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let server, browser, base;
test.before(async () => {
  server = http.createServer((req,res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file)); } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function open(t, file='index.html', options={}) {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',...options});
  t.after(()=>context.close());
  await context.route('https://**/*',route=>route.abort());
  const page=await context.newPage();
  await page.goto(base+'/'+file);
  return page;
}
for (const [query,label,target] of [
  ['Lucky 7', 'GameDay Lucky 7s', 'gameday-slots.html'],
  ['Lucky 7’s', 'GameDay Lucky 7s', 'gameday-slots.html'],
  ['Omaha', 'Omaha', 'gameday-omaha.html'],
  ['Texas Holdem', 'Texas Hold’em', 'gameday-texas-holdem.html'],
  ['Stud', 'Seven-Card Stud', 'gameday-seven-card-stud.html'],
  ['Draw', 'Five-Card Draw', 'gameday-five-card-draw.html'],
]) test('Homepage search opens '+label+' even when account SDK fails', async t=>{
  const page=await open(t);
  await page.fill('#searchInput',query);
  const result=page.locator('#searchResults a', {hasText:label});
  assert.equal(await result.count(),1);
  assert.equal(await result.getAttribute('href'),base+'/'+target);
  await page.press('#searchInput','ArrowDown');
  assert.equal(await page.locator('#searchInput').getAttribute('aria-activedescendant'),await result.getAttribute('id'));
  await page.press('#searchInput','Enter');
  await page.waitForURL('**/'+target);
});
test('Closed mobile navigation has no offscreen keyboard stops after SDK failure',async t=>{
  const page=await open(t);
  await page.waitForFunction(()=>document.querySelector('#sidebar').inert);
  for(let i=0;i<35;i++){
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>sidebar.contains(document.activeElement)),false);
  }
  assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'false');
});
test('Mobile menu traps focus and closes with Escape, restoring its opener',async t=>{
  const page=await open(t);
  await page.click('#menuToggle');
  await page.waitForFunction(()=>sidebar.contains(document.activeElement));
  assert.equal(await page.evaluate(()=>mainContent.inert),true);
  assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'),'true');
  const first=await page.evaluate(()=>document.activeElement.outerHTML);
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(()=>sidebar.contains(document.activeElement)));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.outerHTML),first);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'menuToggle');
  assert.equal(await page.evaluate(()=>sidebar.inert),true);
  assert.equal(await page.evaluate(()=>mainContent.inert),false);
  assert.equal(await page.locator('#menuBackdrop').isVisible(),false);
});
test('Desktop navigation remains available and resizing a focused link restores mobile focus',async t=>{
  const page=await open(t,'index.html',{viewport:{width:1280,height:900}});
  assert.equal(await page.evaluate(()=>sidebar.inert),false);
  const settings=page.locator('#sidebar a[data-search-label="Settings"]');
  assert.equal(await settings.getAttribute('href'),'gameday-settings.html');
  await settings.focus();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.activeElement.id==='menuToggle'&&sidebar.inert);
});
test('Mobile sidebar is hidden from keyboard when JavaScript is unavailable',async t=>{
  const page=await open(t,'index.html',{javaScriptEnabled:false});
  for(let i=0;i<20;i++){
    await page.keyboard.press('Tab');
    const active=await page.locator(':focus').getAttribute('href').catch(()=>null);
    assert.notEqual(active,'gameday-settings.html');
    assert.notEqual(active,'gameday-help.html');
  }
  assert.equal(await page.locator('#sidebar').isVisible(),false);
});
test('Poker Room Sign in is a usable link even if its SDK cannot load',async t=>{
  const page=await open(t,'gameday-poker.html');
  const link=page.getByRole('link',{name:'Sign in to your GameDay account'});
  assert.equal(await link.getAttribute('href'),'gameday-auth.html');
  await link.click();await page.waitForURL('**/gameday-auth.html');
});
test('Settings saves all five existing game sound preferences and restores them on reload',async t=>{
  const page=await open(t,'gameday-settings.html');
  await page.waitForFunction(()=>document.querySelector('#settings-status').textContent==='Sound preferences are ready.');
  for(const id of ['midnight','galactic','lucky','cards','roulette']){
    assert.equal(await page.locator('#sound-'+id).isChecked(),true);
    await page.uncheck('#sound-'+id);
  }
  assert.deepEqual(await page.evaluate(()=>({mm:localStorage.getItem('gameday-mm-muted'),gr:localStorage.getItem('gameday-gr-muted'),l7:localStorage.getItem('gameday-l7-muted'),cards:sessionStorage.getItem('gameday:deal-sound'),roulette:sessionStorage.getItem('gameday:roulette-sound')})),{mm:'1',gr:'1',l7:'1',cards:'off',roulette:'off'});
  await page.reload();
  for(const id of ['midnight','galactic','lucky','cards','roulette'])assert.equal(await page.locator('#sound-'+id).isChecked(),false);
  await page.check('#sound-midnight');assert.equal(await page.evaluate(()=>localStorage.getItem('gameday-mm-muted')),'0');
});
test('Settings reports storage failures instead of falsely claiming a save',async t=>{
  const page=await open(t,'gameday-settings.html');
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Denied','SecurityError');};});
  await page.click('#sound-midnight');
  assert.equal(await page.locator('#sound-midnight').isChecked(),true);
  assert.match(await page.locator('#settings-status').textContent(),/cannot save/);
  assert.equal(await page.locator('#settings-status').evaluate(e=>e.classList.contains('error')),true);
});
test('Settings accurately reflects the device reduced motion setting',async t=>{
  const page=await open(t,'gameday-settings.html',{reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('#motion-status').textContent.includes('is on'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>document.querySelector('#motion-status').textContent.includes('is off'));
});
for (const [id,file,sound] of [
  ['midnight','gameday-midnight-monsters-v2.html','#mm-sound'],
  ['galactic','gameday-galactic-rebellion-v2.html','#gr-sound'],
  ['lucky','gameday-slots.html','#l7-sound'],
]) test('Settings sound preference is applied by the actual '+id+' game even without its SDK',async t=>{
  const page=await open(t,'gameday-settings.html');
  await page.uncheck('#sound-'+id);
  await page.goto(base+'/'+file);
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-pressed')==='false',sound);
  assert.equal(await page.locator(sound).getAttribute('aria-label'),'Turn game sound on');
  await page.goto(base+'/gameday-settings.html');await page.check('#sound-'+id);
  await page.goto(base+'/'+file);
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-pressed')==='true',sound);
  assert.equal(await page.locator(sound).getAttribute('aria-label'),'Mute game sound');
});
for (const [id,file,sound] of [
  ['cards','gameday-blackjack.html','.gd-deal-sound'],
  ['roulette','gameday-roulette.html','#roulette-sound'],
]) test('Settings sound preference is applied by the actual '+id+' game in this tab',async t=>{
  const page=await open(t,'gameday-settings.html');await page.uncheck('#sound-'+id);
  await page.goto(base+'/'+file);
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-pressed')==='false',sound);
  assert.match(await page.locator(sound).textContent(),/Sound off/);
  await page.goto(base+'/gameday-settings.html');await page.check('#sound-'+id);await page.goto(base+'/'+file);
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-pressed')==='true',sound);
  assert.match(await page.locator(sound).textContent(),/Sound on/);
});
test('Help exposes result/recovery FAQ and creates copyable details without submitting data',async t=>{
  const page=await open(t,'gameday-help.html');
  await page.getByText('Where can I find my results?',{exact:true}).click();
  assert.equal(await page.locator('details[open] a[href="gameday-casino-history.html"]').count(),1);
  await page.fill('#help-receipt','receipt-fixture-123');await page.fill('#help-details','Spin result did not appear.');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}}));
  await page.click('#help-copy');
  const copied=await page.evaluate(()=>window.__copied);assert.match(copied,/receipt-fixture-123/);assert.match(copied,/Spin result did not appear/);
  assert.match(await page.locator('#help-status').textContent(),/Nothing has been sent/);
  assert.equal(await page.evaluate(()=>localStorage.length),0);
});
test('Help offers visible manual copy when clipboard access fails',async t=>{
  const page=await open(t,'gameday-help.html');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Denied');}}}));
  await page.click('#help-copy');
  assert.equal(await page.locator('#help-preview').isVisible(),true);
  assert.match(await page.locator('#help-status').textContent(),/Select and copy/);
});
test('Help uses configured support email and opens reviewable email, including safely encoded details',async t=>{
  const page=await open(t,'gameday-help.html');
  await page.route('**/gameday-config.js',route=>route.fulfill({contentType:'text/javascript',body:"export const GAMEDAY_CONFIG={support:{email:'support@example.invalid'}}"}));
  await page.reload();await page.fill('#help-details','test & subject=<unsafe>');
  const contact=page.locator('#support-contact');assert.equal(await contact.isVisible(),true);
  const href=await contact.getAttribute('href');assert(href.startsWith('mailto:support%40example.invalid?'));
  const url=new URL(href);assert.equal(url.searchParams.get('subject'),'GameDay help: Connection or sign-in');assert.match(url.searchParams.get('body'),/test & subject=<unsafe>/);
});
test('Privacy notice and every Help/Settings navigation route resolve without changing casino styles',async t=>{
  const page=await open(t,'gameday-privacy.html');
  assert.match(await page.locator('main').textContent(),/TEST MODE — no real money/);
  assert.match(await page.locator('main').textContent(),/browser storage/);
  for(const href of await page.locator('a[href]').evaluateAll(links=>links.map(l=>l.getAttribute('href'))))assert.equal((await page.request.get(base+'/'+href)).status(),200);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(255, 255, 255)');
});
