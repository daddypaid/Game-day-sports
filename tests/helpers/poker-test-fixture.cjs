const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const root = path.resolve(__dirname, '../..');
const migration = path.resolve(root, 'supabase/migrations/20261010042617_poker_table_games.sql');
const setupSQL = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
insert into auth.users values('${user}'),('${other}');
create type public.wallet_transaction_type as enum ('wager_debit','wager_credit','refund');
create table public.wallets(user_id uuid primary key references auth.users(id), balance numeric(14,2) not null check(balance>=0), updated_at timestamptz not null default now());
create table public.wallet_transactions(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), transaction_type public.wallet_transaction_type not null, amount numeric(14,2) not null check(amount>0), balance_after numeric(14,2), note text);
insert into public.wallets(user_id,balance) values('${user}',1000),('${other}',1000);
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
`;
function engineExports() {
  const source = stripTypeScriptTypes(fs.readFileSync(path.resolve(root, 'supabase/functions/poker-test/engine.ts'), 'utf8')).replace(/^export /gm, '');
  const context = vm.createContext({ crypto: webcrypto, Uint32Array, structuredClone, console });
  vm.runInContext(source + '\nthis.exports = { startGame, actGame, publicHand };', context);
  return context.exports;
}
module.exports = { user, other, root, migration, setupSQL, engineExports };
