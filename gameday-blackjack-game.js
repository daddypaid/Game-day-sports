import { GAMEDAY_CONFIG, functionUrl } from './gameday-config.js';

// Cards, legal actions, results and wallet balances come from the authenticated game service.
async function initializeBlackjack() {
  const stage = document.querySelector('.gd-wager-surface');
  const view = stage?.gamedayCardView;
  const wager = stage?.gamedayWager;
  if (!view || !wager || stage.dataset.blackjackInitialized) return false;
  stage.dataset.blackjackInitialized = 'true';
  const { actions, status, announcement } = view;
  const panel = stage.querySelector('.gd-table-wager-panel');
  announcement.classList.add('gd-blackjack-announcement');
  const info = document.createElement('div');
  info.className = 'gd-blackjack-info';
  info.innerHTML = '<p class="gd-blackjack-balance">Test balance: loading…</p><p>Blackjack pays 3:2. Dealer hits soft 17.</p><p class="gd-blackjack-totals"></p>';
  panel.querySelector('.gd-table-action-groups').after(info);
  const result = document.createElement('section');
  result.className = 'gd-blackjack-result';
  result.setAttribute('aria-label', 'Hand result');
  result.setAttribute('aria-live', 'polite');
  result.hidden = true;
  panel.appendChild(result);
  const recovery = document.createElement('div');
  recovery.className = 'gd-blackjack-recovery';
  recovery.innerHTML = '<button type="button">Retry connection</button><a href="gameday-auth.html">Sign in</a>';
  recovery.hidden = true;
  panel.appendChild(recovery);
  const retryButton = recovery.querySelector('button');
  const signIn = recovery.querySelector('a');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const resultNames = { player_blackjack:'Blackjack — you win', player_bust:'Bust — dealer wins', dealer_bust:'Dealer busts — you win', won:'You win', lost:'Dealer wins', push:'Push — wager returned' };
  let supabase, user = null, hand = null, balance = null;
  let busy = true, recoveryRequired = false, recoveryContext = null, unavailable = false;
  let epoch = 0, hidden = false, requestController = null, sdkAttempt = 0;
  const isActive = () => hand?.status === 'active';
  const knownKey = id => `gameday:blackjack:last-hand:${id}`;
  const pendingKey = id => `gameday:blackjack:pending:${id}`;
  const current = (token, id) => token === epoch && !hidden && user?.id === id;
  function storedHand(id) { try { return localStorage.getItem(knownKey(id)); } catch (_) { return null; } }
  function storeHand(id, handId) { try { localStorage.setItem(knownKey(id), handId); } catch (_) {} }
  function savePending(id, context) { try { if (context) localStorage.setItem(pendingKey(id), JSON.stringify(context)); else localStorage.removeItem(pendingKey(id)); } catch (_) {} }
  function pendingHand(id) { try { return JSON.parse(localStorage.getItem(pendingKey(id))); } catch (_) { return null; } }
  function baseStake(id, next) {
    let value;
    try { value = Number(localStorage.getItem(`${knownKey(id)}:base:${next.id}`)); } catch (_) {}
    if (!Number.isInteger(value) || value < 1 || value > 10000) value = recoveryContext?.baseStake || (Array.isArray(next.player_hands) ? Math.min(...next.player_hands.map(part => Number(part.stake))) : Number(next.stake));
    if (!Number.isInteger(value) || value < 1 || value > 10000) value = 1;
    try { localStorage.setItem(`${knownKey(id)}:base:${next.id}`, String(value)); } catch (_) {}
    return value;
  }
  function message(text) { if (status) status.textContent = text; }
  function controls() {
    const locked = busy || recoveryRequired || unavailable || !user || isActive();
    wager.setLocked(locked);
    stage.dataset.dealBusy = String(busy);
    stage.setAttribute('aria-busy', String(busy));
    actions.forEach(button => { button.disabled = true; });
    const active = !busy && !recoveryRequired && !unavailable && user && isActive();
    for (const name of ['hit','stand','double','split']) {
      const extraStake = name === 'double' ? Number(hand?.player_hands?.[hand.active_hand_index]?.stake ?? hand?.stake) : Number(hand?.stake);
      actions.get(name).disabled = !(active && hand[`can_${name}`] === true && (!['double','split'].includes(name) || (Number.isFinite(balance) && balance >= extraStake)));
    }
    const amount = wager.getAmount();
    const valid = Number.isInteger(amount) && amount >= 1 && amount <= 10000 && Number.isFinite(balance) && amount <= balance;
    actions.get('deal').textContent = hand && !isActive() ? 'New Deal' : 'Deal';
    actions.get('deal').disabled = busy || recoveryRequired || unavailable || !user || isActive() || !valid;
    retryButton.disabled = busy;
    recovery.hidden = Boolean(user && !recoveryRequired && !unavailable);
    retryButton.hidden = !recoveryRequired && !unavailable;
    retryButton.textContent = recoveryRequired ? 'Retry recovery' : 'Retry connection';
    signIn.hidden = Boolean(user);
    info.querySelector('.gd-blackjack-balance').textContent = Number.isFinite(balance) ? `Test balance: ${money.format(balance)}` : user ? 'Test balance unavailable' : 'Sign in to play with test credits';
    if (!busy && user && !isActive() && !unavailable && !recoveryRequired && !valid) {
      message(amount < 1 ? 'Choose a chip to set a wager of at least $1.' : amount > 10000 ? 'The maximum wager is $10,000.' : 'Your wager exceeds your available test balance. Choose a smaller amount.');
    }
  }
  function validateHand(next) {
    if (!next || typeof next.id !== 'string' || !next.id || !['active', ...Object.keys(resultNames)].includes(next.status) || !Number.isFinite(Number(next.stake)) || Number(next.stake) <= 0 || !Number.isFinite(Number(next.payout)) || !Number.isFinite(Number(next.balance)) || !Number.isSafeInteger(Number(next.action_count))) throw new Error('The game service returned an incomplete hand.');
    const validCards = (cards, allowHidden = false) => Array.isArray(cards) && cards.length >= 2 && cards.length <= 20 && cards.every(card => card && ((allowHidden && card.rank === '?' && card.suit === '') || ['A','2','3','4','5','6','7','8','9','10','J','Q','K'].includes(card.rank) && ['♠','♥','♦','♣'].includes(card.suit)));
    if (!validCards(next.player_cards) || !validCards(next.dealer_cards, next.status === 'active')) throw new Error('The game service returned invalid cards.');
    if (next.player_hands !== null && next.player_hands !== undefined) {
      if (!Array.isArray(next.player_hands) || next.player_hands.length !== 2 || !next.player_hands.every(part => validCards(part.cards) && Number.isFinite(Number(part.total)) && Number(part.stake) > 0) || ![0,1].includes(Number(next.active_hand_index))) throw new Error('The game service returned incomplete split hands.');
    }
    return next;
  }
  async function applyHand(next, token, id, animate = true) {
    validateHand(next);
    if (!current(token, id)) return false;
    hand = next;
    balance = Number(next.balance);
    storeHand(id, next.id);
    const draftStake = baseStake(id, next);
    if (isActive()) wager.setAmount(Number(next.stake));
    else wager.startNextWager(`${id}:${next.id}`, draftStake);
    result.hidden = true;
    const rendered = await view.render({ groups: { player: next.player_cards, dealer: next.dealer_cards }, phase: isActive() ? 'active' : 'complete', splitHands: next.player_hands, activeHandIndex: Number(next.active_hand_index) }, { animate });
    if (!rendered || !current(token, id)) return false;
    const split = Array.isArray(next.player_hands);
    const playerTotals = split ? next.player_hands.map((part, index) => `Hand ${index + 1}: ${part.total}`).join(' · ') : `Total: ${next.player_total}`;
    info.querySelector('.gd-blackjack-totals').textContent = `${playerTotals}${isActive() ? '' : ` · Dealer: ${next.dealer_total}`}`;
    if (isActive()) {
      message(split ? `Play highlighted hand ${Number(next.active_hand_index) + 1}.` : 'Choose Hit, Stand, Double or Split when available.');
      announcement.textContent = split ? 'Both split hands remain on the table. Finish the highlighted hand to continue.' : 'Your hand is active. Stand lets the dealer finish the round.';
    } else {
      result.replaceChildren();
      const title = document.createElement('h2');
      title.textContent = resultNames[next.status];
      const settlement = document.createElement('p');
      const net = Number(next.payout) - Number(next.stake);
      settlement.textContent = `Wager ${money.format(next.stake)} · Returned ${money.format(next.payout)} · Net ${net > 0 ? '+' : ''}${money.format(net)}`;
      result.append(title, settlement);
      if (split) {
        const parts = document.createElement('p');
        parts.textContent = next.player_hands.map((part, index) => `Hand ${index + 1}: ${part.total} (${part.status})`).join(' · ');
        result.appendChild(parts);
      }
      result.hidden = false;
      message('Round complete. Choose a wager and press New Deal for the next hand.');
      announcement.textContent = `${resultNames[next.status]}. Test balance ${money.format(balance)}.`;
    }
    window.dispatchEvent(new CustomEvent('gameday:wallet-updated', { detail: { balance, userId: id } }));
    return true;
  }
  async function request(payload, token, id) {
    const { data, error } = await supabase.auth.getSession();
    if (!current(token, id) || error || !data.session?.access_token || data.session.user?.id !== id) {
      const authError = new Error('Your session changed. Sign in again to continue.');
      authError.auth = true;
      throw authError;
    }
    const controller = new AbortController();
    requestController = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(functionUrl('blackjack'), { method: 'POST', headers: { 'Content-Type':'application/json', apikey:GAMEDAY_CONFIG.supabasePublishableKey, Authorization:`Bearer ${data.session.access_token}` }, body:JSON.stringify(payload), signal:controller.signal });
      let body;
      try { body = await response.json(); } catch (_) { throw new Error('The hand response could not be read.'); }
      if (!response.ok || !body.ok) {
        const failure = new Error(body.error || 'The hand request could not finish.');
        failure.auth = response.status === 401 || response.status === 403;
        failure.clientError = response.status >= 400 && response.status < 500;
        // Only explicit validation rejects prove that no new wager was accepted.
        failure.rejected = response.status >= 400 && response.status < 500 && /^(Invalid stake|Insufficient test balance)(?:\b|$)/i.test(String(body.error || ''));
        throw failure;
      }
      return body;
    } finally { clearTimeout(timer); if (requestController === controller) requestController = null; }
  }
  async function recover(context, token, id) {
    message('Checking the saved hand before any further wager…');
    let saved;
    if (context.handId) saved = (await request({ action:'state', hand_id:context.handId }, token, id)).hand;
    else {
      const resumed = await request({ action:'resume', include_latest:true }, token, id);
      saved = resumed.hand;
      if (!saved && resumed.latest_hand?.id && resumed.latest_hand.id !== context.baselineId) saved = resumed.latest_hand;
      if (!saved && context.rejected) {
        recoveryRequired = false;
        recoveryContext = null;
        savePending(id, null);
        message(context.message || 'No new hand was started. Adjust your wager and try again.');
        return;
      }
      if (!saved) throw new Error('The last request is still unconfirmed. Retry recovery before placing another wager.');
    }
    await applyHand(saved, token, id);
    if (!current(token, id)) return;
    recoveryRequired = false;
    recoveryContext = null;
    savePending(id, null);
  }
  async function perform(action) {
    if (busy || recoveryRequired || unavailable || !user || hidden || actions.get(action)?.disabled) return;
    const id = user.id, token = epoch;
    busy = true;
    controls();
    view.unlockAudio();
    let context;
    try {
      if (action === 'deal') {
        const resumed = await request({ action:'resume', include_latest:true }, token, id);
        if (resumed.hand) { await applyHand(resumed.hand, token, id); return; }
        const stake = wager.getAmount();
        if (!Number.isInteger(stake) || stake < 1 || stake > 10000 || !Number.isFinite(balance) || stake > balance) throw new Error('Choose a valid wager within your test balance.');
        context = { action:'start', baselineId:resumed.latest_hand?.id || null, baseStake:stake };
        recoveryContext = context;
        savePending(id, context);
        const response = await request({ action:'start', stake }, token, id);
        await applyHand(response.hand, token, id);
      } else {
        if (!isActive() || hand[`can_${action}`] !== true) return;
        context = { action, handId:hand.id, baseStake:baseStake(id, hand) };
        recoveryContext = context;
        savePending(id, context);
        const response = await request({ action, hand_id:hand.id, expected_action_count:Number(hand.action_count) }, token, id);
        await applyHand(response.hand, token, id);
      }
      if (current(token, id)) { recoveryContext = null; savePending(id, null); }
    } catch (error) {
      if (!current(token, id)) return;
      if (error.auth) { user = null; unavailable = true; balance = null; view.clear(); hand = null; result.hidden = true; message(error.message); }
      else if (context) {
        recoveryRequired = true;
        context.rejected = Boolean(error.rejected);
        context.message = error.message;
        savePending(id, context);
        try { await recover(context, token, id); } catch (_) { if (current(token, id)) message('The last request is unconfirmed. Press Retry recovery to check your saved hand. Another wager is blocked.'); }
      } else message(error.message || 'Unable to check your hand. Please try again.');
    } finally { if (token === epoch) { busy = false; controls(); } }
  }
  async function connect() {
    const token = ++epoch;
    busy = true;
    unavailable = false;
    requestController?.abort();
    view.cancel();
    controls();
    message('Checking your sign-in and saved Blackjack hand…');
    try {
      if (!supabase) {
        let createClient;
        try { ({ createClient } = await import(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm?blackjack=${++sdkAttempt}`)); }
        catch (_) { throw new Error('Blackjack could not load your sign-in connection. Check your connection and press Retry connection.'); }
        if (token !== epoch || hidden) return;
        supabase = createClient(GAMEDAY_CONFIG.supabaseUrl, GAMEDAY_CONFIG.supabasePublishableKey);
        supabase.auth.onAuthStateChange((_event, session) => {
          const nextId = session?.user?.id || null;
          if (nextId !== (user?.id || null)) {
            epoch++;
            requestController?.abort();
            view.cancel();
            busy = true;
            balance = null;
            controls();
            setTimeout(() => { if (!hidden) connect(); }, 0);
          }
        });
      }
      const { data, error } = await supabase.auth.getSession();
      if (token !== epoch || hidden) return;
      if (error) throw error;
      const nextUser = data.session?.user || null;
      if (nextUser?.id !== user?.id) { hand = null; balance = null; recoveryRequired = false; recoveryContext = null; view.clear(); result.hidden = true; info.querySelector('.gd-blackjack-totals').textContent = ''; }
      user = nextUser;
      if (!user || !data.session?.access_token) { message('Sign in to deal a Blackjack hand with your GameDay test wallet.'); announcement.textContent = ''; return; }
      const id = user.id;
      if (!recoveryContext) {
        const pending = pendingHand(id);
        if (pending && ['start','hit','stand','double','split'].includes(pending.action) && (pending.action === 'start' || typeof pending.handId === 'string')) { recoveryContext = pending; recoveryRequired = true; }
      }
      if (recoveryRequired && recoveryContext) { await recover(recoveryContext, token, id); return; }
      const resumed = await request({ action:'resume' }, token, id);
      if (!current(token, id)) return;
      if (resumed.hand) { await applyHand(resumed.hand, token, id, false); return; }
      const lastId = storedHand(id);
      if (lastId) {
        try { const saved = await request({ action:'state', hand_id:lastId }, token, id); await applyHand(saved.hand, token, id, false); return; }
        catch (error) { if (error.auth || !error.clientError) throw error; }
      }
      const { data:wallet, error:walletError } = await supabase.from('wallets').select('balance').eq('user_id', id).single();
      if (!current(token, id)) return;
      if (walletError || !wallet || !Number.isFinite(Number(wallet.balance))) throw new Error('Your test balance could not be loaded. Retry connection before placing a wager.');
      balance = Number(wallet.balance);
      if (wager.getAmount() === 0) wager.setAmount(1);
      message('Choose a wager, then press Deal.');
    } catch (error) {
      if (token !== epoch || hidden) return;
      unavailable = true;
      if (error.auth) { user = null; balance = null; view.clear(); hand = null; result.hidden = true; }
      message(recoveryRequired ? 'Your hand needs recovery. Retry recovery before placing another wager.' : error.message || 'Blackjack could not connect. Retry connection or sign in.');
    } finally { if (token === epoch) { busy = false; controls(); } }
  }
  for (const name of ['deal','hit','stand','double','split']) actions.get(name)?.addEventListener('click', () => perform(name));
  stage.addEventListener('gameday:wager-change', controls);
  retryButton.addEventListener('click', connect);
  window.addEventListener('pagehide', () => { hidden = true; epoch++; requestController?.abort(); view.cancel(); });
  window.addEventListener('pageshow', event => { if (event.persisted || hidden) { hidden = false; connect(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !hidden && user && !busy && !recoveryRequired) connect(); });
  window.addEventListener('storage', event => { if (user && event.key === knownKey(user.id) && !busy) connect(); });
  controls();
  connect();
  return true;
}

if (!await initializeBlackjack()) {
  document.addEventListener('gameday:card-view-ready', initializeBlackjack, { once:true });
  document.addEventListener('gameday:wager-ready', initializeBlackjack, { once:true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeBlackjack, { once:true });
}
