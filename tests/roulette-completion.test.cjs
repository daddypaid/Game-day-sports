const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
const requestId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const copy=value=>JSON.parse(JSON.stringify(value));

function service({authenticated=true,spins=[],balance=401,random=[1],lostResponse=false,rpcFailure=null,walletFailure=null}={}){
 const calls=[],queries=[];let handler,randomReads=0;
 const context=vm.createContext({Response,Request,console,Uint32Array,Error,
  crypto:{getRandomValues(a){a[0]=random[randomReads++]??1;return a;}},
  Deno:{env:{get:key=>key},serve:fn=>{handler=fn;}},
  createClient(_url,_key,options){
   if(options)return{auth:{async getUser(){calls.push({operation:'auth'});return{data:{user:authenticated?{id:'customer'}:null},error:null};}}};
   return{
    from(table){let columns=[],filters=[],ordered=false,limit=0;const q={
     select(value){columns=value.split(',');return q;},eq(key,value){filters.push([key,value]);return q;},order(){ordered=true;return q;},limit(value){limit=value;return q;},
     async single(){return q.maybeSingle();},async maybeSingle(){
      queries.push({table,filters:copy(filters),columns});
      if(table==='wallets'&&walletFailure){const error=walletFailure;walletFailure=null;return{data:null,error};}
      let records=table==='wallets'?[{user_id:'customer',balance}]:spins;
      records=records.filter(row=>filters.every(([key,value])=>row[key]===value));
      if(ordered)records=records.toSorted((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
      if(limit)records=records.slice(0,limit);
      if(records.length>1)throw new Error('Expected one owner-filtered record');
      const row=records[0];return{data:row?Object.fromEntries(columns.map(key=>[key,row[key]??null])):null,error:null};
     }
    };return q;},
    async rpc(name,args){
     calls.push({operation:'rpc',name,args:copy(args)});if(rpcFailure)return{data:null,error:rpcFailure};
     assert.equal(name,'play_test_roulette_atomic');
     let row=spins.find(s=>s.user_id===args.p_user_id&&s.request_id===args.p_request_id);
     if(!row){
      balance=+(balance-args.p_stake+args.p_payout).toFixed(2);
      row={id:'server-spin',user_id:args.p_user_id,request_id:args.p_request_id,winning_number:args.p_winning_number,winning_color:args.p_winning_color,bet_type:args.p_bet_type,bet_value:args.p_bet_value,stake:args.p_stake,payout:args.p_payout,result:args.p_result,is_test:true,created_at:'2026-10-10T12:00:00Z'};spins.push(row);
      if(lostResponse)throw new Error('Transport lost after server commit');
     }
     return{data:[{...row,spin_id:row.id,balance}],error:null};
    }
   };
  }
 });
 const source=fs.readFileSync(path.join(root,'supabase/functions/roulette-test/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),context);
 return{calls,queries,spins,context,get balance(){return balance},get randomReads(){return randomReads},setBalance:value=>{balance=value},
  async request(body,method='POST',rawBody){
   const response=await handler(new Request('https://fixture.invalid/roulette-test',{method,headers:{Authorization:'Bearer fixture-customer','Content-Type':'application/json'},...(method==='POST'?{body:rawBody??JSON.stringify(body)}:{})}));
   const text=await response.text();return{status:response.status,body:text==='ok'?text:JSON.parse(text)};
  },evaluate(code){return copy(vm.runInContext(code,context));}
 };
}

const wager=(extra={})=>({stake:5,bet_type:'red',bet_value:null,request_id:requestId,...extra});

test('European roulette math covers all 37 numbers, six outside bets and three columns',()=>{
 const e=service();let checked=0;
 for(let n=0;n<=36;n++){
  assert.equal(e.evaluate('colorOf('+n+')'),n===0?'green':RED.has(n)?'red':'black');
  for(let bet=0;bet<=36;bet++){assert.equal(e.evaluate('settleBet("number","'+bet+'",'+n+')'),bet===n?36:0);checked++;}
  for(const type of ['red','black','odd','even','low','high','column1','column2','column3']){
   let expected=0;
   if(n!==0){
    const won=type==='red'?RED.has(n):type==='black'?!RED.has(n):type==='odd'?n%2===1:type==='even'?n%2===0:type==='low'?n<=18:type==='high'?n>=19:(n-1)%3+1===Number(type.at(-1));
    expected=won?(type.startsWith('column')?3:2):0;
   }
   assert.equal(e.evaluate('settleBet("'+type+'",null,'+n+')'),expected,type+' '+n);checked++;
  }
 }
 assert.equal(checked,1702);
});

test('winning column pays 2:1 profit and losing zero returns no stake',async()=>{
 for(const [type,n,payout] of [['column1',1,15],['column2',2,15],['column3',3,15],['column1',0,0],['even',0,0]]){
  const e=service({random:[n]});const result=await e.request(wager({bet_type:type}));assert.equal(result.status,200);assert.equal(result.body.spin.payout,payout);assert.equal(result.body.balance,396+payout);
 }
});

test('authenticated owner and normalized numbers reach atomic RPC; client result fields are ignored',async()=>{
 for(const input of ['01','1.0',' 1 ',1]){
  const e=service({random:[1]});const result=await e.request(wager({bet_type:'number',bet_value:input,user_id:'victim',winning_number:0,payout:999999}));
  assert.equal(result.status,200);assert.equal(result.body.spin.bet_value,'1');assert.equal(result.body.spin.payout,180);
  const rpc=e.calls.find(c=>c.operation==='rpc');assert.equal(rpc.args.p_user_id,'customer');assert.equal(rpc.args.p_request_id,requestId);assert.equal(rpc.args.p_winning_number,1);assert.equal(rpc.args.p_bet_value,'1');assert.equal(rpc.args.p_payout,180);
  assert(e.queries.some(q=>q.table==='wallets'&&q.filters.some(([key,value])=>key==='user_id'&&value==='customer')));
 }
});

test('invalid stake, number, bet, action and request UUID never reach settlement',async()=>{
 const invalid=[wager({request_id:null}),wager({request_id:'bad'}),wager({request_id:1}),wager({stake:0}),wager({stake:-1}),wager({stake:10000.01}),wager({stake:0.001}),wager({stake:'1'}),wager({stake:true}),wager({bet_type:'column4'}),wager({action:'unexpected'}),...['',null,false,'37','-1','1.2','NaN'].map(bet_value=>wager({bet_type:'number',bet_value}))];
 for(const body of invalid){const e=service();const r=await e.request(body);assert.equal(r.status,400,JSON.stringify(body));assert.equal(e.calls.some(c=>c.operation==='rpc'),false);}
 const e=service();assert.equal((await e.request(null,'POST','{bad')).status,400);assert.equal(e.calls.some(c=>c.operation==='rpc'),false);
});

test('random rejection sampling rejects biased tail before mapping to one of 37 pockets',async()=>{
 const limit=Math.floor(0x100000000/37)*37;const e=service({random:[0xffffffff,limit,36]});const r=await e.request(wager());assert.equal(r.status,200);assert.equal(e.randomReads,3);assert.equal(r.body.spin.winning_number,36);
});

test('stake normalization preserves whole cents and rejects amounts below one cent',async()=>{
 const e=service();const rounded=await e.request(wager({stake:0.1+0.2}));assert.equal(rounded.status,200);assert.equal(rounded.body.spin.stake,0.3);assert.equal(e.calls.find(c=>c.operation==='rpc').args.p_stake,0.3);
 const tiny=service();assert.equal((await tiny.request(wager({stake:0.0000000001}))).status,400);assert.equal(tiny.calls.some(c=>c.operation==='rpc'),false);
});

test('read state and latest are owner-filtered, do not wager and return current wallet balance',async()=>{
 const own={id:'own-spin',user_id:'customer',request_id:requestId,winning_number:1,winning_color:'red',bet_type:'red',bet_value:null,stake:5,payout:10,result:'won',is_test:true,created_at:'2026-10-09T12:00:00Z'};
 const victim={...own,id:'victim-spin',user_id:'victim',request_id:otherId,created_at:'2026-10-10T12:00:00Z'};
 const e=service({spins:[own,victim],balance:333});
 const state=await e.request({action:'state',request_id:requestId,user_id:'victim'});assert.equal(state.body.spin.id,'own-spin');assert.equal(state.body.balance,333);assert.equal(state.body.spin.balance,333);
 const foreign=await e.request({action:'state',request_id:otherId});assert.equal(foreign.body.spin,null);
 const latest=await e.request({action:'latest'});assert.equal(latest.body.spin.id,'own-spin');assert.equal(e.calls.some(c=>c.operation==='rpc'),false);assert.equal(e.randomReads,0);
 for(const query of e.queries)assert(query.filters.some(([key,value])=>key==='user_id'&&value==='customer'));
 const none=service();assert.equal((await none.request({action:'latest'})).body.spin,null);
 assert.equal((await e.request({action:'state'})).status,400);
});

test('retry returns original stored wheel result and fresh balance rather than regenerated outcome',async()=>{
 const e=service({random:[1,0]});const first=await e.request(wager());e.setBalance(123);const replay=await e.request(wager());assert.equal(first.body.spin.id,replay.body.spin.id);assert.equal(replay.body.spin.winning_number,1);assert.equal(replay.body.spin.payout,10);assert.equal(replay.body.balance,123);assert.equal(e.spins.length,1);
});

test('a lost response after commit can recover by UUID without another wallet mutation',async()=>{
 const e=service({lostResponse:true});assert.equal((await e.request(wager())).status,400);assert.equal(e.spins.length,1);assert.equal(e.balance,406);
 const recovered=await e.request({action:'state',request_id:requestId});assert.equal(recovered.status,200);assert.equal(recovered.body.spin.id,'server-spin');assert.equal(recovered.body.balance,406);assert.equal(e.calls.filter(c=>c.operation==='rpc').length,1);
 const rejected=service({rpcFailure:new Error('RPC unavailable')});assert.equal((await rejected.request(wager())).status,400);assert.equal((await rejected.request({action:'state',request_id:requestId})).body.spin,null);
});

test('authentication, method and CORS checks precede privileged wallet access',async()=>{
 const anonymous=service({authenticated:false});assert.equal((await anonymous.request(wager())).status,401);assert.equal(anonymous.calls.some(c=>c.operation==='rpc'),false);assert.equal(anonymous.queries.length,0);
 const e=service();assert.equal((await e.request({},'GET')).status,405);assert.equal((await e.request({},'OPTIONS')).body,'ok');assert.equal(e.calls.length,0);
});

test('definitive validation and transactional rollback allow editing the wager',async()=>{
 const validation=service();const invalid=await validation.request(wager({stake:0}));assert.equal(invalid.body.spin_rejected,true);assert.equal(validation.calls.some(c=>c.operation==='rpc'),false);
 const action=service();assert.equal((await action.request(wager({action:'unexpected'}))).body.spin_rejected,true);
 const rejected=service({rpcFailure:{code:'P0001',message:'Insufficient test balance'}});const response=await rejected.request(wager());assert.equal(response.status,400);assert.equal(response.body.error,'Insufficient test balance');assert.equal(response.body.spin_rejected,true);assert.equal(rejected.spins.length,0);assert.equal(rejected.balance,401);
 const anonymous=service({authenticated:false});const auth=await anonymous.request(wager());assert.equal(auth.status,401);assert.equal(auth.body.spin_rejected,true);assert.equal(anonymous.calls.some(c=>c.operation==='rpc'),false);
});

test('transport and post-commit wallet read failures keep the spin outcome unknown',async()=>{
 const unavailable=service({rpcFailure:{message:'Failed to fetch'}});const failed=await unavailable.request(wager());assert.equal(failed.status,400);assert.equal(failed.body.spin_rejected,false);
 const lost=service({lostResponse:true});assert.equal((await lost.request(wager())).body.spin_rejected,false);assert.equal(lost.spins.length,1);
 const committed=service({walletFailure:{code:'P0001',message:'Balance response unavailable'}});const result=await committed.request(wager());assert.equal(result.status,400);assert.equal(result.body.spin_rejected,false);assert.equal(committed.spins.length,1);assert.equal(committed.balance,406);
 const recovered=await committed.request({action:'state',request_id:requestId});assert.equal(recovered.body.spin.id,'server-spin');assert.equal(recovered.body.balance,406);assert.equal(committed.calls.filter(c=>c.operation==='rpc').length,1);
});

test('read-only state and latest errors never declare a pending spin rejected',async()=>{
 const invalid=service();assert.equal((await invalid.request({action:'state'})).body.spin_rejected,false);
 for(const action of ['state','latest']){
  const anonymous=service({authenticated:false});const auth=await anonymous.request({action,request_id:requestId});assert.equal(auth.status,401);assert.equal(auth.body.spin_rejected,false);
  const broken=service({walletFailure:{code:'P0001',message:'Wallet lookup failed'}});const response=await broken.request({action,request_id:requestId});assert.equal(response.status,400);assert.equal(response.body.spin_rejected,false);assert.equal(broken.calls.some(c=>c.operation==='rpc'),false);
 }
});

test('migration serializes owner request recovery before debit and restricts RPC to service role',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261010021011_roulette_complete.sql'),'utf8');
 assert.match(sql,/on public\.roulette_spins \(user_id, request_id\)/);
 assert.match(sql,/p_request_id uuid default null/);
 assert(sql.indexOf('for update')<sql.indexOf('if p_request_id is not null'));
 assert(sql.indexOf('if p_request_id is not null')<sql.indexOf('if v_balance < p_stake'));
 assert(sql.indexOf('if p_request_id is not null')<sql.indexOf('set balance = w.balance - p_stake'));
 assert.match(sql,/s\.user_id = p_user_id and s\.request_id = p_request_id/);
 assert.match(sql,/Request ID already used for a different wager/);
 assert.match(sql,/elsif p_winning_number <> 0 then/);
 for(let n=1;n<=3;n++)assert.match(sql,new RegExp("p_bet_type = 'column"+n+"'.*then 3"));
 assert.match(sql,/p_payout is distinct from v_payout/);
 assert.match(sql,/from public,anon,authenticated/);
 assert.match(sql,/to service_role/);
});
