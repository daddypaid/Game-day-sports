import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

// The service owns cards, computer decisions, legal actions and test-wallet settlement.
const games = { 'gameday-texas-holdem.html':'holdem', 'gameday-omaha.html':'omaha', 'gameday-seven-card-stud.html':'stud', 'gameday-five-card-draw.html':'draw' };
const game = games[location.pathname.split('/').pop()];
const stage = document.querySelector('.stage');
const account = document.getElementById('poker-account');
const balanceLabel = document.getElementById('poker-balance');
const signin = document.getElementById('poker-signin');
const money = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' });
const names = { 'bring-in':'Bring In', complete:'Complete', 'all-in':'All In', pot:'Pot', fold:'Fold', check:'Check', call:'Call', bet:'Bet', raise:'Raise', draw:'Draw', discard:'Discard', deal:'Deal' };
const streets = { preflop:'Opening round', flop:'Flop', turn:'Turn', river:'River', third:'Third street', fourth:'Fourth street', fifth:'Fifth street', sixth:'Sixth street', seventh:'Seventh street', opening:'Opening round', draw:'Draw', final:'Final round' };
let client, view, wager, info, resultBox, retry;
let owner = null, hand = null, balance = null, pending = null;
let busy = false, ready = false, unavailable = false, hidden = false, generation = 0, sdkAttempt = 0;
let selected = new Set();
const requests = new Set();
const storageKey = id => `gameday:poker-pending:${game}:${id}`;
const current = (token, id = owner) => !hidden && token === generation && owner === id;
const active = () => hand?.status === 'active';
const draft = () => Number(wager?.getAmount() || 0);
const legal = name => active() && hand.legal_actions.includes(name);
const validMoney = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const validStake = value => validMoney(value) && Number.isInteger(value) && value >= 1 && value <= 10000;
const validCards = (cards, masked = false) => Array.isArray(cards) && cards.every(card => card && ((masked && card.rank === '?' && card.suit === '') || ['A','2','3','4','5','6','7','8','9','10','J','Q','K'].includes(card.rank) && ['♠','♥','♦','♣'].includes(card.suit)));
function message(text) { if (view?.status) view.status.textContent = text; }
function showBalance(value) {
  balance = validMoney(value) ? value : null;
  balanceLabel.textContent = balance === null ? 'Test balance —' : `Test balance ${money.format(balance)}`;
  if (balance !== null && owner) window.dispatchEvent(new CustomEvent('gameday:wallet-updated', { detail:{balance,userId:owner} }));
}
function validateHand(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.game !== game || !['active','settled'].includes(value.status) || typeof value.street !== 'string' || !Number.isSafeInteger(value.action_count) || value.action_count < 0 || !Array.isArray(value.legal_actions) || value.legal_actions.some(name => !Object.hasOwn(names,name)) || !validCards(value.player_cards) || !validCards(value.opponent_cards,true) || !validCards(value.board)) throw new Error('The poker service returned an incomplete hand.');
  for (const field of ['pot','stake','committed','payout','to_call','min_bet','min_raise','max_bet','max_raise','balance']) if (!validMoney(value[field])) throw new Error('The poker service returned incomplete wager details.');
  const count = game === 'holdem' ? 2 : game === 'omaha' ? 4 : game === 'draw' ? 5 : null;
  if ((count && (value.player_cards.length !== count || value.opponent_cards.length !== count)) || (game === 'stud' && (value.player_cards.length < 3 || value.player_cards.length > 7 || value.player_cards.length !== value.opponent_cards.length)) || (['holdem','omaha'].includes(game) ? ![0,3,4,5].includes(value.board.length) : value.board.length !== 0)) throw new Error('The poker service returned invalid cards.');
  const visible = [...value.player_cards,...value.opponent_cards,...value.board].filter(card => card.rank !== '?');
  if (new Set(visible.map(card => card.rank + card.suit)).size !== visible.length) throw new Error('The poker service returned duplicate cards.');
  return value;
}
function loadPending(id) {
  try {
    const marker = JSON.parse(localStorage.getItem(storageKey(id)));
    return marker && marker.owner === id && marker.body?.game === game && typeof marker.body.request_id === 'string' && (marker.body.action === 'deal' || (typeof marker.body.hand_id === 'string' && Number.isSafeInteger(marker.body.action_count))) ? marker : null;
  } catch (_) { return null; }
}
function savePending(body) {
  const marker = { owner, body, baseline:hand?.id || null };
  try { localStorage.setItem(storageKey(owner),JSON.stringify(marker)); }
  catch (_) { throw new Error('Your browser could not save round recovery. Enable browser storage and retry.'); }
  pending = marker;
}
function clearPending() {
  if (owner) try { localStorage.removeItem(storageKey(owner)); } catch (_) {}
  pending = null;
}
function amountAllowed(name) {
  const amount = draft();
  return legal(name) && validMoney(amount) && amount > 0 && amount <= balance && amount >= hand[`min_${name}`] && amount <= hand[`max_${name}`];
}
function controls() {
  if (!view) return;
  const blocked = busy || !ready || unavailable || !owner || Boolean(pending);
  wager.setLocked(blocked);
  stage.dataset.dealBusy = String(busy);
  stage.dataset.pokerPhase = pending ? 'unconfirmed' : busy ? 'busy' : active() ? hand.street : hand ? 'settled' : 'ready';
  stage.setAttribute('aria-busy',String(busy));
  for (const [name,button] of view.actions) {
    button.textContent = names[name] || name;
    button.disabled = true;
    button.removeAttribute('aria-pressed');
    button.title = active() ? 'Unavailable at this stage of the hand.' : 'Deal a hand to use this action.';
    if (name === 'deal') {
      button.textContent = hand ? 'New Deal' : 'Deal';
      button.disabled = blocked || active() || !validStake(draft()) || balance === null || draft() > balance;
      button.title = active() ? 'Finish or fold this hand before starting another.' : 'Starts a hand against the computer with matching antes.';
    } else if (legal(name)) {
      button.disabled = blocked || (['bet','raise'].includes(name) && !amountAllowed(name));
      if (name === 'call') button.textContent = `Call ${money.format(hand.to_call)}`;
      if (['bet','raise'].includes(name)) {
        button.textContent = `${names[name]} ${money.format(draft())}`;
        button.title = `${names[name]} must add ${money.format(hand[`min_${name}`])} to ${money.format(hand[`max_${name}`])}.`;
      } else button.title = `${names[name]} is available.`;
      if (name === 'draw') button.textContent = selected.size ? `Draw ${selected.size}` : 'Keep All / Draw';
      if (name === 'discard') button.setAttribute('aria-pressed',String(selected.size === 5));
    }
    if (blocked) button.title = pending ? 'Check your last action before continuing.' : !owner ? 'Sign in to play with test credits.' : 'Wait for the current action to finish.';
  }
  retry.disabled = busy;
  retry.textContent = pending ? 'Check / Retry Last Action' : 'Retry Connection';
  retry.hidden = !pending && !unavailable;
  const label = document.getElementById('gd-table-wager-label');
  if (label) label.textContent = active() ? 'NEXT BET / RAISE' : 'TOTAL BET';
}
function prompt() {
  if (busy || pending || !ready || unavailable || !owner) return;
  if (!active()) {
    if (balance < 1) message('Your test balance is below $1. Refill test credits in Account to deal again.');
    else if (!validStake(draft())) message('Choose chips for an ante from $1 to $10,000, then Deal.');
    else if (draft() > balance) message('Your ante exceeds your test balance. Use the down arrow or choose a smaller chip.');
    else message(`Ready to deal. You and the computer each ante ${money.format(draft())}.`);
    return;
  }
  if (legal('draw')) { message('Select cards to discard, or keep all five, then Draw. A final betting round follows.'); return; }
  if (legal('bring-in')) { message(`Third street · Post the required Bring In, Complete the opening bet to ${money.format(hand.stake)}, or Fold.`); return; }
  const chosen = ['bet','raise'].find(legal);
  const range = chosen && !amountAllowed(chosen) ? ` ${names[chosen]} adds ${money.format(hand[`min_${chosen}`])}–${money.format(hand[`max_${chosen}`])}; change your chips to choose an amount.` : chosen ? ' Chips set the amount added by Bet or Raise.' : '';
  message(`${streets[hand.street] || 'Betting round'} · ${hand.to_call > 0 ? `${money.format(hand.to_call)} to call.` : legal('check') ? 'No bet to call; Check is available.' : 'Choose an available action below.'}${range}`);
}
function renderInfo() {
  info.replaceChildren();
  if (!hand) { const rule = document.createElement('p'); rule.textContent = 'Heads-up poker against the computer · Test credits only'; info.appendChild(rule); return; }
  const line = document.createElement('p'); line.textContent = active() ? `${streets[hand.street] || 'Hand'} · Pot ${money.format(hand.pot)} · To call ${money.format(hand.to_call)}` : `Hand complete · Pot ${money.format(hand.pot)}`;
  const committed = document.createElement('p'); committed.textContent = `Your committed wager ${money.format(hand.committed)}`;
  info.append(line,committed);
}
function renderResult() {
  resultBox.replaceChildren();
  resultBox.hidden = !hand || active();
  if (resultBox.hidden) return;
  const title = document.createElement('strong'); title.textContent = hand.result || 'Hand complete';
  const ranks = document.createElement('p');
  const label = value => typeof value === 'string' ? value : value?.label;
  const descriptions = [label(hand.player_rank) ? `You: ${label(hand.player_rank)}` : '',label(hand.opponent_rank) ? `Computer: ${label(hand.opponent_rank)}` : ''].filter(Boolean);
  ranks.textContent = descriptions.join(' · ');
  const returned = document.createElement('p'); returned.textContent = `Committed ${money.format(hand.committed)} · Returned ${money.format(hand.payout)} · Net ${money.format(hand.payout - hand.committed)}`;
  resultBox.append(title); if (descriptions.length) resultBox.append(ranks); resultBox.append(returned);
}
async function applyHand(next, token, id, animate = false) {
  if (!current(token,id)) return false;
  const prior = hand;
  hand = next ? validateHand(next) : null;
  if (!hand || hand.id !== prior?.id || hand.street !== 'draw') selected.clear();
  renderInfo(); renderResult();
  if (!hand) { view.clear(); view.announcement.textContent = ''; return true; }
  const rendered = await view.render({ groups:{player:hand.player_cards,opponent:hand.opponent_cards,board:hand.board}, phase:active() ? hand.street : 'complete', selectable:legal('draw'), selectedIndices:[...selected] }, {animate});
  if (!rendered || !current(token,id)) return false;
  if (!active()) {
    wager.startNextWager(`${id}:${hand.id}`,hand.stake);
    view.announcement.textContent = `${hand.result || 'Hand complete'}. Returned ${money.format(hand.payout)}. Choose a wager for New Deal.`;
  } else view.announcement.textContent = `${streets[hand.street] || 'Hand'} ready. ${hand.to_call > 0 ? `${money.format(hand.to_call)} to call.` : 'Choose your action.'}`;
  return true;
}
async function request(body, token, id) {
  const auth = await client.auth.getSession();
  if (!current(token,id)) throw new Error('The page or account changed.');
  if (auth.error || auth.data?.session?.user?.id !== id || !auth.data.session.access_token) {
    const error = new Error('Sign in again to continue this hand.'); error.auth = true; error.definite = true; throw error;
  }
  const controller = new AbortController(); requests.add(controller);
  const timeout = setTimeout(() => controller.abort(),20000);
  try {
    const response = await fetch(functionUrl('poker'), {method:'POST',headers:{'Content-Type':'application/json',apikey:GAMEDAY_CONFIG.supabasePublishableKey,Authorization:`Bearer ${auth.data.session.access_token}`},body:JSON.stringify(body),signal:controller.signal});
    let data; try { data = await response.json(); } catch (_) { throw new Error('The hand response could not be read.'); }
    if (!response.ok || data?.ok !== true) {
      const error = new Error(data?.error || 'The poker request did not finish.');
      error.auth = response.status === 401 || response.status === 403;
      error.changed = response.status === 409;
      error.definite = [400,401,403,409].includes(response.status);
      throw error;
    }
    if (!validMoney(data.balance)) throw new Error('Your test balance could not be confirmed.');
    if (data.hand !== null && data.hand !== undefined) validateHand(data.hand);
    else if (body.action !== 'latest') throw new Error('The poker service returned no hand.');
    return data;
  } finally { clearTimeout(timeout); requests.delete(controller); }
}
function recovered(next) {
  if (!pending) return true;
  if (!next) return false;
  const body = pending.body;
  if (body.action === 'deal') return next.started_request_id === body.request_id || next.last_request_id === body.request_id || (next.id !== pending.baseline && next.status === 'active');
  return next.id === body.hand_id && (next.last_request_id === body.request_id || next.action_count > body.action_count);
}
async function reconcile(token, id, animate = false) {
  const data = await request({action:'latest',game},token,id);
  if (!current(token,id)) return false;
  let next = data.hand || null;
  if (pending?.body.action !== 'deal' && pending?.body.hand_id && next?.id !== pending.body.hand_id) {
    const state = await request({action:'state',game,hand_id:pending.body.hand_id},token,id);
    if (!current(token,id)) return false;
    if (recovered(state.hand)) clearPending();
  }
  if (pending && recovered(next)) clearPending();
  showBalance(data.balance);
  await applyHand(next,token,id,animate);
  if (!current(token,id)) return false;
  if (pending) message('Your last action is not confirmed. Use Check / Retry Last Action before continuing; the same request will be checked safely.');
  return !pending;
}
function resetPrivate() {
  generation++; requests.forEach(controller => controller.abort()); view?.cancel();
  owner = null; hand = null; balance = null; pending = null; selected.clear(); ready = false; busy = false;
  view?.clear(); if (view) view.announcement.textContent = '';
  if (resultBox) resultBox.hidden = true;
  if (info) renderInfo();
  showBalance(null);
}
async function connect() {
  if (!view || hidden || busy) return;
  const token = ++generation;
  busy = true; ready = false; unavailable = false; controls();
  account.textContent = 'Connecting…'; signin.hidden = true; message('Checking your GameDay account and latest hand…');
  try {
    if (!client) {
      const sdk = await import(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm?gameday-poker-sdk=${sdkAttempt++}`).catch(() => {
        throw new Error('GameDay could not connect. Check your connection, then retry.');
      });
      if (hidden || token !== generation) return;
      client = sdk.createClient(GAMEDAY_CONFIG.supabaseUrl,GAMEDAY_CONFIG.supabasePublishableKey);
      client.auth.onAuthStateChange((event,session) => {
        if (event === 'INITIAL_SESSION' || (session?.user?.id === owner && event !== 'SIGNED_OUT')) return;
        resetPrivate(); unavailable = false; controls();
        setTimeout(connect,0);
      });
    }
    const auth = await client.auth.getSession();
    if (hidden || token !== generation) return;
    if (auth.error) throw auth.error;
    const id = auth.data?.session?.user?.id;
    if (!id) {
      owner = null; hand = null; pending = null; selected.clear(); view.clear(); resultBox.hidden = true; renderInfo(); showBalance(null);
      account.textContent = 'Sign in to play'; signin.hidden = false; message('Sign in to play poker against the computer with GameDay test credits.'); return;
    }
    if (owner !== id) { view.clear(); hand = null; selected.clear(); resultBox.hidden = true; }
    owner = id; pending = loadPending(id); account.textContent = 'Computer opponent · Test credits';
    if (draft() === 0) wager.setAmount(1);
    await reconcile(token,id);
    if (current(token,id)) ready = true;
  } catch (error) {
    if (!hidden && token === generation) {
      unavailable = true;
      if (error.auth) { view.clear(); hand = null; selected.clear(); resultBox.hidden = true; renderInfo(); ready = false; signin.hidden = false; }
      account.textContent = error.auth ? 'Sign in required' : 'Connection unavailable';
      message(pending ? 'Your last action could not be confirmed. Retry the connection before continuing.' : `${error.message || 'Connection unavailable'} Use Retry Connection.`);
    }
  } finally {
    if (!hidden && token === generation) { busy = false; controls(); if (!pending && ready) prompt(); }
  }
}
async function sendAction(name) {
  if (busy || !ready || unavailable || !owner || pending || view.actions.get(name)?.disabled) return;
  if (name === 'discard') {
    selected = selected.size === 5 ? new Set() : new Set([0,1,2,3,4]); view.setSelection([...selected]); controls(); prompt(); return;
  }
  const token = generation, id = owner;
  const body = name === 'deal' ? {action:'deal',game,stake:draft(),request_id:crypto.randomUUID()} : {action:name,game,hand_id:hand.id,action_count:hand.action_count,request_id:crypto.randomUUID()};
  if (['bet','raise'].includes(name)) body.amount = draft();
  if (name === 'draw') body.discards = [...selected].sort((a,b) => a-b);
  try { savePending(body); } catch (error) { message(error.message); return; }
  let preserveMessage = false;
  busy = true; controls(); view.unlockAudio(); message(name === 'deal' ? 'Dealing…' : 'Playing your action and the computer response…');
  try {
    const data = await request(body,token,id);
    if (!current(token,id)) return;
    if (name !== 'deal' && data.hand.id !== body.hand_id) throw new Error('The poker service returned a different hand.');
    if (data.hand.last_request_id && data.hand.last_request_id !== body.request_id) throw new Error('The action receipt could not be confirmed.');
    clearPending(); showBalance(data.balance); await applyHand(data.hand,token,id,true);
  } catch (error) {
    if (!current(token,id)) return;
    if (error.definite) {
      clearPending();
      if (error.auth) { view.clear(); hand = null; selected.clear(); resultBox.hidden = true; ready = false; unavailable = true; signin.hidden = false; account.textContent = 'Sign in required'; renderInfo(); showBalance(null); message('Sign in again, then Retry Connection to recover your hand.'); }
      else if (error.changed) { try { await reconcile(token,id,true); } catch (_) { unavailable = true; message('The table changed. Retry Connection to load your latest hand.'); } }
      else { preserveMessage = true; message(error.message); }
    } else {
      try { await reconcile(token,id,true); }
      catch (_) { if (current(token,id)) { unavailable = true; message('Your last action may have completed. Use Check / Retry Last Action before continuing.'); } }
    }
  } finally { if (current(token,id)) { busy = false; controls(); if (!pending && !unavailable && !preserveMessage) prompt(); } }
}
async function retryLast() {
  if (busy || hidden) return;
  if (!owner || !pending) { connect(); return; }
  const token = generation, id = owner;
  busy = true; controls(); message('Checking your last action…');
  try {
    await reconcile(token,id,true);
    if (!current(token,id)) return;
    if (pending) {
      const data = await request(pending.body,token,id);
      if (!current(token,id)) return;
      clearPending();
      // Reload current state after an idempotent receipt; another tab may have continued.
      await reconcile(token,id,true);
    }
    if (current(token,id)) { ready = true; unavailable = false; }
  } catch (error) {
    if (current(token,id)) {
      if (error.definite && !error.auth) {
        clearPending();
        try { await reconcile(token,id,true); ready = true; unavailable = false; } catch (_) { unavailable = true; }
      } else unavailable = true;
      if (error.auth) { view.clear(); hand = null; selected.clear(); resultBox.hidden = true; renderInfo(); ready = false; signin.hidden = false; account.textContent = 'Sign in required'; showBalance(null); }
      message(error.auth ? 'Sign in again, then retry to recover your hand.' : pending ? 'Your last action is still unconfirmed. Check it again before continuing.' : 'The connection could not finish. Retry Connection.');
    }
  } finally { if (current(token,id)) { busy = false; controls(); if (!pending && ready && !unavailable) prompt(); } }
}
function boot() {
  if (!game || view || !stage?.gamedayCardView || !stage.gamedayWager) return;
  view = stage.gamedayCardView; wager = stage.gamedayWager;
  const panel = stage.querySelector('.gd-table-wager-panel');
  info = document.createElement('div'); info.className = 'gd-poker-info'; renderInfo();
  resultBox = document.createElement('section'); resultBox.className = 'gd-poker-result'; resultBox.hidden = true; resultBox.setAttribute('aria-label','Poker hand result'); resultBox.setAttribute('aria-live','polite');
  retry = document.createElement('button'); retry.type = 'button'; retry.className = 'gd-poker-retry'; retry.hidden = true;
  panel.querySelector('.gd-table-action-groups').after(info); panel.append(resultBox,retry);
  view.actions.forEach((button,name) => button.addEventListener('click',() => sendAction(name)));
  view.setOnCardSelect(index => { if (busy || pending || unavailable || !legal('draw')) return; selected.has(index) ? selected.delete(index) : selected.add(index); view.setSelection([...selected]); controls(); });
  retry.addEventListener('click',retryLast);
  stage.addEventListener('gameday:wager-change',() => { controls(); prompt(); });
  controls(); connect();
}
stage?.addEventListener('gameday:card-view-ready',boot); boot();
window.addEventListener('pagehide',() => { hidden = true; generation++; requests.forEach(controller => controller.abort()); view?.cancel(); ready = false; busy = false; });
window.addEventListener('pageshow',event => { hidden = false; if (event.persisted) connect(); });
