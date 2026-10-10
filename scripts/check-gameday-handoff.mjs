import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saleFiles = ['README.md','BUYER-OVERVIEW.md','SALE-LISTING.md','V5-BUYER-SALES-PACK.md','ASSET-INVENTORY.md','DUE-DILIGENCE-DISCLOSURES.md','ACQUISITION-HANDOFF.md','HANDOFF-REHEARSAL.md','BUYER-RELEASE-CHECKLIST.md','FINAL-SALE-READINESS.md','gameday-v5.html','gameday-sale-room.html','gameday-buyer-demo.html'];
const handoffFiles = ['gameday-config.js','gameday-transfer-audit.html','gameday-config-check.html','gameday-buyer-readiness.html','gameday-platform-architecture.html','gameday-admin-takeover.html','scripts/gameday-transfer-config.mjs'];

function publicClientKey(key,url) {
  if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key||''))return true;
  try {
    const parts=key.split('.');if(parts.length!==3)return false;
    const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    return payload.role==='anon'&&payload.ref===new URL(url).hostname.split('.')[0];
  }catch{return false;}
}

export async function checkHandoff({ root = defaultRoot, mode = 'all' } = {}) {
  assert(['all','sale','transfer'].includes(mode), 'Unknown handoff check mode');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const exists = file => assert(fs.statSync(path.join(root, file)).size > 0, `Empty handoff resource: ${file}`);
  for (const file of [...handoffFiles, ...(mode !== 'transfer' ? saleFiles : [])]) exists(file);
  const configSource = read('gameday-config.js');
  const module = await import('data:text/javascript;base64,' + Buffer.from(configSource).toString('base64'));
  const config = module.GAMEDAY_CONFIG;
  assert.equal(config.environment, 'TEST', 'Public configuration must stay in TEST mode');
  assert(module.assertGameDayConfig().ok, 'Public configuration is invalid');
  assert(Object.isFrozen(config) && Object.isFrozen(config.routes) && Object.isFrozen(config.functions), 'Public configuration must be immutable');
  assert(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl), 'Invalid configured Supabase project URL');
  assert(publicClientKey(config.supabasePublishableKey,config.supabaseUrl), 'Browser configuration requires a publishable or matching legacy anon key; private keys are forbidden');
  for (const [name, file] of Object.entries(config.routes)) {
    assert(/^[a-z0-9-]+\.html$/.test(file), `Unsafe route: ${name}`);
    exists(file);
  }
  for (const [name, slug] of Object.entries(config.functions)) {
    assert(/^[a-z0-9-]+$/.test(slug), `Unsafe function slug: ${name}`);
    assert.equal(module.functionUrl(name), config.supabaseUrl + '/functions/v1/' + slug, `Incorrect service URL for ${name}`);
    exists(`supabase/functions/${slug}/index.ts`);
  }
  const sourceInventory=JSON.parse(read('scripts/gameday-edge-source-inventory.json'));
  const migrationInventory=JSON.parse(read('scripts/gameday-database-migration-inventory.json'));
  assert(Array.isArray(sourceInventory.functions)&&sourceInventory.functions.length>0,'Missing deployed function source inventory');
  assert(Array.isArray(migrationInventory.deployed_migrations)&&migrationInventory.deployed_migrations.length>0,'Missing deployed migration inventory');
  assert.equal(new Set(sourceInventory.functions.map(item=>item.slug)).size,sourceInventory.functions.length,'Duplicate deployed function inventory entry');
  for(const item of sourceInventory.functions) {
    assert(Array.isArray(item.files)&&item.files.length>0,`Missing inventoried backend bundle: ${item.slug}`);
    for(const file of item.files) {
      assert(/^supabase\/functions\/[a-zA-Z0-9_./-]+$/.test(file.path)&&!file.path.includes('..'),'Unsafe inventoried backend path');
      exists(file.path);
    }
  }
  for(const item of migrationInventory.deployed_migrations) {
    assert(/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(item.path),'Unsafe inventoried migration path');
    exists(item.path);
  }
  for (const file of ['gameday-transfer-audit.html','gameday-buyer-readiness.html','gameday-platform-architecture.html', ...(mode !== 'transfer' ? ['gameday-v5.html','gameday-sale-room.html', ...saleFiles.filter(f => f.endsWith('.md'))] : [])]) {
    if (['BUYER-OVERVIEW.md','ASSET-INVENTORY.md','ACQUISITION-HANDOFF.md','HANDOFF-REHEARSAL.md','BUYER-RELEASE-CHECKLIST.md'].includes(file)) continue;
    assert(/TEST\s+MODE/i.test(read(file)), `Missing test-mode disclosure in ${file}`);
  }
  for (const file of ['gameday-admin-takeover.html','gameday-platform-architecture.html', ...(mode !== 'transfer' ? ['gameday-buyer-demo.html','gameday-sale-room.html'] : [])]) {
    const links = [...read(file).matchAll(/\bhref\s*=\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    assert(links.length > 0, `Missing handoff navigation in ${file}`);
    for (const link of links) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), link.split(/[?#]/)[0]));
      assert(!target.startsWith('../') && !target.startsWith('/'), `Handoff navigation leaves package: ${file}`);
      exists(target);
    }
  }
  if (mode !== 'transfer') {
    for (const file of ['art/gameday-sportsbook-approved-hero.jpg','art/gameday-sportsbook-hero.svg','assets/gameday-blackjack-table-premium.svg','assets/gameday-roulette-room.svg','assets/gameday-baccarat-room.svg']) exists(file);
    for (const file of ['README.md','SALE-LISTING.md','DUE-DILIGENCE-DISCLOSURES.md']) assert(/(?:no|not[^.]*?(?:accept|enable))\s+real-money deposits/i.test(read(file)), `Missing no-deposit disclosure in ${file}`);
    const demo = read('gameday-v5.html');
    assert(/No backend wager or wallet transaction was created/i.test(demo), 'Standalone buyer demo must disclose simulation-only receipts');
    assert(!/functions\/v1|\.functions\.invoke|\.rpc\(/.test(demo), 'Standalone buyer demo must not submit backend wagers');
  }
  // Rehearse the transfer utility in a disposable copy so this check never edits
  // the active project or attempts to authenticate with either project.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'gameday-handoff-'));
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/gameday-transfer-config.mjs'), path.join(fixture, 'scripts/gameday-transfer-config.mjs'));
    for (const file of ['gameday-config.js','gameday-blackjack.html','gameday-roulette.html','gameday-baccarat.html','gameday-slots.html']) fs.copyFileSync(path.join(root,file),path.join(fixture,file));
    const env = { ...process.env, GAMEDAY_SUPABASE_URL: 'https://handoff-fixture.supabase.co', GAMEDAY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_public_key' };
    const run = spawnSync(process.execPath,['scripts/gameday-transfer-config.mjs'], { cwd:fixture, env, encoding:'utf8' });
    assert.equal(run.status,0,'Public transfer utility rehearsal failed');
    const transferred = fs.readFileSync(path.join(fixture,'gameday-config.js'),'utf8');
    assert(transferred.includes(env.GAMEDAY_SUPABASE_URL) && transferred.includes(env.GAMEDAY_SUPABASE_PUBLISHABLE_KEY), 'Transfer did not update centralized public settings');
    const unsafe = spawnSync(process.execPath,['scripts/gameday-transfer-config.mjs'], { cwd:fixture, env:{...env,GAMEDAY_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture_private_key'}, encoding:'utf8' });
    assert.notEqual(unsafe.status,0,'Transfer utility accepted a private browser key');
    assert.equal(fs.readFileSync(path.join(fixture,'gameday-config.js'),'utf8'),transferred,'Rejected private key changed browser configuration');
  } finally { fs.rmSync(fixture, { recursive:true, force:true }); }
  return { mode, routes:Object.keys(config.routes).length, functions:Object.keys(config.functions).length, inventoriedFunctions:sourceInventory.functions.length, inventoriedMigrations:migrationInventory.deployed_migrations.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode')+1] : 'all';
  const result = await checkHandoff({ mode });
  console.log(`Handoff package checks passed (${result.mode}): ${result.routes} configured routes, ${result.functions} configured services, ${result.inventoriedFunctions} inventoried function bundles, ${result.inventoriedMigrations} migration files and isolated public-config transfer. These checks do not certify live capacity, backup recovery or real-money readiness.`);
}
