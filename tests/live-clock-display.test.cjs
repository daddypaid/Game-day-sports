// Exercise the actual Sportsbook against isolated provider snapshots. No live
// accounts, wagers or external requests are used by these browser checks.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, server, base;
const sdk = `export function createClient(){return {
 auth:{async getSession(){return {data:{session:null},error:null}},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},
 from(){throw Error('Anonymous clock fixture must not read a wallet')},
 functions:{invoke(){throw Error('Clock fixture must never place a wager')}}
}}`;
function game(sport) { return { id: 'clock-' + sport, commence_time: new Date(Date.now() - 60000).toISOString(), home_team: 'Fixture Home', away_team: 'Fixture Away', bookmakers: [{ markets: [{ key: 'h2h', outcomes: [{ name: 'Fixture Home', price: 100 }, { name: 'Fixture Away', price: -110 }] }] }] }; }
function state(sport, fields = {}) { return { provider: 'verified-fixture', sport, event_start: new Date(Date.now() - 60000).toISOString(), home_team: 'Fixture Home', away_team: 'Fixture Away', home_key: 'fixture home', away_key: 'fixture away', home_score: 21, away_score: 14, live: true, completed: false, period: 'Q3', period_verified: true, clock: '08:42', clock_verified: true, clock_kind: 'countdown', ...fields }; }
function feed(sport, states = [state(sport)], fields = {}) { return { sport, states, fetched_at: new Date().toISOString(), stale: false, ...fields }; }

test.before(async () => {
 server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
 browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'] });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function open(t, { sport = 'nfl', payload, clock = false } = {}) {
 const fixture = { payload: payload || feed(sport), failure: false, requests: [], held: [], response: null };
 const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
 t.after(async () => { fixture.held.splice(0).forEach(release => release()); await context.setOffline(true); await context.unrouteAll({ behavior: 'wait' }); await context.close(); });
 const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
 t.after(() => assert.deepEqual(errors, [], 'Sportsbook has no browser errors'));
 if (clock) await page.clock.install({ time: new Date() });
 await context.addInitScript(() => {
  window.__clockIntervals = []; const nativeInterval = window.setInterval;
  window.setInterval = (fn, ms, ...args) => {
   __clockIntervals.push(ms);
   if (ms === 15000) { window.__liveTick = fn; return nativeInterval(() => {}, 99999999); }
   if (ms === 60000) { window.__oddsTick = fn; return nativeInterval(() => {}, 99999999); }
   return nativeInterval(fn, ms, ...args);
  };
 });
 await context.route('https://**/*', route => route.abort());
 await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: sdk }));
 await context.route('https://qsvrvhcklnsbekxblpfo.supabase.co/**', async route => {
  const body = route.request().postDataJSON(); fixture.requests.push(body);
  let result;
  if (body.mode === 'sports') result = { sports: ['nfl', 'nba', 'mls', 'nhl', 'mlb', 'tennis_atp'].map(key => ({ key, group: 'Fixture', title: key, active: true })) };
  else if (body.mode === 'games') result = { games: [game(body.sport)] };
  else {
   if (fixture.response) result = await fixture.response(body.sport);
   else result = structuredClone(fixture.payload);
   if (fixture.failure) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Verified feed temporarily unavailable' }) }); return; }
  }
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
 });
 await page.goto(base + '/gameday-sportsbook.html?view=live&sport=' + sport);
 await page.locator('.game-state strong').waitFor();
 return { page, fixture, context };
}
async function label(page) { return page.locator('.game-state strong').textContent(); }
async function tick(page) { await page.evaluate(() => { void __liveTick(); }); }
async function waitLabel(page, text) { await page.waitForFunction(text => document.querySelector('.game-state strong')?.textContent === text, text); }

for (const [sport, fields, expected] of [
 ['nfl', { period: 'Q3', clock: '08:42' }, 'Q3 · 08:42'],
 ['nba', { period: 'Q4', clock: '02:17' }, 'Q4 · 02:17'],
 ['mls', { period: '2nd Half', clock: '67′', clock_kind: 'elapsed' }, '2nd Half · 67′'],
 ['mls', { period: '2nd Half', clock: '90+3′', clock_kind: 'elapsed' }, '2nd Half · 90+3′'],
 ['nhl', { period: 'P2', clock: '11:24' }, 'P2 · 11:24'],
 ['mlb', { period: 'Top 7th', clock: null, clock_verified: false, clock_kind: 'inning' }, 'Top 7th'],
 ['mlb', { period: 'Bottom 9th', clock: null, clock_verified: false, clock_kind: 'inning' }, 'Bottom 9th'],
 ['tennis_atp', { period: 'Set 3', clock: null, clock_verified: false, clock_kind: 'status' }, 'Set 3'],
 ['nfl', { period: 'Halftime', clock: null, clock_verified: false, clock_kind: 'status' }, 'Halftime'],
]) test(sport + ' displays the actual provider period/time: ' + expected, async t => {
 const { page } = await open(t, { sport, payload: feed(sport, [state(sport, fields)]) });
 assert.equal(await label(page), expected); assert.equal(await page.locator('.score').first().textContent(), '14');
});

test('provider clock remains unchanged as browser time passes and changes only on a fresh response', async t => {
 const { page, fixture } = await open(t, { clock: true });
 assert.equal(await label(page), 'Q3 · 08:42'); await page.clock.runFor(4500); assert.equal(await label(page), 'Q3 · 08:42');
 assert(!await page.evaluate(() => __clockIntervals.includes(1000)), 'No local game countdown interval');
 fixture.payload = feed('nfl', [state('nfl', { clock: '08:39' })]); await tick(page); await waitLabel(page, 'Q3 · 08:39');
 await page.clock.runFor(2000); assert.equal(await label(page), 'Q3 · 08:39');
});

for (const [name, payload] of [
 ['missing feed', feed('nfl', [])],
 ['missing timer', feed('nfl', [state('nfl', { clock: null, clock_verified: false })])],
 ['unverified timer', feed('nfl', [state('nfl', { clock_verified: false })])],
 ['stale envelope', feed('nfl', [state('nfl')], { stale: true })],
 ['stale individual state', feed('nfl', [state('nfl', { stale: true })])],
 ['expired individual state', feed('nfl', [state('nfl', { fetched_at: new Date(Date.now() - 120000).toISOString() })])],
 ['expired snapshot', feed('nfl', [state('nfl')], { fetched_at: new Date(Date.now() - 120000).toISOString() })],
 ['future snapshot', feed('nfl', [state('nfl')], { fetched_at: new Date(Date.now() + 120000).toISOString() })],
 ['missing timestamp', feed('nfl', [state('nfl')], { fetched_at: null })],
 ['wrong sport envelope', feed('nba', [state('nba')])],
 ['wrong sport state', feed('nfl', [state('nba')])],
 ['missing event identity', feed('nfl', [state('nfl', { event_start: null })])],
 ['invalid event identity', feed('nfl', [state('nfl', { event_start: 'not-a-date' })])],
 ['completed event', feed('nfl', [state('nfl', { completed: true, live: false })])],
 ['not-live event', feed('nfl', [state('nfl', { live: false })])],
 ['unknown clock kind', feed('nfl', [state('nfl', { clock_kind: 'estimated' })])],
 ['unverified baseball half', feed('nfl', [state('nfl', { clock_kind: 'inning', clock: null, clock_verified: false, period_verified: false })])],
]) test(name + ' displays Time unavailable without a guessed time', async t => {
 const { page } = await open(t, { payload }); assert.match(await label(page), /Time unavailable/); assert(!await label(page).then(text => text.includes('08:42')));
});

test('provider failure clears the previous clock and a verified retry restores it', async t => {
 const { page, fixture } = await open(t); fixture.failure = true; await tick(page);
 await page.waitForFunction(() => document.querySelector('.game-state strong')?.textContent.includes('Time unavailable'));
 assert(!await label(page).then(text => text.includes('08:42')));
 fixture.failure = false; fixture.payload = feed('nfl', [state('nfl', { period: 'Q4', clock: '06:14' })]); await tick(page); await waitLabel(page, 'Q4 · 06:14');
});

test('a displayed snapshot expires even when the provider poll is paused', async t => {
 const { page } = await open(t, { clock: true }); await page.clock.runFor(91000);
 assert.match(await label(page), /Time unavailable/); assert(!await label(page).then(text => text.includes('08:42')));
});

test('returning to the page clears an expired clock before awaiting the provider', async t => {
 const { page, fixture } = await open(t, { clock: true }); let release, entered;
 const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve); fixture.held.push(release);
 fixture.response = async () => { entered(); await gate; return feed('nfl'); };
 await page.clock.setSystemTime(new Date(Date.now() + 120000));
 assert.equal(await label(page), 'Q3 · 08:42', 'Timers were intentionally paused while this tab was away');
 await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await started;
 assert.match(await label(page), /Time unavailable/); release();
});

test('an older successful response cannot overwrite a newer verified clock', async t => {
 const { page, fixture } = await open(t); let release, entered;
 const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
 fixture.held.push(release); let call = 0;
 fixture.response = async () => { if (++call === 1) { entered(); await gate; return feed('nfl', [state('nfl', { clock: '08:41' })]); } return feed('nfl', [state('nfl', { clock: '08:35' })]); };
 await tick(page); await started; await tick(page); await waitLabel(page, 'Q3 · 08:35'); release();
 await page.waitForTimeout(75); assert.equal(await label(page), 'Q3 · 08:35');
});

test('an older full-board refresh cannot overwrite a newer clock-only response', async t => {
 const { page, fixture } = await open(t); let release, entered;
 const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
 fixture.held.push(release); let call = 0;
 fixture.response = async () => { if (++call === 1) { entered(); await gate; return feed('nfl', [state('nfl', { clock: '08:41' })]); } return feed('nfl', [state('nfl', { clock: '08:35' })]); };
 await page.evaluate(() => { void __oddsTick(); }); await started;
 await tick(page); await waitLabel(page, 'Q3 · 08:35'); release(); await page.waitForTimeout(75);
 assert.equal(await label(page), 'Q3 · 08:35'); assert.equal(await page.locator('.odd').count(), 2);
});

test('a late response from the former sport cannot replace the active basketball clock', async t => {
 const { page, fixture } = await open(t); let release, entered;
 const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve); fixture.held.push(release);
 fixture.response = async sport => { if (sport === 'nfl') { entered(); await gate; return feed('nfl'); } return feed('nba', [state('nba', { period: 'Q2', clock: '04:59' })]); };
 await tick(page); await started; await page.click('[data-sport="nba"]'); await waitLabel(page, 'Q2 · 04:59'); release();
 await page.waitForTimeout(75); assert.equal(await label(page), 'Q2 · 04:59'); assert.match(await page.locator('.sport.active').textContent(), /NBA/);
});

test('explicit paired provider full-location aliases match NCAA team names', async t => {
 const { page } = await open(t, { sport: 'ncaaf', payload: feed('ncaaf', [state('ncaaf', {
  home_team: 'University Home Tigers', away_team: 'University Away Aggies', home_key: 'university home tigers', away_key: 'university away aggies',
  home_aliases: ['fixture home'], away_aliases: ['fixture away'],
 })]) }); assert.equal(await label(page), 'Q3 · 08:42'); assert.equal(await page.locator('.score').first().textContent(), '14');
});

test('substring nicknames cannot match an unrelated provider team pairing', async t => {
 const { page } = await open(t, { payload: feed('nfl', [state('nfl', {
  home_team: 'Different Fixture Home', away_team: 'Different Fixture Away', home_key: 'different fixture home', away_key: 'different fixture away',
 })]) }); assert.match(await label(page), /Time unavailable/);
});

test('a duplicate team pairing cannot lend another event its clock', async t => {
 const { page } = await open(t, { payload: feed('nfl', [state('nfl'), state('nfl', { clock: '02:11' })]) }); assert.match(await label(page), /Time unavailable/);
});

test('a different scheduled game between the same teams cannot lend its clock', async t => {
 const { page } = await open(t, { payload: feed('nfl', [state('nfl', { event_start: new Date(Date.now() - 86400000).toISOString() })]) }); assert.match(await label(page), /Time unavailable/);
});

test('provider labels are rendered as text, with no injected markup', async t => {
 const { page } = await open(t, { payload: feed('nfl', [state('nfl', { period: '<img src=x onerror=alert(1)>', clock: '<b>08:42</b>' })]) });
 assert.equal(await label(page), '<img src=x onerror=alert(1)> · <b>08:42</b>'); assert.equal(await page.locator('.game-state img,.game-state b').count(), 0);
});
