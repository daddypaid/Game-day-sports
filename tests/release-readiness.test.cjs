const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
let release, handoff;
async function modules() {
  release ||= (await import('../scripts/check-gameday-release.mjs')).checkRelease;
  handoff ||= (await import('../scripts/check-gameday-handoff.mjs')).checkHandoff;
}
async function copyFixture(callback) {
  await modules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gameday-release-check-'));
  try {
    // Hardlinks keep binary artwork cheap; modified files must be unlinked first.
    function copy(from,to) {
      fs.mkdirSync(to,{recursive:true});
      for(const item of fs.readdirSync(from,{withFileTypes:true})) {
        if(['.git','node_modules','test-results','playwright-report'].includes(item.name))continue;
        const source=path.join(from,item.name),target=path.join(to,item.name);
        if(item.isDirectory())copy(source,target);else {
          try { fs.linkSync(source,target); } catch(error) { if(error.code!=='EXDEV')throw error;fs.copyFileSync(source,target); }
        }
      }
    }
    copy(root,dir);
    const change = (file,fn) => {const target=path.join(dir,file),before=fs.readFileSync(target,'utf8');fs.unlinkSync(target);fs.writeFileSync(target,fn(before));};
    return await callback(dir,change);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('Current release validates configured game services, matching PWA cache and resources', async()=>{
  await modules();const result=release(root);assert(result.pages>=19);assert(result.shell>=178);
});
test('Release rejects missing shell resources and mismatched PWA registration versions',()=>copyFixture((dir,change)=>{
  fs.unlinkSync(path.join(dir,'gameday-casino-history.css'));
  assert.throws(()=>release(dir),/Missing shell resource/);
  fs.copyFileSync(path.join(root,'gameday-casino-history.css'),path.join(dir,'gameday-casino-history.css'));
  change('gameday-app.js',s=>s.replace(/sw\.js\?v=\d+/,'sw.js?v=0'));
  assert.throws(()=>release(dir),/PWA registration version/);
}));
test('Release follows imported controllers and rejects wrong current slot service',()=>copyFixture((dir,change)=>{
  change('gameday-midnight-monsters-game.js',s=>s.replaceAll("functionUrl('themedSlots')","functionUrl('not-configured')"));
  assert.throws(()=>release(dir),/configured game service/);
}));
test('Release scans deployable browser resources and rejects secret key literals',()=>copyFixture((dir)=>{
  fs.writeFileSync(path.join(dir,'fixture-browser.js'),"const unsafe='sb_secret_fixture_private_key';");
  assert.throws(()=>release(dir),/Private credential reference/);
}));
test('Handoff checks fail if a configured backend source is absent',()=>copyFixture(async(dir)=>{
  fs.rmSync(path.join(dir,'supabase/functions/blackjack-test'),{recursive:true,force:true});
  await assert.rejects(handoff({root:dir,mode:'transfer'}),/ENOENT/);
}));
test('Handoff checks evaluate config values rather than exact quote formatting',()=>copyFixture(async(dir,change)=>{
  change('gameday-config.js',s=>s.replace("environment: 'TEST'",'environment: "TEST"'));
  await handoff({root:dir,mode:'all'});
  change('gameday-config.js',s=>s.replace('environment: "TEST"','environment: "LIVE"'));
  await assert.rejects(handoff({root:dir,mode:'transfer'}),/TEST mode/);
}));
test('Handoff rejects broken configured navigation and real backend wagering in the instant demo',()=>copyFixture(async(dir,change)=>{
  change('gameday-config.js',s=>s.replace("home: 'index.html'","home: 'missing-route.html'"));
  await assert.rejects(handoff({root:dir,mode:'all'}),/ENOENT/);
  change('gameday-config.js',s=>s.replace("home: 'missing-route.html'","home: 'index.html'"));
  change('gameday-v5.html',s=>s+'\n<script>supabase.rpc("place_wager")</script>');
  await assert.rejects(handoff({root:dir,mode:'sale'}),/must not submit backend wagers/);
}));
test('Handoff checks include deployed backend bundles that are not directly configured in browser routes',()=>copyFixture(async(dir)=>{
  fs.rmSync(path.join(dir,'supabase/functions/odds-proxy'),{recursive:true,force:true});
  await assert.rejects(handoff({root:dir,mode:'transfer'}),/ENOENT/);
}));
test('Handoff rejects an encoded legacy service-role key in public configuration',()=>copyFixture(async(dir,change)=>{
  const payload=Buffer.from(JSON.stringify({role:'service_role',ref:'qsvrvhcklnsbekxblpfo'})).toString('base64url');
  const privateFixture='fixture-header.'+payload+'.fixture-signature';
  change('gameday-config.js',s=>s.replace(/supabasePublishableKey:\s*'[^']+'/,"supabasePublishableKey: '"+privateFixture+"'"));
  await assert.rejects(handoff({root:dir,mode:'transfer'}),/private keys are forbidden/);
}));
