const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const directory = path.resolve(__dirname, '../supabase/functions/gameday-live-state');
const now = Date.parse('2026-10-10T17:05:00.000Z');
const fetchedAt = new Date(now).toISOString();
function sources() {
  return {
    model: stripTypeScriptTypes(fs.readFileSync(path.join(directory, 'live-state-model.ts'), 'utf8'), { mode: 'strip' }).replace(/^export /gm, ''),
    endpoint: stripTypeScriptTypes(fs.readFileSync(path.join(directory, 'index.ts'), 'utf8').replace(/^import .+\n/gm, ''), { mode: 'strip' }),
  };
}
function loadModel() {
  const context = vm.createContext({ Date, Map, Set });
  vm.runInContext(sources().model + '\nthis.model={routeFor,mapEspnEvent,mapMlbGame,withoutCurrentTime,normalizeName};', context);
  return context.model;
}
const plain = value => JSON.parse(JSON.stringify(value));
const status = (period = 1, displayClock = '1:01', extra = {}) => ({
  period, displayClock,
  type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, description: 'In Progress', detail: `${displayClock} - 1st Quarter`, ...extra },
});
function event({ kind = 'football', clock = '1:01', period = 1, regulation = 4, eventStatus, competitionStatus, season = 2 } = {}) {
  // Compact factual ESPN structure: college football uses team.location + displayName,
  // and competitions can carry a status distinct from the enclosing event.
  const c = {
    id: '401858481', date: '2026-10-10T16:00Z', format: { regulation: { periods: regulation } },
    competitors: [
      { homeAway: 'away', team: { displayName: 'Rutgers Scarlet Knights', location: 'Rutgers', name: 'Scarlet Knights' }, score: '7' },
      { homeAway: 'home', team: { displayName: 'Nebraska Cornhuskers', location: 'Nebraska', name: 'Cornhuskers' }, score: '14' },
    ],
  };
  if (competitionStatus) c.status = competitionStatus;
  return { id: 'event-id', date: '2026-10-10T16:00Z', season: { type: season }, status: eventStatus || status(period, clock), competitions: [c] };
}
function mapped(sport, input) {
  const model = loadModel();
  const route = model.routeFor(sport);
  assert(route, `Supported fixture route: ${sport}`);
  return plain(model.mapEspnEvent(input, route, sport, fetchedAt));
}
function schedule(extra = {}) {
  return {
    gamePk: 825167, gameDate: '2026-10-10T17:00:00Z', gameType: 'R',
    status: { abstractGameState: 'Live', detailedState: 'In Progress', codedGameState: 'I' },
    teams: { home: { team: { name: 'New York Yankees' }, score: 0 }, away: { team: { name: 'Boston Red Sox' }, score: 2 } },
    linescore: { currentInning: 3, inningState: 'Top', balls: 1, strikes: 2, outs: 1, offense: { first: { id: 1 } } },
    ...extra,
  };
}
function harness({ sport = 'ncaaf', cache = null, cacheReadError = false, cacheWriteError = false, provider, sdkFetch = false, realSdk = false } = {}) {
  const reads = [], writes = [], logs = [];
  let handler;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const fetcher = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    reads.push({ url, method: init?.method || 'GET', signal: init?.signal, headers: init?.headers });
    if (url.includes('/rest/v1/')) {
      if (sdkFetch === 'stall') return stalledBody(init?.signal);
      if (sdkFetch === '503') return new Response(JSON.stringify({ message: 'Fixture database unavailable' }), { status: 503 });
      return new Response(JSON.stringify(cache), { status: 200 });
    }
    if (provider) return provider(url, init, reads);
    const route = loadModel().routeFor(sport);
    return new Response(JSON.stringify({ leagues: [{ slug: route.path.split('/').at(-1) }], events: [event()] }), { status: 200 });
  };
  const createClient = (url, key, options) => {
    assert.equal(key, 'fixture-service-key');
    assert.equal(options.auth.persistSession, false);
    assert.equal(options.db?.retry, false, 'Optional cache failure must not repeat SDK requests ahead of provider recovery');
    if (realSdk) return require('@supabase/supabase-js').createClient(url, key, options);
    return { from(table) {
      assert.equal(table, 'odds_response_cache');
      return {
        select() { return { eq(column, key) {
          assert.equal(column, 'cache_key');
          assert.equal(key, `live-state:verified-v2:${sport}`);
          return { async maybeSingle() {
            if (cacheReadError) throw new Error('Fixture cache read failure');
            if (sdkFetch) return { data: await (await options.global.fetch(url + '/rest/v1/odds_response_cache')).json() };
            return { data: cache };
          } };
        } }; },
        async upsert(value, options) {
          writes.push(plain(value));
          assert.equal(options.onConflict, 'cache_key');
          return { error: cacheWriteError ? { message: 'Fixture write failure' } : null };
        },
      };
    } };
  };
  const context = vm.createContext({
    Date: FixedDate, URL, URLSearchParams, Request, Response, Headers, AbortController, Uint8Array,
    setTimeout: (callback, milliseconds) => setTimeout(callback, [2000, 5000].includes(milliseconds) ? 25 : milliseconds), clearTimeout,
    fetch: fetcher, createClient,
    console: { warn: message => logs.push(message) },
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://fixture.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' })[name] }, serve: value => { handler = value; } },
  });
  const source = sources();
  vm.runInContext(source.model + '\n' + source.endpoint, context);
  return { reads, writes, logs, async request(query = sport, method = 'GET', body) {
    const response = await handler(new Request('https://fixture.test/live-state?sport=' + encodeURIComponent(query), { method, ...(body !== undefined ? { body } : {}) }));
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  } };
}
function stalledBody(signal) {
  return { status: 200, statusText: 'OK', headers: new Headers(), arrayBuffer: () => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) };
}
const cached = (sport = 'ncaaf', age = 60000, expires = -1) => ({
  expires_at: new Date(now + expires).toISOString(),
  payload: { provider: 'espn', sport, count: 1, states: mapped('ncaaf', event()), fetched_at: new Date(now - age).toISOString(), stale: false, configured: true },
});

test('Verified competition routes distinguish college, professional, preseason and unrelated sports', () => {
  const model = loadModel();
  for (const [alias, path] of [['nfl', 'football/nfl'], ['ncaaf', 'football/college-football'], ['nba', 'basketball/nba'], ['wnba', 'basketball/wnba'], ['ncaab', 'basketball/mens-college-basketball'], ['nhl', 'hockey/nhl'], ['mlb', 'baseball/mlb'], ['epl', 'soccer/eng.1'], ['mls', 'soccer/usa.1'], ['ucl', 'soccer/uefa.champions']]) assert.equal(model.routeFor(alias)?.path, path, alias);
  assert.equal(model.routeFor('basketball_nba_preseason').preseason, true);
  for (const sport of ['cricket_big_bash', 'soccer_invented_league', 'nfl_wrong', 'rugbyleague_nrl']) assert.equal(model.routeFor(sport), null, sport);
});
test('All fifty-six provider-verified soccer competitions keep their exact league routes', () => {
  const model = loadModel();
  // Expected routes were verified against the provider league catalog and scoreboards.
  const leagues = {
    argentina_primera_division:'arg.1', australia_aleague:'aus.1', austria_bundesliga:'aut.1', belgium_first_div:'bel.1', brazil_campeonato:'bra.1', brazil_serie_b:'bra.2',
    chile_campeonato:'chi.1', china_superleague:'chn.1', denmark_superliga:'den.1', efl_champ:'eng.2', england_efl_cup:'eng.league_cup', england_league1:'eng.3', england_league2:'eng.4', epl:'eng.1', fa_cup:'eng.fa',
    fifa_world_cup:'fifa.world', fifa_world_cup_qualifiers_europe:'fifa.worldq.uefa', fifa_world_cup_qualifiers_south_america:'fifa.worldq.conmebol', fifa_world_cup_womens:'fifa.wwc', fifa_club_world_cup:'fifa.cwc',
    france_coupe_de_france:'fra.coupe_de_france', france_ligue_one:'fra.1', france_ligue_two:'fra.2', germany_bundesliga:'ger.1', germany_bundesliga2:'ger.2', germany_dfb_pokal:'ger.dfb_pokal', greece_super_league:'gre.1',
    italy_coppa_italia:'ita.coppa_italia', italy_serie_a:'ita.1', italy_serie_b:'ita.2', japan_j_league:'jpn.1', mexico_ligamx:'mex.1', netherlands_eredivisie:'ned.1', norway_eliteserien:'nor.1', portugal_primeira_liga:'por.1', russia_premier_league:'rus.1',
    spain_la_liga:'esp.1', spain_copa_del_rey:'esp.copa_del_rey', spain_segunda_division:'esp.2', saudi_arabia_pro_league:'ksa.1', spl:'sco.1', sweden_allsvenskan:'swe.1', turkey_super_league:'tur.1',
    uefa_europa_conference_league:'uefa.europa.conf', uefa_champs_league:'uefa.champions', uefa_champs_league_qualification:'uefa.champions_qual', uefa_champs_league_women:'uefa.wchampions', uefa_europa_league:'uefa.europa',
    uefa_european_championship:'uefa.euro', uefa_euro_qualification:'uefa.euroq', uefa_nations_league:'uefa.nations', concacaf_leagues_cup:'concacaf.leagues.cup', conmebol_copa_america:'conmebol.america', conmebol_copa_libertadores:'conmebol.libertadores', conmebol_copa_sudamericana:'conmebol.sudamericana', usa_mls:'usa.1',
  };
  assert.equal(Object.keys(leagues).length, 56);
  for (const [key, slug] of Object.entries(leagues)) {
    const route = model.routeFor('soccer_' + key); assert.equal(route?.path, 'soccer/' + slug, key); assert.equal(route.kind, 'soccer');
  }
});
test('Captured college-football shape maps the verified clock, team side, zero-safe scores and full-name aliases', () => {
  const state = mapped('ncaaf', event())[0];
  assert.equal(state.clock, '01:01'); assert.equal(state.period, 'Q1');
  assert.equal(state.home_team, 'Nebraska Cornhuskers'); assert.equal(state.away_team, 'Rutgers Scarlet Knights');
  assert.equal(state.home_score, 14); assert.equal(state.away_score, 7);
  assert.deepEqual(state.home_aliases, ['nebraska cornhuskers', 'nebraska']);
  assert(!state.home_aliases.includes('cornhuskers'));
  assert.equal(state.event_start, '2026-10-10T16:00:00.000Z');
  assert.equal(state.clock_verified, true); assert.equal(state.period_verified, true);
});
test('Basketball and hockey display explicit quarters, halves, overtime and fractional seconds', () => {
  for (const [sport, period, regulation, clock, expectedPeriod, expectedClock] of [
    ['nba', 4, 4, '0.7', 'Q4', '00:00.7'], ['nba', 5, 4, '3:15', 'OT', '03:15'], ['nba', 6, 4, '12:00', '2OT', '12:00'],
    ['ncaab', 2, 2, '5:03', 'H2', '05:03'], ['nhl', 3, 3, '11:04', 'P3', '11:04'], ['nhl', 4, 3, '2:03', 'OT', '02:03'],
  ]) {
    const state = mapped(sport, event({ period, regulation, clock }))[0];
    assert.equal(state.period, expectedPeriod); assert.equal(state.clock, expectedClock);
  }
});
test('Halftime, intermission and shootout labels never advertise an actively running countdown', () => {
  for (const [name, description] of [['STATUS_HALFTIME', 'Halftime'], ['STATUS_END_PERIOD', 'End of 1st'], ['STATUS_INTERMISSION', 'Intermission'], ['STATUS_SHOOTOUT', 'Shootout']]) {
    const state = mapped('nhl', event({ competitionStatus: status(2, '20:00', { name, description }) }))[0];
    assert.equal(state.period, description); assert.equal(state.clock, null); assert.equal(state.clock_verified, false); assert.equal(state.clock_kind, 'status');
  }
});
test('Soccer accepts provider elapsed minutes and explicit stoppage time without deriving time from kickoff', () => {
  for (const [clock, expected] of [["20'", '20′'], ["45'+3'", '45′ + 3′'], ['90′ + 12′', '90′ + 12′']]) {
    const state = mapped('epl', event({ competitionStatus: status(2, clock, { name: 'STATUS_SECOND_HALF', description: 'Second Half' }) }))[0];
    assert.equal(state.clock, expected); assert.equal(state.period, 'Second Half'); assert.equal(state.clock_kind, 'elapsed');
  }
  const state = mapped('epl', event({ clock: '', eventStatus: status(2, '', { description: 'Second Half' }) }))[0];
  assert.equal(state.clock, null); assert.equal(state.clock_verified, false);
});
test('Unverified or malformed clocks stay unavailable rather than becoming zero, elapsed time or guessed periods', () => {
  for (const clock of ['', '-', 'unknown', '1:99', '60.4', '12', '25:99', '-1:00']) {
    const state = mapped('nba', event({ clock }))[0];
    assert.equal(state.clock, null, clock); assert.equal(state.clock_verified, false);
  }
  for (const period of [null, '', -1, 0, 1.5]) {
    const state = mapped('nba', event({ eventStatus: status(period, '12:00') }))[0];
    assert.equal(state.period, null); assert.equal(state.clock, null);
  }
});
test('Scheduled, postponed, cancelled, completed and incomplete competitions cannot create live clocks', () => {
  for (const type of [{ state: 'pre', name: 'STATUS_SCHEDULED' }, { state: 'in', name: 'STATUS_POSTPONED' }, { state: 'in', name: 'STATUS_CANCELED' }, { state: 'in', name: 'STATUS_FINAL' }, { state: 'in', completed: true }]) assert.deepEqual(mapped('ncaaf', event({ eventStatus: status(1, '12:00', type) })), []);
  const missing = event(); missing.competitions[0].competitors.pop(); assert.deepEqual(mapped('ncaaf', missing), []);
  assert.deepEqual(mapped('basketball_nba_preseason', event({ season: 2 })), []);
  assert.equal(mapped('basketball_nba_preseason', event({ season: 1 })).length, 1);
});
test('A live competition status overrides a completed enclosing multi-match event', () => {
  const input = event({ eventStatus: status(1, '0:00', { state: 'post', completed: true }), competitionStatus: status(2, '4:12') });
  assert.equal(mapped('ncaaf', input)[0].clock, '04:12');
});
test('Baseball only uses the provider half-inning and preserves unknown scores as null', () => {
  const model = loadModel();
  for (const [half, expected] of [['Top', 'Top 3rd'], ['Bottom', 'Bot 3rd'], ['Middle', 'Middle 3rd'], ['End', 'End 3rd']]) {
    const input = schedule(); input.linescore.inningState = half;
    const state = plain(model.mapMlbGame(input, 'mlb', fetchedAt));
    assert.equal(state.period, expected); assert.equal(state.clock, null); assert.equal(state.clock_verified, false);
    assert.equal(state.home_score, 0); assert.deepEqual(state.bases, { first: true, second: false, third: false });
  }
  const input = schedule(); delete input.linescore.inningState; input.teams.home.score = null; delete input.teams.away.score;
  const state = plain(model.mapMlbGame(input, 'mlb', fetchedAt));
  assert.equal(state.period, null); assert.equal(state.period_verified, false); assert.equal(state.home_score, null); assert.equal(state.away_score, null);
});
test('Baseball delays and preseason restrictions use explicit current provider state', () => {
  const model = loadModel(), input = schedule(); input.status.detailedState = 'Rain Delay';
  const state = plain(model.mapMlbGame(input, 'mlb', fetchedAt)); assert.equal(state.period, 'Rain Delay'); assert.equal(state.clock_kind, 'status');
  assert.equal(model.mapMlbGame(schedule({ gameType: 'R' }), 'baseball_mlb_preseason', fetchedAt, true), null);
  assert.equal(model.mapMlbGame(schedule({ status: { abstractGameState: 'Final' } }), 'mlb', fetchedAt), null);
});
test('Combat match identity comes from its two athletes and explicit round rather than card-level status', () => {
  for (const period of [2, 4]) {
    const input = event({ regulation: 3, competitionStatus: status(period, '4:45') });
    input.competitions[0].competitors = [{ athlete: { displayName: 'Melissa Gatto' } }, { athlete: { fullName: 'Ernesta Kareckaite' } }];
    const state = mapped('mma_mixed_martial_arts', input)[0];
    assert.equal(state.period, 'Round ' + period); assert.equal(state.clock, '04:45'); assert.equal(state.home_score, null); assert.equal(state.away_score, null);
  }
});
function tennisEvent() {
  const competition = { id: '186254', date: '2026-10-10T16:03Z', status: status(2, '-'), competitors: [
    { athlete: { displayName: 'Arthur Gea' }, linescores: [{ value: 6 }, { value: 3 }] },
    { athlete: { displayName: 'Te Rigele' }, linescores: [{ value: 2 }, { value: 4 }] },
  ] };
  return { name: 'China Open', shortName: 'Beijing', date: '2026-09-27T04:00Z', status: status(2, '-', { state: 'post', completed: true, name: 'STATUS_FINAL' }), groupings: [
    { grouping: { slug: 'mens-singles' }, competitions: [competition] },
    { grouping: { slug: 'womens-singles' }, competitions: [{ ...competition, id: 'wta-match', competitors: [{ athlete: { displayName: 'Iga Swiatek' } }, { athlete: { displayName: 'Coco Gauff' } }] }] },
    { grouping: { slug: 'mens-doubles' }, competitions: [{ ...competition, id: 'doubles-match' }] },
  ] };
}
test('Tennis flattens only the requested singles grouping and uses live match status despite the enclosing tournament being final', () => {
  const input = tennisEvent(), atp = mapped('tennis_atp', input), wta = mapped('tennis_wta', input);
  assert.equal(atp.length, 1); assert.equal(atp[0].provider_event_id, '186254'); assert.equal(atp[0].home_team, 'Arthur Gea');
  assert.equal(atp[0].period, 'Set 2'); assert.equal(atp[0].clock, null); assert.equal(atp[0].home_score, null); assert.equal(atp[0].event_start, '2026-10-10T16:03:00.000Z');
  assert.equal(wta.length, 1); assert.equal(wta[0].home_team, 'Iga Swiatek'); assert.equal(wta[0].provider_event_id, 'wta-match');
});
test('Tournament-specific tennis routes never borrow clocks from an unrelated tournament or fuzzy partial name', () => {
  const input = tennisEvent();
  assert.equal(mapped('tennis_atp_china_open', input).length, 1);
  assert.deepEqual(mapped('tennis_atp_shanghai', input), []);
  assert.deepEqual(mapped('tennis_atp_china', input), []);
  input.groupings = [{ grouping: { slug: 'womens-singles' }, competitions: input.groupings[1].competitions }];
  assert.deepEqual(mapped('tennis_atp_china_open', input), []);
});
test('Stale provider fallback strips clocks and periods while preserving the last identified teams and scores', () => {
  const source = cached().payload, model = loadModel(), before = plain(source);
  const stale = plain(model.withoutCurrentTime(source));
  assert.equal(stale.stale, true); assert.equal(stale.states[0].clock, null); assert.equal(stale.states[0].period, null);
  assert.equal(stale.states[0].clock_verified, false); assert.equal(stale.states[0].period_verified, false);
  assert.equal(stale.states[0].home_score, 14); assert.equal(stale.states[0].home_team, 'Nebraska Cornhuskers'); assert.deepEqual(plain(source), before);
});
test('Unsupported competitions return explicit unavailable state without borrowing an NFL provider route', async () => {
  const h = harness({ sport: 'soccer_unknown' }), result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.configured, false); assert.equal(result.body.provider, null); assert.deepEqual(result.body.states, []);
  assert.match(result.body.warning, /not available/); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
});
test('Provider fetches current and prior dates, deduplicates competition IDs and saves a short verified cache', async () => {
  const h = harness(), result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.count, 1); assert.equal(result.body.stale, false); assert.equal(result.body.configured, true);
  assert.equal(h.reads.length, 2); assert(h.reads.some(r => r.url.includes('dates=20261010'))); assert(h.reads.some(r => r.url.includes('dates=20261009')));
  assert(h.reads.every(r => r.url.includes('/football/college-football/scoreboard')));
  assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].expires_at, '2026-10-10T17:05:15.000Z');
});
test('Only college football uses its conference group filter; unrelated leagues retain their actual live events', async () => {
  const model = loadModel();
  for (const sport of ['ncaaf', 'nfl', 'nba', 'wnba', 'ncaab', 'nhl', 'epl', 'soccer_usa_mls', 'mma_mixed_martial_arts', 'tennis_atp', 'tennis_wta']) {
    const route = model.routeFor(sport), expectedGroup = sport === 'ncaaf' ? '80' : null;
    let input = event();
    if (route.kind === 'soccer') input = event({ competitionStatus: status(1, "33'", { name: 'STATUS_FIRST_HALF', description: 'First Half' }) });
    if (route.kind === 'combat') {
      input.competitions[0].competitors = [{ athlete: { displayName: 'Melissa Gatto' } }, { athlete: { displayName: 'Ernesta Kareckaite' } }];
    }
    if (route.kind === 'tennis') input = tennisEvent();
    const h = harness({ sport, provider: async url => {
      // ESPN applies groups as a competition filter. A college-football group on
      // soccer produces a valid but empty payload, and other sports may reject it.
      const wrongGroup = new URL(url).searchParams.get('groups') !== expectedGroup;
      if (wrongGroup && ['combat', 'tennis'].includes(route.kind)) return new Response('{}', { status: 502 });
      return new Response(JSON.stringify({ leagues: [{ slug: route.path.split('/')[1] }], events: wrongGroup ? [] : [input] }));
    } });
    const result = await h.request();
    assert.equal(result.status, 200, sport); assert.equal(result.body.count, 1, `${sport}: unfiltered live event remains visible`);
    assert.equal(result.body.states[0].period_verified, true, sport);
    assert.equal(h.reads.length, 2, sport);
    for (const read of h.reads) assert.equal(new URL(read.url).searchParams.get('groups'), expectedGroup, sport);
    if (route.kind === 'soccer') assert.equal(result.body.states[0].clock, '33′');
  }
});
test('Fresh verified cache is usable for under thirty seconds and only for the requested competition', async () => {
  const h = harness({ cache: cached('ncaaf', 10000, 5000) }), result = await h.request();
  assert.equal(result.status, 200); assert.equal(h.reads.length, 0); assert.equal(result.body.states[0].clock, '01:01');
  for (const source of [cached('nba', 10000, 5000), cached('ncaaf', 30000, 60000), cached('ncaaf', -1000, 5000)]) {
    const other = harness({ cache: source }); await other.request(); assert.equal(other.reads.length, 2);
  }
});
test('A failed date cannot incorrectly erase a still-live event; stale fallback removes all current time claims', async () => {
  const h = harness({ cache: cached(), provider: async url => {
    if (url.includes('20261009')) throw new Error('Prior date unavailable');
    return new Response(JSON.stringify({ leagues: [{ slug: 'college-football' }], events: [] }), { status: 200 });
  } }), result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.stale, true); assert.equal(result.body.states[0].home_team, 'Nebraska Cornhuskers');
  assert.equal(result.body.states[0].clock, null); assert.equal(result.body.states[0].period, null); assert.equal(h.writes.length, 0);
});
test('Provider transport and malformed payload failures have bounded, usable unavailable responses', async () => {
  for (const provider of [async () => { throw new Error('Offline'); }, async () => new Response('{}', { status: 200 }), async () => new Response('not JSON', { status: 200 }), async () => new Response('{}', { status: 503 })]) {
    const h = harness({ provider }), result = await h.request(); assert.equal(result.status, 502); assert.equal(result.body.stale, true); assert.deepEqual(result.body.states, []); assert.equal(h.writes.length, 0);
  }
});
test('Old or future HTTP timestamps and aged CDN responses cannot masquerade as fresh verified clocks', async () => {
  for (const headers of [{ Date: new Date(now - 91000).toUTCString() }, { Date: new Date(now + 91000).toUTCString() }, { Age: '91' }, { Age: 'invalid' }]) {
    const h = harness({ provider: async () => new Response(JSON.stringify({ leagues: [{ slug: 'college-football' }], events: [event()] }), { headers }) });
    const result = await h.request(); assert.equal(result.status, 502); assert.deepEqual(result.body.states, []); assert.equal(h.writes.length, 0);
  }
  const h = harness({ provider: async () => new Response(JSON.stringify({ leagues: [{ slug: 'college-football' }], events: [event()] }), { headers: { Date: new Date(now).toUTCString(), Age: '0' } }) });
  assert.equal((await h.request()).body.states[0].clock, '01:01');
});
test('Timeout covers a stalled provider response body, not only headers', async () => {
  const h = harness({ provider: async (url, init) => stalledBody(init.signal) }), started = Date.now(), result = await h.request();
  assert.equal(result.status, 502); assert(Date.now() - started < 1000); assert(h.reads.every(r => r.signal.aborted));
});
test('Cache SDK stalled bodies and failed cache reads or writes cannot prevent verified provider recovery', async () => {
  for (const options of [{ sdkFetch: 'stall' }, { cacheReadError: true }, { cacheWriteError: true }]) {
    const h = harness(options), result = await h.request(); assert.equal(result.status, 200); assert.equal(result.body.states[0].clock, '01:01');
    assert.equal(result.body.stale, false); assert.equal(result.body.count, 1);
  }
});
test('The actual pinned Supabase SDK makes one unavailable cache read and write without delaying verified provider recovery with retries', async () => {
  const h = harness({ realSdk: true, sdkFetch: '503' }), started = Date.now(), result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.states[0].clock, '01:01'); assert.equal(result.body.stale, false);
  const database = h.reads.filter(read => read.url.includes('/rest/v1/'));
  assert.equal(database.filter(read => read.method === 'GET').length, 1);
  assert.equal(database.filter(read => read.method === 'POST').length, 1);
  assert.equal(h.reads.filter(read => read.url.includes('/scoreboard')).length, 2);
  assert(Date.now() - started < 1000, 'Optional cache failure must not incur SDK backoff delays');
});
test('Wrong-league scoreboard responses cannot lend a live clock to the requested league', async () => {
  const h = harness({ provider: async () => new Response(JSON.stringify({ leagues: [{ slug: 'nba' }], events: [event()] }), { status: 200 }) });
  const result = await h.request(); assert.equal(result.status, 502); assert.equal(result.body.stale, true); assert.deepEqual(result.body.states, []); assert.equal(h.writes.length, 0);
});
test('WTA endpoint rejects a provider payload identifying the ATP league even when a live match exists', async () => {
  const h = harness({ sport: 'tennis_wta', provider: async () => new Response(JSON.stringify({ leagues: [{ slug: 'atp' }], events: [tennisEvent()] }), { status: 200 }) });
  const result = await h.request(); assert.equal(result.status, 502); assert.deepEqual(result.body.states, []); assert.equal(h.writes.length, 0);
});
test('MLB endpoint maps StatsAPI linescore without using ESPN status or a fabricated countdown', async () => {
  const h = harness({ sport: 'mlb', provider: async () => new Response(JSON.stringify({ dates: [{ games: [schedule()] }] })) });
  const result = await h.request(); assert.equal(result.status, 200); assert.equal(result.body.provider, 'mlb'); assert.equal(result.body.states[0].period, 'Top 3rd'); assert.equal(result.body.states[0].clock, null);
  assert(h.reads.every(r => r.url.includes('statsapi.mlb.com/api/v1/schedule') && r.url.includes('hydrate=linescore')));
});
test('Input validation, preflight and unsupported methods finish without requesting any provider', async () => {
  const h = harness();
  assert.equal((await h.request('ncaaf', 'OPTIONS')).status, 204);
  assert.equal((await h.request('ncaaf', 'PUT')).status, 405);
  assert.equal((await h.request('ncaaf', 'POST', '{')).status, 400);
  for (const sport of ['', '../nfl', 'soccer/EPL', 'x'.repeat(101)]) assert.equal((await h.request(sport)).status, 400);
  assert.equal(h.reads.length, 0);
});
