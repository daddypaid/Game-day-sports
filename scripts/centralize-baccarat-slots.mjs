import fs from 'node:fs';

const targets = [
  { file: 'gameday-baccarat.html', functionKey: 'baccarat', legacyFunction: 'baccarat-test' },
  { file: 'gameday-slots.html', functionKey: 'slots', legacyFunction: 'slots-test' }
];

for (const target of targets) {
  let source = fs.readFileSync(target.file, 'utf8');

  if (!source.includes('gameday-config.js')) {
    const createClientImport = /import\s*\{\s*createClient\s*\}\s*from\s*["']https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/\+esm["'];/m;
    if (!createClientImport.test(source)) {
      throw new Error(`${target.file}: createClient import not found`);
    }
    source = source.replace(
      createClientImport,
      match => `${match}\nimport{GAMEDAY_CONFIG}from"./gameday-config.js";`
    );
  }

  const embeddedClient = /const\s+supabase\s*=\s*createClient\(\s*["']https:\/\/[^"']+\.supabase\.co["']\s*,\s*["']sb_publishable_[^"']+["']\s*\);/m;
  if (embeddedClient.test(source)) {
    source = source.replace(
      embeddedClient,
      'const supabase = createClient(GAMEDAY_CONFIG.supabaseUrl,GAMEDAY_CONFIG.supabasePublishableKey);'
    );
  }

  const quotedFunction = new RegExp(`["']${target.legacyFunction}["']`, 'g');
  source = source.replace(quotedFunction, `GAMEDAY_CONFIG.functions.${target.functionKey}`);

  if (!source.includes('gameday-config.js')) {
    throw new Error(`${target.file}: shared config import missing after migration`);
  }
  if (!source.includes(`GAMEDAY_CONFIG.functions.${target.functionKey}`)) {
    throw new Error(`${target.file}: shared function mapping missing after migration`);
  }
  if (/https:\/\/qsvrvhcklnsbekxblpfo\.supabase\.co|sb_publishable_-yCYGvDqIzVFgu90lgoVpw_uoWnYmO0/.test(source)) {
    throw new Error(`${target.file}: legacy embedded GameDay client config remains`);
  }

  fs.writeFileSync(target.file, source);
  console.log(`Centralized ${target.file}`);
}
