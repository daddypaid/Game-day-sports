const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration='supabase/migrations/20261010131427_operator_monitoring_alert_outbox.sql';
const transitionMigration='supabase/migrations/20261010133524_operator_alert_transition_sequence.sql';
let database;
async function db() {
  if(!database){database=new PGlite();await database.waitReady;await database.exec('create role anon;create role authenticated;create role service_role bypassrls;');await database.exec(fs.readFileSync(path.join(root,migration),'utf8'));await database.exec(fs.readFileSync(path.join(root,transitionMigration),'utf8'));}
  await database.exec('truncate operator_alert_outbox,operator_monitor_checks,operator_monitor_state,operator_monitor_delivery_config cascade;');
  return database;
}
after(async()=>{await database?.close();});
const observed=(step=0)=>new Date(Date.now()-120000+step*1000).toISOString();
const measured=(status,key='database')=>({key,label:'Database',status,detail:'Measured aggregate health only',measured:true});
const record=(database,checks,time=observed())=>database.query('select record_operator_health_alerts($1::jsonb,$2::timestamptz) as count',[JSON.stringify(checks),time]);
const config={url:'https://alerts.example.test/webhook',signingSecret:'fixture-signing-secret-at-least-32-characters'};
let helpers;
function loadHelper(){
  if(helpers)return helpers;
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/_shared/operator-alerts.ts'),'utf8').replace(/^export /gm,'').replace(/^import .+;\n/gm,''),{mode:'strip'});
  const context=vm.createContext({crypto:webcrypto,TextEncoder,URL,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms===90000?800:ms===15000?40:ms),clearTimeout,fetch,Date,Response,Request});
  const authSource=stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/_shared/operator-auth.ts'),'utf8').replace(/^import .+;\n/gm,''),{mode:'transform'}).replace(/^export /gm,'');
  vm.runInContext(authSource+'\nthis.bounded=bounded;this.operatorFetch=operatorFetch;',context);
  vm.runInContext(source+'\nthis.exports={validAlertConfiguration,deliverOperatorAlert,dispatchOperatorAlerts,bounded,operatorFetch};',context);
  return helpers=context.exports;
}
function adminFor(database,{failAcknowledgement=false}={}) {
  return {async rpc(name,args={}){
    try {
      if(name==='claim_operator_alerts')return {data:(await database.query('select * from claim_operator_alerts($1)',[args.p_limit])).rows,error:null};
      if(name==='finish_operator_alert'){
        if(failAcknowledgement)return {data:null,error:{message:'fixture acknowledgement failed'}};
        return {data:(await database.query('select finish_operator_alert($1,$2,$3,$4) as result',[args.p_alert_id,args.p_lease_id,args.p_delivered,args.p_error_code])).rows[0].result,error:null};
      }
      if(name==='record_operator_health_alerts')return {data:(await record(database,args.p_checks,args.p_observed_at)).rows[0].count,error:null};
      throw new Error('Unknown fixture RPC');
    } catch(error){return {data:null,error:{message:error.message}};}
  }};
}
async function sink(onRequest){
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    await onRequest(req,res,body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/alerts`,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
const localConfig=url=>({...config,url,allowLocalHttpForTest:true});

const signatures=['configure_operator_alert_delivery(text,text)','record_operator_health_alerts(jsonb,timestamptz)','claim_operator_alerts(integer)','finish_operator_alert(uuid,uuid,boolean,text)','get_operator_alert_health()'];
test('Alert secrets, delivery config, queue and RPCs are inaccessible to customer and anonymous roles',async()=>{
  const database=await db();
  for(const signature of signatures){const row=(await database.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') c,has_function_privilege('service_role',$1,'EXECUTE') s",[signature])).rows[0];assert.deepEqual(row,{a:false,c:false,s:true});}
  for(const table of ['operator_monitor_job_secret','operator_monitor_delivery_config','operator_monitor_checks','operator_alert_outbox','operator_monitor_state']){
    const row=(await database.query("select has_table_privilege('authenticated',$1,'SELECT') as exposed,(select relrowsecurity from pg_class where relname=$1) as rls",[table])).rows[0];assert.deepEqual(row,{exposed:false,rls:true});
  }
});
test('Measured incident transitions enqueue once, recover once, and ignore stale collector responses',async()=>{
  const database=await db();
  assert.equal((await record(database,[measured('healthy')],observed(0))).rows[0].count,0);
  assert.equal((await record(database,[measured('stale')],observed(1))).rows[0].count,1);
  assert.equal((await record(database,[measured('stale')],observed(2))).rows[0].count,0);
  assert.equal((await record(database,[measured('degraded')],observed(3))).rows[0].count,1);
  assert.equal((await record(database,[measured('healthy')],observed(4))).rows[0].count,1);
  assert.equal((await record(database,[measured('degraded')],observed(3))).rows[0].count,0);
  assert.equal((await record(database,[measured('stale')],observed(5))).rows[0].count,1);
  const rows=(await database.query('select incident_number,event_type,health_status from operator_alert_outbox order by created_at,id')).rows;
  assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.event_type==='opened').length,2);assert.equal(rows.filter(r=>r.event_type==='recovered').length,1);
});
test('Alert payloads omit customer identifiers and reject unmeasured/future observations',async()=>{
  const database=await db();await record(database,[{...measured('degraded'),email:'private@example.test',user_id:'private-user',wallet_balance:42}]);
  const payload=(await database.query('select payload from operator_alert_outbox')).rows[0].payload;
  assert(!JSON.stringify(payload).includes('private'));assert.equal(payload.mode,'TEST MODE');
  await assert.rejects(record(database,[{...measured('healthy'),measured:false}],observed(2)),/Invalid measured/);
  await assert.rejects(record(database,[measured('healthy')],new Date(Date.now()+3600000).toISOString()),/observation time/);
});
test('Missing configuration leaves alerts durably pending without consuming an attempt',async()=>{
  const database=await db();await record(database,[measured('stale')]);
  const result=await loadHelper().dispatchOperatorAlerts(adminFor(database),{url:'',signingSecret:''});
  assert.equal(result.configured,false);assert.deepEqual((await database.query('select attempts,state from operator_alert_outbox')).rows[0],{attempts:0,state:'pending'});
});
test('Production delivery requires a signed HTTPS endpoint and disallows credentials/private addresses',()=>{
  const {validAlertConfiguration}=loadHelper();assert(validAlertConfiguration(config));
  for(const url of ['http://alerts.example.test','https://localhost/a','https://127.0.0.1/a','https://[::1]/a','https://metadata.google.internal/a','https://a.local/a','https://user:pass@alerts.example.test/a','https://alerts.example.test/a#fragment'])assert.equal(validAlertConfiguration({...config,url}),false,url);
  assert.equal(validAlertConfiguration({...config,signingSecret:'short'}),false);
});
test('Actual HTTP sink verifies HMAC and stable alert identity before queue delivery acknowledgement',async()=>{
  const database=await db();await record(database,[measured('degraded')]);let accepted=0;
  const server=await sink((req,res,body)=>{
    const expected='v1='+createHmac('sha256',config.signingSecret).update(req.headers['x-gameday-sent-at']+'.'+body).digest('hex');
    assert.equal(req.headers['x-gameday-signature'],expected);assert.equal(JSON.parse(body).alert_id,req.headers['x-gameday-alert-id']);accepted++;res.writeHead(204);res.end();
  });
  try{const result=await loadHelper().dispatchOperatorAlerts(adminFor(database),localConfig(server.url));assert.equal(result.delivered,1);assert.equal(result.failed,0);assert.equal(accepted,1);assert.equal((await database.query('select state from operator_alert_outbox')).rows[0].state,'delivered');}
  finally{await server.close();}
});
test('HTTP rejection schedules a bounded retry and stores no sensitive sink body',async()=>{
  const database=await db();await record(database,[measured('degraded')]);
  const server=await sink((_req,res)=>{res.writeHead(503);res.end('Sensitive sink response fixture-secret and private URL');});
  try{const result=await loadHelper().dispatchOperatorAlerts(adminFor(database),localConfig(server.url));assert.equal(result.failed,1);const row=(await database.query('select state,attempts,last_error_code,extract(epoch from next_attempt_at-now()) as delay from operator_alert_outbox')).rows[0];assert.equal(row.state,'pending');assert.equal(row.attempts,1);assert.equal(row.last_error_code,'http_503');assert(Number(row.delay)>13&&Number(row.delay)<=15);}
  finally{await server.close();}
});
test('Unknown acknowledgement retries with same ID and receiver deduplication prevents a second notification',async()=>{
  const database=await db();await record(database,[measured('degraded')]);let requests=0;const delivered=new Set();
  const server=await sink((req,res)=>{requests++;delivered.add(req.headers['x-gameday-alert-id']);res.writeHead(204);res.end();});
  try{
    await assert.rejects(loadHelper().dispatchOperatorAlerts(adminFor(database,{failAcknowledgement:true}),localConfig(server.url)),/acknowledgement unavailable/);
    await database.exec("update operator_alert_outbox set leased_until=now()-interval '1 second'");
    const result=await loadHelper().dispatchOperatorAlerts(adminFor(database),localConfig(server.url));assert.equal(result.delivered,1);assert.equal(requests,2);assert.equal(delivered.size,1);
  }finally{await server.close();}
});
test('Active leases exclude concurrent claims and stale acknowledgements cannot finish a newer lease',async()=>{
  const database=await db();await record(database,[measured('stale')]);
  const first=(await database.query('select * from claim_operator_alerts(20)')).rows[0];assert.equal((await database.query('select * from claim_operator_alerts(20)')).rows.length,0);
  await database.exec("update operator_alert_outbox set leased_until=now()-interval '1 second'");
  const next=(await database.query('select * from claim_operator_alerts(20)')).rows[0];assert.notEqual(first.lease_id,next.lease_id);
  assert.equal((await database.query('select finish_operator_alert($1,$2,true,null) as result',[first.alert_id,first.lease_id])).rows[0].result,false);
  assert.equal((await database.query('select finish_operator_alert($1,$2,true,null) as result',[next.alert_id,next.lease_id])).rows[0].result,true);
});
test('Eight unsuccessful deliveries stop automatic retries and appear in dead-letter health',async()=>{
  const database=await db();await record(database,[measured('stale')]);
  for(let i=0;i<8;i++){
    await database.exec('update operator_alert_outbox set next_attempt_at=now()');
    const row=(await database.query('select * from claim_operator_alerts(1)')).rows[0];assert.equal(row.attempt,i+1);
    await database.query('select finish_operator_alert($1,$2,false,\'http_503\')',[row.alert_id,row.lease_id]);
  }
  assert.equal((await database.query('select * from claim_operator_alerts(20)')).rows.length,0);
  const health=(await database.query('select get_operator_alert_health() as health')).rows[0].health;assert.equal(health.dead_count,1);assert.equal(health.pending_count,0);
});
test('Worker termination on final attempt becomes a dead letter after its lease expires',async()=>{
  const database=await db();await record(database,[measured('stale')]);
  await database.exec('update operator_alert_outbox set attempts=7');await database.query('select * from claim_operator_alerts(1)');
  await database.exec("update operator_alert_outbox set leased_until=now()-interval '1 second'");await database.query('select * from claim_operator_alerts(1)');
  assert.deepEqual((await database.query('select state,attempts,last_error_code from operator_alert_outbox')).rows[0],{state:'dead',attempts:8,last_error_code:'delivery_unknown'});
});
test('Actual hung HTTP request aborts within deadline and records timeout',async()=>{
  const server=await sink(()=>{});const started=Date.now();
  try{const result=await loadHelper().deliverOperatorAlert({alert_id:'fixture-alert',payload:measured('stale')}, {...localConfig(server.url),timeoutMs:40});assert.equal(result.errorCode,'timeout');assert(Date.now()-started<1000);}
  finally{await server.close();}
});
test('HTTP redirects cannot forward an alert signature or payload to another destination',async()=>{
  let forwarded=0;const destination=await sink((_req,res)=>{forwarded++;res.end();});
  const server=await sink((_req,res)=>{res.writeHead(302,{Location:destination.url});res.end();});
  try{const result=await loadHelper().deliverOperatorAlert({alert_id:'fixture-alert',payload:measured('stale')},localConfig(server.url));assert.equal(result.delivered,false);assert.equal(result.errorCode,'network_error');assert.equal(forwarded,0);}
  finally{await server.close();await destination.close();}
});
test('Service-only delivery configuration can be stored without exposing credentials in health metadata',async()=>{
  const database=await db();await database.query('select configure_operator_alert_delivery($1,$2)',[config.url,config.signingSecret]);
  const health=JSON.stringify((await database.query('select get_operator_alert_health() as health')).rows[0].health);assert(!health.includes(config.url));assert(!health.includes(config.signingSecret));
  await assert.rejects(database.query('select configure_operator_alert_delivery($1,$2)',['http://alerts.example.test','short']),/Invalid alert delivery/);
});

function loadMonitor(admin,{env={},healthError=false,deliveryFetch=async()=>new Response(null,{status:204}),clientFactory}={}){
  let handler,healthReads=0,deliveries=0;
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/gameday-operator-monitor/index.ts'),'utf8').replace(/^import .+;\n/gm,''),{mode:'strip'});
  const {bounded,operatorFetch}=loadHelper();
  const context=vm.createContext({crypto:webcrypto,TextEncoder,Response,Request,Date,AbortController,bounded,operatorFetch,setTimeout:(fn,ms)=>setTimeout(fn,ms===90000?500:ms),clearTimeout,createClient:clientFactory||(()=>admin),
    Deno:{env:{get:name=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',...env})[name]},serve:fn=>{handler=fn;}},
    collectOperatorHealth:async()=>{healthReads++;if(healthError)throw new Error('Sensitive backend error');return {ok:true,mode:'TEST MODE',overall:'degraded',generated_at:new Date().toISOString(),checks:[measured('degraded')]};},
    dispatchOperatorAlerts:async(client,configuration)=>loadHelper().dispatchOperatorAlerts(client,configuration,async(...args)=>{deliveries++;return deliveryFetch(...args);})
  });
  vm.runInContext(source,context);return {handler,get healthReads(){return healthReads;},get deliveries(){return deliveries;}};
}
function monitorAdmin(database,{secret='a'.repeat(64),configuration=null}={}){
  const admin=adminFor(database);admin.from=table=>{
    if(table==='operator_monitor_state')return {async upsert(value){try{await database.query('insert into operator_monitor_state(singleton,checked_at,overall_status,delivery_configured,delivered_count,failed_count) values(true,$1,$2,$3,$4,$5) on conflict(singleton) do update set checked_at=excluded.checked_at,overall_status=excluded.overall_status,delivery_configured=excluded.delivery_configured,delivered_count=excluded.delivered_count,failed_count=excluded.failed_count',[value.checked_at,value.overall_status,value.delivery_configured,value.delivered_count,value.failed_count]);return {error:null};}catch(error){return {error};}}};
    return {select(){return this;},eq(){return this;},async single(){return {data:secret?{secret}:null,error:null};},async maybeSingle(){return {data:configuration,error:null};}};
  };return admin;
}
const jobToken='a'.repeat(64);
test('Monitor rejects customer JWTs and incorrect job tokens before reading aggregate health',async()=>{
  const database=await db(),monitor=loadMonitor(monitorAdmin(database));
  for(const headers of [{Authorization:'Bearer customer-fixture-token'},{'x-gameday-job-token':'incorrect'},{'x-gameday-job-token':'b'.repeat(64)}]){
    const response=await monitor.handler(new Request('https://fixture.test/monitor',{method:'POST',headers}));assert.equal(response.status,401);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(monitor.healthReads,0);assert.equal(monitor.deliveries,0);
  assert.equal((await database.query('select count(*)::int n from operator_alert_outbox')).rows[0].n,0);
});
test('Authenticated scheduled monitor records measured alerts while clearly reporting unconfigured delivery',async()=>{
  const database=await db(),monitor=loadMonitor(monitorAdmin(database));
  const response=await monitor.handler(new Request('https://fixture.test/monitor',{method:'POST',headers:{'x-gameday-job-token':jobToken}}));
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.configured,false);assert.equal(result.enqueued,1);assert.equal(result.delivered,0);
  assert.deepEqual((await database.query('select delivery_configured,overall_status from operator_monitor_state')).rows[0],{delivery_configured:false,overall_status:'degraded'});
});
test('Scheduled monitor can use private database delivery config and exposes no URL or signing secret',async()=>{
  const database=await db();const admin=monitorAdmin(database,{configuration:{webhook_url:config.url,signing_secret:config.signingSecret}});const monitor=loadMonitor(admin);
  const response=await monitor.handler(new Request('https://fixture.test/monitor',{method:'POST',headers:{'x-gameday-job-token':jobToken}}));const result=await response.json();
  assert.equal(result.configured,true);assert.equal(result.delivered,1);assert.equal(monitor.deliveries,1);assert(!JSON.stringify(result).includes(config.url));assert(!JSON.stringify(result).includes(config.signingSecret));assert(!JSON.stringify(result).includes(jobToken));
});
test('Misconfigured or failed scheduled monitoring returns a bounded sanitized failure',async()=>{
  const database=await db();
  const headers={'x-gameday-job-token':jobToken};
  const unconfigured=loadMonitor(monitorAdmin(database),{env:{SUPABASE_URL:undefined}});assert.equal((await unconfigured.handler(new Request('https://fixture.test/monitor',{method:'POST',headers}))).status,503);
  const missingSecret=loadMonitor(monitorAdmin(database,{secret:null}));assert.equal((await missingSecret.handler(new Request('https://fixture.test/monitor',{method:'POST',headers}))).status,503);
  const failed=loadMonitor(monitorAdmin(database),{healthError:true});const response=await failed.handler(new Request('https://fixture.test/monitor',{method:'POST',headers:{'x-gameday-job-token':jobToken}}));assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('Sensitive'));
  assert.equal((await failed.handler(new Request('https://fixture.test/monitor',{method:'GET'}))).status,405);
});

test('Recovery notifications wait for earlier pending alerts from the same check',async()=>{
  const database=await db();await record(database,[measured('degraded')],observed(0));await record(database,[measured('healthy')],observed(1));
  const first=(await database.query('select * from claim_operator_alerts(20)')).rows;assert.equal(first.length,1);assert.equal(first[0].payload.event_type,'opened');
  await database.query('select finish_operator_alert($1,$2,false,\'http_503\')',[first[0].alert_id,first[0].lease_id]);
  assert.equal((await database.query('select * from claim_operator_alerts(20)')).rows.length,0);
  await database.exec('update operator_alert_outbox set next_attempt_at=now()');
  const retry=(await database.query('select * from claim_operator_alerts(20)')).rows;assert.equal(retry.length,1);await database.query('select finish_operator_alert($1,$2,true,null)',[retry[0].alert_id,retry[0].lease_id]);
  const recovery=(await database.query('select * from claim_operator_alerts(20)')).rows;assert.equal(recovery.length,1);assert.equal(recovery[0].payload.event_type,'recovered');
});
test('Dead-letter retry is service-only and retains the receiver idempotency identity',async()=>{
  const database=await db();await record(database,[measured('degraded')]);const id=(await database.query('select id from operator_alert_outbox')).rows[0].id;
  await database.exec("update operator_alert_outbox set attempts=8,state='dead'");
  const privileges=(await database.query("select has_function_privilege('authenticated','retry_operator_alert(uuid)','EXECUTE') a,has_function_privilege('service_role','retry_operator_alert(uuid)','EXECUTE') s")).rows[0];assert.deepEqual(privileges,{a:false,s:true});
  assert.equal((await database.query('select retry_operator_alert($1) as result',[id])).rows[0].result,true);
  const retry=(await database.query('select * from claim_operator_alerts(20)')).rows[0];assert.equal(retry.alert_id,id);assert.equal(retry.attempt,1);
});
test('A late dead-letter retry is acknowledged without reverting the receiver to an older measured state',async()=>{
  const database=await db();await record(database,[measured('degraded')],observed(0));await record(database,[measured('healthy')],observed(1));
  const openingId=(await database.query("select id from operator_alert_outbox where event_type='opened'")).rows[0].id;
  await database.query("update operator_alert_outbox set state='dead',attempts=8 where id=$1",[openingId]);
  const seen=new Set(),latest=new Map(),notifications=[];
  const server=await sink((req,res,body)=>{
    const expected='v1='+createHmac('sha256',config.signingSecret).update(req.headers['x-gameday-sent-at']+'.'+body).digest('hex');assert.equal(req.headers['x-gameday-signature'],expected);
    const alert=JSON.parse(body),sequence=latest.get(alert.check_key)||0;
    if(!seen.has(alert.alert_id)&&alert.transition_sequence>sequence){latest.set(alert.check_key,alert.transition_sequence);notifications.push(alert.status);}seen.add(alert.alert_id);
    res.writeHead(204);res.end();
  });
  try{
    assert.equal((await loadHelper().dispatchOperatorAlerts(adminFor(database),localConfig(server.url))).delivered,1);
    await database.query('select retry_operator_alert($1)',[openingId]);
    assert.equal((await loadHelper().dispatchOperatorAlerts(adminFor(database),localConfig(server.url))).delivered,1);
    assert.deepEqual(notifications,['healthy']);assert.equal(latest.get('database'),2);assert.equal(seen.size,2);
    assert.equal((await database.query('select count(*)::int n from operator_alert_outbox where state=\'delivered\'')).rows[0].n,2);
  }finally{await server.close();}
});

test('Twenty hung destinations use five workers and leave every alert durably retryable',async()=>{
  const database=await db();await record(database,Array.from({length:20},(_,i)=>measured('degraded','source_'+i)));
  let active=0,peak=0,requests=0;
  const server=await sink((_req,res)=>{requests++;active++;peak=Math.max(peak,active);res.on('close',()=>active--);});
  const started=Date.now();
  try{
    const result=await loadHelper().dispatchOperatorAlerts(adminFor(database),{...localConfig(server.url),timeoutMs:40});
    assert.equal(result.failed,20);assert.equal(requests,20);assert(peak<=5);assert(Date.now()-started<2000);
    const row=(await database.query("select count(*)::int n,min(attempts)::int min,max(attempts)::int max,count(*)filter(where leased_until is not null)::int leased from operator_alert_outbox where state='pending'")).rows[0];assert.deepEqual(row,{n:20,min:1,max:1,leased:0});
  }finally{await server.close();}
});
test('Stalled queue claim and acknowledgement stop within SDK deadline while preserving queue state',async()=>{
  const database=await db();await record(database,[measured('degraded')]);const started=Date.now();
  const claimHang={rpc:()=>new Promise(()=>{})};
  await assert.rejects(loadHelper().dispatchOperatorAlerts(claimHang,config),/timed out/);assert(Date.now()-started<1000);
  const admin=adminFor(database),rpc=admin.rpc;
  admin.rpc=(name,args)=>name==='finish_operator_alert'?new Promise(()=>{}):rpc(name,args);
  await assert.rejects(loadHelper().dispatchOperatorAlerts(admin,config,async()=>new Response(null,{status:204})),/acknowledgement unavailable/);
  const row=(await database.query('select state,attempts,leased_until is not null leased from operator_alert_outbox')).rows[0];assert.deepEqual(row,{state:'pending',attempts:1,leased:true});
});
test('Stalled real SDK secret response body returns503 before health work and creates no fake status',async()=>{
  const database=await db();const {createClient}=require('@supabase/supabase-js');let backendRequests=0,clientOptions;
  const server=await sink((_req,res)=>{backendRequests++;res.writeHead(200,{'Content-Type':'application/json'});res.write('{"secret":');});
  const monitor=loadMonitor(null,{env:{SUPABASE_URL:server.url.replace('/alerts','')},clientFactory:(url,key,options)=>{clientOptions=options;return createClient(url,key,options);}});
  const started=Date.now();
  try{
    const response=await monitor.handler(new Request('https://fixture.test/monitor',{method:'POST',headers:{'x-gameday-job-token':jobToken}}));assert.equal(response.status,503);assert(Date.now()-started<1000);assert.equal(backendRequests,1);assert.equal(typeof clientOptions.global.fetch,'function');assert.equal(clientOptions.db.retry,false);assert.equal(monitor.healthReads,0);
    assert.equal((await database.query('select count(*)::int n from operator_monitor_state')).rows[0].n,0);assert.equal((await database.query('select count(*)::int n from operator_alert_outbox')).rows[0].n,0);
  }finally{await server.close();}
});
test('Stalled delivery configuration, health recording and monitor-state writes fail without invented success',async()=>{
  const database=await db(),headers={'x-gameday-job-token':jobToken};
  for(const stage of ['configuration','record','state']){
    await database.exec('truncate operator_alert_outbox,operator_monitor_checks,operator_monitor_state cascade');
    const admin=monitorAdmin(database),from=admin.from,rpc=admin.rpc;
    if(stage==='configuration')admin.from=table=>table==='operator_monitor_delivery_config'?{select(){return this;},eq(){return this;},maybeSingle:()=>new Promise(()=>{})}:from(table);
    if(stage==='record')admin.rpc=(name,args)=>name==='record_operator_health_alerts'?new Promise(()=>{}):rpc(name,args);
    if(stage==='state')admin.from=table=>table==='operator_monitor_state'?{upsert:()=>new Promise(()=>{})}:from(table);
    const monitor=loadMonitor(admin),response=await monitor.handler(new Request('https://fixture.test/monitor',{method:'POST',headers}));assert.equal(response.status,503,stage);assert.equal((await database.query('select count(*)::int n from operator_monitor_state')).rows[0].n,0,stage);
  }
});
test('Malformed queue responses never become a successful empty dispatch',async()=>{
  for(const data of [null,{},[{alert_id:'invalid',lease_id:'invalid',payload:{},attempt:1}]])await assert.rejects(loadHelper().dispatchOperatorAlerts({rpc:async()=>({data,error:null})},config),/queue unavailable/);
});
test('Missing or malformed job headers avoid constructing the privileged SDK client',async()=>{
  let clients=0;const monitor=loadMonitor(null,{clientFactory:()=>{clients++;throw new Error('Should not create privileged client');}});
  for(const token of ['', 'ordinary-customer-token','a'.repeat(63),'g'.repeat(64), 'a'.repeat(65)]){
    const response=await monitor.handler(new Request('https://fixture.test/monitor',{method:'POST',headers:{'x-gameday-job-token':token}}));assert.equal(response.status,401);
  }
  assert.equal(clients,0);
});

test('Every later real status transition is retained even when an incident alternates back to a previous status',async()=>{
  const database=await db(),counts=[];
  for(const [i,status]of ['stale','degraded','stale','degraded'].entries())counts.push((await record(database,[measured(status)],observed(i))).rows[0].count);
  assert.deepEqual(counts,[1,1,1,1]);
  const rows=(await database.query('select transition_sequence,payload from operator_alert_outbox order by transition_sequence')).rows;
  assert.deepEqual(rows.map(r=>Number(r.transition_sequence)),[1,2,3,4]);assert.deepEqual(rows.map(r=>r.payload.status),['stale','degraded','stale','degraded']);assert.deepEqual(rows.map(r=>r.payload.transition_sequence),[1,2,3,4]);
  assert.equal((await record(database,[measured('degraded')],observed(5))).rows[0].count,0);
});
test('Equal transaction timestamps and reverse UUID order cannot deliver recovery before opening',async()=>{
  const database=await db();await database.exec('begin');
  try{await record(database,[measured('degraded')],observed(0));await record(database,[measured('healthy')],observed(1));await database.exec('commit');}catch(error){await database.exec('rollback');throw error;}
  await database.exec("update operator_alert_outbox set id=case event_type when 'opened' then 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid else '00000000-0000-4000-8000-000000000001'::uuid end");
  assert.equal((await database.query('select count(distinct created_at)::int n from operator_alert_outbox')).rows[0].n,1);
  const opening=(await database.query('select * from claim_operator_alerts(20)')).rows;assert.equal(opening.length,1);assert.equal(opening[0].payload.event_type,'opened');assert.equal(opening[0].payload.transition_sequence,1);
  await database.query('select finish_operator_alert($1,$2,true,null)',[opening[0].alert_id,opening[0].lease_id]);
  const recovery=(await database.query('select * from claim_operator_alerts(20)')).rows;assert.equal(recovery.length,1);assert.equal(recovery[0].payload.event_type,'recovered');assert.equal(recovery[0].payload.transition_sequence,2);
});
test('Backfill preserves original alert IDs and reconstructs a current state dropped by the former uniqueness rule',async()=>{
  const legacy=new PGlite();await legacy.waitReady;
  try{
    await legacy.exec('create role anon;create role authenticated;create role service_role bypassrls;');await legacy.exec(fs.readFileSync(path.join(root,migration),'utf8'));
    const counts=[];for(const[i,status]of ['stale','degraded','stale','degraded'].entries())counts.push((await record(legacy,[measured(status)],observed(i))).rows[0].count);
    assert.deepEqual(counts,[1,1,1,0]);const originalIds=(await legacy.query('select id from operator_alert_outbox')).rows.map(r=>r.id);
    await legacy.exec(fs.readFileSync(path.join(root,transitionMigration),'utf8'));
    const rows=(await legacy.query('select id,transition_sequence,payload from operator_alert_outbox order by transition_sequence')).rows;
    assert.equal(rows.length,4);assert(originalIds.every(id=>rows.some(r=>r.id===id)));assert.deepEqual(rows.map(r=>r.payload.status),['stale','degraded','stale','degraded']);assert.deepEqual(rows.map(r=>r.payload.transition_sequence),[1,2,3,4]);
    assert.equal(Number((await legacy.query('select transition_sequence from operator_monitor_checks')).rows[0].transition_sequence),4);
    await record(legacy,[measured('healthy')],observed(5));assert.equal((await legacy.query('select payload from operator_alert_outbox order by transition_sequence desc limit 1')).rows[0].payload.transition_sequence,5);
  }finally{await legacy.close();}
});
