const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-10T12:00:00.123456Z';
const card = (rank, suit = '♠') => ({ rank: String(rank), suit });
const hand = (...ranks) => ranks.map(rank => card(rank));
const id = n => '33333333-3333-4333-8333-' + String(n).padStart(12, '0');
const games = ['blackjack', 'baccarat', 'roulette', 'jacks-or-better', 'holdem', 'omaha', 'stud', 'draw'];
async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(fs.readFileSync(path.join(root, 'tests/fixtures/card-deal-baseline.sql'), 'utf8'));
  await db.exec(`
    alter table blackjack_hands add column insurance_status text not null default 'not_offered', add column insurance_stake numeric not null default 0, add column insurance_payout numeric not null default 0;
    create table roulette_spins(id uuid primary key default gen_random_uuid(),user_id uuid not null,stake numeric not null,bet_type text not null,bet_value text,winning_number integer not null,winning_color text not null,payout numeric not null,result text not null,is_test boolean not null,created_at timestamptz not null);
    create table video_poker_hands(id uuid primary key default gen_random_uuid(),user_id uuid not null,game text not null,stake numeric not null,initial_hand jsonb not null,final_hand jsonb,deck_remaining jsonb not null,status text not null,result text,multiplier numeric not null,payout numeric not null,is_test boolean not null,created_at timestamptz not null,settled_at timestamptz);
    insert into auth.users values('${A}'),('${B}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261010043551_poker_table_games.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261010122742_casino_table_history_indexes.sql'), 'utf8'));
  const calls = [];
  let handler, fail = false, authenticated = true, authError = null, authHang = false, queryHang = false;
  function projection(columns) {
    return columns.split(',').map(field => {
      if (/^[a-z_]+$/.test(field)) return field;
      const json = /^([a-z_]+):private_state(->>?)([a-zA-Z]+)$/.exec(field);
      assertIdentifier(json?.[1]);
      if (!json) throw new Error('Unexpected select projection');
      return `private_state${json[2]}'${json[3]}' as ${json[1]}`;
    }).join(',');
  }
  function assertIdentifier(value) { if (!/^[a-z_]+$/.test(value || '')) throw new Error('Unexpected identifier'); }
  const admin = { from(table) {
    assertIdentifier(table);
    let columns = '*', pageLimit, ordered = [];
    const clauses = [], parameters = [];
    const parameter = value => { parameters.push(value); return '$' + parameters.length; };
    const q = {
      select(value) { columns = value; return q; },
      eq(key, value) { assertIdentifier(key); clauses.push(`${key}=${parameter(value)}`); return q; },
      in(key, values) { assertIdentifier(key); clauses.push(`${key} in (${values.map(parameter).join(',')})`); return q; },
      not(key, operator, value) { assertIdentifier(key); if (operator !== 'is' || value !== null) throw new Error('Unsupported exclusion'); clauses.push(`${key} is not null`); return q; },
      or(value) {
        const parsed = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([0-9a-f-]+)\)$/.exec(value);
        if (!parsed || parsed[1] !== parsed[2]) throw new Error('Invalid cursor expression');
        const time = parameter(parsed[1]), beforeId = parameter(parsed[3]);
        clauses.push(`(created_at<${time}::timestamptz or (created_at=${time}::timestamptz and id<${beforeId}::uuid))`); return q;
      },
      order(key, options) { assertIdentifier(key); ordered.push(`${key} ${options.ascending ? 'asc' : 'desc'}`); return q; },
      limit(value) { pageLimit = value; return q; },
      then(resolve, reject) {
        calls.push({ table, columns, clauses: [...clauses], parameters: [...parameters], limit: pageLimit });
        const query = `select ${projection(columns)} from ${table} where ${clauses.join(' and ')} order by ${ordered.join(',')} limit ${parameter(pageLimit)}`;
        if (queryHang) return new Promise(() => {});
        if (fail) return Promise.resolve({ data: null, error: { message: 'SHOE_PRIVATE_INTERNAL_DATABASE_FAILURE' } }).then(resolve, reject);
        // PostgREST serializes timestamptz at microsecond precision. Avoid JS Date truncation.
        return db.query(query, parameters).then(async response => {
          for (const row of response.rows) {
            const saved = await db.query(`select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at${row.settled_at ? `,to_char(settled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as settled_at` : ''} from ${table} where id=$1`, [row.id]);
            Object.assign(row, saved.rows[0]);
          }
          return { data: response.rows, error: null };
        }, error => ({ data: null, error })).then(resolve, reject);
      },
    };
    return q;
  } };
  const context = vm.createContext({ Response, Request, Error, Set, Date, Number, JSON, console, setTimeout: (fn, ms) => setTimeout(fn, ms === 15000 ? 500 : ms), clearTimeout, AbortController, fetch() { throw new Error('External access prohibited'); }, Deno: { env: { get: key => key }, serve: fn => handler = fn }, createClient(_url, key, options) {
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') return admin;
    return { auth: { async getUser(token) { calls.push({ auth: true, token }); if (authHang) await new Promise(() => {}); return { data: { user: authenticated && [A, B].includes(token) ? { id: token } : null }, error: authError }; } } };
  } });
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/casino-history-test/index.ts'), 'utf8').replace(/^import .*;\n/gm, '')), context);
  async function send(body, owner = A, method = 'POST') {
    const response = await handler(new Request('https://fixture.invalid', { method, headers: owner ? { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' } : {}, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), ...(method === 'OPTIONS' ? {} : await response.json()) };
  }
  async function insert(game, n, { owner = A, active = false, isTest = true, time = stamp, insurance = false, split = false, showdown = true } = {}) {
    const common = { id: id(n), user_id: owner, created_at: time, is_test: isTest };
    const player = hand(10, 'Q').map(c => ({ ...c, private_marker: 'CARD_SECRET' }));
    let table, row;
    if (game === 'blackjack') {
      const dealerNatural = insurance && !split;
      table = 'blackjack_hands'; row = { ...common, stake: split ? 20 : 10, status: active ? 'active' : dealerNatural ? 'lost' : 'won', player_cards: dealerNatural ? hand(10,6) : player, dealer_cards: dealerNatural ? hand('A','K') : hand('A', 6), shoe: [{ rank: 'SHOE_SECRET', suit: '' }], player_total: dealerNatural ? 16 : 20, dealer_total: dealerNatural ? 21 : 17, payout: split ? 30 : dealerNatural ? 0 : 20, action_count: 1, settled_at: active ? null : time, insurance_status: insurance ? 'accepted' : 'not_offered', insurance_stake: insurance ? 5 : 0, insurance_payout: dealerNatural ? 15 : 0, player_hands: split ? [{ cards: hand(10, 10), stake: 10, status: 'won', total: 20, secret: 'SPLIT_SECRET' }, { cards: hand(10, 7), stake: 10, status: 'push', total: 17, doubled: false }] : null };
    } else if (game === 'baccarat') {
      table = 'baccarat_rounds'; row = { ...common, stake: 10, bet_type: 'banker', player_cards: hand(3, 2), banker_cards: hand(4, 3), player_total: 5, banker_total: 7, result: active ? 'pending' : 'banker', payout: 19.5 };
    } else if (game === 'roulette') {
      table = 'roulette_spins'; row = { ...common, stake: 10, bet_type: 'number', bet_value: '0', winning_number: 0, winning_color: 'green', payout: 360, result: active ? 'pending' : 'won' };
    } else if (game === 'jacks-or-better') {
      table = 'video_poker_hands'; row = { ...common, game: 'jacks_or_better', stake: 10, initial_hand: hand(10, 'J', 'Q', 'K', 'A'), final_hand: active ? null : hand(10, 'J', 'Q', 'K', 'A'), deck_remaining: [{ rank: 'DECK_SECRET', suit: '' }], status: active ? 'active' : 'settled', result: active ? null : 'Royal Flush', multiplier: 800, payout: 8000, settled_at: active ? null : time };
    } else {
      const count = game === 'holdem' ? 2 : game === 'omaha' ? 4 : game === 'draw' ? 5 : 7;
      table = 'poker_test_hands'; row = { ...common, game, status: active ? 'active' : 'settled', action_count: 1, stake: 10, committed: 25, payout: showdown ? 50 : 0, started_request_id: id(n + 10000), last_request_id: id(n + 20000), settled_at: active ? null : time, private_state: { game, status: active ? 'active' : 'settled', result: showdown ? 'You won' : 'You folded', player: hand('A', 'K', 'Q', 'J', 10, 9, 8).slice(0,count), opponent: hand(2, 3, 4, 5, 6, 7, 8).slice(0,count), board: ['holdem', 'omaha'].includes(game) ? hand(2, 3, 4, 5, 6) : [], showdown, playerRank: 'Straight Flush', opponentRank: 'Straight', potCents: 5000, opponentCommittedCents: 2500, deck: [{ rank: 'DECK_SECRET', suit: '' }], arbitrary_private: 'STATE_SECRET' } };
    }
    const keys = Object.keys(row), values = Object.values(row).map(value => typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')})`, values);
    return id(n);
  }
  return { db, calls, send, insert, setFailure(value) { fail = value; }, setAuth(value) { authenticated = value; }, setAuthError(value) { authError = value; }, setAuthHang(value) { authHang = value; }, setQueryHang(value) { queryHang = value; }, close: () => db.close() };
}
module.exports = { fixture, A, B, id, stamp, games, hand };
