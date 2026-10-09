import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

// The reel strips are visual animation only. The authenticated slot service
// supplies every settled symbol, payout, wallet balance, and free-spin count.
const supabase = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
const GAME = 'midnight-monsters';
const ART = 'assets/midnight-monsters/';
const ATLAS = ART + 'extended-symbols-atlas.webp';
const SYMBOLS = {
  VAMP: { name: 'Vampire', file: 'vampire.webp', pays: [4, 10, 40] },
  WOLF: { name: 'Werewolf', file: 'werewolf.webp', pays: [3, 8, 30] },
  ZOMB: { name: 'Zombie', file: 'zombie.webp', pays: [2, 6, 24] },
  POTION: { name: 'Potion', file: 'potion.webp', pays: [2, 5, 18] },
  BAT: { name: 'Bat', file: 'bat.webp', pays: [1, 3, 10] },
  CANDLE: { name: 'Candle', file: 'candle.webp', pays: [1, 2, 8] },
  WILD: { name: 'Wild', file: 'wild.webp', pays: [5, 15, 50] },
  SCATTER: { name: 'Scatter', file: 'scatter.webp' },
  SPADE: { name: 'Spade', atlas: [0, 0], pays: [1, 2, 4] },
  CLUB: { name: 'Club', atlas: [1, 0], pays: [1, 2, 4] },
  HEART: { name: 'Heart', atlas: [2, 0], pays: [1, 2, 4] },
  DIAMOND: { name: 'Diamond', atlas: [3, 0], pays: [1, 2, 4] },
  SKULL: { name: 'Skull', atlas: [0, 1], pays: [1, 2, 6] },
  BOOK: { name: 'Book', atlas: [1, 1], pays: [1, 2, 6] },
  RING: { name: 'Ring', atlas: [2, 1], pays: [1, 2, 6] },
};
const CODES = Object.keys(SYMBOLS);
const PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 2, 2, 2, 0],
  [2, 0, 0, 0, 2], [1, 1, 0, 1, 1],
];
const INITIAL_GRID = [
  ['VAMP', 'SPADE', 'CANDLE'], ['WOLF', 'SCATTER', 'DIAMOND'],
  ['ZOMB', 'WILD', 'ZOMB'], ['POTION', 'VAMP', 'CANDLE'],
  ['BAT', 'CLUB', 'WOLF'],
];
const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'reels', 'wallet', 'win', 'free-spins', 'spin', 'bet-line', 'total-bet',
  'line-minus', 'line-plus', 'total-minus', 'total-plus', 'auto', 'max',
  'sound', 'status', 'features', 'info', 'menu', 'dialog', 'dialog-title',
  'dialog-content', 'dialog-close',
].map(name => [name, $('mm-' + name)]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let user = null;
let balance = null;
let betCents = 10;
let bonus = null;
let bonusProgress = { used: 0, total: 10 };
let grid = INITIAL_GRID.map(column => [...column]);
let spinning = false;
let activeAnimation = null;
let accountReady = false;
let accountEpoch = 0;
let accountLoad = 0;
let pendingAccountRefresh = false;
let autoRemaining = 0;
let autoTimer = 0;
let audio = null;
let spinSound = [];
let muted = false;
try { muted = localStorage.getItem('gameday-mm-muted') === '1'; } catch { /* Private browsing can deny storage. */ }

const money = value => '$' + Number(value || 0).toFixed(2);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const randomCode = () => CODES[Math.floor(Math.random() * CODES.length)];
const lineBet = () => betCents / 100;
const totalBet = () => Math.round(betCents * 20) / 100;
const affordableMax = () => Math.min(1000, Math.floor(Number(balance || 0) / 2) * 10);

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
  symbol.className = 'mm-symbol';
  symbol.dataset.symbol = code;
  if (cellIndex !== undefined) symbol.dataset.cell = String(cellIndex);
  symbol.setAttribute('role', 'img');
  symbol.setAttribute('aria-label', artwork.name);
  if (artwork.file) {
    const image = document.createElement('img');
    image.src = ART + artwork.file;
    image.alt = '';
    image.draggable = false;
    symbol.appendChild(image);
  } else {
    symbol.classList.add('mm-symbol--atlas');
    symbol.style.backgroundImage = `url("${ATLAS}")`;
    symbol.style.backgroundSize = '400% 200%';
    symbol.style.backgroundPosition = `${artwork.atlas[0] * 100 / 3}% ${artwork.atlas[1] * 100}%`;
  }
  return symbol;
}

const reels = Array.from({ length: 5 }, (_, column) => {
  const reel = document.createElement('div');
  reel.className = 'mm-reel';
  reel.setAttribute('aria-label', 'Reel ' + (column + 1));
  const strip = document.createElement('div');
  strip.className = 'mm-strip';
  reel.appendChild(strip);
  ui.reels.appendChild(reel);
  return { reel, strip };
});

function fillStrip(strip, codes, size, column) {
  strip.replaceChildren(...codes.map((code, row) => {
    const symbol = makeSymbol(code, column === undefined ? undefined : row * 5 + column);
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
        const lead = [...visible, ...Array.from({ length: 5 }, randomCode)];
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
  else if (kind === 'bonus') [220, 330, 440, 659, 880, 1047].forEach((note, index) => tone(note, 0.42, 0.041, index * 0.13, 'sine'));
}

function sync() {
  ui.wallet.textContent = user && balance !== null ? money(balance) : '—';
  ui['bet-line'].textContent = money(lineBet());
  ui['total-bet'].textContent = money(totalBet());
  ui['free-spins'].textContent = `${bonusProgress.used} / ${bonusProgress.total}`;
  const locked = spinning || !!bonus || !accountReady;
  ui['line-minus'].disabled = locked || betCents <= 10;
  ui['total-minus'].disabled = locked || betCents <= 10;
  ui['line-plus'].disabled = locked || betCents >= 1000;
  ui['total-plus'].disabled = locked || betCents >= 1000;
  ui.max.disabled = locked || affordableMax() < 10;
  ui.spin.disabled = spinning || !accountReady || (!bonus && Number(balance) < totalBet());
  ui.spin.textContent = bonus ? 'FREE SPIN' : 'SPIN';
  ui.spin.setAttribute('aria-label', bonus ? `Play free spin, ${bonus.spins_remaining} remaining` : `Spin for ${money(totalBet())} test credits`);
  ui.auto.disabled = !autoRemaining && (spinning || ui.spin.disabled);
  ui.auto.classList.toggle('is-active', autoRemaining > 0);
  ui.auto.setAttribute('aria-pressed', String(autoRemaining > 0));
  ui.auto.textContent = autoRemaining ? 'STOP' : 'AUTO';
  ui.auto.setAttribute('aria-label', autoRemaining ? 'Stop automatic spins' : 'Play five automatic spins');
  ui.sound.classList.toggle('is-muted', muted);
  ui.sound.textContent = muted ? '🔇' : '🔊';
  ui.sound.setAttribute('aria-pressed', String(!muted));
  ui.sound.setAttribute('aria-label', muted ? 'Turn game sound on' : 'Mute game sound');
  document.body.classList.toggle('mm-bonus-mode', !!bonus);
}

function stopAuto() {
  autoRemaining = 0;
  clearTimeout(autoTimer);
  sync();
}

function queueAuto() {
  if (!autoRemaining) return;
  autoRemaining--;
  if (!autoRemaining || document.hidden || ui.dialog.open || ui.spin.disabled) { stopAuto(); return; }
  sync();
  autoTimer = setTimeout(() => { if (autoRemaining && !document.hidden && !spinning) spin(); }, 1000);
}

class SlotError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}

async function invokeSlot(body, expectedUser = user?.id) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || data.session.user.id !== expectedUser) {
    throw new SlotError('Sign in to play Midnight Monsters.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(functionUrl('themedSlots'), {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', apikey: GAMEDAY_CONFIG.supabasePublishableKey,
        Authorization: 'Bearer ' + data.session.access_token,
      },
      body: JSON.stringify(body),
    });
    let result;
    try { result = await response.json(); } catch { throw new SlotError('The server response could not be read.', true); }
    if (!response.ok || result.error) throw new SlotError(result.error || 'The slot service is unavailable.');
    return result;
  } catch (error) {
    if (error instanceof SlotError) throw error;
    throw new SlotError(error.name === 'AbortError' ? 'The connection timed out.' : 'The connection was interrupted.', true);
  } finally { clearTimeout(timeout); }
}

function normalizeBonus(value) {
  if (!value || Number(value.spins_remaining) <= 0) return null;
  const remaining = Number(value.spins_remaining);
  const total = Number(value.total_spins || value.bonus_total_spins || remaining);
  const cents = Math.round(Number(value.bet_per_line) * 100);
  const payout = Number(value.total_payout || 0);
  if (typeof value.id !== 'string' || !Number.isInteger(remaining) || !Number.isInteger(total) || total < remaining ||
      !Number.isInteger(cents) || cents < 10 || cents > 1000 || !Number.isFinite(payout) || payout < 0) {
    throw new SlotError('Your free-spin session could not be loaded.');
  }
  return { id: value.id, spins_remaining: remaining, total_spins: total, bet_per_line: cents / 100, total_payout: payout };
}

async function loadAccount({ quiet = false } = {}) {
  if (spinning) { pendingAccountRefresh = true; return false; }
  const load = ++accountLoad;
  const epoch = accountEpoch;
  accountReady = false;
  sync();
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new SlotError('Your GameDay account could not be loaded.');
    if (load !== accountLoad || epoch !== accountEpoch) return false;
    user = data.session?.user || null;
    if (!user) {
      balance = null;
      bonus = null;
      bonusProgress = { used: 0, total: 10 };
      setStatus('Sign in to use your GameDay test wallet.', '', true);
      sync();
      return false;
    }
    const currentUser = user.id;
    const [wallet, status] = await Promise.all([
      supabase.from('wallets').select('balance').eq('user_id', currentUser).single(),
      invokeSlot({ game: GAME, action: 'status' }, currentUser),
    ]);
    if (load !== accountLoad || epoch !== accountEpoch || user?.id !== currentUser) return false;
    if (wallet.error || !Number.isFinite(Number(wallet.data?.balance))) throw new SlotError('Your GameDay test wallet could not be loaded.');
    const restoredBonus = normalizeBonus(status.bonus);
    balance = Number(wallet.data.balance);
    bonus = restoredBonus;
    if (bonus) {
      betCents = Math.round(bonus.bet_per_line * 100);
      bonusProgress = { used: bonus.total_spins - bonus.spins_remaining, total: bonus.total_spins };
    }
    accountReady = true;
    if (!quiet) {
      if (bonus) setStatus(`${bonus.spins_remaining} free spins ready. Your wager is locked for this bonus.`);
      else if (balance < totalBet()) setStatus('Lower your bet or refill your test wallet in Account.', '', true);
      else setStatus('The monsters are waiting. Press SPIN.');
    }
    sync();
    return true;
  } catch (error) {
    if (load !== accountLoad || epoch !== accountEpoch) return false;
    accountReady = false;
    setStatus(error.message + ' Reload this page to reconnect.', 'error', true);
    sync();
    return false;
  }
}

function validateSpin(result) {
  if (!result || !Array.isArray(result.grid) || result.grid.length !== 5 || result.grid.some(column =>
    !Array.isArray(column) || column.length !== 3 || column.some(code => !CODES.includes(code)))) {
    throw new SlotError('The server returned an invalid reel result.', true);
  }
  if (!Number.isFinite(result.balance) || result.balance < 0 || !Number.isFinite(result.payout) || result.payout < 0) {
    throw new SlotError('The server returned an invalid wallet result.', true);
  }
}

async function spin() {
  if (spinning || !accountReady || !user || ui.dialog.open) return;
  const free = !!bonus;
  if (!free && Number(balance) < totalBet()) { stopAuto(); setStatus('Lower your bet or refill your test wallet in Account.', 'error', true); return; }
  const epoch = accountEpoch;
  const currentUser = user.id;
  const requestBonus = bonus ? { ...bonus } : null;
  spinning = true; // Set before any await so fast repeated taps cannot place duplicate spins.
  ui.win.textContent = money(0);
  if (!free) bonusProgress = { used: 0, total: 10 };
  setStatus(free ? 'The crypt free spin is spinning…' : 'The monsters are spinning…');
  sync();
  const animation = startReels();
  activeAnimation = animation;
  unlockAudio().then(context => { if (context && spinning && epoch === accountEpoch) startSpinSound(); });
  let finished = false;
  try {
    const result = await invokeSlot(free ? { game: GAME, action: 'bonus_spin', session_id: requestBonus.id } :
      { game: GAME, action: 'spin', bet_per_line: lineBet() }, currentUser);
    const settled = result.spin;
    validateSpin(settled);
    if (epoch !== accountEpoch || user?.id !== currentUser) return;
    await animation.settle(settled.grid);
    if (epoch !== accountEpoch || user?.id !== currentUser) return;
    grid = settled.grid.map(column => [...column]);
    balance = Number(settled.balance);
    ui.win.textContent = money(settled.payout);
    renderGrid(settled.win_cells || [], settled.feature_cells || []);
    if (settled.bonus_triggered && settled.bonus_session_id) {
      const remaining = Number(settled.bonus_spins_remaining);
      bonus = normalizeBonus({ id: settled.bonus_session_id, spins_remaining: remaining,
        total_spins: settled.bonus_total_spins || remaining, bet_per_line: settled.bet_per_line || lineBet(), total_payout: 0 });
      bonusProgress = { used: bonus.total_spins - bonus.spins_remaining, total: bonus.total_spins };
      stopAuto();
      showBonus('Free spins awarded', `${bonus.total_spins} FREE SPINS`, 'Unleash the monsters. Your free spins use the wager that triggered this bonus.');
      playSound('bonus');
    } else if (settled.free_spin && requestBonus) {
      const remaining = Number(settled.bonus_spins_remaining);
      const total = Number(settled.bonus_total_spins || requestBonus.total_spins);
      bonusProgress = { used: total - Math.max(0, remaining), total };
      if (settled.bonus_complete || remaining <= 0) {
        bonus = null;
        stopAuto();
        showBonus('Free spins complete', money(settled.bonus_total_payout), 'Your bonus wins are credited to your GameDay test wallet.');
        playSound('bonus');
      } else {
        bonus = { ...requestBonus, spins_remaining: remaining, total_spins: total, total_payout: Number(settled.bonus_total_payout || 0) };
      }
    }
    const payout = Number(settled.payout);
    const feature = settled.feature_name ? String(settled.feature_name).replaceAll('_', ' ') : '';
    if (settled.bonus_triggered) setStatus(`${bonusProgress.total} free spins awarded • ${money(payout)} win`, 'win');
    else if (settled.bonus_complete) setStatus(`Free spins complete • ${money(settled.bonus_total_payout)} total`, 'win');
    else if (feature) setStatus(`${feature} • ${money(payout)}${Number(settled.feature_multiplier) > 1 ? ' • ' + settled.feature_multiplier + '×' : ''}`, payout > 0 ? 'win' : '');
    else setStatus(payout > 0 ? `You won ${money(payout)}` : 'No win. The night continues.', payout > 0 ? 'win' : '');
    if (!settled.bonus_triggered && !settled.bonus_complete) {
      if (payout > 0) playSound('win');
      else if (feature) playSound('bonus');
    }
    finished = true;
  } catch (error) {
    if (epoch !== accountEpoch || activeAnimation !== animation) return;
    stopAuto();
    animation.cancel(true);
    if (epoch === accountEpoch && user?.id === currentUser) {
      // A dropped response may follow a committed spin. Status is read-only:
      // never repeat a paid or free-spin request automatically after an error.
      spinning = false;
      const reconnected = await loadAccount({ quiet: true });
      if (epoch !== accountEpoch || activeAnimation !== animation) return;
      const message = error.uncertain ? `${error.message} Your last spin may have completed. ${reconnected ? 'Wallet and free spins refreshed; check Account before spinning again.' : 'Reconnect before spinning again.'}` : error.message;
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
      if (finished && epoch === accountEpoch) queueAuto();
    }
  }
}

function openDialog(title, content) {
  stopAuto();
  ui['dialog-title'].textContent = title;
  ui['dialog-content'].replaceChildren(content);
  if (!ui.dialog.open) ui.dialog.showModal();
}

function paragraph(text) {
  const element = document.createElement('p');
  element.textContent = text;
  return element;
}

function showBonus(title, amount, description) {
  const content = document.createElement('div');
  content.className = 'mm-bonus-announcement';
  const value = document.createElement('strong');
  value.className = 'mm-bonus-value';
  value.textContent = amount;
  content.append(value, paragraph(description));
  const continueButton = document.createElement('button');
  continueButton.className = 'mm-dialog-action';
  continueButton.textContent = 'CONTINUE';
  continueButton.addEventListener('click', () => ui.dialog.close());
  content.appendChild(continueButton);
  openDialog(title, content);
}

function showFeatures() {
  const content = document.createElement('div');
  content.append(paragraph('15 symbols. 5 reels. 20 fixed paylines. All play uses test credits.'));
  const gallery = document.createElement('div');
  gallery.className = 'mm-symbol-gallery';
  for (const code of CODES) {
    const item = document.createElement('figure');
    const label = document.createElement('figcaption');
    label.textContent = SYMBOLS[code].name;
    item.append(makeSymbol(code), label);
    gallery.appendChild(item);
  }
  content.append(gallery, paragraph('WILD substitutes for every line symbol except SCATTER. Three or more SCATTER symbols anywhere on a paid spin award 10 free spins.'));
  const paytable = document.createElement('table');
  paytable.className = 'mm-paytable';
  const header = document.createElement('tr');
  for (const text of ['Symbol', '3', '4', '5']) {
    const cell = document.createElement('th');
    cell.textContent = text;
    header.appendChild(cell);
  }
  const thead = document.createElement('thead');
  thead.appendChild(header);
  const tbody = document.createElement('tbody');
  for (const symbol of Object.values(SYMBOLS)) {
    if (!symbol.pays) continue;
    const row = document.createElement('tr');
    for (const text of [symbol.name, ...symbol.pays.map(value => value + '×')]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  const caption = document.createElement('caption');
  caption.textContent = 'Line payouts: matching symbols × bet per line';
  paytable.append(caption, thead, tbody);
  content.append(paytable, paragraph('Three or more Scatter symbols pay their count × 10 × bet per line. Monster feature multipliers apply to the resulting win.'));
  for (const [title, description] of [
    ['Blood Moon', 'Multiplies a paid feature win by 2. During free spins, the Blood Moon multiplier is 3.'],
    ['Werewolf Claw', 'Turns an entire reel Wild.'],
    ['Zombie Infection', 'Adds Wild symbols to the reels without replacing Scatter symbols.'],
    ['Crypt Free Spins', 'Every free spin has a monster feature and at least a 2× multiplier. Existing bonus sessions keep the number of spins originally awarded.'],
  ]) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    content.append(heading, paragraph(description));
  }
  openDialog('Midnight Monsters features', content);
}

function showInfo() {
  const content = document.createElement('div');
  content.append(paragraph('Choose your bet per line or total bet, then press SPIN. All 20 paylines are active. Three or more matching symbols pay consecutively from the leftmost reel.'));
  content.append(paragraph('Bet per line: $0.10–$10.00 in $0.10 steps. Total bet is bet per line × 20. AUTO runs up to five spins and stops on a new bonus, insufficient balance, an error, or when you leave the game. MAX BET chooses the highest wager your test wallet can cover.'));
  const title = document.createElement('h3');
  title.textContent = '20 paylines';
  content.appendChild(title);
  const gallery = document.createElement('div');
  gallery.className = 'mm-payline-gallery';
  const svgNS = 'http://www.w3.org/2000/svg';
  PAYLINES.forEach((line, index) => {
    const item = document.createElement('figure');
    const diagram = document.createElementNS(svgNS, 'svg');
    diagram.setAttribute('viewBox', '0 0 100 60');
    diagram.setAttribute('role', 'img');
    diagram.setAttribute('aria-label', 'Payline ' + (index + 1));
    for (let row = 0; row < 3; row++) for (let column = 0; column < 5; column++) {
      const cell = document.createElementNS(svgNS, 'rect');
      cell.setAttribute('x', String(column * 20 + 2)); cell.setAttribute('y', String(row * 20 + 2));
      cell.setAttribute('width', '16'); cell.setAttribute('height', '16');
      cell.setAttribute('fill', line[column] === row ? '#e1bd63' : '#15321d');
      cell.setAttribute('stroke', '#917444'); diagram.appendChild(cell);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = String(index + 1);
    item.append(diagram, caption);
    gallery.appendChild(item);
  });
  content.append(gallery, paragraph('Scatter pays independently of paylines. Every result and test-wallet change is settled by the authenticated GameDay service. Test mode only; no real money.'));
  openDialog('How to play', content);
}

function adjustBet(direction) {
  if (spinning || bonus || !accountReady) return;
  unlockAudio().then(() => playSound('tap'));
  betCents = Math.min(1000, Math.max(10, betCents + direction * 10));
  sync();
  if (Number(balance) < totalBet()) setStatus('Lower your bet or refill your test wallet in Account.', '', true);
  else setStatus('The monsters are waiting. Press SPIN.');
}

ui.spin.addEventListener('click', spin);
ui['line-minus'].addEventListener('click', () => adjustBet(-1));
ui['total-minus'].addEventListener('click', () => adjustBet(-1));
ui['line-plus'].addEventListener('click', () => adjustBet(1));
ui['total-plus'].addEventListener('click', () => adjustBet(1));
ui.max.addEventListener('click', () => {
  if (spinning || bonus || !accountReady || affordableMax() < 10) return;
  unlockAudio().then(() => playSound('tap'));
  betCents = affordableMax();
  sync();
  setStatus('Maximum affordable wager selected.');
});
ui.auto.addEventListener('click', () => {
  if (autoRemaining) { stopAuto(); return; }
  if (spinning || ui.spin.disabled || ui.dialog.open) return;
  autoRemaining = 5;
  sync();
  spin();
});
ui.sound.addEventListener('click', async () => {
  muted = !muted;
  try { localStorage.setItem('gameday-mm-muted', muted ? '1' : '0'); } catch { /* Sound remains usable without storage. */ }
  if (muted) { stopSpinSound(); try { await audio?.suspend(); } catch { /* Audio is optional. */ } }
  else { await unlockAudio(); if (spinning) startSpinSound(); else playSound('tap'); }
  sync();
});
ui.features.addEventListener('click', showFeatures);
ui.info.addEventListener('click', showInfo);
ui.menu.addEventListener('click', () => {
  const content = document.createElement('div');
  content.className = 'mm-menu-links';
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
  stopAuto(); stopSpinSound();
  try { audio?.close(); } catch { /* The browser can already have closed it. */ }
});
window.addEventListener('resize', () => { if (!spinning) renderGrid(); });

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
    bonus = null;
    bonusProgress = { used: 0, total: 10 };
    betCents = 10;
    grid = INITIAL_GRID.map(column => [...column]);
    ui.win.textContent = money(0);
    renderGrid();
    if (ui['dialog-content'].querySelector('.mm-bonus-announcement')) ui.dialog.close();
    accountReady = false;
    stopAuto();
    setStatus(nextUser ? 'Connecting to your GameDay test wallet…' : 'Sign in to use your GameDay test wallet.', '', !nextUser);
    sync();
  }
  // Keep Supabase calls outside its synchronous auth notification callback.
  if (event !== 'TOKEN_REFRESHED') setTimeout(() => loadAccount(), 0);
});
renderGrid();
sync();
loadAccount();
