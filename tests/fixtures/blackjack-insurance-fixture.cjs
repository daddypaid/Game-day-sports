const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const card=rank=>({rank:String(rank),suit:'♠'}),cards=(...ranks)=>ranks.map(card);
async function fixture({player=cards(10,6),dealer=cards('A','K'),draws=cards(8),stake=1,balance=100}={}){
 const db=new PGlite();await db.waitReady;
 for(const file of ['tests/fixtures/card-deal-baseline.sql','supabase/migrations/20260912060000_add_blackjack_double_split.sql','supabase/migrations/20261010104826_card_deal_request_recovery.sql','supabase/migrations/20261010120032_blackjack_insurance_decision.sql'])await db.exec(fs.readFileSync(path.join(root,file),'utf8'));
 await db.query('insert into auth.users values($1),($2)',[A,B]);await db.query('insert into wallets(user_id,balance) values($1,$2),($3,100)',[A,balance,B]);
 let handler;
 const admin={from(table){const filters=[];let ordered=false,limited=false;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){ordered=true;return q},limit(){limited=true;return q},async single(){return q.maybeSingle()},async maybeSingle(){try{const r=await db.query(`select * from ${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}${ordered?' order by created_at desc':''}${limited?' limit 1':''}`,filters.map(([,v])=>v));return{data:r.rows[0]||null,error:null}}catch(e){return{data:null,error:{message:e.message}}}}};return q},async rpc(name,p){try{const r=await db.query(`select * from ${name}(${Object.keys(p).map((k,i)=>`${k}=>$${i+1}`).join(',')})`,Object.values(p).map(v=>Array.isArray(v)?JSON.stringify(v):v));return{data:r.rows,error:null}}catch(e){return{data:null,error:{message:e.message}}}}};
 const ctx=vm.createContext({Response,Request,Error,Uint32Array,crypto:webcrypto,console,Deno:{env:{get:k=>k},serve:fn=>handler=fn},createClient(_url,_key,options){if(!options)return admin;const id=options.global.headers.Authorization.replace('Bearer ','');return{auth:{getUser:async()=>({data:{user:[A,B].includes(id)?{id}:null},error:null})}}}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/blackjack-test/index.ts'),'utf8').replace(/^import .*;\n/gm,'')),ctx);
 ctx.shuffle=()=>[...draws.toReversed(),dealer[1],dealer[0],player[1],player[0]];
 async function send(body,id=A){const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer '+id},body:JSON.stringify(body)}));return{httpStatus:response.status,...await response.json()};}
 const start=()=>send({action:'start',stake,request_id:requestId,supports_insurance:true});
 const wallet=async(id=A)=>Number((await db.query('select balance from wallets where user_id=$1',[id])).rows[0].balance);
 const ledger=async()=> (await db.query('select transaction_type,amount,note from wallet_transactions order by id')).rows;
 return{db,send,start,wallet,ledger,handler};
}

module.exports={fixture,A,B,cards};
