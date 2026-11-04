const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

// Exercise the actual odds-engine aggregation helper with fixture bookmaker quotes.
// Strip TypeScript-only annotations; neither a network call nor real wagers are used.
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/odds-engine/index.ts'),'utf8');
const start=source.indexOf('function median('),end=source.indexOf('function normalizeGame(',start);
assert(start>=0&&end>start,'Odds engine exposes the consensus helper');
const js=source.slice(start,end)
 .replaceAll('values:number[]','values')
 .replaceAll('values:Array<number|null>','values')
 .replaceAll('(v):v is number','(v)')
 .replaceAll('new Map<number,number>()','new Map()')
 .replaceAll('bookmakers:any[]=[]','bookmakers=[]')
 .replaceAll('(b:any)','(b)')
 .replaceAll('(m:any)','(m)')
 .replaceAll('new Map<string,any[]>()','new Map()')
 .replaceAll('groups.get(sig)!.push(outcome)','groups.get(sig).push(outcome)');
const aggregate=new Function(js+'\nreturn consensusBookmaker;')();

const outcome=(name,point,price)=>({name,description:null,point,price});
test('alternate spreads preserve separate verified half-point lines instead of collapsing into one',()=>{
 const books=[
  {markets:[{key:'alternate_spreads',outcomes:[outcome('Fixture Home',-3,-125),outcome('Fixture Home',-2.5,-145)]}]},
  {markets:[{key:'alternate_spreads',outcomes:[outcome('Fixture Home',-3,-130),outcome('Fixture Home',-2.5,-150)]}]}
 ];
 const lines=aggregate(books).markets.find(m=>m.key==='alternate_spreads').outcomes;
 assert.deepEqual(lines.map(x=>x.point),[-3,-2.5]);
 assert.equal(lines[0].price,-127);
 assert.equal(lines[1].price,-147);
});
test('alternate totals preserve distinct over/under prices for each point',()=>{
 const markets=[{key:'alternate_totals',outcomes:[
  outcome('Over',43.5,-125),outcome('Over',44,-140),
  outcome('Under',44.5,-125),outcome('Under',45,-140)
 ]}];
 const lines=aggregate([{markets}]).markets[0].outcomes;
 assert.deepEqual(lines.filter(x=>x.name==='Over').map(x=>x.point),[43.5,44]);
 assert.deepEqual(lines.filter(x=>x.name==='Under').map(x=>x.point),[44.5,45]);
});
test('alternate markets ignore malformed points rather than advertising unpriceable lines',()=>{
 const lines=aggregate([{markets:[{key:'alternate_spreads',outcomes:[
  outcome('Fixture Home',null,-110),
  outcome('Fixture Home','bad',-125),
  outcome('Fixture Home',-3,-130)
 ]}]}]).markets[0].outcomes;
 assert.equal(lines.length,1);
 assert.equal(lines[0].point,-3);
});
test('NBA sportsbook spreads use only provider-offered integer or half-point lines',()=>{
 const books=[
  {markets:[{key:'spreads',outcomes:[outcome('Atlanta Hawks',-2.5,-110),outcome('Washington Wizards',2.5,-110)]}]},
  {markets:[{key:'spreads',outcomes:[outcome('Atlanta Hawks',-2,-108),outcome('Washington Wizards',2,-112)]}]}
 ];
 const lines=aggregate(books,'basketball_nba').markets.find(m=>m.key==='spreads').outcomes;
 assert.deepEqual(lines.map(x=>x.point),[-2.5,2.5],'No synthetic -2.25/+2.25 spread may be constructed');
 assert.deepEqual(lines.map(x=>x.price),[-110,-110],'Prices correspond to the actual chosen line');
});
test('NBA sportsbook refuses quarter-point quotes and keeps real half-point quotes',()=>{
 const books=[
  {markets:[{key:'spreads',outcomes:[outcome('Home',-2.25,-111),outcome('Away',2.25,-111)]}]},
  {markets:[{key:'spreads',outcomes:[outcome('Home',-2.5,-115),outcome('Away',2.5,-105)]}]}
 ];
 const lines=aggregate(books,'basketball_nba').markets.find(m=>m.key==='spreads').outcomes;
 assert.deepEqual(lines.map(x=>x.point),[-2.5,2.5]);
 assert.deepEqual(lines.map(x=>x.price),[-115,-105]);
});
test('NBA total points use an actual provider line when bookmakers disagree',()=>{
 const books=[
  {markets:[{key:'totals',outcomes:[outcome('Over',231.5,-110),outcome('Under',231.5,-110)]}]},
  {markets:[{key:'totals',outcomes:[outcome('Over',232,-105),outcome('Under',232,-115)]}]}
 ];
 const lines=aggregate(books,'basketball_nba').markets.find(m=>m.key==='totals').outcomes;
 assert.deepEqual(lines.map(x=>x.point),[231.5,231.5]);
});
test('Sport-specific safeguard does not exclude quarter-point Asian soccer handicaps',()=>{
 const books=[{markets:[{key:'spreads',outcomes:[outcome('FC Home',-1.25,-110),outcome('FC Away',1.25,-110)]}]}];
 const lines=aggregate(books,'soccer_epl').markets.find(m=>m.key==='spreads').outcomes;
 assert.deepEqual(lines.map(x=>x.point),[-1.25,1.25]);
});
