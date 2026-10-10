import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

const ui = Object.fromEntries(['status', 'refresh', 'signin', 'list', 'more'].map(id => [id, document.getElementById('history-' + id)]));
const GAMES = { 'midnight-monsters': 'Midnight Monsters', 'galactic-rebellion': 'Galactic Rebellion', 'lucky-7s': 'GameDay Lucky 7s' };
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
let client = null, userId = null, generation = 0, requestNumber = 0, loading = false, cursor = null, booting = false, sdkAttempt = 0;
const seen = new Set();
const money = amount => '$' + Number(amount || 0).toFixed(2);
function status(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle('is-error', error); }
function empty(message) { const el = document.createElement('p'); el.className = 'empty'; el.textContent = message; ui.list.replaceChildren(el); }
function setSession(session) {
  const next = session?.user?.id || null;
  if (next === userId) return false;
  generation++; requestNumber++; loading = false; userId = next; cursor = null; seen.clear();
  ui.list.replaceChildren(); ui.more.hidden = true; ui.refresh.disabled = false; ui.signin.hidden = !!next;
  status(next ? 'Loading your spin history…' : 'Sign in to view your settled spins.');
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
function receipt(row) {
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
async function load(append = false) {
  if (loading || !client) return;
  if (!userId) { empty('Your settled spins will appear here after you sign in.'); status('Sign in to view your settled spins.'); ui.signin.hidden = false; return; }
  const owner = userId, epoch = generation, sequence = ++requestNumber;
  const current = () => userId === owner && generation === epoch && sequence === requestNumber;
  loading = true; ui.refresh.disabled = true; ui.more.disabled = true; status('Loading your spin history…');
  if (!append) { cursor = null; seen.clear(); ui.list.replaceChildren(); ui.more.hidden = true; }
  try {
    const { data, error } = await client.auth.getSession();
    if (!current()) return;
    if (error) { setSession(null); status('Unable to verify your sign-in. Sign in again to view your spins.', true); return; }
    if (data?.session?.user?.id !== owner) { setSession(data?.session || null); if (userId) setTimeout(() => load(), 0); return; }
    const response = await fetch(functionUrl('themedSlots'), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: GAMEDAY_CONFIG.supabasePublishableKey, Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ action: 'history', limit: 20, ...(append && cursor ? { before: cursor } : {}) }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!current()) return;
    if (response.status === 401 || response.status === 403) { setSession(null); status('Your sign-in expired. Sign in again to view your spins.', true); return; }
    if (!response.ok || !result?.ok || !Array.isArray(result.receipts)) throw new Error(result?.error || 'Spin history is unavailable. Press Refresh History to try again.');
    const batchIds = new Set(seen);
    const rows = result.receipts.filter(row => {
      if (batchIds.has(row.id)) return false;
      batchIds.add(row.id);
      return true;
    });
    const fragment = document.createDocumentFragment();
    for (const row of rows) fragment.append(receipt(row));
    for (const row of rows) seen.add(row.id);
    if (!append || !seen.size) ui.list.replaceChildren();
    ui.list.append(fragment);
    if (!seen.size) empty('No settled spins yet. Your next spin’s symbols and payout will appear here.');
    cursor = result.next_cursor || null; ui.more.hidden = !cursor;
    status('Showing your settled spins. TEST MODE — no real money.');
  } catch (error) { if (current()) status(error.message || 'Spin history is unavailable. Press Refresh History to try again.', true); }
  finally { if (current()) { loading = false; ui.refresh.disabled = false; ui.more.disabled = false; } }
}
async function boot() {
  if (booting) return;
  booting = true; ui.refresh.disabled = true;
  try {
    if (!client) {
      const attempt = sdkAttempt++;
      const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm' + (attempt ? '?gameday-history-retry=' + attempt : '');
      const { createClient } = await import(sdkUrl);
      client = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
      client.auth.onAuthStateChange((_event, session) => { if (setSession(session) && session?.user) setTimeout(() => load(), 0); });
    }
    const initial = generation, { data, error } = await client.auth.getSession();
    if (initial !== generation) return;
    if (error) throw error;
    setSession(data?.session || null); await load();
  } catch { status('Unable to connect to your spin history. Press Refresh History to reconnect.', true); }
  finally { booting = false; if (!loading) ui.refresh.disabled = false; }
}
ui.refresh.addEventListener('click', () => client && userId ? load() : boot());
ui.more.addEventListener('click', () => load(true));
await boot();
