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
    refillTestWallet: 'refill-test-wallet',
    placeTestWager: 'place-test-wager',
    blackjack: 'blackjack-test',
    roulette: 'roulette-test',
    baccarat: 'baccarat-test',
    slots: 'slots-test',
    videoPoker: 'video-poker-test',
    threeCardPoker: 'three-card-poker-test',
    ultimateTexasHoldem: 'ultimate-texas-holdem-test',
    caribbeanStud: 'caribbean-stud-test'
  }),
  routes: Object.freeze({
    home: 'index.html',
    sportsbook: 'gameday-sportsbook.html',
    casino: 'gameday-casino-v2.html',
    myBets: 'gameday-my-bets.html',
    account: 'gameday-auth.html',
    blackjack: 'gameday-blackjack.html',
    roulette: 'gameday-roulette.html',
    baccarat: 'gameday-baccarat.html',
    slots: 'gameday-slots.html',
    slotsLobby: 'gameday-slots-lobby.html',
    poker: 'gameday-poker.html',
    videoPoker: 'gameday-video-poker.html',
    bonusPoker: 'gameday-bonus-poker.html',
    deucesWild: 'gameday-deuces-wild.html',
    threeCardPoker: 'gameday-three-card-poker.html',
    ultimateTexasHoldem: 'gameday-ultimate-texas-holdem.html',
    caribbeanStud: 'gameday-caribbean-stud.html',
    controlCenter: 'gameday-control-center.html',
    analytics: 'gameday-operator-analytics.html',
    systemHealth: 'gameday-system-health.html',
    buyerDemo: 'gameday-buyer-demo.html',
    adminTakeover: 'gameday-admin-takeover.html',
    configCheck: 'gameday-config-check.html',
    transferAudit: 'gameday-transfer-audit.html'
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
