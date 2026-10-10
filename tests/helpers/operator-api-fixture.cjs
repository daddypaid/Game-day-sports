const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../..');
const NOW = '2026-10-10T14:00:00.000Z';
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const schemas = {
  profiles:'id', wallets:'id', wagers:'id,stake,potential_return,status,placed_at,is_test',
  wager_selections:'id,sport_key,market_key,result,created_at,wager_id', wallet_transactions:'id,transaction_type,amount,created_at',
  blackjack_hands:'id,stake,payout,status,insurance_stake,insurance_payout,created_at,is_test', roulette_spins:'id,stake,payout,result,created_at,is_test',
  baccarat_rounds:'id,stake,payout,result,created_at,is_test', slot_spins:'id,stake,payout,result,created_at,is_test',
  video_poker_hands:'id,stake,payout,status,result,created_at,is_test', three_card_poker_rounds:'id,ante,decision,payout,status,result,created_at,is_test',
  ultimate_texas_holdem_rounds:'id,ante,blind,play_bet,payout,status,result,created_at,is_test', caribbean_stud_rounds:'id,ante,raise_bet,payout,status,result,created_at,is_test',
  poker_test_hands:'id,game,committed,payout,status,created_at,is_test', themed_slot_bonus_spins:'id,game,payout,created_at',
  sports_events:'id,updated_at', sports_markets:'id', sports_outcomes:'id', sports_line_history:'id', sports_provider_snapshots:'id,captured_at', odds_response_cache:'cache_key,updated_at,expires_at',
};
function baseline() {
  return { sports_provider_snapshots:[{id:1,captured_at:NOW}], odds_response_cache:[{cache_key:'sports',updated_at:NOW,expires_at:'2026-10-10T14:05:00.000Z'}] };
}
function settlement(values={}) {return {pending_count:0,review_required_count:0,provider_error_count:0,check_error_count:0,unchecked_count:0,retry_due_count:0,active_lease_count:0,max_pending_age_seconds:0,oldest_unresolved_at:null,oldest_checked_at:null,last_check_at:NOW,last_attempt_at:NOW,last_success_at:null,...values};}
function monitoring(values={}) {return {pending_count:0,dead_count:0,delivered_count_24h:0,max_pending_age_seconds:0,last_delivery_at:null,last_monitor_at:NOW,delivery_configured:true,...values};}
function fixture(slug, options={}) {
  const trace={clients:[],auth:[],queries:[],rpcs:[]};
  const rows={...baseline(),...options.rows};
  let handler;
  const respond=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...extra}});
  const freshUser=options.user === null ? null : options.user || {id:uuid(100),app_metadata:{role:'operator'},user_metadata:{}};
  async function fetchFixture(input,init={}) {
    const request=input instanceof Request ? input : new Request(input,init),url=new URL(request.url);
    if(url.pathname==='/auth/v1/user') {
      trace.auth.push({url:url.pathname,authorization:request.headers.get('authorization')});
      if(options.authHang)return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});
      if(options.authThrow)throw new Error('private-auth-transport-detail');
      if(options.authError)return respond({msg:options.authError.message||'fixture-auth-error',code:options.authError.code||'unexpected_failure'},options.authError.status);
      if(!freshUser)return respond({msg:'expired token',code:'bad_jwt'},401);
      return respond(freshUser);
    }
    if(url.pathname.startsWith('/rest/v1/rpc/')) {
      const name=url.pathname.split('/').pop();trace.rpcs.push({name,authorization:request.headers.get('authorization'),method:request.method});
      if(options.rpcErrors?.includes(name))return respond({message:'private-rpc-error-detail'},500);
      if(options.rpcHang?.includes(name))return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});
      if(name==='get_test_wager_settlement_health')return respond(options.settlement ?? settlement());
      if(name==='get_operator_alert_health')return respond(options.monitoring ?? monitoring());
      throw new Error('Unexpected privileged RPC '+name);
    }
    if(!url.pathname.startsWith('/rest/v1/'))throw new Error('Unexpected URL '+url.pathname);
    const table=url.pathname.split('/').pop(),params=url.searchParams,columns=params.get('select')||'*';
    trace.queries.push({table,columns,method:request.method,params:Object.fromEntries(params),authorization:request.headers.get('authorization')});
    if(options.failTables?.includes(table))return respond({message:'private-table-schema-detail',code:'42703'},400);
    if(options.hangTables?.includes(table))return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});
    if(!(table in schemas))throw new Error('Unknown table '+table);
    const projection=columns.replace(',wagers!inner(is_test)','').split(',');
    for(const column of projection)if(!schemas[table].split(',').includes(column))return respond({message:'nonexistent column '+column,code:'42703'},400);
    let selected=[...(rows[table]||[])];
    for(const [key,filter]of params){
      if(['select','order','limit','offset'].includes(key))continue;
      const dot=filter.indexOf('.'),operator=filter.slice(0,dot),expected=filter.slice(dot+1);
      selected=selected.filter(row=>{
        let actual=row[key];
        if(key==='wagers.is_test')actual=(rows.wagers||[]).find(wager=>wager.id===row.wager_id)?.is_test;
        if(operator==='eq')return String(actual)===expected;
        if(operator==='lte')return actual<=expected;
        if(operator==='gte')return actual>=expected;
        if(operator==='gt')return actual>expected;
        throw new Error('Unsupported filter '+filter);
      });
    }
    const count=selected.length,order=params.get('order');
    if(order){const [column,direction]=order.split('.');selected.sort((a,b)=>(a[column]>b[column]?1:a[column]<b[column]?-1:0)*(direction==='desc'?-1:1));}
    const limit=Number(params.get('limit')||1000);selected=selected.slice(0,limit).map(row=>Object.fromEntries(projection.map(column=>[column,row[column]])));
    if(options.repeatPage && params.has('id'))selected=(rows[table]||[]).slice(0,limit);
    if(request.method==='HEAD')selected=null;
    const headers=options.missingCounts?.includes(table)?{}:{'content-range':`0-${Math.max(0,count-1)}/${count}`};
    return respond(selected,200,headers);
  }
  const Clock=class extends Date { constructor(...args){super(...(args.length?args:[NOW]));}static now(){return Date.parse(NOW);}};
  const environment={SUPABASE_URL:'https://operator-fixture.invalid',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'};
  const context=vm.createContext({
    Request,Response,Headers,URL,AbortController,Date:Clock,console,Promise,Map,ReadableStream,
    setTimeout:(fn,ms)=>setTimeout(fn,ms>=15000?25:ms),clearTimeout,
    fetch:fetchFixture,
    createClient:(url,key,config)=>{trace.clients.push(key);return createClient(url,key,config);},
    Deno:{env:{get:key=>options.environment?.[key] ?? environment[key]},serve:callback=>{handler=callback;}},
  });
  function load(relative,exports=[]){
    let source=fs.readFileSync(path.join(root,relative),'utf8').replace(/^import\s[^;]+;\s*/gm,'');
    source=stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport /g,'');
    vm.runInContext(`(()=>{${source}\n${exports.map(name=>'globalThis.'+name+'='+name+';').join('\n')}})()`,context,{filename:relative});
  }
  load('supabase/functions/_shared/operator-auth.ts',['operatorHeaders','operatorResponse','operatorFailure','operatorMethod','operatorFetch','bounded','requireOperator','exactCount','allRows','OperatorError']);
  load('supabase/functions/_shared/operator-health.ts',['collectOperatorHealth']);
  load(`supabase/functions/${slug}/index.ts`);
  return {trace,rows,context,async request({method='POST',token='fixture-token',authorization,body}={}){
    const headers={};if(authorization!==undefined)headers.Authorization=authorization;else if(token!==null)headers.Authorization='Bearer '+token;
    const response=await handler(new Request('https://edge-fixture.invalid/'+slug,{method,headers,...(body?{body}:{} )}));
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {response,data};
  }};
}
module.exports={fixture,schemas,baseline,settlement,monitoring,uuid,NOW};
