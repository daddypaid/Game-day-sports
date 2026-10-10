import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

const ui = Object.fromEntries(['status', 'refresh', 'signin', 'list', 'more', 'game'].map(id => [id, document.getElementById('history-' + id)]));
const GAMES = { 'midnight-monsters': 'Midnight Monsters', 'galactic-rebellion': 'Galactic Rebellion', 'lucky-7s': 'GameDay Lucky 7s' };
const TABLES = { blackjack: 'Blackjack', baccarat: 'Baccarat', roulette: 'Roulette', 'jacks-or-better': 'Jacks or Better', holdem: 'Texas Hold’em', omaha: 'Omaha', stud: 'Seven-Card Stud', draw: 'Five-Card Draw' };
const MIDNIGHT = {
  VAMP: ['Vampire', 'vampire.webp'], WOLF: ['Werewolf', 'werewolf.webp'], ZOMB: ['Zombie', 'zombie.webp'],
  POTION: ['Potion', 'potion.webp'], BAT: ['Bat', 'bat.webp'], CANDLE: ['Candle', 'candle.webp'],
  WILD: ['Wild', 'wild.webp'], SCATTER: ['Scatter', 'scatter.webp'],
  SPADE: ['Spade', 0, 0], CLUB: ['Club', 1, 0], HEART: ['Heart', 2, 0], DIAMOND: ['Diamond', 3, 0],
  SKULL: ['Skull', 0, 1], BOOK: ['Book', 1, 1], RING: ['Ring', 2, 1],
};
const GALACTIC = {
  STARFIGHTER: ['Starfighter', 0, 0], STATION: ['Space Station', 1, 0], PLANET: ['Planet', 2, 0], ASTEROID: ['Asteroid', 3, 0],
  GALAXY: ['Galaxy', 0, 1], PILOT: ['Space Pilot', 1, 1], QUEEN: ['Alien Queen', 2, 1], BOT: ['Enemy Bot', 3, 1],
  CHEST: ['Crystal Chest', 0, 2], COMPASS: ['Star Compass', 1, 2], REDPLANET: ['Red Planet', 2, 2], RINGED: ['Ringed Planet', 3, 2],
  BLACKHOLE: ['Black Hole', 0, 3], CANNON: ['Laser Cannon', 1, 3], WILD: ['Wild', 2, 3], SCATTER: ['Scatter', 3, 3],
};
const LEGACY = { FIGHTER: 'STARFIGHTER', DROID: 'BOT', ENERGY: 'CANNON', SAT: 'STATION', COMET: 'ASTEROID' };
const LUCKY = {
  RED7: ['Red 7', 0, 0], BLUE7: ['Blue 7', 1, 0], GOLD7: ['Gold 7', 2, 0], FOOTBALL: ['Football', 0, 1],
  SOCCER: ['Soccer', 1, 1], HOCKEY: ['Hockey puck', 2, 1], BASKETBALL: ['Basketball', 0, 2], BOXING: ['Boxing gloves', 1, 2], GOALPOST: ['Goalpost', 2, 2],
};
let client = null, userId = null, sessionToken = null, generation = 0, requestNumber = 0, loading = false, cursor = null, booting = false, sdkAttempt = 0;
let selectedGame = ui.game.value;
const seen = new Set();
const money = amount => '$' + Number(amount || 0).toFixed(2);
const historyName = () => selectedGame === 'slots' ? 'spin history' : TABLES[selectedGame] + ' history';
const roundName = () => selectedGame === 'slots' ? 'spins' : 'rounds';
async function bounded(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Connection timed out')), 10000); })
    ]);
  } finally { clearTimeout(timer); }
}
function status(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle('is-error', error); }
function empty(message) { const el = document.createElement('p'); el.className = 'empty'; el.textContent = message; ui.list.replaceChildren(el); }
function setSession(session) {
  const next = session?.user?.id || null;
  const nextToken = session?.access_token || null;
  if (next === userId && nextToken === sessionToken) return false;
  generation++; requestNumber++; loading = false; userId = next; sessionToken = nextToken; cursor = null; seen.clear();
  ui.list.replaceChildren(); ui.more.hidden = true; ui.refresh.disabled = false; ui.signin.hidden = !!next;
  status(next ? `Loading your ${historyName()}…` : `Sign in to view your settled ${roundName()}.`);
  return true;
}
function symbol(game, code) {
  const el = document.createElement('div'); el.className = 'receipt-symbol';
  const entry = game === 'midnight-monsters' ? MIDNIGHT[code] : game === 'galactic-rebellion' ? GALACTIC[LEGACY[code] || code] : LUCKY[code];
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', entry?.[0] || String(code));
  if (!entry) { el.classList.add('unknown'); el.textContent = String(code); return el; }
  if (typeof entry[1] === 'string') { el.style.backgroundImage = `url("assets/midnight-monsters/${entry[1]}")`; return el; }
  const file = game === 'midnight-monsters' ? 'assets/midnight-monsters/extended-symbols-atlas.webp' : game === 'galactic-rebellion' ? 'assets/galactic-rebellion/symbols-atlas.webp' : 'assets/lucky-7s/symbols-atlas.webp';
  const columns = game === 'lucky-7s' ? 3 : 4, rows = game === 'midnight-monsters' ? 2 : columns;
  el.style.backgroundImage = `url("${file}")`; el.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
  el.style.backgroundPosition = `${entry[1] * 100 / (columns - 1)}% ${entry[2] * 100 / (rows - 1)}%`;
  return el;
}
function slotReceipt(row) {
  const spin = row.spin, cols = row.game === 'lucky-7s' ? 3 : 5;
  if (!GAMES[row.game] || !spin || !Array.isArray(spin.grid) || spin.grid.length !== cols || spin.grid.some(col => !Array.isArray(col) || col.length !== 3) || !Number.isFinite(Number(spin.payout)) || Number(spin.payout) < 0) throw new Error('A spin receipt is incomplete. Refresh to try again.');
  const el = document.createElement('article'); el.className = 'receipt'; el.dataset.receiptId = row.id;
  const title = document.createElement('h2'); title.textContent = GAMES[row.game]; el.append(title);
  const time = document.createElement('time'); time.dateTime = row.created_at; time.textContent = new Date(row.created_at).toLocaleString(); el.append(time);
  const grid = document.createElement('div'); grid.className = 'receipt-grid'; grid.style.setProperty('--reels', cols); grid.setAttribute('aria-label', 'Settled reel symbols');
  for (let r = 0; r < 3; r++) for (let c = 0; c < cols; c++) grid.append(symbol(row.game, spin.grid[c][r]));
  el.append(grid);
  const free = spin.free_spin === true || spin.is_free_spin === true || spin.bonus_spin === true || spin.spin_type === 'bonus';
  const wager = free ? 0 : Number(spin.stake ?? spin.total_bet ?? (Number(spin.bet_per_line || 0) * 20));
  const summary = document.createElement('dl'); summary.className = 'receipt-summary';
  for (const [name, value] of [['Wager', money(wager)], ['Payout', money(spin.payout)], ['Result', Number(spin.payout) > 0 ? 'Win' : 'No win']]) {
    const cell = document.createElement('div'), label = document.createElement('dt'), amount = document.createElement('dd'); label.textContent = name; amount.textContent = value; cell.append(label, amount); summary.append(cell);
  }
  el.append(summary);
  const details = document.createElement('p'); details.className = 'receipt-details';
  const wins = Array.isArray(spin.line_wins) ? spin.line_wins.length : Number.isInteger(spin.winning_ways) ? spin.winning_ways : Array.isArray(spin.active_lines) ? spin.active_lines.length : null;
  details.textContent = (free ? 'Free spin' : 'Paid spin') + (wins !== null ? ` · ${wins} winning ${row.game === 'galactic-rebellion' ? 'combinations' : 'lines'}` : '') + (spin.bonus_complete ? ' · Free spins complete' : spin.bonus_triggered ? ' · Free spins awarded' : '');
  if (spin.bonus_complete && Number.isFinite(Number(spin.bonus_total_payout))) details.textContent += ' · Bonus total ' + money(spin.bonus_total_payout);
  el.append(details);
  const id = document.createElement('p'); id.className = 'receipt-id'; id.textContent = 'Receipt ' + String(row.id); el.append(id);
  return el;
}
const RANKS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
const SUITS = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
const ROULETTE_BETS = { red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36', column1: 'Column 1', column2: 'Column 2', column3: 'Column 3' };
const amountValid = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
const textValid = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
function readable(value) {
  const labels = { won: 'Won', lost: 'Lost', push: 'Push', bust: 'Bust', blackjack: 'Blackjack', player_blackjack: 'Blackjack', player_bust: 'Player bust', dealer_bust: 'Dealer bust', mixed: 'Mixed result', player: 'Player wins', banker: 'Banker wins', tie: 'Tie', accepted: 'Accepted', declined: 'Declined', won_insurance: 'Insurance won' };
  return labels[value] || String(value).replace(/[_-]/g, ' ').replace(/^\w/, letter => letter.toUpperCase());
}
function validCards(cards, minimum = 1, maximum = 21, hidden = false) {
  return Array.isArray(cards) && cards.length >= minimum && cards.length <= maximum && cards.every(card => card && typeof card === 'object' && ((RANKS.has(card.rank) && SUITS[card.suit]) || (hidden && card.rank === '?' && card.suit === '')));
}
function cardFace(card) {
  const el = document.createElement('div'); el.className = 'receipt-card'; el.setAttribute('role', 'img');
  if (card.rank === '?') { el.classList.add('is-hidden'); el.setAttribute('aria-label', 'Unrevealed card'); return el; }
  el.setAttribute('aria-label', `${card.rank} of ${SUITS[card.suit]}`);
  el.classList.toggle('is-red', card.suit === '♥' || card.suit === '♦');
  const rank = document.createElement('span'); rank.className = 'receipt-card-rank'; rank.textContent = card.rank + card.suit; rank.setAttribute('aria-hidden', 'true'); el.append(rank);
  const center = document.createElement('span'); center.className = 'receipt-card-center'; center.setAttribute('aria-hidden', 'true');
  if (['J', 'Q', 'K'].includes(card.rank)) { center.classList.add('is-court', 'court-' + card.rank.toLowerCase()); }
  else center.textContent = card.suit;
  el.append(center);
  return el;
}
function cardGroup(parent, label, cards, detail = '') {
  const group = document.createElement('section'); group.className = 'receipt-hand';
  const title = document.createElement('h3'); title.textContent = label + (detail ? ' · ' + detail : ''); group.append(title);
  const hand = document.createElement('div'); hand.className = 'receipt-cards'; hand.setAttribute('aria-label', label); cards.forEach(card => hand.append(cardFace(card))); group.append(hand); parent.append(group);
}
function detailLine(parent, message) { const el = document.createElement('p'); el.className = 'receipt-details'; el.textContent = message; parent.append(el); }
function validateTable(row) {
  const result = row?.result;
  if (!row || !TABLES[row.game] || row.game !== selectedGame || !textValid(row.id) || !Number.isFinite(Date.parse(row.created_at)) || (row.settled_at && !Number.isFinite(Date.parse(row.settled_at))) || !amountValid(row.stake) || !amountValid(row.payout) || !textValid(row.outcome) || !result || typeof result !== 'object' || Array.isArray(result)) return false;
  if (row.game === 'blackjack') {
    if (!validCards(result.player_cards) || !validCards(result.dealer_cards) || ![result.player_total, result.dealer_total].every(amountValid) || ![result.main_stake, result.main_payout, result.insurance_stake, result.insurance_payout].every(amountValid)) return false;
    if (Math.abs(Number(row.stake) - Number(result.main_stake) - Number(result.insurance_stake)) > .005 || Math.abs(Number(row.payout) - Number(result.main_payout) - Number(result.insurance_payout)) > .005) return false;
    return result.player_hands == null || (Array.isArray(result.player_hands) && result.player_hands.length >= 2 && result.player_hands.length <= 4 && result.player_hands.every(hand => validCards(hand.cards) && amountValid(hand.stake) && amountValid(hand.total) && textValid(hand.status)));
  }
  if (row.game === 'baccarat') return validCards(result.player_cards, 2, 3) && validCards(result.banker_cards, 2, 3) && [result.player_total, result.banker_total].every(amountValid) && textValid(result.bet_type);
  if (row.game === 'roulette') {
    const numberBet = result.bet_type === 'number', betNumber = Number(result.bet_value);
    return Number.isInteger(result.winning_number) && result.winning_number >= 0 && result.winning_number <= 36 && ['red', 'black', 'green'].includes(result.winning_color) && (numberBet ? result.bet_value !== null && result.bet_value !== '' && ['string', 'number'].includes(typeof result.bet_value) && Number.isInteger(betNumber) && betNumber >= 0 && betNumber <= 36 : Object.hasOwn(ROULETTE_BETS, result.bet_type) && (result.bet_value == null || typeof result.bet_value === 'string' || typeof result.bet_value === 'number'));
  }
  if (row.game === 'jacks-or-better') return validCards(result.final_hand, 5, 5) && validCards(result.initial_hand, 5, 5) && amountValid(result.multiplier);
  const count = { holdem: 2, omaha: 4, draw: 5 }[row.game];
  return validCards(result.player_cards, count || 3, count || 7) && validCards(result.opponent_cards, count || 3, count || 7, true) && validCards(result.board, 0, 5) && [result.ante, result.committed, result.opponent_committed, result.pot].every(amountValid);
}
function tableReceipt(row) {
  if (!validateTable(row)) throw new Error('A table round receipt is incomplete. Refresh to try again.');
  const result = row.result, el = document.createElement('article'); el.className = 'receipt receipt-table'; el.dataset.receiptId = row.id;
  const title = document.createElement('h2'); title.textContent = TABLES[row.game]; el.append(title);
  const time = document.createElement('time'); time.dateTime = row.settled_at || row.created_at; time.textContent = 'Settled ' + new Date(time.dateTime).toLocaleString(); el.append(time);
  const summary = document.createElement('dl'); summary.className = 'receipt-summary';
  for (const [name, value] of [['Wager', money(row.stake)], ['Returned', money(row.payout)], [row.game === 'blackjack' ? 'Main result' : 'Result', readable(row.outcome)]]) {
    const cell = document.createElement('div'), label = document.createElement('dt'), amount = document.createElement('dd'); label.textContent = name; amount.textContent = value; cell.append(label, amount); summary.append(cell);
  }
  el.append(summary);
  if (row.game === 'blackjack') {
    cardGroup(el, 'Dealer', result.dealer_cards, 'Total ' + result.dealer_total);
    if (result.player_hands?.length) result.player_hands.forEach((hand, index) => cardGroup(el, 'Hand ' + (index + 1), hand.cards, `Total ${hand.total} · ${readable(hand.status)} · Wager ${money(hand.stake)}`));
    else cardGroup(el, 'Player', result.player_cards, 'Total ' + result.player_total);
    detailLine(el, `Main wager ${money(result.main_stake)} · Returned ${money(result.main_payout)}`);
    if (Number(result.insurance_stake) > 0 || Number(result.insurance_payout) > 0) detailLine(el, `Insurance wager ${money(result.insurance_stake)} · Returned ${money(result.insurance_payout)} · ${Number(result.insurance_payout) > 0 ? 'Won' : 'Lost'}`);
    else if (result.insurance_status === 'declined') detailLine(el, 'Insurance declined');
  } else if (row.game === 'baccarat') {
    detailLine(el, 'Bet on ' + readable(result.bet_type));
    cardGroup(el, 'Player', result.player_cards, 'Total ' + result.player_total); cardGroup(el, 'Banker', result.banker_cards, 'Total ' + result.banker_total);
  } else if (row.game === 'roulette') {
    const winner = document.createElement('p'); winner.className = 'receipt-roulette-result ' + result.winning_color; winner.textContent = result.winning_number + ' ' + readable(result.winning_color); el.append(winner);
    detailLine(el, 'Bet: ' + (result.bet_type === 'number' ? 'Number ' + String(result.bet_value) : ROULETTE_BETS[result.bet_type]));
  } else if (row.game === 'jacks-or-better') {
    cardGroup(el, 'Final cards', result.final_hand); cardGroup(el, 'Initial cards', result.initial_hand); detailLine(el, 'Payout multiplier: ' + result.multiplier + '×');
  } else {
    if (result.board.length) cardGroup(el, 'Community cards', result.board);
    cardGroup(el, 'Player', result.player_cards, typeof result.player_rank === 'string' ? result.player_rank : '');
    cardGroup(el, 'Computer', result.opponent_cards, typeof result.opponent_rank === 'string' ? result.opponent_rank : '');
    detailLine(el, `Opening wager ${money(result.ante)} · Total wager ${money(result.committed)} · Computer wager ${money(result.opponent_committed)} · Pot ${money(result.pot)}`);
  }
  detailLine(el, 'Returned includes any wager returned with this round.');
  const id = document.createElement('p'); id.className = 'receipt-id'; id.textContent = 'Receipt ' + row.id; el.append(id);
  return el;
}
async function load(append = false) {
  if (loading || !client) return;
  if (!userId) { empty(`Your settled ${roundName()} will appear here after you sign in.`); status(`Sign in to view your settled ${roundName()}.`); ui.signin.hidden = false; return; }
  const owner = userId, epoch = generation, sequence = ++requestNumber, game = selectedGame;
  const current = () => userId === owner && generation === epoch && sequence === requestNumber && selectedGame === game;
  loading = true; ui.refresh.disabled = true; ui.more.disabled = true; status(`Loading your ${historyName()}…`);
  if (!append) { cursor = null; seen.clear(); ui.list.replaceChildren(); ui.more.hidden = true; }
  try {
    const { data, error } = await bounded(client.auth.getSession());
    if (!current()) return;
    if (error) { setSession(null); status('Unable to verify your sign-in. Sign in again to view your casino history.', true); return; }
    if (data?.session?.user?.id !== owner) { setSession(data?.session || null); if (userId) setTimeout(() => load(), 0); return; }
    const body = game === 'slots' ? { action: 'history', limit: 20, ...(append && cursor ? { before: cursor } : {}) } : { game, limit: 20, before: append && cursor ? cursor : null };
    const response = await fetch(functionUrl(game === 'slots' ? 'themedSlots' : 'casinoHistory'), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: GAMEDAY_CONFIG.supabasePublishableKey, Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!current()) return;
    if (response.status === 401 || response.status === 403) { setSession(null); status('Your sign-in expired. Sign in again to view your casino history.', true); return; }
    const entries = game === 'slots' ? result?.receipts : result?.rounds;
    if (!response.ok || !result?.ok || !Array.isArray(entries)) throw new Error(result?.error || 'Casino history is unavailable. Press Refresh History to try again.');
    const batchIds = new Set(seen);
    const rows = entries.filter(row => {
      if (batchIds.has(row.id)) return false;
      batchIds.add(row.id);
      return true;
    });
    const fragment = document.createDocumentFragment();
    for (const row of rows) fragment.append(game === 'slots' ? slotReceipt(row) : tableReceipt(row));
    for (const row of rows) seen.add(row.id);
    if (!append || !seen.size) ui.list.replaceChildren();
    ui.list.append(fragment);
    if (!seen.size) empty(game === 'slots' ? 'No settled spins yet. Your next spin’s symbols and payout will appear here.' : `No settled ${TABLES[game]} rounds yet. Finished rounds and returns will appear here.`);
    cursor = result.next_cursor || null; ui.more.hidden = !cursor;
    status(`Showing your settled ${roundName()}. TEST MODE — no real money.`);
  } catch (error) { if (current()) status(error.message || 'Casino history is unavailable. Press Refresh History to try again.', true); }
  finally { if (current()) { loading = false; ui.refresh.disabled = false; ui.more.disabled = false; } }
}
async function boot() {
  if (booting) return;
  booting = true; ui.refresh.disabled = true;
  try {
    if (!client) {
      const previousAttempt = Number(new URL(location.href).searchParams.get('gameday-history-retry')) || 0;
      const attempt = sdkAttempt++ + previousAttempt;
      const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm' + (attempt ? '?gameday-history-retry=' + attempt : '');
      const { createClient } = await bounded(import(sdkUrl));
      client = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
      client.auth.onAuthStateChange((_event, session) => { if (setSession(session) && session?.user) setTimeout(() => load(), 0); });
    }
    const initial = generation, { data, error } = await bounded(client.auth.getSession());
    if (initial !== generation) return;
    if (error) throw error;
    setSession(data?.session || null); await load();
  } catch { status('Unable to connect to your casino history. Press Refresh History to reconnect.', true); }
  finally { booting = false; if (!loading) ui.refresh.disabled = false; }
}
ui.refresh.addEventListener('click', () => {
  if (!client && sdkAttempt > 0) {
    const url = new URL(location.href);
    url.searchParams.set('gameday-history-retry', String((Number(url.searchParams.get('gameday-history-retry')) || 0) + 1));
    location.replace(url.href);
    return;
  }
  return client && userId ? load() : boot();
});
ui.more.addEventListener('click', () => load(true));
ui.game.addEventListener('change', () => {
  selectedGame = ui.game.value;
  requestNumber++; loading = false; cursor = null; seen.clear(); ui.list.replaceChildren(); ui.more.hidden = true; ui.more.disabled = false; ui.refresh.disabled = false;
  status(`Loading your ${historyName()}…`);
  if (client) load();
});
await boot();
