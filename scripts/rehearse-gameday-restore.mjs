import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { verifyRestoredBlackjack } from '../tests/helpers/postgres-blackjack-restore.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const runLoad = process.argv.includes('--load');
const port = Number(process.env.GAMEDAY_RESTORE_PORT || 55441);
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Invalid isolated restore port');
const container = process.env.GAMEDAY_RESTORE_CONTAINER || `gameday-restore-${process.pid}`;
if (!/^gameday-restore-[a-zA-Z0-9_-]+$/.test(container)) throw new Error('Use a dedicated gameday-restore container name');
const database = 'gameday_restore';
const backupDatabase = 'gameday_load';
const image = process.env.GAMEDAY_RESTORE_IMAGE || 'gameday-restore-postgres:17.6';
const artifactDir = path.resolve(process.env.GAMEDAY_RESTORE_ARTIFACT_DIR || `/tmp/gameday-restore-${process.pid}`);
fs.mkdirSync(artifactDir, { recursive: true });
const dockerEnv = { ...process.env };
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[name];
const docker = (args, input) => {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env: dockerEnv, input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Isolated Docker ${args[0]} failed: ${(result.stderr || result.error?.message || '').slice(-1500)}`);
  return result.stdout;
};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const report = { scope: 'isolated application schema and RPC restore; no production data or hosted services', started_at: new Date().toISOString(), image, port, migrations: [], checks: [] };
let client;
let backupClient;
let started = false;
let backupStarted = false;
const backupContainer = `${container}-backup`;
try {
  docker(['run', '--detach', '--name', container, '--publish', `127.0.0.1:${port}:5432`, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', `POSTGRES_DB=${database}`, image,
    '-c', 'shared_preload_libraries=pg_cron,pg_net,pg_stat_statements', '-c', `cron.database_name=${database}`]);
  started = true;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const probe = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); client = probe; break; } catch { await probe.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!client) throw new Error('Isolated PostgreSQL startup exceeded 60 seconds');
  await client.query("set statement_timeout='30s'; set lock_timeout='10s'; set search_path=public,extensions");
  const version = (await client.query('show server_version')).rows[0].server_version;
  if (!version.startsWith('17.6 ' ) && version !== '17.6') throw new Error(`Expected PostgreSQL 17.6, received ${version}`);
  report.server_version = version;
  await client.query(fs.readFileSync(path.join(root, 'supabase/restore/local-platform-prerequisites.sql'), 'utf8'));
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
    try { await client.query('begin'); await client.query(sql); await client.query('commit'); }
    catch (error) { await client.query('rollback'); throw new Error(`Migration ${name} failed (${error.code || 'unknown'}): ${error.message}`); }
    report.migrations.push({ path: `supabase/migrations/${name}`, sha256: sha(sql) });
  }
  const extensions = (await client.query("select extname,extversion from pg_extension where extname in ('pg_cron','pg_net') order by extname")).rows;
  if (JSON.stringify(extensions) !== JSON.stringify([{ extname: 'pg_cron', extversion: '1.6' }, { extname: 'pg_net', extversion: '0.20.4' }]) &&
      JSON.stringify(extensions) !== JSON.stringify([{ extname: 'pg_cron', extversion: '1.6.4' }, { extname: 'pg_net', extversion: '0.20.4' }])) throw new Error('Real pg_cron/pg_net extension version mismatch');
  report.extensions = extensions;
  const dormant = (await client.query('select (select count(*)::int from cron.job) scheduled_jobs,(select count(*)::int from net.http_request_queue) queued_requests')).rows[0];
  if (dormant.scheduled_jobs || dormant.queued_requests) throw new Error('Rehearsal unexpectedly contains scheduled or queued outbound work');
  report.scheduler = dormant;
  report.checks.push('Every chronological application migration applied without omitted extension SQL');
  const fingerprintSql = fs.readFileSync(path.join(root, 'scripts/gameday-schema-fingerprint.sql'), 'utf8');
  const actual = (await client.query(fingerprintSql)).rows[0];
  fs.writeFileSync(path.join(artifactDir, 'restored-schema-fingerprint.json'), JSON.stringify(actual, null, 2) + '\n');
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gameday-production-schema-fingerprint.json'), 'utf8'));
  const expectedCatalog = expected.fingerprint || expected.catalog || expected.snapshot || expected;
  const actualCatalog = actual.fingerprint || actual.catalog || actual.snapshot || actual;
  report.schema_fingerprint_equal = JSON.stringify(actualCatalog) === JSON.stringify(expectedCatalog);
  report.schema_fingerprint_sha256 = sha(JSON.stringify(actualCatalog));
  if (!report.schema_fingerprint_equal) {
    fs.writeFileSync(path.join(artifactDir, 'expected-schema-fingerprint.json'), JSON.stringify(expectedCatalog, null, 2) + '\n');
    throw new Error('Restored schema fingerprint differs from the read-only production catalog snapshot; inspect isolated artifact metadata');
  }
  report.checks.push('Live catalog and restored catalog match: columns, constraints, indexes, policies, ACLs, routines, triggers and views');
  const relationRls = (await client.query("select count(*)::int tables, bool_and(c.relrowsecurity) all_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')")).rows[0];
  if (!relationRls.all_rls) throw new Error('Restored application table without RLS');
  report.application_tables = relationRls.tables;
  const userA = crypto.randomUUID(), userB = crypto.randomUUID();
  await client.query('begin');
  await client.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [userA, 'restore-a@example.invalid', userB, 'restore-b@example.invalid']);
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userA, role: 'authenticated' })]);
  const own = (await client.query('select user_id from public.wallets')).rows;
  if (own.length !== 1 || own[0].user_id !== userA) throw new Error('Owner RLS failed on restored wallets');
  await client.query('reset role');
  await client.query('set local role anon');
  const anonymous = (await client.query("select has_function_privilege('anon','public.settle_slot_request_atomic(uuid,uuid,text,text,jsonb,jsonb,jsonb)','EXECUTE') allowed")).rows[0];
  if (anonymous?.allowed) throw new Error('Anonymous access to slot settlement RPC');
  await client.query('rollback');
  report.checks.push('Synthetic new-user trigger, owner-scoped wallet reads and restricted settlement RPC verified');
  report.blackjack_rpc = await verifyRestoredBlackjack(client);
  report.checks.push('Restored Blackjack Deal replay, Hit, Stand, Split, Double, stale-action and owner checks reconcile with the wallet ledger');
  const baseline = docker(['exec', container, 'pg_dump', '--schema-only', '--schema=public', '--no-comments', '--dbname', database, '--username', 'postgres']);
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bsb_secret_[A-Za-z0-9_-]+\b|cron\.schedule\(|net\.http_post\(/.test(baseline)) throw new Error('Unsafe literal in schema-only dump');
  fs.writeFileSync(path.join(artifactDir, 'schema-baseline.sql'), baseline);
  report.baseline_sha256 = sha(baseline);
  // Rehearse an actual custom-format backup/restore with synthetic data only.
  // Use a second runtime because pg_cron is bound to one named database.
  const wagerId = crypto.randomUUID();
  await client.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [userA, 'restore-a@example.invalid', userB, 'restore-b@example.invalid']);
  const initialSyntheticBalance = Number((await client.query('select balance from public.wallets where user_id=$1', [userA])).rows[0].balance);
  await client.query("insert into public.wagers(id,user_id,wager_type,stake,potential_return,status,is_test,settled_at) values($1,$2,'single',10,20,'won',true,now())", [wagerId, userA]);
  await client.query("insert into public.wager_selections(wager_id,event_id,event_name,sport_key,market_key,selection_name,american_odds) values($1,'restore-event','Synthetic restore event','basketball_nba','h2h','Synthetic team',100)", [wagerId]);
  await client.query('update public.wallets set balance=balance+10 where user_id=$1', [userA]);
  await client.query("insert into public.wallet_transactions(user_id,wager_id,transaction_type,amount,balance_after,note) values($1,$2,'wager_debit',10,$3,'Synthetic restore debit'),($1,$2,'wager_credit',20,$4,'Synthetic restore credit')", [userA, wagerId, initialSyntheticBalance - 10, initialSyntheticBalance + 10]);
  await client.query('set role service_role');
  await client.query("select * from public.play_test_roulette_atomic($1,1,'red',null,1,'red',2,'won')", [userB]);
  await client.query('reset role');
  const dataCheckSql = `select jsonb_build_object('wallets',(select jsonb_agg(jsonb_build_object('owner',user_id,'balance',balance) order by user_id) from public.wallets),
    'ledger',(select jsonb_agg(jsonb_build_object('owner',user_id,'wager',wager_id,'type',transaction_type,'amount',amount,'balance_after',balance_after) order by user_id,transaction_type,id) from public.wallet_transactions),
    'wagers',(select jsonb_agg(jsonb_build_object('id',id,'owner',user_id,'status',status,'stake',stake,'return',potential_return) order by id) from public.wagers),
    'casino',(select jsonb_agg(jsonb_build_object('owner',user_id,'number',winning_number,'stake',stake,'payout',payout,'bet',bet_type) order by id) from public.roulette_spins)) as synthetic`;
  const syntheticBefore = (await client.query(dataCheckSql)).rows[0].synthetic;
  const ledgerCheckSql = `select count(*)::int mismatches from public.wallets w
    where w.balance <> (select coalesce(sum(case when t.transaction_type in ('wager_debit','withdrawal') then -t.amount else t.amount end),0) from public.wallet_transactions t where t.user_id=w.user_id)`;
  if ((await client.query(ledgerCheckSql)).rows[0].mismatches !== 0) throw new Error('Synthetic backup fixture wallet/ledger does not reconcile');
  docker(['exec', container, 'pg_dump', '--format=custom', '--file=/tmp/gameday-synthetic.dump', '--dbname', database, '--username', 'postgres']);
  const backupPath = path.join(artifactDir, 'synthetic-backup.dump');
  docker(['cp', `${container}:/tmp/gameday-synthetic.dump`, backupPath]);
  fs.chmodSync(backupPath, 0o600);
  docker(['run', '--detach', '--name', backupContainer, '--publish', `127.0.0.1:${port + 1}:5432`, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', `POSTGRES_DB=${backupDatabase}`, image,
    '-c', 'shared_preload_libraries=pg_cron,pg_net,pg_stat_statements', '-c', `cron.database_name=${backupDatabase}`]);
  backupStarted = true;
  const backupDeadline = Date.now() + 60000;
  while (Date.now() < backupDeadline) {
    const probe = new pg.Client({ host: '127.0.0.1', port: port + 1, user: 'postgres', database: backupDatabase, connectionTimeoutMillis: 1000 });
    try { await probe.connect(); backupClient = probe; break; } catch { await probe.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!backupClient) throw new Error('Backup target startup exceeded 60 seconds');
  // Cluster roles are separate from pg_dump; create only safe rehearsal roles.
  await backupClient.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_admin nologin bypassrls");
  docker(['cp', backupPath, `${backupContainer}:/tmp/gameday-synthetic.dump`]);
  docker(['exec', backupContainer, 'pg_restore', '--exit-on-error', '--single-transaction', '--dbname', backupDatabase, '--username', 'postgres', '/tmp/gameday-synthetic.dump']);
  const syntheticAfter = (await backupClient.query(dataCheckSql)).rows[0].synthetic;
  if (JSON.stringify(syntheticBefore) !== JSON.stringify(syntheticAfter)) throw new Error('Backup restore lost synthetic wallet, wager, ledger or casino data');
  if ((await backupClient.query(ledgerCheckSql)).rows[0].mismatches !== 0) throw new Error('Restored backup wallet/ledger does not reconcile');
  const backupCatalog = (await backupClient.query(fingerprintSql)).rows[0].fingerprint;
  if (JSON.stringify(backupCatalog) !== JSON.stringify(actualCatalog)) throw new Error('Backup restore changed schema, ACL, RLS or routine fingerprints');
  await backupClient.query('begin');
  await backupClient.query('set local role authenticated');
  await backupClient.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userA, role: 'authenticated' })]);
  const backupOwn = (await backupClient.query('select user_id from public.wallets')).rows;
  if (backupOwn.length !== 1 || backupOwn[0].user_id !== userA) throw new Error('Backup restore lost owner-scoped RLS');
  await backupClient.query('rollback');
  const restoredDormant = (await backupClient.query('select (select count(*)::int from cron.job) scheduled_jobs,(select count(*)::int from net.http_request_queue) queued_requests')).rows[0];
  if (restoredDormant.scheduled_jobs || restoredDormant.queued_requests) throw new Error('Backup restore contains outbound scheduled work');
  report.backup_restore = { passed: true, synthetic_only: true, schema_equal: true, owner_rls: true, wallet_ledger_wager_casino_equal: true, wallet_ledger_reconciled: true, sha256: sha(fs.readFileSync(backupPath)), scheduler: restoredDormant };
  report.checks.push('Actual pg_dump/pg_restore into a second PostgreSQL runtime preserved synthetic wallet, ledger, wagers, casino results, schema, ACLs and owner RLS');
  if (runLoad) {
    await backupClient.end(); backupClient = undefined;
    const alertProof = spawnSync(process.execPath, [path.join(root, 'tests/operator-alerts-postgres.cjs')], {
      cwd: root, env: { ...dockerEnv, GAMEDAY_POSTGRES_CONTAINER: backupContainer }, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000,
    });
    if (alertProof.status !== 0) throw new Error(`Restored PostgreSQL alert ordering failed: ${(alertProof.stderr || alertProof.error?.message || alertProof.stdout || '').slice(-1500)}`);
    const alerts = JSON.parse(alertProof.stdout.trim());
    if (alerts.ok !== true) throw new Error('Actual PostgreSQL alert ordering assertion failed');
    fs.writeFileSync(path.join(artifactDir, 'operator-alerts-postgres-results.json'), JSON.stringify(alerts, null, 2) + '\n');
    report.operator_alerts = { passed: true, checks: alerts.checks, migration_sha256: alerts.migration_sha256 };
    report.checks.push('Actual PostgreSQL alert transition, legacy backfill, causal ordering, lease fencing and service-only privilege checks passed');
    const workload = spawnSync(process.execPath, [path.join(root, 'tests/postgres-concurrency-load.cjs')], {
      cwd: root, env: { ...process.env, GAMEDAY_LOAD_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port + 1}/${backupDatabase}`, GAMEDAY_LOAD_OUTPUT: path.join(artifactDir, 'postgres-load-results.json') },
      encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 180000,
    });
    if (workload.status !== 0) throw new Error(`Restored PostgreSQL workload failed: ${(workload.stderr || workload.error?.message || workload.stdout || '').slice(-1500)}`);
    const loadReport = JSON.parse(fs.readFileSync(path.join(artifactDir, 'postgres-load-results.json'), 'utf8'));
    if (Object.values(loadReport.assertions).some(value => value !== true)) throw new Error('Restored workload assertion failed');
    report.load = { passed: true, assertions: loadReport.assertions, deadlocks: loadReport.deadlocks, productionCapacityVerified: false };
    report.checks.push('Restored database passed sustained concurrent wallet, sportsbook, slots, poker and durable retry workload');
  }
  report.passed = true;
  fs.writeFileSync(path.join(artifactDir, 'local-connection.env'), `GAMEDAY_LOCAL_PG_HOST=127.0.0.1\nGAMEDAY_LOCAL_PG_PORT=${port}\nGAMEDAY_LOCAL_PG_USER=postgres\nGAMEDAY_LOCAL_PG_DATABASE=${database}\nGAMEDAY_LOCAL_PG_CONTAINER=${container}\n`);
  console.log(JSON.stringify({ passed: true, migrations: report.migrations.length, checks: report.checks, artifactDir, retained: keep }, null, 2));
} catch (error) {
  report.passed = false; report.error = error.message;
  console.error(error.message); process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
  await backupClient?.end().catch(() => {});
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(artifactDir, 'restore-results.json'), JSON.stringify(report, null, 2) + '\n');
  if (started && !keep) { try { docker(['rm', '--force', '--volumes', container]); } catch (error) { console.error(error.message); process.exitCode = 1; } }
  if (backupStarted && !keep) { try { docker(['rm', '--force', '--volumes', backupContainer]); } catch (error) { console.error(error.message); process.exitCode = 1; } }
}
