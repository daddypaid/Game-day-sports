import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const newUrl = process.env.GAMEDAY_SUPABASE_URL?.trim();
const newKey = process.env.GAMEDAY_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!newUrl || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(newUrl)) {
  console.error('Set GAMEDAY_SUPABASE_URL to a valid https://<project>.supabase.co URL.');
  process.exit(1);
}

if (!newKey) {
  console.error('Set GAMEDAY_SUPABASE_PUBLISHABLE_KEY to the buyer project publishable key.');
  process.exit(1);
}

const configPath = path.join(root, 'gameday-config.js');
if (!fs.existsSync(configPath)) {
  console.error('gameday-config.js was not found. Run this script from the repository root.');
  process.exit(1);
}

const configBefore = fs.readFileSync(configPath, 'utf8');
const oldUrlMatch = configBefore.match(/supabaseUrl:\s*'([^']+)'/);
const oldKeyMatch = configBefore.match(/supabasePublishableKey:\s*'([^']+)'/);

if (!oldUrlMatch || !oldKeyMatch) {
  console.error('Could not locate the current public Supabase settings in gameday-config.js.');
  process.exit(1);
}

const oldUrl = oldUrlMatch[1];
const oldKey = oldKeyMatch[1];
const oldProjectRef = new URL(oldUrl).hostname.split('.')[0];

const targetPages = [
  'gameday-blackjack.html',
  'gameday-roulette.html',
  'gameday-baccarat.html',
  'gameday-slots.html',
  'gameday-video-poker.html',
  'gameday-bonus-poker.html',
  'gameday-deuces-wild.html',
  'gameday-three-card-poker.html',
  'gameday-ultimate-texas-holdem.html',
  'gameday-caribbean-stud.html'
];

function replaceAllLiteral(text, from, to) {
  return from ? text.split(from).join(to) : text;
}

let configAfter = configBefore
  .replace(/supabaseUrl:\s*'[^']+'/, `supabaseUrl: '${newUrl}'`)
  .replace(/supabasePublishableKey:\s*'[^']+'/, `supabasePublishableKey: '${newKey}'`);
fs.writeFileSync(configPath, configAfter);

let changed = 1;
let untouched = 0;
const missing = [];

for (const file of targetPages) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) {
    missing.push(file);
    continue;
  }

  const before = fs.readFileSync(filePath, 'utf8');
  let after = replaceAllLiteral(before, oldUrl, newUrl);
  after = replaceAllLiteral(after, oldKey, newKey);
  after = replaceAllLiteral(after, oldProjectRef, new URL(newUrl).hostname.split('.')[0]);

  if (after !== before) {
    fs.writeFileSync(filePath, after);
    changed += 1;
  } else {
    untouched += 1;
  }
}

console.log(`Updated ${changed} file(s).`);
console.log(`${untouched} legacy target page(s) required no direct replacement.`);
if (missing.length) console.warn(`Missing target page(s): ${missing.join(', ')}`);
console.log('Public browser configuration only. No service-role or provider secrets were read or written.');
console.log('Next: run the deployment workflows and open gameday-transfer-audit.html plus gameday-config-check.html.');
