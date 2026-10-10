// Actual PostgreSQL regression for the additive alert ordering migration.
// Run explicitly: GAMEDAY_POSTGRES_CONTAINER=gameday-capacity-postgres node tests/operator-alerts-postgres.cjs
// Only a newly created disposable database is mutated; no connection URL/secret is used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {randomUUID,createHash} = require('node:crypto');
const root = path.resolve(__dirname,'..');
const container = process.env.GAMEDAY_POSTGRES_CONTAINER;
if (!container || !/^gameday-[a-zA-Z0-9_-]+$/.test(container)) {
  console.error('Set GAMEDAY_POSTGRES_CONTAINER to an explicitly selected local GameDay PostgreSQL container.');
  process.exit(2);
}
const database = 'gameday_alert_verify_'+randomUUID().replace(/-/g,'');
const original = 'supabase/migrations/20261010131427_operator_monitoring_alert_outbox.sql';
const additive = 'supabase/migrations/20261010133524_operator_alert_transition_sequence.sql';
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const docker = (args,input) => execFileSync('docker',['--host','unix:///var/run/docker.sock','exec','-i',container,...args],{input,env:dockerEnv,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql = input => docker(['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','--single-transaction','-U','postgres','-d',database],input).trim();
const json = query => JSON.parse(sql(query));
const baseTime = Date.now()-120000;
const observed = step => new Date(baseTime+step*1000).toISOString();
const recordSQL = (key,status,step) => `select public.record_operator_health_alerts('[{"key":"${key}","status":"${status}","measured":true,"detail":"Local verification fixture"}]'::jsonb,'${observed(step)}'::timestamptz);`;
const claim = () => json("select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.claim_operator_alerts(20) c;");
const finish = row => sql(`select public.finish_operator_alert('${row.alert_id}'::uuid,'${row.lease_id}'::uuid,true,null);`);
let created = false;
try {
  docker(['createdb','-U','postgres',database]); created=true;
  const version=sql('select version();');
  sql(read(original));
  // Reproduce suppressed status on the former recorder before applying the repair.
  assert.deepEqual(sql(['stale','degraded','stale','degraded'].map((status,i)=>recordSQL('legacy_flap',status,i)).join('\n')).split('\n'),['1','1','1','0']);
  sql(recordSQL('legacy_tie','degraded',5)+recordSQL('legacy_tie','healthy',6));
  sql("update public.operator_alert_outbox set id=case event_type when 'opened' then 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid else '00000000-0000-4000-8000-000000000001'::uuid end where check_key='legacy_tie';");
  const before=json("select jsonb_build_object('ids',(select jsonb_agg(id order by id) from public.operator_alert_outbox),'flap_count',(select count(*) from public.operator_alert_outbox where check_key='legacy_flap'),'status',(select status from public.operator_monitor_checks where check_key='legacy_flap'));" );
  assert.equal(before.flap_count,3);assert.equal(before.status,'degraded');
  sql(read(additive));
  const after=json("select jsonb_build_object('ids',(select jsonb_agg(id order by id) from public.operator_alert_outbox),'flap',(select jsonb_agg(jsonb_build_object('sequence',transition_sequence,'status',health_status,'event',event_type,'payload_sequence',payload->'transition_sequence') order by transition_sequence) from public.operator_alert_outbox where check_key='legacy_flap'),'counter',(select transition_sequence from public.operator_monitor_checks where check_key='legacy_flap'));" );
  assert(before.ids.every(id=>after.ids.includes(id)),'Existing alert identities must survive the backfill');
  assert.deepEqual(after.flap.map(row=>row.status),['stale','degraded','stale','degraded']);
  assert.deepEqual(after.flap.map(row=>row.sequence),[1,2,3,4]);
  assert(after.flap.every(row=>row.sequence===row.payload_sequence));assert.equal(after.counter,4);
  const backfilled=claim(),opening=backfilled.find(row=>row.payload.check_key==='legacy_tie');
  assert.equal(opening.payload.event_type,'opened');assert.equal(opening.payload.transition_sequence,1);
  assert.equal(opening.alert_id,'ffffffff-ffff-4fff-8fff-ffffffffffff');
  for(const row of backfilled)finish(row);
  const recovery=claim().find(row=>row.payload.check_key==='legacy_tie');
  assert.equal(recovery.payload.event_type,'recovered');assert.equal(recovery.payload.transition_sequence,2);

  sql('truncate public.operator_alert_outbox,public.operator_monitor_checks cascade;');
  assert.deepEqual(sql(['stale','degraded','stale','degraded'].map((status,i)=>recordSQL('fresh_flap',status,20+i)).join('\n')).split('\n'),['1','1','1','1']);
  assert.equal(sql(recordSQL('fresh_flap','degraded',25)),'0','Unchanged observations still deduplicate');
  const identities=[
    'ffffffff-ffff-4fff-8fff-fffffffffff1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3','cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
  ];
  sql(`update public.operator_alert_outbox set created_at='2026-10-10T00:00:00Z',id=(array[${identities.map(id=>"'"+id+"'::uuid").join(',')}])[transition_sequence::integer];`);
  for(let sequence=1;sequence<=4;sequence++){
    const rows=claim();assert.equal(rows.length,1);assert.equal(rows[0].payload.transition_sequence,sequence);
    assert.equal(rows[0].alert_id,identities[sequence-1]);
    assert.equal(claim().length,0,'A leased predecessor must fence later transitions');
    finish(rows[0]);
  }
  assert.equal(claim().length,0);

  sql('truncate public.operator_alert_outbox,public.operator_monitor_checks cascade;');
  sql(recordSQL('fresh_recovery','degraded',30)+recordSQL('fresh_recovery','healthy',31));
  sql("update public.operator_alert_outbox set created_at='2026-10-10T00:00:00Z',id=case event_type when 'opened' then 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid else '00000000-0000-4000-8000-000000000001'::uuid end;");
  const first=claim();assert.equal(first.length,1);assert.equal(first[0].payload.event_type,'opened');
  assert.equal(claim().length,0);finish(first[0]);
  const second=claim();assert.equal(second.length,1);assert.equal(second[0].payload.event_type,'recovered');

  const rights=json("select jsonb_build_object('anon',has_function_privilege('anon','public.record_operator_health_alerts(jsonb,timestamptz)','EXECUTE'),'customer',has_function_privilege('authenticated','public.claim_operator_alerts(integer)','EXECUTE'),'service',has_function_privilege('service_role','public.claim_operator_alerts(integer)','EXECUTE'),'browser_table',has_table_privilege('authenticated','public.operator_alert_outbox','SELECT'));" );
  assert.deepEqual(rights,{anon:false,customer:false,service:true,browser_table:false});
  console.log(JSON.stringify({ok:true,postgres:version,checks:['four distinct severity transitions','unchanged-observation deduplication','tied timestamps and reversed UUID causality','active lease fences recovery','legacy suppressed-state reconciliation','backfill preserves original alert IDs','service-only privileges'],migration_sha256:createHash('sha256').update(read(additive)).digest('hex')}));
} finally {
  if(created)docker(['dropdb','--force','-U','postgres',database]);
}
