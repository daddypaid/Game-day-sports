import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

// Cards, outcomes, and test-wallet settlement come only from the authenticated game service.
const stage = document.querySelector('.game-stage');
const balanceView = document.getElementById('gd-jacks-balance');
const signIn = document.getElementById('gd-jacks-signin');
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
let supabase, sdkPromise, view, wager, actions, status, resultView, recovery;
let sdkAttempts = 0;
let userId = null, hand = null, balance = null, holds = new Set(), pending = null;
let ready = false, busy = false, hidden = false, generation = 0, controller = null;
let needsRefresh = false, initPromise = null;
let authNeeded = false;

function storageKey() { return `gameday:jacks-pending:${userId}`; }
function savePending() {
  try {
    if (pending) sessionStorage.setItem(storageKey(), JSON.stringify(pending));
    else sessionStorage.removeItem(storageKey());
  } catch (_) { /* Recovery also works through the server when storage is unavailable. */ }
}
function loadPending() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey()));
    return value && ['deal', 'draw'].includes(value.action) && Number.isFinite(value.started_at) ? value : null;
  } catch (_) { return null; }
}
function say(message) { if (status) status.textContent = message; }
function activeHand() { return hand?.status === 'active'; }
function updateControls() {
  if (!actions) return;
  const usable = ready && !busy && !hidden && !pending;
  const active = activeHand();
  const amount = wager?.getAmount() ?? Number(stage.dataset.wagerAmount);
  const validStake = Number.isInteger(amount) && amount >= 1 && amount <= 1000 && amount <= balance;
  actions.forEach(button => { button.disabled = true; });
  actions.get('deal').textContent = hand?.status === 'settled' ? 'New Deal' : 'Deal';
  actions.get('deal').disabled = !usable || active || !validStake;
  actions.get('draw').disabled = !usable || !active;
  for (let index = 0; index < 5; index++) {
    const button = actions.get(`hold-${index + 1}`);
    button.disabled = !usable || !active;
    button.setAttribute('aria-pressed', String(active && holds.has(index)));
  }
  wager?.setLocked((!ready && !pending?.retryAllowed) || busy || hidden || active || (Boolean(pending) && !pending.retryAllowed));
  stage.dataset.dealBusy = String(busy);
  stage.setAttribute('aria-busy', String(busy));
  signIn.hidden = Boolean(userId) && !authNeeded;
  balanceView.value = Number.isFinite(balance) ? money(balance) : '—';
  if (recovery) {
    recovery.hidden = !needsRefresh && !pending;
    recovery.disabled = busy || hidden || (pending?.retryAllowed && !validStake);
    recovery.textContent = pending?.retryAllowed ? 'Retry Deal' : pending ? 'Check hand' : 'Retry connection';
  }
}
function validCards(cards) {
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return Array.isArray(cards) && cards.length === 5 && cards.every(card => card && ranks.includes(card.rank) && ['♠', '♥', '♦', '♣'].includes(card.suit)) && new Set(cards.map(card => card.rank + card.suit)).size === 5;
}
function validatedHand(value) {
  if (!value) return null;
  if (typeof value.id !== 'string' || value.game !== 'jacks_or_better' || !['active', 'settled'].includes(value.status) || !Number.isFinite(Number(value.stake)) || Number(value.stake) <= 0 || !validCards(value.initial_hand)) throw new Error('GameDay returned an incomplete hand. Check your hand before playing again.');
  if (value.status === 'settled' && (!validCards(value.final_hand) || typeof value.result !== 'string' || !Number.isFinite(Number(value.payout)) || Number(value.payout) < 0)) throw new Error('GameDay returned an incomplete result. Check your hand before playing again.');
  return value;
}
async function renderHand(value, animate = false, token = generation) {
  const next = validatedHand(value);
  if (token !== generation || hidden) return;
  const sameHand = hand?.id === next?.id;
  hand = next;
  if (!sameHand || !activeHand()) holds.clear();
  resultView.hidden = hand?.status !== 'settled';
  if (!hand) {
    view.clear();
    say('Choose a chip, then Deal. Test credits only.');
  } else {
    wager.setAmount(Number(hand.stake));
    if (!sameHand && animate) view.clear();
    if (activeHand()) {
      say('Select any cards to hold, then Draw to finish your hand.');
    } else {
      const payout = Number(hand.payout), net = Math.round((payout - Number(hand.stake)) * 100) / 100;
      resultView.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = hand.result;
      const detail = document.createElement('span');
      detail.textContent = `Returned ${money(payout)} · Net ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`;
      resultView.append(title, detail);
      say(Number.isInteger(Number(hand.stake)) ? 'Hand complete. Choose your next wager, then New Deal.' : 'Hand complete. Choose a whole-dollar chip for your next Deal.');
    }
    await view.render({ groups: { player: activeHand() ? hand.initial_hand : hand.final_hand }, phase: activeHand() ? 'active' : 'complete', selectedIndices: [...holds], selectable: activeHand() && !pending }, { animate });
  }
  if (token === generation && !hidden) updateControls();
}
function cancelWork() {
  generation++;
  controller?.abort();
  controller = null;
  view?.cancel();
  busy = false;
  ready = false;
}
async function loadSdk() {
  if (supabase) return supabase;
  // Browsers cache failed module loads. A manual retry uses a fresh URL for the same pinned SDK.
  const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
  if (!sdkPromise) sdkPromise = import(sdkUrl + (sdkAttempts++ ? `?retry=${sdkAttempts}` : '')).then(({ createClient }) => {
    supabase = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || hidden) return;
      const nextId = session?.user?.id || null;
      if (nextId === userId) return;
      cancelWork();
      initPromise = null;
      hand = null; holds.clear(); pending = null; balance = null;
      userId = nextId;
      authNeeded = !nextId;
      view?.clear();
      if (resultView) resultView.hidden = true;
      say(nextId ? 'Connecting to your GameDay test game…' : 'Sign in to play Jacks or Better with test credits.');
      updateControls();
      if (nextId) setTimeout(() => initialize(), 0);
    });
    return supabase;
  }).catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}
async function request(body, token) {
  const { data, error } = await supabase.auth.getSession();
  if (token !== generation || hidden) throw new DOMException('Cancelled', 'AbortError');
  if (error || !data?.session?.access_token || data.session.user?.id !== userId) {
    authNeeded = true;
    throw new Error('Your session expired. Sign in again to continue your hand.');
  }
  const abort = new AbortController();
  controller = abort;
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(functionUrl('jacksOrBetter'), {
      method: 'POST', signal: abort.signal,
      headers: { 'Content-Type': 'application/json', apikey: GAMEDAY_CONFIG.supabasePublishableKey, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body)
    });
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('The hand response was interrupted. Check your hand before playing again.'); }
    if (!response.ok || !result?.ok) {
      const failure = new Error(result?.error || `GameDay is unavailable (${response.status}).`);
      failure.definitive = true;
      if (response.status === 401) authNeeded = true;
      throw failure;
    }
    if (token !== generation || hidden) throw new DOMException('Cancelled', 'AbortError');
    return result;
  } finally {
    clearTimeout(timeout);
    if (controller === abort) controller = null;
  }
}
async function readBalance(result, token) {
  let next = Number(result?.balance);
  if (result?.balance === undefined || !Number.isFinite(next) || next < 0) {
    const { data, error } = await supabase.from('wallets').select('balance').eq('user_id', userId).single();
    if (error || !data || !Number.isFinite(Number(data.balance))) throw new Error('Unable to refresh your test balance. Retry connection before playing.');
    next = Number(data.balance);
  }
  if (token === generation && !hidden) balance = next;
}
async function recover(token, animate = false) {
  const marker = pending;
  const response = marker?.hand_id ? await request({ action: 'state', hand_id: marker.hand_id }, token) : await request({ action: 'resume', include_latest: true }, token);
  await readBalance(response, token);
  if (token !== generation || hidden) throw new DOMException('Cancelled', 'AbortError');
  let recovered = response.hand || null;
  if (!recovered && !marker && response.latest_hand?.status === 'settled') recovered = response.latest_hand;
  if (!recovered && marker?.action === 'deal') {
    const latest = response.latest_hand;
    if (latest && latest.id !== marker.previous_id && Date.parse(latest.created_at) >= marker.started_at - 5000) recovered = latest;
  }
  if (marker?.action === 'deal' && !recovered) {
    // The server's atomic deal checks for an active hand under the wallet lock.
    // An explicit retry can create at most one active hand; no automatic debit retry occurs.
    pending.retryAllowed = true; savePending();
    say('No active hand was found. Retry Deal to start it, or check again after reconnecting.');
    return false;
  }
  if (marker?.action === 'draw' && recovered?.status === 'active') {
    hand = validatedHand(recovered);
    holds = new Set((marker.holds || []).filter(index => Number.isInteger(index) && index >= 0 && index < 5));
    pending = null; savePending();
    await renderHand(recovered, false, token);
    say('Your hand is still active. Your held cards are restored; press Draw to finish.');
    return true;
  }
  // Clear an uncertain request only after recovering its authoritative hand.
  if (marker && !recovered) throw new Error('Unable to find your hand. Check hand again before playing.');
  pending = null; savePending();
  await renderHand(recovered, animate, token);
  return true;
}
async function initialize() {
  if (initPromise || hidden) return initPromise;
  const attempt = (async () => {
    const token = ++generation;
    busy = true; ready = false; needsRefresh = false;
    updateControls();
    say('Connecting to your GameDay test game…');
    try {
      await loadSdk();
      const { data, error } = await supabase.auth.getSession();
      if (token !== generation || hidden) return;
      if (error) throw new Error('Unable to load your GameDay session. Retry connection.');
      userId = data?.session?.user?.id || null;
      authNeeded = !userId;
      if (!userId) {
        hand = null; balance = null; pending = null; holds.clear(); view.clear();
        resultView.hidden = true;
        say('Sign in to play Jacks or Better with test credits.');
        return;
      }
      pending = loadPending();
      const recovered = await recover(token);
      if (token === generation && !hidden) ready = recovered;
    } catch (error) {
      if (token !== generation || hidden) return;
      needsRefresh = true;
      say(error.name === 'AbortError' ? 'Connection timed out. Retry connection to recover your hand.' : error.message || 'Unable to connect. Retry connection to recover your hand.');
    } finally {
      if (token === generation && !hidden) { busy = false; updateControls(); }
    }
  })();
  initPromise = attempt.finally(() => { if (initPromise === tracked) initPromise = null; });
  const tracked = initPromise;
  return initPromise;
}
async function play(action, explicitRetry = false) {
  if ((!ready && !explicitRetry) || busy || (pending && !explicitRetry) || hidden || !userId) return;
  const active = activeHand(), stake = wager.getAmount();
  if (action === 'deal' && (active || !Number.isInteger(stake) || stake < 1 || stake > 1000 || stake > balance)) return;
  if (action === 'draw' && !active) return;
  view.unlockAudio();
  const token = ++generation;
  busy = true; needsRefresh = false;
  pending = { action, stake, started_at: Date.now(), previous_id: hand?.id || null, ...(action === 'draw' ? { hand_id: hand.id, holds: [...holds] } : {}) };
  savePending(); updateControls();
  say(action === 'draw' ? 'Drawing and settling your hand…' : 'Dealing your hand…');
  try {
    const response = await request(action === 'deal' ? { action, stake } : { action, hand_id: hand.id, holds: [...holds] }, token);
    validatedHand(response.hand);
    await readBalance(response, token);
    if (token !== generation || hidden) return;
    pending = null; savePending();
    await renderHand(response.hand, true, token);
    ready = true;
  } catch (error) {
    if (token !== generation || hidden) return;
    // A lost response can still represent a completed debit or settlement. Read state; never replay a bet automatically.
    try {
      const recovered = await recover(token, false);
      if (error.definitive && !recovered) {
        pending = null; savePending(); ready = true;
        say(error.message);
      } else if (recovered) ready = true;
    } catch (_) {
      ready = false; needsRefresh = true;
      say('Connection interrupted. Check hand to recover your cards and test balance before playing again.');
    }
  } finally {
    if (token === generation && !hidden) { busy = false; updateControls(); }
  }
}
function toggleHold(index) {
  if (!ready || busy || pending || hidden || !activeHand() || index < 0 || index >= 5) return;
  if (holds.has(index)) holds.delete(index); else holds.add(index);
  view.setSelection([...holds]);
  say(`${holds.size} ${holds.size === 1 ? 'card' : 'cards'} held. Draw finishes your hand, including when all five are held.`);
  updateControls();
}
function attach() {
  if (view || !stage.gamedayCardView || !stage.gamedayWager) return;
  view = stage.gamedayCardView; wager = stage.gamedayWager;
  actions = view.actions; status = view.status;
  const panel = stage.querySelector('.gd-table-wager-panel');
  resultView = document.createElement('div');
  resultView.className = 'gd-jacks-result'; resultView.hidden = true;
  resultView.setAttribute('role', 'status');
  recovery = document.createElement('button');
  recovery.type = 'button'; recovery.className = 'gd-jacks-recovery'; recovery.hidden = true;
  recovery.textContent = 'Retry connection';
  if (status?.parentElement === panel) panel.insertBefore(resultView, status);
  else panel.appendChild(resultView);
  panel.appendChild(recovery);
  recovery.addEventListener('click', () => pending?.retryAllowed ? play('deal', true) : initialize());
  view.setOnCardSelect(toggleHold);
  actions.forEach((button, action) => button.addEventListener('click', () => {
    if (action.startsWith('hold-')) toggleHold(Number(action.slice(5)) - 1);
    else if (action === 'deal' || action === 'draw') play(action);
  }));
  stage.addEventListener('gameday:wager-change', () => {
    if (!busy && (!pending || pending.retryAllowed) && !activeHand() && (ready || pending?.retryAllowed)) {
      const amount = wager.getAmount();
      say(amount <= 0 ? 'Choose a chip, then Deal.' : !Number.isInteger(amount) ? 'Choose a whole-dollar chip for your next Deal.' : amount > 1000 ? 'The maximum wager is $1,000. Decrease your wager to deal.' : amount > balance ? 'Your wager exceeds your test balance. Choose a smaller chip or decrease the wager.' : 'Press Deal to start your next hand.');
    }
    updateControls();
  });
  initialize();
}
stage.addEventListener('gameday:card-view-ready', attach);
stage.addEventListener('gameday:wager-ready', attach);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
else attach();
window.addEventListener('pagehide', () => { hidden = true; cancelWork(); updateControls(); });
window.addEventListener('pageshow', event => { if (hidden || event.persisted) { hidden = false; initPromise = null; initialize(); } });
