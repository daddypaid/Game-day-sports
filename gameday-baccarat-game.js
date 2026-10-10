import { GAMEDAY_CONFIG } from './gameday-config.js';

// Cards, results and test-wallet returns come from the authenticated Baccarat service.
const stage = document.querySelector('.game-stage');
const account = document.getElementById('baccarat-account');
const balanceLabel = document.getElementById('balance');
const signin = document.getElementById('baccarat-signin');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const sides = ['player', 'banker', 'tie'];
let client, view, wager, resultBox, retry;
let owner = null, wallet = null, selected = null, latest = null, pending = null;
let busy = false, hidden = false, ready = false, generation = 0, sdkAttempt = 0, authSubscription;
const requests = new Set();
const markerKey = id => `gameday:baccarat-pending:${id}`;
const validAmount = value => Number.isInteger(value) && value >= 1 && value <= 10000;
const validReturnedStake = value => Number.isFinite(value) && value > 0 && value <= 10000 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const current = token => !hidden && token === generation;
const amount = () => Number(wager?.getAmount?.() ?? stage.dataset.wagerAmount ?? 0);

function setStatus(text) { if (view?.status) view.status.textContent = text; }
function controls() {
  if (!view) return;
  const disabled = busy || !ready || !owner || pending !== null;
  sides.forEach(side => {
    const button = view.actions.get(side);
    if (!button) return;
    button.disabled = disabled;
    button.setAttribute('aria-pressed', String(selected === side));
  });
  const deal = view.actions.get('deal');
  deal.disabled = disabled || !selected || !validAmount(amount()) || wallet === null || amount() > wallet;
  deal.textContent = busy ? 'Checking…' : pending ? 'Checking Result' : latest ? 'New Deal' : 'Deal';
  wager?.setLocked?.(disabled);
  if (retry) retry.disabled = busy;
  stage.dataset.baccaratPhase = pending ? 'unconfirmed' : busy ? 'busy' : latest ? 'complete' : 'ready';
}
function prompt() {
  if (busy || pending || !ready || !owner) return;
  if (!validAmount(amount())) setStatus('Choose a wager from $1 to $10,000.');
  else if (amount() > wallet) setStatus('Your wager exceeds your test wallet. Use the down arrow to reduce it.');
  else if (!selected) setStatus('Choose Player, Banker or Tie, then Deal.');
  else setStatus(`${selected[0].toUpperCase() + selected.slice(1)} selected · ${money.format(amount())} wager. Ready to deal.`);
}
function showWallet(value) {
  wallet = value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  balanceLabel.textContent = wallet === null ? 'TEST WALLET —' : `TEST ${money.format(wallet)}`;
}
function loadMarker(id) {
  try {
    const value = JSON.parse(sessionStorage.getItem(markerKey(id)));
    return value && value.owner === id && validAmount(value.stake) && sides.includes(value.side) && (value.baseline === null || typeof value.baseline === 'string') ? value : null;
  } catch (_) { return null; }
}
function saveMarker(marker) {
  sessionStorage.setItem(markerKey(marker.owner), JSON.stringify(marker));
  pending = marker;
}
function clearMarker(id) {
  try { sessionStorage.removeItem(markerKey(id)); } catch (_) {}
  pending = null;
}
function validateRound(round) {
  if (!round || typeof round.id !== 'string' || !sides.includes(round.bet_type) || !sides.includes(round.result) || !validReturnedStake(Number(round.stake)) || !Number.isFinite(Number(round.payout))) throw new Error('The service returned an incomplete result.');
  for (const name of ['player', 'banker']) {
    const cards = round[`${name}_cards`];
    if (!Array.isArray(cards) || cards.length < 2 || cards.length > 3 || cards.some(c => !['A','2','3','4','5','6','7','8','9','10','J','Q','K'].includes(c.rank) || !['♠','♥','♦','♣'].includes(c.suit)) || !Number.isInteger(Number(round[`${name}_total`])) || Number(round[`${name}_total`]) < 0 || Number(round[`${name}_total`]) > 9) throw new Error('The service returned an incomplete hand.');
  }
  return round;
}
function resultText(round) {
  const stake = Number(round.stake), payout = Number(round.payout), net = Math.round((payout - stake) * 100) / 100;
  const pushed = round.result === 'tie' && round.bet_type !== 'tie' && payout === stake;
  const outcome = pushed ? 'Push — your wager returned' : net > 0 ? 'You won' : net === 0 ? 'Push — your wager returned' : 'You lost';
  const winner = round.result === 'tie' ? 'Tie' : `${round.result[0].toUpperCase() + round.result.slice(1)} wins`;
  resultBox.replaceChildren();
  const heading = document.createElement('strong'); heading.textContent = `${winner} · ${outcome}`;
  const totals = document.createElement('p'); totals.textContent = `Player ${round.player_total} · Banker ${round.banker_total}`;
  const wagerLine = document.createElement('p'); wagerLine.textContent = `${round.bet_type[0].toUpperCase() + round.bet_type.slice(1)} wager ${money.format(stake)} · Total return ${money.format(payout)}`;
  const profit = document.createElement('p'); profit.textContent = `Net ${net > 0 ? '+' : net < 0 ? '−' : ''}${money.format(Math.abs(net))}`;
  resultBox.append(heading, totals, wagerLine, profit);
  resultBox.hidden = false;
  return `${heading.textContent}. ${totals.textContent}. Total return ${money.format(payout)}.`;
}
async function renderRound(round, token, animate) {
  validateRound(round);
  latest = round;
  const rendered = await view.render({ groups: { player: round.player_cards, banker: round.banker_cards }, phase: 'complete' }, { animate });
  if (!current(token) || !rendered) return false;
  wager.startNextWager(`${owner}:${round.id}`);
  const summary = resultText(round);
  view.announcement.textContent = summary;
  setStatus('Round complete. Choose your wager and side for the next deal.');
  return true;
}
async function request(body) {
  const controller = new AbortController(); requests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await client.functions.invoke(GAMEDAY_CONFIG.functions.baccarat, { body, signal: controller.signal });
    if (response.error || response.data?.error) {
      let text = response.data?.error || response.error?.message || 'Unable to contact Baccarat.';
      const status = response.error?.context?.status;
      try { const payload = await response.error?.context?.clone?.().json(); if (payload?.error) text = payload.error; } catch (_) {}
      const error = new Error(text); error.definite = status === 400 || status === 401 || status === 403; error.auth = status === 401 || status === 403; throw error;
    }
    return response.data;
  } finally { clearTimeout(timeout); requests.delete(controller); }
}
function showRetry(text, checking = false) {
  retry.hidden = false; retry.textContent = checking ? 'Check result' : 'Retry connection';
  setStatus(text); controls();
}
async function reconcile(token, animate = false) {
  const data = await request({ action: 'latest' });
  if (!current(token)) return false;
  if (!data || !Number.isFinite(Number(data.balance))) throw new Error('Your test wallet could not be confirmed.');
  showWallet(data.balance);
  const round = data.round ? validateRound(data.round) : null;
  if (pending) {
    if (!round || round.id === pending.baseline || Number(round.stake) !== pending.stake || round.bet_type !== pending.side) {
      showRetry('Your last deal is not confirmed yet. Check the result before starting another round; your wager will not be sent again.', true);
      return false;
    }
    clearMarker(owner);
  }
  retry.hidden = true;
  if (round) await renderRound(round, token, animate);
  else { latest = null; view.clear(); resultBox.hidden = true; view.announcement.textContent = ''; }
  return true;
}
async function connect() {
  if (!view || hidden || busy) return;
  const token = ++generation;
  busy = true; ready = false; controls();
  signin.hidden = true; account.textContent = 'Connecting…';
  setStatus('Checking your GameDay account and latest Baccarat round…');
  try {
    if (!client) {
      const { createClient } = await import(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm?gameday-baccarat-sdk=${sdkAttempt++}`);
      if (!current(token)) return;
      client = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
      authSubscription = client.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' || (session?.user?.id === owner && !['SIGNED_OUT','USER_UPDATED'].includes(event))) return;
        generation++; requests.forEach(r => r.abort()); view.cancel(); ready = false; busy = false;
        owner = null; pending = null; latest = null; selected = null; showWallet(null); resultBox.hidden = true; view.clear(); controls();
        setTimeout(connect, 0);
      });
    }
    const sessionResponse = await client.auth.getSession();
    if (!current(token)) return;
    if (sessionResponse.error) throw sessionResponse.error;
    const id = sessionResponse.data?.session?.user?.id;
    if (!id) {
      owner = null; wallet = null; selected = null; latest = null; pending = null; view.clear(); resultBox.hidden = true;
      account.textContent = 'Not signed in'; balanceLabel.textContent = 'TEST WALLET —'; signin.hidden = false;
      retry.hidden = true; setStatus('Sign in to play Baccarat with your GameDay test wallet.'); return;
    }
    if (owner !== id) { view.clear(); resultBox.hidden = true; latest = null; selected = null; }
    owner = id; pending = loadMarker(id); account.textContent = 'Signed in · Test credits';
    if (amount() === 0) wager?.setAmount?.(1);
    await reconcile(token);
    if (current(token)) ready = true;
  } catch (error) {
    if (current(token)) { account.textContent = owner ? 'Signed in · Connection unavailable' : 'Connection unavailable'; signin.hidden = Boolean(owner); showRetry(pending ? 'Your last deal could not be confirmed. Check the result before playing again.' : `${error.message || 'Connection unavailable'} Retry to reconnect.`, Boolean(pending)); }
  } finally {
    if (current(token)) { busy = false; controls(); if (!pending && ready && !latest) prompt(); }
  }
}
async function deal() {
  if (busy || !ready || !owner || pending || !selected || !validAmount(amount()) || amount() > wallet) return;
  const token = generation, id = owner, stake = amount(), side = selected;
  busy = true; controls(); resultBox.hidden = true; view.announcement.textContent = '';
  setStatus('Checking your wager…');
  let invoked = false;
  try {
    const state = await request({ action: 'latest' });
    if (!current(token)) return;
    if (!state || !Number.isFinite(Number(state.balance))) throw new Error('Your test wallet could not be confirmed.');
    showWallet(state.balance);
    if (stake > wallet) throw new Error('Insufficient test balance. Choose a smaller wager.');
    const baseline = state.round ? validateRound(state.round).id : null;
    saveMarker({ owner: id, baseline, stake, side });
    view.unlockAudio(); setStatus('Dealing…');
    const dealButton = view.actions.get('deal'); dealButton.textContent = 'Dealing…';
    invoked = true;
    const data = await request({ stake, bet_type: side });
    if (!current(token)) return;
    const round = validateRound(data?.round);
    if (round.bet_type !== side || Number(round.stake) !== stake || !Number.isFinite(Number(round.balance))) throw new Error('The service returned a different wager.');
    clearMarker(id); showWallet(round.balance); retry.hidden = true;
    await renderRound(round, token, true);
  } catch (error) {
    if (!current(token)) return;
    if (!invoked || error.definite) {
      clearMarker(id); setStatus(error.message || 'Your deal was not accepted. Choose your wager and try again.');
      if (latest) resultText(latest);
      if (error.auth) { ready = false; account.textContent = 'Sign in required'; signin.hidden = false; showRetry('Sign in again or retry your connection before dealing.'); }
    } else {
      try { await reconcile(token, true); }
      catch (_) { if (current(token)) showRetry('Your deal may have completed. Check the result before starting another round; your wager will not be sent again.', true); }
    }
  } finally { if (current(token)) { busy = false; controls(); } }
}
function boot() {
  if (view || !stage.gamedayCardView) return;
  view = stage.gamedayCardView; wager = stage.gamedayWager;
  const panel = stage.querySelector('.gd-table-wager-panel');
  resultBox = document.createElement('section'); resultBox.className = 'gd-baccarat-result'; resultBox.hidden = true;
  resultBox.setAttribute('aria-label', 'Baccarat round result');
  retry = document.createElement('button'); retry.type = 'button'; retry.className = 'gd-baccarat-retry'; retry.hidden = true;
  panel.insertBefore(resultBox, view.status || view.announcement); panel.appendChild(retry);
  sides.forEach(side => view.actions.get(side)?.addEventListener('click', () => {
    if (busy || !ready || !owner || pending) return;
    selected = side; controls(); prompt();
  }));
  view.actions.get('deal').addEventListener('click', deal);
  retry.addEventListener('click', connect);
  stage.addEventListener('gameday:wager-change', () => { controls(); prompt(); });
  controls(); connect();
}
stage.addEventListener('gameday:card-view-ready', boot); boot();
window.addEventListener('pagehide', () => { hidden = true; generation++; requests.forEach(r => r.abort()); view?.cancel(); ready = false; busy = false; });
window.addEventListener('pageshow', event => { hidden = false; if (event.persisted) connect(); });
