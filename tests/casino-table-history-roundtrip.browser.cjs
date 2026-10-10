// Current browser controller -> current Edge handler -> isolated PostgreSQL.
// Only authentication and transport are fixtures; receipt queries and rendering are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixture, A, B, id, games, stamp } = require('./helpers/casino-history-fixture.cjs');
const root = path.resolve(__dirname, '..');
const names = { blackjack: 'Blackjack', baccarat: 'Baccarat', roulette: 'Roulette', 'jacks-or-better': 'Jacks or Better', holdem: 'Texas Hold’em', omaha: 'Omaha', stud: 'Seven-Card Stud', draw: 'Five-Card Draw' };
const suits = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
const sdk = `export function createClient(){return{auth:{
  async getSession(){if(__authLock)throw Error('Session read inside auth callback');return{data:{session:structuredClone(__session)},error:null}},
  onAuthStateChange(fn){__authCallbacks.push(fn);return{data:{subscription:{unsubscribe(){}}}}}
}}}`;
const money = value => '$' + Number(value).toFixed(2);
async function waitFor(predicate, message) {
  const end = Date.now() + 15000;
  while (!predicate()) { if (Date.now() > end) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function run() {
  const h = await fixture(), results = [];
  let server, browser;
  try {
    server = http.createServer((req, res) => {
      const filename = path.join(root, decodeURIComponent(new URL(req.url, 'http://fixture').pathname));
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(filename)] || 'text/html'); res.end(fs.readFileSync(filename)); }
      catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    async function open() {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const calls = [], pending = [], blocked = [], errors = [];
      let gates = [];
      await context.addInitScript(({ A }) => {
        window.__user = owner => ({ user: { id: owner, email: owner + '@example.invalid' }, access_token: owner });
        window.__session = __user(A); window.__authCallbacks = []; window.__authLock = false;
        window.__emit = session => { __session = session; __authLock = true; try { __authCallbacks.forEach(fn => fn(session ? 'SIGNED_IN' : 'SIGNED_OUT', session)); } finally { __authLock = false; } };
      }, { A });
      await context.route('https://**/*', async route => {
        const request = route.request(), url = request.url();
        if (url.includes('/@supabase/supabase-js@')) return route.fulfill({ contentType: 'text/javascript', body: sdk });
        if (url.includes('/functions/v1/themed-slots-test')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, receipts: [], next_cursor: null }) });
        if (url.includes('/functions/v1/casino-history-test')) {
          const body = request.postDataJSON(), owner = request.headers().authorization?.replace(/^Bearer\s+/i, '');
          calls.push({ body, owner });
          const answer = await h.send(body, owner);
          if (gates.some(gate => (!gate.owner || gate.owner === owner) && (!gate.game || gate.game === body.game))) await new Promise(resolve => pending.push({ owner, game: body.game, resolve }));
          try { return await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer) }); }
          catch (error) { if (!context.pages().every(page => page.isClosed())) throw error; }
          return;
        }
        blocked.push(url); return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/gameday-casino-history.html');
      await page.waitForFunction(() => !document.querySelector('#history-refresh').disabled && document.querySelector('#history-list').textContent.includes('No settled spins'));
      return { page, calls, pending, setGates(value) { gates = value; }, release(predicate = () => true) { gates = []; for (const entry of pending.filter(predicate)) entry.resolve(); }, async close() { for (const entry of pending) entry.resolve(); await context.close(); assert.deepEqual(errors, [], 'no unhandled browser error'); assert.deepEqual(blocked, [], 'no unexpected external request'); } };
    }
    async function check(name, operation) {
      const opened = await open();
      try { await operation(opened); results.push({ name, pass: true }); process.stdout.write('PASS ' + name + '\n'); }
      finally { await opened.close(); }
    }
    async function ready(page, roundId) { await page.waitForFunction(roundId => document.querySelector(`[data-receipt-id="${roundId}"]`) && !document.querySelector('#history-refresh').disabled, roundId); }
    async function choose(page, game, roundId) { await page.selectOption('#history-game', game); await ready(page, roundId); }
    const renderedIds = page => page.locator('.receipt').evaluateAll(elements => elements.map(el => el.dataset.receiptId));
    async function stored(game, roundId) { const response = await h.send({ game, limit: 50 }); assert.equal(response.status, 200); const saved = response.rounds.find(row => row.id === roundId); assert(saved, 'saved settled receipt exists'); return saved; }
    function cardLabels(row) {
      const result = row.result;
      const groups = row.game === 'blackjack' ? [result.dealer_cards, ...(result.player_hands?.length ? result.player_hands.map(hand => hand.cards) : [result.player_cards])] : row.game === 'baccarat' ? [result.player_cards, result.banker_cards] : row.game === 'roulette' ? [] : row.game === 'jacks-or-better' ? [result.final_hand, result.initial_hand] : [result.board, result.player_cards, result.opponent_cards];
      return groups.flat().map(card => card.rank === '?' ? 'Unrevealed card' : `${card.rank} of ${suits[card.suit]}`);
    }
    async function exact(page, row) {
      const article = page.locator(`[data-receipt-id="${row.id}"]`);
      assert.equal(await article.locator('h2').textContent(), names[row.game]);
      const summary = await article.locator('.receipt-summary dd').allTextContents(); assert.deepEqual(summary.slice(0, 2), [money(row.stake), money(row.payout)]);
      assert.deepEqual(await article.locator('.receipt-card').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label'))), cardLabels(row));
      assert.equal(await article.locator('time').getAttribute('datetime'), row.settled_at);
      const text = await article.textContent();
      for (const privateField of ['SHOE_SECRET', 'DECK_SECRET', 'STATE_SECRET', 'CARD_SECRET', 'SPLIT_SECRET', 'balance_after', 'private_state']) assert(!text.includes(privateField), privateField + ' excluded from rendered receipt');
      assert(!/balance/i.test(text), 'no invented historical balance');
      return summary;
    }
    const firstIds = {};
    for (const [index, game] of games.entries()) {
      const n = 1000 + index * 100, own = await h.insert(game, n); firstIds[game] = own;
      await h.insert(game, n + 1, { owner: B }); await h.insert(game, n + 2, { active: true });
      if (index < 4) await h.insert(game, n + 3, { isTest: false });
      const row = await stored(game, own);
      await check(game + ' exact saved outcome/cards/totals; excludes foreign, active and non-test rounds', async ({ page, calls }) => {
        await choose(page, game, own); assert.deepEqual(await renderedIds(page), [own]); const summary = await exact(page, row);
        assert.equal(summary[2], { won: 'Won', banker: 'Banker wins' }[row.outcome] || row.outcome);
        assert.deepEqual(calls, [{ owner: A, body: { game, limit: 20, before: null } }]);
      });
    }
    for (const [index, [betType, label]] of Object.entries({ red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36', column1: 'Column 1', column2: 'Column 2', column3: 'Column 3' }).entries()) {
      const own = await h.insert('roulette', 3000 + index);
      const payout = ['red', 'even', 'high'].includes(betType) ? 20 : betType === 'column3' ? 30 : 0;
      await h.db.query('update roulette_spins set bet_type=$1,bet_value=null,winning_number=30,winning_color=\'red\',payout=$2,result=$3 where id=$4', [betType, payout, payout ? 'won' : 'lost', own]);
      const row = await stored('roulette', own);
      await check('roulette ' + betType + ' actual SQL null selection renders', async ({ page }) => {
        await choose(page, 'roulette', own); await exact(page, row); const article = page.locator(`[data-receipt-id="${own}"]`);
        assert.equal(await article.locator('.receipt-details').first().textContent(), 'Bet: ' + label);
        assert.equal(await article.locator('.receipt-roulette-result.red').textContent(), '30 Red');
        assert.equal(await article.locator('.receipt-summary dd').last().textContent(), payout ? 'Won' : 'Lost');
      });
    }
    for (const split of [false, true]) {
      const own = await h.insert('blackjack', split ? 5002 : 5001, { insurance: true, split }); const row = await stored('blackjack', own);
      await check('blackjack ' + (split ? 'split + insurance' : 'dealer natural + winning insurance') + ' exact aggregate/details', async ({ page }) => {
        await choose(page, 'blackjack', own); const summary = await exact(page, row); const article = page.locator(`[data-receipt-id="${own}"]`);
        assert.deepEqual(summary.slice(0, 2), split ? ['$25.00', '$30.00'] : ['$15.00', '$15.00']);
        assert.deepEqual(await article.locator('.receipt-summary dt').allTextContents(), ['Wager', 'Returned', 'Main result']);
        const detail = await article.locator('.receipt-details').allTextContents();
        assert(detail.includes(`Main wager ${money(row.result.main_stake)} · Returned ${money(row.result.main_payout)}`));
        assert(detail.includes(`Insurance wager ${money(row.result.insurance_stake)} · Returned ${money(row.result.insurance_payout)} · ${row.result.insurance_payout > 0 ? 'Won' : 'Lost'}`));
        if (split) { assert.deepEqual(await article.locator('.receipt-hand h3').allTextContents(), ['Dealer · Total 17', 'Hand 1 · Total 20 · Won · Wager $10.00', 'Hand 2 · Total 17 · Push · Wager $10.00']); assert.equal(await article.locator('.receipt-hand').filter({ hasText: 'Returned' }).count(), 0); }
        else { assert.equal(summary[2], 'Lost'); assert.equal(await article.locator('.receipt-hand h3').first().textContent(), 'Dealer · Total 21'); }
      });
    }
    for (const game of ['holdem', 'omaha', 'stud', 'draw']) {
      const own = await h.insert(game, 6000 + games.indexOf(game), { showdown: false }); const row = await stored(game, own);
      await check(game + ' fold hides unshown opponent cards from current service', async ({ page }) => {
        await choose(page, game, own); await exact(page, row); const article = page.locator(`[data-receipt-id="${own}"]`);
        assert.equal(await article.locator('.receipt-card.is-hidden').count(), game === 'stud' ? 3 : game === 'holdem' ? 2 : game === 'omaha' ? 4 : 5);
        assert.equal(await article.locator('.receipt-summary dd').last().textContent(), 'You folded');
        assert(!await article.textContent().then(text => text.includes('Straight Flush')));
      });
    }
    for (const [index, game] of games.entries()) {
      const n = 7000 + index * 100, nextStamp = '2026-10-11T12:00:00.654321Z';
      for (let offset = 0; offset < 22; offset++) await h.insert(game, n + offset, { time: nextStamp });
      const expected = await h.send({ game, limit: 50 }); assert.equal(expected.status, 200);
      await check(game + ' browser 20-row keyset pagination retains microseconds without gaps or duplicates', async ({ page, calls }) => {
        await choose(page, game, id(n + 21)); assert.equal(await page.locator('.receipt').count(), 20); assert(await page.locator('#history-more').isVisible());
        await page.click('#history-more'); await ready(page, firstIds[game]);
        assert.deepEqual(await renderedIds(page), expected.rounds.map(row => row.id)); assert(!await page.locator('#history-more').isVisible());
        assert.deepEqual(calls[1].body, { game, limit: 20, before: { created_at: nextStamp, id: id(n + 2) } });
        assert.equal(new Set(await renderedIds(page)).size, expected.rounds.length);
        await page.click('#history-refresh'); await ready(page, id(n + 21)); assert.equal(await page.locator('.receipt').count(), 20); assert.equal(calls.at(-1).body.before, null);
      });
    }
    await check('late actual blackjack query cannot replace a later baccarat filter', async opened => {
      const { page, pending } = opened; opened.setGates([{ game: 'blackjack' }]);
      await page.selectOption('#history-game', 'blackjack'); await waitFor(() => pending.length === 1, 'blackjack request held');
      const current = (await h.send({ game: 'baccarat', limit: 20 })).rounds[0]; await choose(page, 'baccarat', current.id); opened.release(); await page.waitForTimeout(80);
      assert((await page.locator('.receipt h2').allTextContents()).every(name => name === 'Baccarat')); assert(!(await renderedIds(page)).includes(firstIds.blackjack));
    });
    await check('signout removes real table receipts and ignores late current-service response', async opened => {
      const { page, pending } = opened, latest = (await h.send({ game: 'blackjack', limit: 20 })).rounds[0]; await choose(page, 'blackjack', latest.id);
      opened.setGates([{ owner: A, game: 'blackjack' }]); await page.click('#history-refresh'); await waitFor(() => pending.length === 1, 'A refresh held');
      await page.evaluate(() => __emit(null)); assert.equal(await page.locator('.receipt').count(), 0); assert(await page.locator('#history-signin').isVisible()); opened.release(); await page.waitForTimeout(80); assert.equal(await page.locator('.receipt').count(), 0);
    });
    await check('A-B-A actual owner queries reject the former same-owner reply', async opened => {
      const { page, pending } = opened, old = (await h.send({ game: 'blackjack', limit: 20 })).rounds[0]; await choose(page, 'blackjack', old.id);
      opened.setGates([{ owner: A, game: 'blackjack' }]); await page.click('#history-refresh'); await waitFor(() => pending.length === 1, 'A query held');
      await page.evaluate(B => __emit(__user(B)), B); await ready(page, id(1001)); assert.deepEqual(await renderedIds(page), [id(1001)]);
      const fresh = await h.insert('blackjack', 9999, { time: '2026-10-12T12:00:00.123456Z' }); opened.setGates([]); await page.evaluate(A => __emit(__user(A)), A); await ready(page, fresh); opened.release(); await page.waitForTimeout(80);
      assert.equal((await renderedIds(page))[0], fresh); assert(!(await renderedIds(page)).includes(id(1001))); assert(await page.locator('#history-refresh').isEnabled());
    });
    await check('history browser retrieval leaves wallets, transactions and settled rows unchanged', async ({ page }) => {
      const count = async () => (await h.db.query('select (select count(*) from wallets) wallets,(select count(*) from wallet_transactions) ledger,(select count(*) from blackjack_hands) blackjack,(select count(*) from poker_test_hands) poker')).rows;
      const before = await count(); for (const game of games) { const response = await h.send({ game, limit: 20 }); await choose(page, game, response.rounds[0].id); } assert.deepEqual(await count(), before);
    });
    if (process.env.CASINO_HISTORY_RESULTS) fs.writeFileSync(process.env.CASINO_HISTORY_RESULTS, JSON.stringify(results, null, 2));
    process.stdout.write(JSON.stringify({ passed: results.length, failed: 0 }) + '\n');
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await h.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
