const {test,before,after}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),catalog=JSON.parse(fs.readFileSync(root+'/assets/sportsbook/team-logos.json'));
let browser,server,base;
before(async()=>{server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://fixture').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']})});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r))});
test('catalog entries have usable URLs and explicit monograms never claim to be official crests',()=>{
 let monograms=0;
 for(const league of Object.values(catalog.leagues))for(const team of league.teams){
  assert.equal(typeof team.logo,'string');assert(team.logo);
  if(team.logoType==='monogram'){
   monograms++;assert.match(team.logo,/^assets\/sportsbook\/team-monograms\/[a-z0-9_]+-\d+\.svg$/);
   const svg=fs.readFileSync(root+'/'+team.logo,'utf8');assert.match(svg,/crest unavailable/);assert.doesNotMatch(svg,/<script|onload|href=/);
  }else{const u=new URL(team.logo);assert.equal(u.protocol,'https:');assert(['a.espncdn.com','r2.thesportsdb.com'].includes(u.hostname));}
 }
 assert.equal(monograms,148);
});
test('a real page renders local team identity images and keeps a safe fallback when external art fails',async t=>{
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 await context.route('https://**/*',r=>r.abort());const p=await context.newPage();await p.goto(base+'/offline.html');
 await p.evaluate(async()=>{const {teamLabel,hydrateTeamLogos}=await import('./gameday-team-logos.js');document.body.innerHTML=teamLabel('Andrew Fighting Tigers','ncaaf')+teamLabel('Arizona Cardinals','nfl');await hydrateTeamLogos(document.body)});
 await p.waitForFunction(()=>document.querySelector('[data-gd-team-name="Andrew Fighting Tigers"] img')?.complete);
 const badge=p.locator('[data-gd-team-name="Andrew Fighting Tigers"] .gd-team-logo');
 assert.equal(await badge.getAttribute('data-gd-logo-type'),'monogram');assert.match(await badge.getAttribute('title'),/crest unavailable/);
 assert(await badge.locator('img').evaluate(el=>el.naturalWidth>0));assert.equal(await p.locator('[data-gd-team-name="Arizona Cardinals"] .gd-team-text').textContent(),'Arizona Cardinals');
 await p.waitForFunction(()=>document.querySelector('[data-gd-team-name="Arizona Cardinals"] img')?.hidden===true);
 assert.equal(await p.locator('[data-gd-team-name="Arizona Cardinals"] .gd-team-monogram').textContent(),'AC');
});
test('untrusted and traversing catalog URLs cannot become images',async t=>{
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 const records=[['Unsafe','https://evil.example/logo.png'],['Traversal','assets/sportsbook/team-monograms/../../private.svg'],['Script','javascript:alert(1)']];
 await context.route('**/assets/sportsbook/team-logos.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({leagues:{nfl:{teams:records.map(([name,logo],id)=>({id,name,names:[],logo}))}}})}));
 const p=await context.newPage();await p.goto(base+'/offline.html');await p.evaluate(async()=>{const {teamLabel,hydrateTeamLogos}=await import('./gameday-team-logos.js');document.body.innerHTML=['Unsafe','Traversal','Script'].map(n=>teamLabel(n,'nfl')).join('');await hydrateTeamLogos(document.body)});
 assert.equal(await p.locator('.gd-team-identity img').count(),0);assert.equal(await p.locator('.gd-team-text').count(),3);
});
