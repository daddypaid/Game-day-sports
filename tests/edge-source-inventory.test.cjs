const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'scripts/gameday-edge-source-inventory.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Edge source inventory records the complete safe deployed metadata snapshot', () => {
  assert.equal(inventory.schema_version, 1); assert.equal(inventory.hash_algorithm, 'sha256');
  assert(Number.isFinite(Date.parse(inventory.observed_at))); assert(inventory.functions.length > 0);
  assert.equal(new Set(inventory.functions.map(fn => fn.slug)).size, inventory.functions.length);
  const localHandlers = fs.readdirSync(path.join(root, 'supabase/functions')).filter(name => fs.existsSync(path.join(root, 'supabase/functions', name, 'index.ts'))).sort();
  assert.deepEqual(inventory.functions.map(fn => fn.slug).sort(), localHandlers, 'every repository Edge handler has a canonical deployed source snapshot');
  for (const fn of inventory.functions) {
    assert.match(fn.slug, /^[a-z0-9-]+$/); assert.equal(fn.deployed_status, 'ACTIVE'); assert(Number.isInteger(fn.deployed_version) && fn.deployed_version > 0);
    assert.equal(typeof fn.verify_jwt, 'boolean'); assert.equal(typeof fn.import_map, 'boolean'); assert.match(fn.deployed_bundle_sha256, /^[a-f0-9]{64}$/);
    assert.equal(fn.source_status, 'local_matches_deployment', fn.slug + ' has a complete canonical source comparison'); assert(Array.isArray(fn.files) && fn.files.length > 0);
    assert.equal(new Set(fn.files.map(file => file.path)).size, fn.files.length, fn.slug + ' canonical files are unique');
    assert(fn.files.some(file => file.path === 'supabase/functions/' + fn.slug + '/index.ts'), fn.slug + ' includes its canonical entrypoint');
    for (const file of fn.files) assert(fs.existsSync(path.join(root, file.path)), fn.slug + ' has repository source, including delegated repairs');
    assert(!('content' in fn) && !('entrypoint_path' in fn), 'inventory contains metadata, not raw source or deployment paths');
  }
  const encoded = JSON.stringify(inventory);
  assert(!/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bsb_secret_[A-Za-z0-9_-]+\b/.test(encoded), 'no credential values');
  assert(!/"(?:authorization|headers|command|schedule|content)"\s*:/i.test(encoded), 'no job requests, schedules or raw source');
});

test('Every deployed Edge bundle and shared helper matches the exact canonical UTF-8 source', () => {
  const seenHelpers = new Map();
  for (const fn of inventory.functions) for (const file of fn.files) {
    assert.match(file.path, /^supabase\/functions\/[a-z0-9_-]+\/[a-zA-Z0-9_./-]+$/);
    assert(inventory.functions.some(other => file.path.startsWith('supabase/functions/' + other.slug + '/')) || file.path.startsWith('supabase/functions/_shared/'), 'helper belongs to a deployed function or shared source directory');
    assert(!file.path.split('/').includes('..')); const absolute = path.join(root, file.path); assert(fs.statSync(absolute).isFile(), file.path + ' exists');
    assert.match(file.deployed_sha256, /^[a-f0-9]{64}$/); assert.match(file.local_sha256, /^[a-f0-9]{64}$/);
    const actual = hash(fs.readFileSync(absolute)); assert.equal(actual, file.local_sha256, file.path + ' matches the inventory'); assert.equal(actual, file.deployed_sha256, file.path + ' matches canonical deployed source');
    if (seenHelpers.has(file.path)) assert.equal(file.deployed_sha256, seenHelpers.get(file.path), file.path + ' is identical across deployed bundles');
    else seenHelpers.set(file.path, file.deployed_sha256);
  }
});

test('Restored Edge configuration preserves deployed JWT verification settings', () => {
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  const sections = new Map([...config.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
  for (const fn of inventory.functions) {
    const section = sections.get(fn.slug), declared = section?.match(/^verify_jwt\s*=\s*(true|false)\s*$/m);
    if (fn.verify_jwt === false) { assert(declared, fn.slug + ' explicitly configures JWT verification'); assert.equal(declared[1], 'false', fn.slug); }
    else if (declared) assert.equal(declared[1], 'true', fn.slug);
  }
});
