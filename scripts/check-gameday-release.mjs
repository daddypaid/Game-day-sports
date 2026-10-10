import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function checkRelease(root = defaultRoot) {
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function dependencies(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = read(file), relative = [];
  for (const m of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) relative.push(m[1]);
  if (file.endsWith('.html')) for (const m of source.matchAll(/<script\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) {
    if (!/^(?:https?:)?\/\//.test(m[1])) relative.push('./' + m[1]);
  }
  for (const value of relative) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), value.split('?')[0]));
    assert(!target.startsWith('../'), `Dependency escapes site: ${target}`);
    dependencies(target, seen);
  }
  return seen;
}
const pages = [
  'gameday-sportsbook.html','gameday-casino-v2.html','gameday-my-bets.html','gameday-auth.html',
  'gameday-blackjack.html','gameday-roulette.html','gameday-baccarat.html','gameday-slots.html',
  'gameday-jacks-or-better.html','gameday-texas-holdem.html','gameday-omaha.html',
  'gameday-seven-card-stud.html','gameday-five-card-draw.html','gameday-casino-history.html',
  'gameday-midnight-monsters-v2.html','gameday-galactic-rebellion-v2.html',
  'gameday-control-center.html','gameday-operator-analytics.html','gameday-system-health.html',
];
for (const file of pages) {
  assert(dependencies(file).has('gameday-config.js'), `${file} must use centralized config directly or through its controller`);
  assert(!read(file).includes('qsvrvhcklnsbekxblpfo'), `Embedded project reference in ${file}`);
}
for (const [page, key] of [['gameday-blackjack.html','blackjack'],['gameday-roulette.html','roulette'],['gameday-baccarat.html','baccarat'],['gameday-slots.html','slots'],['gameday-midnight-monsters-v2.html','themedSlots'],['gameday-galactic-rebellion-v2.html','themedSlots'],['gameday-jacks-or-better.html','jacksOrBetter'],['gameday-texas-holdem.html','poker'],['gameday-omaha.html','poker'],['gameday-seven-card-stud.html','poker'],['gameday-five-card-draw.html','poker']]) {
  assert([...dependencies(page)].some(file => new RegExp(`functionUrl\\(['"]${key}['"]\\)|GAMEDAY_CONFIG\\.functions\\.${key}`).test(read(file))), `${page} must use its configured game service`);
}
assert(/serviceWorker\.register\(['"]\.\/sw\.js(?:\?[^'"]*)?['"]/.test(read('gameday-app.js')), 'Missing service worker registration');
const swSource = read('sw.js');
const shellMatch = swSource.match(/const\s+SHELL\s*=\s*\[([\s\S]*?)\];/);
assert(shellMatch, 'Missing PWA shell manifest');
const shell = [...shellMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
for (const file of shell) assert(fs.existsSync(path.join(root,file.split('?')[0])), `Missing shell resource: ${file}`);
assert.equal(new Set(shell).size, shell.length, 'Duplicate PWA shell resource');
const cacheVersion = swSource.match(/gameday-shell-v(\d+)/)?.[1];
assert(cacheVersion, 'Missing versioned PWA cache');
for (const file of ['gameday-app.js','gameday-home.js']) assert(read(file).includes(`./sw.js?v=${cacheVersion}`), `PWA registration version does not match cache in ${file}`);
for (const file of ['gameday-casino-history.html','gameday-casino-history.js','gameday-casino-history.css','gameday-help.html','gameday-help.js','gameday-privacy.html','gameday-settings.html','gameday-settings.js','gameday-account-pages.css']) assert(shell.includes('./' + file), `Missing new history shell entry: ${file}`);
function walk(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['.git','.github','node_modules','test-results','playwright-report','tests','supabase','scripts'].includes(entry.name)) continue;
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:html|js|css)$/.test(file)) assert(!/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS|API_SPORTS_KEY|ODDS_API_KEY|sb_secret_[A-Za-z0-9_-]+/.test(fs.readFileSync(file,'utf8')), `Private credential reference in browser resource: ${path.relative(root,file)}`);
  }
}
walk(root);
return { pages: pages.length, shell: shell.length, cacheVersion };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRelease();
  console.log(`Release checks passed: ${result.pages} centralized pages, ${result.shell} shell resources, configured services and browser credential patterns (cache v${result.cacheVersion}).`);
}
