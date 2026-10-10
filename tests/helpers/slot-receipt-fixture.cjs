// Isolated PostgreSQL and current Edge-function loader for browser roundtrips.
// All auth/service calls stay inside this fixture; no hosted Supabase calls.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { PGlite } = require(process.env.GAMEDAY_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const migration = path.join(root, 'supabase/migrations/20261010110730_slot_request_receipts.sql');
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${user}'),('${other}');
    create table wallets(user_id uuid primary key references auth.users(id),balance numeric(14,2) check(balance>=0),updated_at timestamptz default now());
    insert into wallets(user_id,balance) values('${user}',1000),('${other}',1000);
    create table wallet_transactions(id uuid primary key default gen_random_uuid(),user_id uuid,transaction_type text,amount numeric,balance_after numeric,note text);
    create table slot_spins(id uuid primary key default gen_random_uuid(),user_id uuid,stake numeric,reels jsonb,payout numeric,result text,is_test boolean);
    create table themed_slot_bonus_sessions(id uuid primary key default gen_random_uuid(),user_id uuid,game text,bet_per_line numeric,spins_remaining int,total_spins int,total_payout numeric,status text,updated_at timestamptz default now());
    create unique index active_bonus on themed_slot_bonus_sessions(user_id,game) where status='active';
    create table themed_slot_bonus_spins(id uuid primary key default gen_random_uuid(),session_id uuid,user_id uuid,game text,grid jsonb,payout numeric,feature text);
  `);
  await db.exec(fs.readFileSync(path.join(root, 'tests/fixtures/slot-settlement-rpcs.sql'), 'utf8'));
  await db.exec('begin;\n' + fs.readFileSync(migration, 'utf8') + '\ncommit;');
  const counts = async () => (await db.query(`select
    (select count(*)::int from slot_spins) spins,
    (select count(*)::int from themed_slot_bonus_spins) bonus_spins,
    (select count(*)::int from wallet_transactions) ledger,
    (select count(*)::int from slot_request_receipts) receipts`)).rows[0];
  const wallet = async owner => Number((await db.query('select balance from wallets where user_id=$1', [owner || user])).rows[0].balance);
  return { db, counts, wallet };
}
function handler(file, db, options={}) {
  const state = { owner:user, authenticated:true, ...options };
  let serve; const calls=[];
  const context = vm.createContext({ console, Response, Request, Error, Uint32Array, JSON,Number,Math,Set,crypto:webcrypto,
    Deno:{env:{get:name=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[name]},serve:fn=>{serve=fn;}},
    createClient(_url,key) {
      if(key==='anon') return {auth:{getUser:async()=>({data:{user:state.authenticated?{id:state.owner}:null},error:null})}};
      return {
        from(table) {
          const filters=[]; const builder={select(){return builder;},eq(c,v){filters.push([c,v]);return builder;},
            async single(){return read(false);},async maybeSingle(){return read(true);}};
          async function read(optional) {
            const r = await db.query(`select * from ${table} where ${filters.map(([c],i)=>`${c}=$${i+1}`).join(' and ')}`,filters.map(([,v])=>v));
            return {data:r.rows[0]||null,error:!optional&&!r.rows.length?new Error('Missing session'):null};
          }
          return builder;
        },
        async rpc(name,args) {
          calls.push({name,args:clone(args)});
          try {
            let result;
            if(name==='get_slot_request_receipt') result=await db.query('select public.get_slot_request_receipt($1::uuid,$2::uuid,$3::text,$4::jsonb) value',[args.p_user_id,args.p_request_id,args.p_game,args.p_payload===null?null:JSON.stringify(args.p_payload)]);
            else if(name==='settle_slot_request_atomic') result=await db.query('select public.settle_slot_request_atomic($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::jsonb) value',[args.p_user_id,args.p_request_id,args.p_game,args.p_action,JSON.stringify(args.p_payload),JSON.stringify(args.p_response),JSON.stringify(args.p_settlement)]);
            else if(name==='get_slot_request_history') {
              result=await db.query('select * from public.get_slot_request_history($1::uuid,$2::int,$3::timestamptz,$4::uuid)',[args.p_user_id,args.p_limit,args.p_before_created_at,args.p_before_id]);
              return {data:result.rows,error:null};
            } else throw new Error('Unexpected RPC '+name);
            return {data:result.rows[0].value,error:null};
          } catch(e) { return {data:null,error:{message:e.message}}; }
        }
      };
    }
  });
  const source=fs.readFileSync(path.join(root,'supabase/functions',file,'index.ts'),'utf8').replace(/^import .*\n/gm,'');
  vm.runInContext(stripTypeScriptTypes(source),context);
  return { state,calls,async request(body,method='POST') {
    const response=await serve(new Request('https://fixture.invalid',{method,headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
    return {status:response.status,body:await response.json()};
  }};
}

module.exports = { fixture, handler, user, other };
