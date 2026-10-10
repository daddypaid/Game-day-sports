import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

// Reel animation is visual only. Every settled grid, winning line, payout,
// and wallet balance comes from the authenticated Lucky 7s slot service.
const supabase = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
const GAME = 'lucky-7s';
const MATH_VERSION = 'five-lines-v1';
const ATLAS = 'assets/lucky-7s/symbols-atlas.webp';
const SYMBOLS = {
  RED7: { name: 'Red 7', atlas: [0, 0] },
  BLUE7: { name: 'Blue 7', atlas: [1, 0] },
  GOLD7: { name: 'Gold 7', atlas: [2, 0] },
  FOOTBALL: { name: 'Football', atlas: [0, 1] },
  SOCCER: { name: 'Soccer', atlas: [1, 1] },
  HOCKEY: { name: 'Hockey puck', atlas: [2, 1] },
  BASKETBALL: { name: 'Basketball', atlas: [0, 2] },
  BOXING: { name: 'Boxing gloves', atlas: [1, 2] },
  GOALPOST: { name: 'Goalpost', atlas: [2, 2] },
};
const CODES = Object.keys(SYMBOLS);
const PAYLINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
const LINE_NAMES = ['Top', 'Middle', 'Bottom', 'Diagonal down', 'Diagonal up'];
const LINE_COLORS = ['#f8df77', '#73f0ad', '#6ebeff', '#ffa276', '#cd9eff'];
const INITIAL_GRID = [
  ['RED7', 'FOOTBALL', 'GOLD7'],
  ['SOCCER', 'BLUE7', 'BOXING'],
  ['HOCKEY', 'BASKETBALL', 'GOALPOST'],
];
// Display defaults only; authenticated service configuration is required
// before Spin, Auto Spin, or wager controls become available.
const DEFAULT_RULES = {
  min_total_bet: 0.1, max_total_bet: 200, total_bet_step: 0.1,
  default_total_bet: 1, pays: null,
};
const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'reels', 'wallet', 'win', 'spin', 'bet-line', 'total-bet',
  'line-minus', 'line-plus', 'total-minus', 'total-plus', 'auto', 'max',
  'sound', 'status', 'info', 'menu', 'dialog', 'dialog-title',
  'dialog-content', 'dialog-close',
].map(name => [name, $('l7-' + name)]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let user = null;
let balance = null;
let rules = { ...DEFAULT_RULES };
let betCents = 100;
let grid = INITIAL_GRID.map(column => [...column]);
let lastWinCells = [];
let lastWinLines = [];
let spinning = false;
let activeAnimation = null;
let accountReady = false;
let accountEpoch = 0;
let accountLoad = 0;
let pendingAccountRefresh = false;
let pageGone = false;
let autoRemaining = 0;
let autoTimer = 0;
let audio = null;
let spinSound = [];
let muted = false;
try { muted = localStorage.getItem('gameday-l7-muted') === '1'; } catch { /* Sound works without storage. */ }

const money = value => '$' + Number(value || 0).toFixed(2);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const randomCode = () => CODES[Math.floor(Math.random() * CODES.length)];
const totalBet = () => betCents / 100;
const lineBet = () => totalBet() / 5;
const minBetCents = () => Math.round(rules.min_total_bet * 100);
const maxBetCents = () => Math.round(rules.max_total_bet * 100);
const stepCents = () => Math.round(rules.total_bet_step * 100);
const affordableMax = () => Math.min(maxBetCents(), Math.floor(Math.floor(Number(balance || 0) * 100) / stepCents()) * stepCents());

function setStatus(message, kind = '', accountLink = false) {
  ui.status.replaceChildren(document.createTextNode(message));
  ui.status.classList.toggle('is-error', kind === 'error');
  ui.status.classList.toggle('is-win', kind === 'win');
  if (accountLink) {
    const link = document.createElement('a');
    link.href = GAMEDAY_CONFIG.routes.account;
    link.textContent = user ? ' Open Account' : ' Sign in';
    ui.status.appendChild(link);
  }
}

function makeSymbol(code, cellIndex) {
  const symbol = document.createElement('div');
  const artwork = SYMBOLS[code];
  symbol.className = 'l7-symbol';
  symbol.dataset.symbol = code;
  if (cellIndex !== undefined) symbol.dataset.cell = String(cellIndex);
  symbol.setAttribute('role', 'img');
  symbol.setAttribute('aria-label', artwork.name);
  const art = document.createElement('span');
  art.className = 'l7-symbol-art';
  art.setAttribute('aria-hidden', 'true');
  art.style.backgroundImage = `url("${ATLAS}")`;
  art.style.backgroundSize = '300% 300%';
  art.style.backgroundPosition = `${artwork.atlas[0] * 50}% ${artwork.atlas[1] * 50}%`;
  symbol.appendChild(art);
  return symbol;
}

const reels = Array.from({ length: 3 }, (_, column) => {
  const reel = document.createElement('div');
  reel.className = 'l7-reel';
  reel.setAttribute('aria-label', 'Reel ' + (column + 1));
  const strip = document.createElement('div');
  strip.className = 'l7-strip';
  reel.appendChild(strip);
  ui.reels.appendChild(reel);
  return { reel, strip };
});

function fillStrip(strip, codes, size, column) {
  strip.replaceChildren(...codes.map((code, row) => {
    const symbol = makeSymbol(code, column === undefined ? undefined : row * 3 + column);
    symbol.style.height = size + 'px';
    symbol.style.flex = '0 0 ' + size + 'px';
    return symbol;
  }));
}

function renderGrid(winCells = [], featureCells = []) {
  const wins = new Set(winCells);
  const features = new Set(featureCells);
  reels.forEach(({ reel, strip }, column) => {
    strip.style.transform = '';
    fillStrip(strip, grid[column], reel.clientHeight / 3 || reel.clientWidth, column);
    for (const symbol of strip.children) {
      const cell = Number(symbol.dataset.cell);
      symbol.classList.toggle('is-win', wins.has(cell));
      symbol.classList.toggle('is-feature', features.has(cell));
    }
  });
}

function startReels() {
  ui.reels.classList.add('is-spinning');
  ui.reels.setAttribute('aria-busy', 'true');
  const previousGrid = grid.map(column => [...column]);
  const started = performance.now();
  const columns = reels.map(({ reel, strip }, column) => {
    const cycle = [...previousGrid[column], ...Array.from({ length: 15 }, randomCode)];
    const size = reel.clientHeight / 3 || reel.clientWidth;
    fillStrip(strip, [...cycle, ...cycle.slice(0, 4)], size);
    reel.classList.add('is-spinning');
    return { reel, strip, cycle, size, offset: 0, rolling: true, animation: null };
  });
  let cancelled = false;
  let frame = 0;
  const roll = now => {
    if (cancelled) return;
    columns.forEach((column, index) => {
      if (!column.rolling || reducedMotion.matches) return;
      column.offset = ((now - started) * (0.012 + index * 0.00045)) % column.cycle.length;
      column.strip.style.transform = `translate3d(0,${-column.offset * column.size}px,0)`;
    });
    frame = requestAnimationFrame(roll);
  };
  if (!reducedMotion.matches) frame = requestAnimationFrame(roll);
  return {
    async settle(finalGrid) {
      if (!reducedMotion.matches) await delay(Math.max(0, 1150 - (performance.now() - started)));
      await Promise.all(columns.map(async (column, index) => {
        if (!reducedMotion.matches) await delay(index * 155);
        if (cancelled) return;
        column.rolling = false;
        const cellOffset = Math.floor(column.offset);
        const fraction = column.offset - cellOffset;
        const visible = Array.from({ length: 4 }, (_, row) => column.cycle[(cellOffset + row) % column.cycle.length]);
        const lead = [...visible, ...Array.from({ length: 3 }, randomCode)];
        fillStrip(column.strip, [...lead, ...finalGrid[index]], column.size);
        const from = `translate3d(0,${-fraction * column.size}px,0)`;
        const to = `translate3d(0,${-lead.length * column.size}px,0)`;
        column.strip.style.transform = from;
        if (!reducedMotion.matches) {
          column.animation = column.strip.animate([{ transform: from }, { transform: to }], {
            duration: 620, easing: 'cubic-bezier(.18,.65,.2,1)', fill: 'forwards',
          });
          try { await column.animation.finished; } catch { /* Cancelled on navigation or an account change. */ }
        }
        if (cancelled) return;
        column.animation?.cancel();
        column.strip.style.transform = '';
        fillStrip(column.strip, finalGrid[index], column.size, index);
        column.reel.classList.remove('is-spinning');
        column.reel.classList.add('is-stopped');
        setTimeout(() => column.reel.classList.remove('is-stopped'), 250);
        playSound('stop');
      }));
    },
    cancel(restore = false) {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(frame);
      columns.forEach(column => {
        column.animation?.cancel();
        column.reel.classList.remove('is-spinning', 'is-stopped');
      });
      ui.reels.classList.remove('is-spinning');
      ui.reels.removeAttribute('aria-busy');
      if (restore) renderGrid();
    },
  };
}

async function unlockAudio() {
  if (muted) return null;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audio || audio.state === 'closed') audio = new AudioContext();
    if (audio.state === 'suspended') await audio.resume();
    return audio.state === 'running' ? audio : null;
  } catch { return null; }
}

function tone(frequency, duration, volume = 0.035, offset = 0, type = 'triangle') {
  if (muted || document.hidden || !audio || audio.state !== 'running') return;
  const at = audio.currentTime + offset;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.03);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}

function stopSpinSound() {
  for (const node of spinSound) {
    try { node.stop?.(); node.disconnect(); } catch { /* A source may already have stopped. */ }
  }
  spinSound = [];
}

function startSpinSound() {
  stopSpinSound();
  if (muted || document.hidden || !audio || audio.state !== 'running') return;
  const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) {
    const flutter = 0.6 + 0.4 * Math.sin(index / audio.sampleRate * Math.PI * 32);
    samples[index] = (Math.random() * 2 - 1) * flutter;
  }
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = 'bandpass';
  filter.frequency.value = 580;
  filter.Q.value = 0.7;
  gain.gain.value = 0.045;
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start();
  spinSound = [source, filter, gain];
  tone(75, 0.19, 0.027, 0, 'sine');
}

function playSound(kind) {
  if (kind === 'tap') tone(270, 0.06, 0.024);
  else if (kind === 'stop') { tone(130, 0.06, 0.025, 0, 'square'); tone(72, 0.09, 0.02, 0.018); }
  else if (kind === 'win') [523, 659, 784, 1047].forEach((note, index) => tone(note, 0.24, 0.038, index * 0.11));
}

function sync() {
  ui.wallet.textContent = user && balance !== null ? money(balance) : '—';
  ui['bet-line'].textContent = money(lineBet());
  ui['total-bet'].textContent = money(totalBet());
  const locked = spinning || !accountReady || pageGone;
  ui['line-minus'].disabled = locked || betCents <= minBetCents();
  ui['total-minus'].disabled = locked || betCents <= minBetCents();
  ui['line-plus'].disabled = locked || betCents >= maxBetCents();
  ui['total-plus'].disabled = locked || betCents >= maxBetCents();
  ui.max.disabled = locked || affordableMax() < minBetCents();
  ui.spin.disabled = locked || Number(balance) < totalBet();
  ui.spin.textContent = 'SPIN';
  ui.spin.setAttribute('aria-label', `Spin all five paylines for ${money(totalBet())} test credits`);
  ui.auto.disabled = !autoRemaining && ui.spin.disabled;
  ui.auto.classList.toggle('is-active', autoRemaining > 0);
  ui.auto.setAttribute('aria-pressed', String(autoRemaining > 0));
  ui.auto.textContent = autoRemaining ? 'STOP AUTO' : 'AUTO SPIN';
  ui.auto.setAttribute('aria-label', autoRemaining ? 'Stop automatic spins' : 'Play five automatic spins');
  ui.sound.classList.toggle('is-muted', muted);
  ui.sound.textContent = muted ? '🔇' : '🔊';
  ui.sound.setAttribute('aria-pressed', String(!muted));
  ui.sound.setAttribute('aria-label', muted ? 'Turn game sound on' : 'Mute game sound');
}

function stopAuto() {
  autoRemaining = 0;
  clearTimeout(autoTimer);
  sync();
}

function queueAuto() {
  if (!autoRemaining) return;
  autoRemaining--;
  if (!autoRemaining || document.hidden || pageGone || ui.dialog.open || ui.spin.disabled) { stopAuto(); return; }
  sync();
  autoTimer = setTimeout(() => { if (autoRemaining && !document.hidden && !spinning && !pageGone) spin(); }, 1000);
}

class SlotError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}

async function invokeSlot(body, expectedUser = user?.id) {
  const expectedEpoch = accountEpoch;
  const { data, error } = await supabase.auth.getSession();
  if (pageGone || expectedEpoch !== accountEpoch || user?.id !== expectedUser ||
      error || !data.session?.access_token || data.session.user.id !== expectedUser) {
    throw new SlotError('Sign in to play GameDay Lucky 7s.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(functionUrl('slots'), {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', apikey: GAMEDAY_CONFIG.supabasePublishableKey,
        Authorization: 'Bearer ' + data.session.access_token,
      },
      body: JSON.stringify({ game: GAME, math_version: MATH_VERSION, ...body }),
    });
    let result;
    try { result = await response.json(); } catch { throw new SlotError('The server response could not be read.', true); }
    if (!response.ok || result.error) {
      throw new SlotError(result.error || 'The slot service is unavailable.', response.status >= 500);
    }
    return result;
  } catch (error) {
    if (error instanceof SlotError) throw error;
    throw new SlotError(error.name === 'AbortError' ? 'The connection timed out.' : 'The connection was interrupted.', true);
  } finally { clearTimeout(timeout); }
}

function normalizeRules(value) {
  if (!value || value.mode !== 'lines' || value.math_version !== MATH_VERSION || value.reels !== 3 ||
      value.rows !== 3 || value.lines !== 5 || value.free_spins !== 0 ||
      JSON.stringify(value.paylines) !== JSON.stringify(PAYLINES)) {
    throw new SlotError('The Lucky 7s five-payline rules could not be loaded.');
  }
  const fields = ['min_total_bet', 'max_total_bet', 'total_bet_step', 'default_total_bet'];
  const cents = fields.map(field => Number(value[field]) * 100);
  if (cents.some(amount => !Number.isFinite(amount) || amount <= 0 || Math.abs(amount - Math.round(amount)) > 1e-6) ||
      cents[0] > cents[3] || cents[3] > cents[1] || cents[1] > 20000 ||
      cents.some(amount => Math.abs(amount / cents[2] - Math.round(amount / cents[2])) > 1e-6) ||
      !value.pays || CODES.some(code => !Number.isFinite(value.pays[code]) || value.pays[code] <= 0)) {
    throw new SlotError('The Lucky 7s wager settings could not be loaded.');
  }
  return { ...value, ...Object.fromEntries(fields.map((field, index) => [field, Math.round(cents[index]) / 100])) };
}

async function loadAccount({ quiet = false } = {}) {
  if (pageGone) return false;
  if (spinning) { pendingAccountRefresh = true; return false; }
  const load = ++accountLoad;
  const epoch = accountEpoch;
  accountReady = false;
  sync();
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new SlotError('Your GameDay account could not be loaded.');
    if (load !== accountLoad || epoch !== accountEpoch || pageGone) return false;
    user = data.session?.user || null;
    if (!user) {
      balance = null;
      setStatus('Sign in to use your GameDay test wallet.', '', true);
      sync();
      return false;
    }
    const currentUser = user.id;
    const [wallet, status] = await Promise.all([
      supabase.from('wallets').select('balance').eq('user_id', currentUser).single(),
      invokeSlot({ action: 'status' }, currentUser),
    ]);
    if (load !== accountLoad || epoch !== accountEpoch || user?.id !== currentUser || pageGone) return false;
    if (wallet.error || !Number.isFinite(Number(wallet.data?.balance)) || Number(wallet.data?.balance) < 0) {
      throw new SlotError('Your GameDay test wallet could not be loaded.');
    }
    rules = normalizeRules(status.game_config);
    balance = Number(wallet.data.balance);
    betCents = Math.min(maxBetCents(), Math.max(minBetCents(), Math.round(betCents / stepCents()) * stepCents()));
    accountReady = true;
    if (!quiet) setStatus(balance < totalBet() ? 'Lower your bet or refill your test wallet in Account.' : 'All five paylines are active. Press SPIN.', '', balance < totalBet());
    sync();
    return true;
  } catch (error) {
    if (load !== accountLoad || epoch !== accountEpoch || pageGone) return false;
    accountReady = false;
    setStatus(error.message + ' Reload this page to reconnect.', 'error', true);
    sync();
    return false;
  }
}

function validateSpin(result, requestedTotal) {
  if (!result || result.game !== GAME || result.math_version !== MATH_VERSION || result.lines !== 5 ||
      !Array.isArray(result.grid) || result.grid.length !== 3 || result.grid.some(column =>
        !Array.isArray(column) || column.length !== 3 || column.some(code => !CODES.includes(code)))) {
    throw new SlotError('The server returned an invalid reel result.', true);
  }
  if (!Number.isFinite(result.balance) || result.balance < 0 || !Number.isFinite(result.payout) || result.payout < 0 ||
      !Number.isFinite(result.total_bet) || Math.abs(result.total_bet - requestedTotal) > 1e-6 ||
      !Number.isFinite(result.stake) || Math.abs(result.stake - requestedTotal) > 1e-6 ||
      !Number.isFinite(result.bet_per_line) || Math.abs(result.bet_per_line * 5 - requestedTotal) > 1e-6 ||
      result.free_spin !== false || result.bonus_triggered !== false) {
    throw new SlotError('The server returned an invalid wallet result.', true);
  }
  if (!Array.isArray(result.win_cells) || result.win_cells.some(cell => !Number.isInteger(cell) || cell < 0 || cell > 8) ||
      !Array.isArray(result.active_lines) || result.active_lines.some(line => !Number.isInteger(line) || line < 0 || line > 4)) {
    throw new SlotError('The server returned invalid winning paylines.', true);
  }
}

async function spin() {
  if (spinning || !accountReady || !user || pageGone || ui.dialog.open) return;
  if (Number(balance) < totalBet()) { stopAuto(); setStatus('Lower your bet or refill your test wallet in Account.', 'error', true); return; }
  const epoch = accountEpoch;
  const currentUser = user.id;
  const requestedTotal = totalBet();
  spinning = true; // Lock before any await: repeated taps submit only one spin.
  lastWinCells = [];
  lastWinLines = [];
  clearWinLines();
  ui.win.textContent = money(0);
  setStatus('The Lucky 7s reels are spinning…');
  sync();
  const animation = startReels();
  activeAnimation = animation;
  unlockAudio().then(context => { if (context && spinning && epoch === accountEpoch && !pageGone) startSpinSound(); });
  let finished = false;
  try {
    const result = await invokeSlot({ action: 'spin', total_bet: requestedTotal }, currentUser);
    const settled = result.spin;
    const settledRules = normalizeRules(result.game_config);
    validateSpin(settled, requestedTotal);
    if (epoch !== accountEpoch || user?.id !== currentUser || pageGone) return;
    await animation.settle(settled.grid);
    if (epoch !== accountEpoch || user?.id !== currentUser || pageGone) return;
    rules = settledRules;
    grid = settled.grid.map(column => [...column]);
    balance = settled.balance;
    ui.win.textContent = money(settled.payout);
    lastWinCells = [...settled.win_cells];
    lastWinLines = [...settled.active_lines];
    renderGrid(lastWinCells);
    drawWinLines(lastWinLines);
    const names = lastWinLines.map(index => LINE_NAMES[index]).join(', ');
    setStatus(settled.payout > 0 ? `You won ${money(settled.payout)}${names ? ' • ' + names : ''}` : 'No win. Press SPIN to play again.', settled.payout > 0 ? 'win' : '');
    if (settled.payout > 0) playSound('win');
    finished = true;
  } catch (error) {
    if (epoch !== accountEpoch || activeAnimation !== animation || pageGone) return;
    stopAuto();
    animation.cancel(true);
    if (user?.id === currentUser) {
      // A dropped response can follow a committed spin. Reconcile with read-only
      // status and wallet reads; never retry a paid request automatically.
      spinning = false;
      const reconnected = await loadAccount({ quiet: true });
      if (epoch !== accountEpoch || activeAnimation !== animation || pageGone) return;
      const message = error.uncertain ? `${error.message} Your last spin may have completed. ${reconnected ? 'Wallet refreshed; check Account before spinning again.' : 'Reconnect before spinning again.'}` : error.message;
      setStatus(message, 'error', !!error.uncertain || !reconnected);
    }
  } finally {
    if (activeAnimation === animation) {
      animation.cancel(!finished);
      activeAnimation = null;
      stopSpinSound();
      spinning = false;
      sync();
      if (pendingAccountRefresh) {
        pendingAccountRefresh = false;
        await loadAccount({ quiet: finished });
      }
      if (finished && epoch === accountEpoch && !pageGone) queueAuto();
    }
  }
}

function clearWinLines() {
  ui.reels.querySelector('.l7-payline-overlay')?.remove();
}

function drawWinLines(indices) {
  clearWinLines();
  if (!indices.length) return;
  const bounds = ui.reels.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const reelBounds = reels.map(({ reel }) => reel.getBoundingClientRect());
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('l7-payline-overlay');
  svg.setAttribute('viewBox', '0 0 300 300');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const index of indices) {
    const line = document.createElementNS(svgNS, 'polyline');
    line.dataset.line = String(index);
    line.setAttribute('points', PAYLINES[index].map((row, column) => {
      const reel = reelBounds[column];
      const x = (reel.left + reel.width / 2 - bounds.left) / bounds.width * 300;
      const y = (reel.top + reel.height * (row + 0.5) / 3 - bounds.top) / bounds.height * 300;
      return `${x},${y}`;
    }).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', LINE_COLORS[index]);
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-opacity', '0.88');
    svg.appendChild(line);
  }
  ui.reels.appendChild(svg);
}

function paragraph(text) {
  const element = document.createElement('p');
  element.textContent = text;
  return element;
}

function openDialog(title, content) {
  stopAuto();
  ui['dialog-title'].textContent = title;
  ui['dialog-content'].replaceChildren(content);
  if (!ui.dialog.open) ui.dialog.showModal();
}

function showInfo() {
  const content = document.createElement('div');
  content.append(paragraph('3 reels. 3 visible rows. All 5 paylines are active on every spin. Match three identical symbols along a payline to win. There are no Wild, Scatter, or free-spin symbols. Test credits only; no real money.'));
  const gallery = document.createElement('div');
  gallery.className = 'l7-symbol-gallery';
  for (const code of CODES) {
    const item = document.createElement('figure');
    const label = document.createElement('figcaption');
    label.textContent = SYMBOLS[code].name;
    item.append(makeSymbol(code), label);
    gallery.appendChild(item);
  }
  content.appendChild(gallery);
  if (rules.pays) {
    const paytable = document.createElement('table');
    paytable.className = 'l7-paytable';
    const caption = document.createElement('caption');
    caption.textContent = '3 matching symbols — multiplier × bet per line';
    const thead = document.createElement('thead');
    const header = document.createElement('tr');
    for (const text of ['Symbol', '3 matches']) {
      const cell = document.createElement('th');
      cell.textContent = text;
      header.appendChild(cell);
    }
    thead.appendChild(header);
    const tbody = document.createElement('tbody');
    for (const code of CODES) {
      const row = document.createElement('tr');
      for (const text of [SYMBOLS[code].name, rules.pays[code] + '×']) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
    paytable.append(caption, thead, tbody);
    content.appendChild(paytable);
    content.append(paragraph('Winning paylines are added together. Total bet is split equally across five lines. Payouts, symbols, and test-wallet changes are settled by the authenticated GameDay service.'));
  } else content.append(paragraph('Sign in to load the current GameDay Lucky 7s test paytable.'));
  const title = document.createElement('h3');
  title.textContent = '5 paylines';
  content.appendChild(title);
  const lines = document.createElement('div');
  lines.className = 'l7-payline-gallery';
  const svgNS = 'http://www.w3.org/2000/svg';
  PAYLINES.forEach((line, index) => {
    const item = document.createElement('figure');
    const diagram = document.createElementNS(svgNS, 'svg');
    diagram.setAttribute('viewBox', '0 0 60 60');
    diagram.setAttribute('role', 'img');
    diagram.setAttribute('aria-label', LINE_NAMES[index] + ' payline');
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
      const cell = document.createElementNS(svgNS, 'rect');
      cell.setAttribute('x', String(column * 20 + 2));
      cell.setAttribute('y', String(row * 20 + 2));
      cell.setAttribute('width', '16');
      cell.setAttribute('height', '16');
      cell.setAttribute('fill', line[column] === row ? LINE_COLORS[index] : '#15321d');
      cell.setAttribute('stroke', '#917444');
      diagram.appendChild(cell);
    }
    const label = document.createElement('figcaption');
    label.textContent = LINE_NAMES[index];
    item.append(diagram, label);
    lines.appendChild(item);
  });
  content.appendChild(lines);
  content.append(paragraph(`Choose a total bet, then press SPIN. Total bet: ${money(rules.min_total_bet)}–${money(rules.max_total_bet)} in ${money(rules.total_bet_step)} steps. Bet per line is total bet ÷ 5; both sets of ± buttons adjust the same wager. AUTO SPIN runs up to five paid spins and stops on insufficient balance, an error, or when you leave. MAX BET selects the highest wager your test wallet can cover.`));
  openDialog('Lucky 7s paytable', content);
}

function adjustBet(direction) {
  if (spinning || !accountReady || pageGone) return;
  unlockAudio().then(() => playSound('tap'));
  betCents = Math.min(maxBetCents(), Math.max(minBetCents(), betCents + direction * stepCents()));
  sync();
  const short = Number(balance) < totalBet();
  setStatus(short ? 'Lower your bet or refill your test wallet in Account.' : 'All five paylines are active. Press SPIN.', '', short);
}

ui.spin.addEventListener('click', spin);
ui['line-minus'].addEventListener('click', () => adjustBet(-1));
ui['total-minus'].addEventListener('click', () => adjustBet(-1));
ui['line-plus'].addEventListener('click', () => adjustBet(1));
ui['total-plus'].addEventListener('click', () => adjustBet(1));
ui.max.addEventListener('click', () => {
  if (spinning || !accountReady || pageGone || affordableMax() < minBetCents()) return;
  unlockAudio().then(() => playSound('tap'));
  betCents = affordableMax();
  sync();
  setStatus('Maximum affordable wager selected.');
});
ui.auto.addEventListener('click', () => {
  if (autoRemaining) { stopAuto(); return; }
  if (spinning || ui.spin.disabled || pageGone || ui.dialog.open) return;
  autoRemaining = 5;
  sync();
  spin();
});
ui.sound.addEventListener('click', async () => {
  muted = !muted;
  try { localStorage.setItem('gameday-l7-muted', muted ? '1' : '0'); } catch { /* Sound remains usable without storage. */ }
  if (muted) { stopSpinSound(); try { await audio?.suspend(); } catch { /* Audio is optional. */ } }
  else { await unlockAudio(); if (spinning) startSpinSound(); else playSound('tap'); }
  sync();
});
ui.info.addEventListener('click', showInfo);
ui.menu.addEventListener('click', () => {
  const content = document.createElement('div');
  content.className = 'l7-menu-links';
  for (const [label, destination] of [['Back to Slots Lobby', GAMEDAY_CONFIG.routes.slotsLobby], ['GameDay Casino', GAMEDAY_CONFIG.routes.casino], ['Account / test wallet', GAMEDAY_CONFIG.routes.account]]) {
    const link = document.createElement('a');
    link.href = destination;
    link.textContent = label;
    content.appendChild(link);
  }
  openDialog('Game menu', content);
});
ui['dialog-close'].addEventListener('click', () => ui.dialog.close());
ui.dialog.addEventListener('click', event => { if (event.target === ui.dialog) ui.dialog.close(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopAuto(); stopSpinSound(); }
});
window.addEventListener('pagehide', () => {
  pageGone = true;
  accountEpoch++;
  accountLoad++;
  accountReady = false;
  pendingAccountRefresh = false;
  activeAnimation?.cancel(true);
  activeAnimation = null;
  spinning = false;
  stopAuto();
  stopSpinSound();
  try { audio?.close(); } catch { /* The browser may already have closed it. */ }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  pageGone = false;
  loadAccount();
});
window.addEventListener('resize', () => {
  if (!spinning) { renderGrid(lastWinCells); drawWinLines(lastWinLines); }
});

supabase.auth.onAuthStateChange((event, session) => {
  const nextUser = session?.user || null;
  if (nextUser?.id !== user?.id) {
    accountEpoch++;
    accountLoad++;
    activeAnimation?.cancel();
    activeAnimation = null;
    spinning = false;
    pendingAccountRefresh = false;
    stopSpinSound();
    user = nextUser;
    balance = null;
    rules = { ...DEFAULT_RULES };
    betCents = 100;
    grid = INITIAL_GRID.map(column => [...column]);
    lastWinCells = [];
    lastWinLines = [];
    clearWinLines();
    ui.win.textContent = money(0);
    renderGrid();
    if (ui.dialog.open) ui.dialog.close();
    accountReady = false;
    stopAuto();
    setStatus(nextUser ? 'Connecting to your GameDay test wallet…' : 'Sign in to use your GameDay test wallet.', '', !nextUser);
    sync();
  }
  // Do not call Supabase inside its synchronous auth notification callback.
  if (event !== 'TOKEN_REFRESHED' && !pageGone) setTimeout(() => loadAccount(), 0);
});
renderGrid();
sync();
loadAccount();
