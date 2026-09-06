export const GAMEDAY_CONFIG = Object.freeze({
  brand: 'GameDay Sports & Casino',
  environment: 'TEST',
  supabaseUrl: 'https://qsvrvhcklnsbekxblpfo.supabase.co',
  supabasePublishableKey: 'sb_publishable_-yCYGvDqIzVFgu90lgoVpw_uoWnYmO0',
  functions: Object.freeze({
    odds: 'gameday-odds',
    liveState: 'gameday-live-state',
    operatorMetrics: 'gameday-operator-metrics',
    operatorAnalytics: 'gameday-operator-analytics',
    operatorHealth: 'gameday-operator-health',
    refillTestWallet: 'refill-test-wallet'
  }),
  routes: Object.freeze({
    home: 'index.html',
    sportsbook: 'gameday-sportsbook.html',
    casino: 'gameday-casino-v2.html',
    myBets: 'gameday-my-bets.html',
    account: 'gameday-auth.html',
    controlCenter: 'gameday-control-center.html',
    analytics: 'gameday-operator-analytics.html',
    systemHealth: 'gameday-system-health.html',
    buyerDemo: 'gameday-buyer-demo.html',
    adminTakeover: 'gameday-admin-takeover.html',
    configCheck: 'gameday-config-check.html'
  })
});

export function functionUrl(name) {
  const slug = GAMEDAY_CONFIG.functions[name] || name;
  return `${GAMEDAY_CONFIG.supabaseUrl}/functions/v1/${slug}`;
}

export function assertGameDayConfig() {
  const problems = [];
  if (!GAMEDAY_CONFIG.supabaseUrl?.startsWith('https://')) problems.push('Invalid Supabase URL');
  if (!GAMEDAY_CONFIG.supabasePublishableKey) problems.push('Missing Supabase publishable key');
  if (GAMEDAY_CONFIG.environment !== 'TEST') problems.push('GameDay must remain TEST mode in this build');
  return { ok: problems.length === 0, problems };
}
