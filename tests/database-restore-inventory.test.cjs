const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gameday-database-migration-inventory.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('Every deployable migration has a canonical recorded history entry and exact captured source', () => {
  assert.equal(inventory.remote_history_mutated, false);
  assert.equal(inventory.supplemental_local_migrations.length, 0);
  const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(inventory.deployed_migrations.map(row => path.basename(row.path)), files);
  assert.equal(new Set(inventory.deployed_migrations.map(row => row.version)).size, files.length);
  for (const row of inventory.deployed_migrations) {
    assert.match(row.version, /^\d{14}$/);
    assert.equal(row.path, `supabase/migrations/${row.version}_${row.name}.sql`);
    assert.equal(row.source, 'deployed_migration_history');
    assert.match(row.source_payload_sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha(fs.readFileSync(path.join(root, row.path))), row.local_file_sha256, row.path);
  }
  assert(!files.some(name => name.includes('add_blackjack_double_split')), 'unrecorded obsolete RPC is archived, not deployable');
  assert(fs.existsSync(path.join(root, inventory.archived_unrecorded_legacy_fixture.path)));
});

test('Restore history and required environment inventory contain no captured private credentials or scheduler requests', () => {
  const environment = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gameday-required-environment.json'), 'utf8'));
  for (const [file, names] of Object.entries(environment.files)) {
    assert(fs.existsSync(path.join(root, file)));
    for (const name of names) assert.match(name, /^[A-Z][A-Z0-9_]+$/);
  }
  const source = inventory.deployed_migrations.map(row => fs.readFileSync(path.join(root, row.path), 'utf8')).join('\n');
  assert(!/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bsb_secret_[A-Za-z0-9_-]+\b/.test(source));
  assert(!/cron\.schedule\s*\(|net\.http_post\s*\(/i.test(source), 'source history restores schema, not private scheduler commands');
  assert(!/insert\s+into\s+auth\.users/i.test(source), 'no production Auth identities exported');
});

test('Saved restore evidence covers real extensions, full catalog parity, actual backup restoration and concurrency checks', () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gameday-restore-evidence.json'), 'utf8'));
  assert.equal(evidence.passed, true);
  assert.equal(evidence.canonical_migrations, inventory.deployed_migrations.length);
  assert.match(evidence.server_version, /^17\.6(?: |$)/);
  assert.deepEqual(evidence.extensions.map(row => row.extname), ['pg_cron', 'pg_net']);
  assert.equal(evidence.extensions.find(row => row.extname === 'pg_net').extversion, '0.20.4');
  assert.equal(evidence.schema_fingerprint_equal, true);
  assert.equal(evidence.backup_restore.passed, true);
  assert.equal(evidence.backup_restore.synthetic_only, true);
  assert.equal(evidence.backup_restore.schema_equal, true);
  assert.equal(evidence.backup_restore.owner_rls, true);
  assert.equal(evidence.backup_restore.wallet_ledger_wager_casino_equal, true);
  assert.equal(evidence.scheduler.scheduled_jobs, 0);
  assert.equal(evidence.scheduler.queued_requests, 0);
  assert.equal(evidence.load.passed, true);
  assert.equal(evidence.load.productionCapacityVerified, false);
  assert.equal(evidence.load.deadlocks, 0);
  for (const value of Object.values(evidence.load.assertions)) assert.equal(value, true);
  assert.equal(sha(fs.readFileSync(path.join(root, evidence.source_baseline))), evidence.baseline_sha256);
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gameday-production-schema-fingerprint.json'), 'utf8')).fingerprint;
  assert.equal(snapshot.schema_md5, evidence.live_schema_md5);
  assert.equal(snapshot.entries.length, evidence.catalog_entries);
});
