import { GAMEDAY_CONFIG, functionUrl, assertGameDayConfig } from './gameday-config.js';

const dashboard = document.body.dataset.operatorDashboard;
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
const deadline = 12000;
const metricIds = ['sports_events','sports_markets','sports_outcomes','line_history','users','wagers','casino_rounds','wallet_transactions','provider_snapshots','odds_cache_records','wager_selections','wallets'];
const analyticIds = ['wagers','sportsHandle','potential','recentWagers','casinoRounds','casinoHandle','casinoPayout','casinoNet','txCount','debits','credits','refunds','debitAmt','creditAmt','refundAmt'];
const $ = id => document.getElementById(id);
let client, epoch = 0, currentSession = null, activeRequest, scheduled;
const number = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '—';
const money = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? '$' + Number(value).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '—';

function bounded(work, controller) {
  let timer;
  return Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Connection timed out. Try again.');
      reject(error); controller?.abort(error);
    }, deadline);
  })]).finally(() => clearTimeout(timer));
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  return bounded(fetch(url, {...options, signal}), controller);
}

function reset() {
  for (const id of [...metricIds,...analyticIds,'markets','outcomes','snapshots','cache']) if ($(id)) $(id).textContent = '—';
  for (const id of ['sportsMix','casinoMix']) if ($(id)) $(id).replaceChildren();
  if ($('generated')) $('generated').textContent = 'No current snapshot';
  if ($('sportsDataStatus')) $('sportsDataStatus').textContent = 'Not verified';
  if ($('checks')) $('checks').replaceChildren();
}

function status(message, failed = false) {
  const element = $(dashboard === 'metrics' ? 'sysStatus' : dashboard === 'analytics' ? 'updated' : 'overallText');
  element.textContent = message;
  element.className = failed ? 'error' : '';
  if ($('overallBadge')) {
    $('overallBadge').className = 'status';
    $('overallBadge').textContent = failed ? 'Unavailable' : 'Checking';
  }
  $('operatorNotice').textContent = message;
}

function mix(id, rows) {
  const container = $(id);
  container.replaceChildren();
  if (!Array.isArray(rows) || !rows.length) { container.textContent = 'No activity recorded yet.'; return; }
  const max = Math.max(1,...rows.map(row => Number(row.count) || 0));
  for (const row of rows) {
    const wrapper = document.createElement('div'); wrapper.className = 'barrow';
    const label = document.createElement('span'); label.textContent = String(row.name || 'Unknown').replaceAll('_',' ');
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = Math.min(100,Math.max(0,(Number(row.count)||0)/max*100)) + '%'; bar.append(fill);
    const count = document.createElement('strong'); count.textContent = number(row.count);
    wrapper.append(label,bar,count); container.append(wrapper);
  }
}

function render(data) {
  const date = new Date(data.generated_at);
  const updated = Number.isFinite(date.getTime()) ? 'Updated ' + date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'Snapshot time unavailable';
  if (dashboard === 'metrics') {
    for (const id of metricIds) $(id).textContent = number(data[id]);
    $('generated').textContent = updated;
    $('sportsDataStatus').textContent = 'Queries completed';
    status('Metrics loaded');
  } else if (dashboard === 'analytics') {
    const sports = data.sportsbook || {}, casino = data.casino || {}, wallet = data.wallet || {};
    const values = {wagers:sports.wagers,sportsHandle:sports.handle,potential:sports.potential_return,recentWagers:sports.recent_7d,casinoRounds:casino.rounds,casinoHandle:casino.handle,casinoPayout:casino.payout,casinoNet:casino.simulated_net,txCount:wallet.transactions,debits:wallet.wager_debits,credits:wallet.wager_credits,refunds:wallet.refunds,debitAmt:wallet.wager_debit_amount,creditAmt:wallet.wager_credit_amount,refundAmt:wallet.refund_amount};
    for (const [id,value] of Object.entries(values)) $(id).textContent = /Handle|potential|Payout|Net|Amt/.test(id) ? money(value) : number(value);
    mix('sportsMix',sports.top_sports); mix('casinoMix',casino.game_mix);
    status(updated);
  } else {
    const overall = ['healthy','attention','degraded'].includes(data.overall) ? data.overall : 'degraded';
    status(overall === 'healthy' ? 'Measured checks passed' : overall === 'attention' ? 'System needs attention' : 'Unable to verify all checks', overall === 'degraded');
    $('overallBadge').className = 'status ' + overall;
    $('overallBadge').textContent = overall === 'healthy' ? 'Healthy' : overall === 'attention' ? 'Needs attention' : 'Degraded';
    for (const [id,key] of Object.entries({markets:'markets',outcomes:'outcomes',snapshots:'provider_snapshots',cache:'cache_entries'})) $(id).textContent = number(data.totals?.[key]);
    for (const check of data.checks || []) {
      const card = document.createElement('div'); card.className = 'card';
      const header = document.createElement('div'); header.className = 'cardhead';
      const title = document.createElement('h3'); title.textContent = check.label;
      const pill = document.createElement('span'); pill.className = 'pill ' + (['healthy','stale','degraded','unavailable','attention'].includes(check.status) ? check.status : 'degraded'); pill.textContent = check.status || 'Unavailable';
      const detail = document.createElement('div'); detail.className = 'detail'; detail.textContent = check.detail;
      header.append(title,pill); card.append(header,detail); $('checks').append(card);
    }
    if (!$('checks').children.length) { $('checks').textContent = 'No measured checks returned.'; status('Unable to verify system',true); }
  }
}

async function load() {
  const generation = ++epoch;
  activeRequest?.abort(); activeRequest = new AbortController();
  const controller = activeRequest;
  reset(); status('Checking operator access…'); $('operatorRetry').disabled = true;
  const valid = () => generation === epoch && !controller.signal.aborted;
  try {
    if (!assertGameDayConfig().ok) throw new Error('Configuration invalid.');
    if (!client) throw new Error('Connection unavailable. Try again.');
    const {data,error} = await bounded(client.auth.getSession());
    if (!valid()) return;
    if (error) throw new Error('Unable to verify your session. Try again.');
    currentSession = data?.session || null;
    if (!currentSession) throw new Error('Sign in with an operator account to view this dashboard.');
    const token = currentSession.access_token, owner = currentSession.user.id;
    const result = await bounded(client.auth.getUser(token));
    if (!valid() || currentSession?.access_token !== token) return;
    if (result.error || result.data?.user?.id !== owner) throw new Error('Your session could not be verified. Sign in again.');
    if (!['operator','admin'].includes(result.data.user.app_metadata?.role)) throw new Error('Operator access required. This customer account cannot view operational data.');
    const key = dashboard === 'metrics' ? 'operatorMetrics' : dashboard === 'analytics' ? 'operatorAnalytics' : 'operatorHealth';
    const response = await bounded(fetch(functionUrl(key), {headers:{Authorization:'Bearer '+token,apikey:GAMEDAY_CONFIG.supabasePublishableKey},signal:controller.signal}), controller);
    const payload = await bounded(response.json(),controller);
    if (!valid() || currentSession?.access_token !== token) return;
    if (response.status === 403) throw new Error('Operator access required. Your permission may have changed.');
    if (response.status === 401) throw new Error('Your session expired. Sign in again.');
    if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Operational data unavailable. Try again.');
    render(payload);
  } catch (error) {
    if (generation === epoch) { reset(); status(error.message || 'Operational data unavailable. Try again.',true); }
  } finally {
    if (generation === epoch) $('operatorRetry').disabled = false;
  }
}

function invalidate(session) {
  ++epoch; activeRequest?.abort(); currentSession = session;
  reset(); status(session ? 'Checking operator access…' : 'Sign in with an operator account to view this dashboard.', !session);
  $('operatorRetry').disabled = false;
  clearTimeout(scheduled);
  if (session) scheduled = setTimeout(load,0);
}

$('operatorRetry').addEventListener('click',() => client ? load() : location.reload());
if ($('refresh')) $('refresh').addEventListener('click',load);
try {
  const {createClient} = await bounded(import(SDK));
  client = createClient(GAMEDAY_CONFIG.supabaseUrl,GAMEDAY_CONFIG.supabasePublishableKey,{global:{fetch:timedFetch}});
  client.auth.onAuthStateChange((event,session) => invalidate(session));
  await load();
} catch {
  reset(); status('Unable to connect. Try again to reload the connection.',true); $('operatorRetry').disabled = false;
}
