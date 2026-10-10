import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';
import { createRouletteSpinner } from './gameday-roulette-spinner.js';

// The authenticated Roulette service owns every result, payout and wallet change.
const stage = document.querySelector('.game-stage');
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const TYPES = ['number', 'red', 'black', 'odd', 'even', 'low', 'high', 'column1', 'column2', 'column3'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const currency = value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(Math.round(value * 100) / 100 - value) < 1e-9;
const validStake = value => currency(value) && value >= 1 && value <= 10000;
let client, sdkPromise, sdkAttempts = 0, wheel, wager, ui;
let owner = null, balance = null, selection = null, latest = null, pending = null;
let busy = false, ready = false, hidden = false, generation = 0, connectAttempt = null;
let audio, noise, soundEnabled = true, soundTimer = null, soundEnding = false;
const requests = new Set(), sounds = new Set();
const current = token => !hidden && token === generation;
const pendingKey = id => `gameday:roulette-pending:${id}`;
const selectionKey = id => `gameday:roulette-selection:${id}`;
const amount = () => Number(wager?.getAmount() ?? 0);
const color = number => number === 0 ? 'green' : RED.has(number) ? 'red' : 'black';

function normalizedBet(type, value) {
  if (!TYPES.includes(type)) return null;
  if (type !== 'number') return { type, value: null };
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isInteger(number) && number >= 0 && number <= 36 ? { type, value: String(number) } : null;
}
function label(bet) {
  if (!bet) return 'No bet selected';
  const button = ui.bets.find(button => button.dataset.rouletteBet === bet.type && (bet.type !== 'number' || button.dataset.rouletteValue === bet.value));
  return button?.dataset.rouletteLabel || (bet.type === 'number' ? `Number ${bet.value}` : { low: '1–18', high: '19–36', column1: 'First column', column2: 'Second column', column3: 'Third column' }[bet.type] || bet.type[0].toUpperCase() + bet.type.slice(1));
}
function setStatus(message) { ui.status.textContent = message; }
function setWheelCaption(message = 'European Roulette · Single zero') {
  if (ui?.caption) ui.caption.textContent = message;
}
function saveSelection() {
  if (!owner) return;
  try {
    if (selection) sessionStorage.setItem(selectionKey(owner), JSON.stringify(selection));
    else sessionStorage.removeItem(selectionKey(owner));
  } catch (_) {}
}
function readSelection(id) {
  try {
    const value = JSON.parse(sessionStorage.getItem(selectionKey(id)));
    return normalizedBet(value?.type, value?.value);
  } catch (_) { return null; }
}
function readPending(id) {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey(id)));
    if (!value || value.owner !== id || !UUID.test(value.request_id) || !validStake(value.stake) || !normalizedBet(value.bet_type, value.bet_value)) return null;
    return value;
  } catch (_) { return null; }
}
function savePending(marker) {
  // Persist before sending the stake so a reload can recover the same request.
  try { sessionStorage.setItem(pendingKey(marker.owner), JSON.stringify(marker)); }
  catch (_) { throw new Error('Your browser could not save this spin. Enable site storage before playing.'); }
  pending = marker;
}
function clearPending(id) {
  try { sessionStorage.removeItem(pendingKey(id)); } catch (_) {}
  pending = null;
}
function showBalance(value) {
  if (value === null || value === undefined || !currency(Number(value))) throw new Error('Your test balance could not be confirmed.');
  balance = Number(value);
  ui.balance.textContent = `Balance ${money(balance)}`;
}
function renderSelection() {
  const total = amount();
  ui.bets.forEach(button => {
    const bet = normalizedBet(button.dataset.rouletteBet, button.dataset.rouletteValue);
    const selected = Boolean(bet && selection && bet.type === selection.type && bet.value === selection.value);
    button.setAttribute('aria-pressed', String(selected));
    if (selected && total > 0) button.dataset.rouletteWager = money(total);
    else delete button.dataset.rouletteWager;
    button.setAttribute('aria-label', `${button.dataset.rouletteLabel || label(bet)}${selected ? `, selected, wager ${money(total)}` : ''}`);
  });
  if (ui.selected) ui.selected.textContent = selection ? `${label(selection)} · ${money(total)}` : '';
}
function controls() {
  if (!ui) return;
  const locked = busy || !ready || !owner || Boolean(pending) || hidden;
  ui.bets.forEach(button => { button.disabled = locked; });
  wager.setLocked(locked);
  ui.actions.forEach(button => { button.disabled = locked; });
  ui.actions.get('spin').disabled = locked || !selection || !validStake(amount()) || balance === null || amount() > balance;
  ui.actions.get('spin').textContent = busy ? 'Spinning…' : pending ? 'Checking Spin' : 'Spin';
  ui.actions.get('clear').disabled = locked || (!selection && amount() === 0);
  ui.actions.get('repeat-bet').disabled = locked || !latest;
  ui.retry.disabled = busy || hidden;
  stage.dataset.roulettePhase = hidden ? 'paused' : busy ? 'spinning' : pending ? 'unconfirmed' : !owner ? 'signed-out' : !ready ? 'unavailable' : latest ? 'complete' : 'ready';
  stage.setAttribute('aria-busy', String(busy));
  renderSelection();
}
function prompt() {
  if (!ready || busy || pending || !owner) return;
  if (!validStake(amount())) setStatus('Choose a bet on the table, add chips, then Spin. Wagers are $1 to $10,000.');
  else if (amount() > balance) setStatus('Your wager exceeds your test balance. Use the down arrow to reduce it.');
  else if (!selection) setStatus('Choose a bet on the table, then Spin.');
  else setStatus(`${label(selection)} selected · ${money(amount())}. Press Spin to play.`);
}
function validateSpin(value) {
  const bet = normalizedBet(value?.bet_type, value?.bet_value);
  if (!value || typeof value.id !== 'string' || !bet || value.stake === null || value.stake === undefined || !currency(Number(value.stake)) || Number(value.stake) <= 0 || Number(value.stake) > 10000 || !Number.isInteger(value.winning_number) || value.winning_number < 0 || value.winning_number > 36 || value.winning_color !== color(value.winning_number) || value.payout === null || value.payout === undefined || !currency(Number(value.payout)) || !['won', 'lost'].includes(value.result)) throw new Error('The service returned an incomplete Roulette result. Check your spin before playing again.');
  return value;
}
function matchesMarker(spin, marker) {
  return spin.request_id === marker.request_id && spin.bet_type === marker.bet_type && (spin.bet_type !== 'number' || String(spin.bet_value) === marker.bet_value) && Number(spin.stake) === marker.stake;
}
function resultText(spin) {
  ui.result.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = `${spin.winning_number} ${spin.winning_color[0].toUpperCase() + spin.winning_color.slice(1)} · ${spin.result === 'won' ? 'You won' : 'No win'}`;
  const bet = document.createElement('p');
  bet.textContent = `${label(normalizedBet(spin.bet_type, spin.bet_value))} · Wager ${money(Number(spin.stake))}`;
  const detail = document.createElement('p'), net = Math.round((Number(spin.payout) - Number(spin.stake)) * 100) / 100;
  detail.textContent = `Returned ${money(Number(spin.payout))} · Net ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`;
  ui.result.append(heading, bet, detail);
  ui.result.hidden = false;
}
async function renderSpin(spin, token, animate = false) {
  validateSpin(spin);
  if (!current(token)) return false;
  if (animate) {
    soundEnding = true;
    const landed = await wheel.settle(spin.winning_number);
    if (!current(token) || landed === false) return false;
  } else wheel.show(spin.winning_number);
  stopSpinSound();
  if (!current(token)) return false;
  latest = spin;
  wager.startNextWager(`${owner}:${spin.id}`, Number(spin.stake));
  resultText(spin);
  setWheelCaption(`${spin.winning_number} ${spin.winning_color[0].toUpperCase() + spin.winning_color.slice(1)} · Returned ${money(Number(spin.payout))}`);
  if (animate && spin.result === 'won') winSound();
  setStatus('Spin complete. Add chips for your next wager, or Repeat Bet.');
  return true;
}
function stopSpinSound() {
  clearTimeout(soundTimer); soundTimer = null;
  sounds.forEach(source => { try { source.stop(); } catch (_) {} });
  sounds.clear();
}
function unlockAudio() {
  if (!soundEnabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audio ||= new Audio();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    if (!noise) {
      noise = audio.createBuffer(1, Math.max(1, Math.round(audio.sampleRate * .045)), audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
  } catch (_) { audio = null; }
}
function startSpinSound() {
  stopSpinSound(); soundEnding = false;
  const started = performance.now();
  function click() {
    if (!busy || hidden || !soundEnabled || !audio || !noise) return;
    try {
      const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
      source.buffer = noise; filter.type = 'bandpass'; filter.frequency.value = 1300; filter.Q.value = .7;
      gain.gain.value = .07;
      source.connect(filter); filter.connect(gain); gain.connect(audio.destination);
      sounds.add(source);
      source.onended = () => { sounds.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start();
    } catch (_) {}
    const elapsed = performance.now() - started;
    soundTimer = setTimeout(click, soundEnding ? Math.min(230, 80 + elapsed / 30) : 80);
  }
  click();
}
function winSound() {
  if (!soundEnabled || !audio || hidden) return;
  try {
    [523, 659, 784].forEach((frequency, index) => {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + index * .075;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.001, at); gain.gain.exponentialRampToValueAtTime(.04, at + .015); gain.gain.exponentialRampToValueAtTime(.001, at + .18);
      oscillator.connect(gain); gain.connect(audio.destination); sounds.add(oscillator);
      oscillator.onended = () => { sounds.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + .2);
    });
  } catch (_) {}
}
function cancelWork() {
  generation++;
  requests.forEach(controller => controller.abort());
  wheel?.cancel(); stopSpinSound();
  ready = false; busy = false;
}
async function loadSdk() {
  if (client) return client;
  if (!sdkPromise) {
    const url = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
    sdkPromise = import(url + (sdkAttempts++ ? `?roulette-retry=${sdkAttempts}` : '')).then(({ createClient }) => {
      client = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' || hidden || (session?.user?.id || null) === owner) return;
        cancelWork(); connectAttempt = null;
        owner = null; balance = null; selection = null; latest = null; pending = null;
        wheel.reset(); ui.result.hidden = true; ui.balance.textContent = 'Balance —';
        setWheelCaption();
        ui.signin.hidden = Boolean(session?.user);
        setStatus(session?.user ? 'Connecting to Roulette…' : 'Sign in to play Roulette with test credits.');
        controls();
        setTimeout(connect, 0);
      });
      return client;
    }).catch(error => { sdkPromise = null; throw error; });
  }
  return sdkPromise;
}
async function request(body, token) {
  const id = owner;
  const { data, error } = await client.auth.getSession();
  if (!current(token)) throw new DOMException('Cancelled', 'AbortError');
  if (error || !data?.session?.access_token || data.session.user?.id !== id) {
    const failure = new Error('Your session expired. Sign in again to continue your Roulette spin.');
    failure.auth = true; throw failure;
  }
  const controller = new AbortController(); requests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(functionUrl('roulette'), {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: GAMEDAY_CONFIG.supabasePublishableKey, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body)
    });
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('The Roulette response was interrupted. Check your spin before playing again.'); }
    if (!response.ok || !result?.ok) {
      const failure = new Error(result?.error || `Roulette is unavailable (${response.status}).`);
      failure.definite = result?.spin_rejected === true; failure.auth = [401, 403].includes(response.status);
      throw failure;
    }
    if (!current(token)) throw new DOMException('Cancelled', 'AbortError');
    return result;
  } finally { clearTimeout(timeout); requests.delete(controller); }
}
async function reconcile(token, animate = false) {
  const marker = pending;
  const response = await request(marker ? { action: 'state', request_id: marker.request_id } : { action: 'latest' }, token);
  if (!current(token)) return false;
  showBalance(response.balance);
  const spin = response.spin ? validateSpin(response.spin) : null;
  if (marker) {
    if (!spin) {
      pending.retryAllowed = true;
      try { sessionStorage.setItem(pendingKey(owner), JSON.stringify(pending)); } catch (_) {}
      ui.retry.hidden = false; ui.retry.textContent = 'Retry this spin';
      setWheelCaption('Spin not confirmed · Retry this spin');
      setStatus('No result was found for this spin. Retry this spin to send the same wager safely.');
      return false;
    }
    if (!matchesMarker(spin, marker)) throw new Error('The recovered result did not match your pending spin. Check the result again.');
  }
  if (spin) await renderSpin(spin, token, animate);
  else { latest = null; wheel.reset(); ui.result.hidden = true; setWheelCaption(); }
  if (!current(token)) return false;
  if (marker) clearPending(marker.owner);
  ui.retry.hidden = true;
  return true;
}
async function connect() {
  if (!ui || hidden || connectAttempt) return connectAttempt;
  const token = ++generation;
  busy = true; ready = false; ui.retry.hidden = true;
  ui.account.textContent = 'Connecting…'; setStatus('Checking your account and latest Roulette result…'); controls();
  const attempt = (async () => {
    try {
      await loadSdk();
      const { data, error } = await client.auth.getSession();
      if (!current(token)) return;
      if (error) throw new Error('Unable to load your GameDay session. Retry connection.');
      const id = data?.session?.user?.id || null;
      if (!id) {
        owner = null; balance = null; selection = null; latest = null; pending = null;
        wheel.reset(); ui.result.hidden = true; ui.signin.hidden = false;
        setWheelCaption();
        ui.account.textContent = 'Not signed in'; ui.balance.textContent = 'Balance —';
        setStatus('Sign in to play Roulette with test credits.'); return;
      }
      owner = id; ui.signin.hidden = true; ui.account.textContent = 'Signed in · Test credits';
      selection = readSelection(id); pending = readPending(id);
      if (pending) { selection = normalizedBet(pending.bet_type, pending.bet_value); wager.setAmount(pending.stake); setWheelCaption('Checking your spin…'); }
      const recovered = await reconcile(token);
      if (current(token)) ready = recovered;
    } catch (error) {
      if (!current(token)) return;
      ui.retry.hidden = false; ui.retry.textContent = pending ? 'Check result' : 'Retry connection';
      if (error.auth) ui.signin.hidden = false;
      if (pending) setWheelCaption('Result unconfirmed · Check result');
      ui.account.textContent = owner ? 'Signed in · Connection unavailable' : 'Connection unavailable';
      setStatus(pending ? 'Your spin may have completed. Check the result before playing again; your wager will not be sent again automatically.' : error.message || 'Unable to connect. Retry connection.');
    } finally {
      if (current(token)) { busy = false; controls(); if (ready && !latest) prompt(); }
    }
  })();
  const tracked = attempt.finally(() => { if (connectAttempt === tracked) connectAttempt = null; });
  connectAttempt = tracked;
  return tracked;
}
function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function spin(explicitRetry = false) {
  if (busy || hidden || !owner || (!ready && !explicitRetry) || (pending && !explicitRetry)) return;
  if (explicitRetry && !pending?.retryAllowed) return;
  const marker = explicitRetry ? pending : selection && validStake(amount()) && amount() <= balance ? { owner, request_id: requestId(), stake: amount(), bet_type: selection.type, bet_value: selection.value, started_at: Date.now() } : null;
  if (!marker) { prompt(); return; }
  unlockAudio();
  const token = ++generation;
  busy = true; ui.retry.hidden = true; ui.result.hidden = true;
  let sent = false;
  try {
    savePending({ ...marker, retryAllowed: false });
    controls(); setStatus('Spinning…'); setWheelCaption('Spinning…');
    document.getElementById('roulette-wheel').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    wheel.start(); startSpinSound();
    sent = true;
    const response = await request({ action: 'spin', request_id: marker.request_id, stake: marker.stake, bet_type: marker.bet_type, bet_value: marker.bet_value }, token);
    if (!current(token)) return;
    const outcome = validateSpin(response.spin);
    if (!matchesMarker(outcome, marker)) throw new Error('The service returned a different wager. Check your spin before playing again.');
    showBalance(response.balance ?? response.spin.balance);
    if (!await renderSpin(outcome, token, true)) return;
    clearPending(marker.owner); ready = true;
  } catch (error) {
    if (!current(token)) return;
    wheel.cancel(); stopSpinSound();
    if (!sent) {
      setStatus(error.message); ui.retry.hidden = true;
    } else {
      try {
        const found = await reconcile(token);
        if (!current(token)) return;
        if (found) ready = true;
        else if (error.definite) {
          clearPending(marker.owner); ready = true; ui.retry.hidden = true;
          setStatus(error.message); setWheelCaption('Wager not placed · Adjust your wager');
        }
      } catch (_) {
        if (!current(token)) return;
        ready = false; ui.retry.hidden = false; ui.retry.textContent = 'Check result';
        if (error.auth) ui.signin.hidden = false;
        setWheelCaption('Result unconfirmed · Check result');
        setStatus('Connection interrupted. Check the result to recover this spin and your test balance.');
      }
    }
  } finally {
    if (current(token)) { busy = false; clearTimeout(soundTimer); soundTimer = null; controls(); }
  }
}
function choose(button) {
  if (!ready || busy || hidden || pending) return;
  const bet = normalizedBet(button.dataset.rouletteBet, button.dataset.rouletteValue);
  if (!bet) return;
  selection = bet; saveSelection(); controls(); prompt();
}
function clear() {
  if (!ready || busy || pending || hidden) return;
  selection = null; saveSelection(); wager.setAmount(0); controls(); prompt();
}
function repeat() {
  if (!ready || busy || pending || hidden || !latest) return;
  selection = normalizedBet(latest.bet_type, latest.bet_value); saveSelection();
  wager.setAmount(Number(latest.stake), { asDraft: true }); controls(); prompt();
}
function boot() {
  if (ui || !stage || !stage.gamedayWager) return;
  wager = stage.gamedayWager;
  ui = {
    account: document.getElementById('roulette-account'), balance: document.getElementById('balance'),
    signin: document.getElementById('roulette-signin'), status: document.getElementById('roulette-status'),
    result: document.getElementById('roulette-result'), retry: document.getElementById('roulette-retry'),
    sound: document.getElementById('roulette-sound'), selected: document.getElementById('roulette-selected-bet'),
    caption: document.getElementById('roulette-wheel-caption'),
    bets: [...stage.querySelectorAll('[data-roulette-bet]')],
    actions: new Map([...stage.querySelectorAll('[data-table-action]')].map(button => [button.dataset.tableAction, button]))
  };
  const wheelElement = document.getElementById('roulette-wheel');
  if (!wheelElement || !ui.account || !ui.balance || !ui.signin || !ui.status || !ui.result || !ui.retry || !ui.bets.length || !['select-bet', 'spin', 'clear', 'repeat-bet'].every(action => ui.actions.has(action))) return;
  wheel = createRouletteSpinner(wheelElement);
  stage.gamedayRouletteWheel = wheel;
  const generatedStatus = stage.querySelector('.gd-table-actions-status');
  if (generatedStatus) { generatedStatus.textContent = ''; generatedStatus.hidden = true; }
  ui.actions.forEach(button => button.setAttribute('aria-describedby', 'roulette-status'));
  ui.bets.forEach(button => button.addEventListener('click', () => choose(button)));
  ui.actions.get('spin').addEventListener('click', () => spin());
  ui.actions.get('clear').addEventListener('click', clear);
  ui.actions.get('repeat-bet').addEventListener('click', repeat);
  ui.actions.get('select-bet').addEventListener('click', () => {
    const button = ui.bets.find(button => button.getAttribute('aria-pressed') === 'true') || ui.bets[0];
    button.scrollIntoView({ block: 'center', behavior: 'auto' }); button.focus({ preventScroll: true }); prompt();
  });
  ui.retry.addEventListener('click', () => pending?.retryAllowed ? spin(true) : connect());
  stage.addEventListener('gameday:wager-change', () => { controls(); prompt(); });
  if (ui.sound) {
    try { soundEnabled = sessionStorage.getItem('gameday:roulette-sound') !== 'off'; } catch (_) {}
    const renderSound = () => { ui.sound.textContent = soundEnabled ? 'Sound on' : 'Sound off'; ui.sound.setAttribute('aria-pressed', String(soundEnabled)); };
    ui.sound.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      if (soundEnabled) { unlockAudio(); if (busy && pending) startSpinSound(); } else stopSpinSound();
      try { sessionStorage.setItem('gameday:roulette-sound', soundEnabled ? 'on' : 'off'); } catch (_) {}
      renderSound();
    });
    renderSound();
  }
  controls(); connect();
}
stage?.addEventListener('gameday:wager-ready', boot);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
window.addEventListener('pagehide', () => { hidden = true; cancelWork(); try { audio?.suspend().catch(() => {}); } catch (_) {} });
window.addEventListener('pageshow', event => { if (hidden || event.persisted) { hidden = false; connectAttempt = null; connect(); } });
