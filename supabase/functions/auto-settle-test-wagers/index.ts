import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

import { resolveGradingSport, isFootballGradingSport, isMlbGradingSport } from "../place-test-wager/sport-keys.ts";

const headers={'Content-Type':'application/json'};

const STANDARD_MARKETS=new Set(['h2h','spreads','totals']);
const FOOTBALL_PROP_BASE=new Set(['player_pass_yds','player_pass_tds','player_pass_attempts','player_pass_completions','player_pass_interceptions','player_rush_yds','player_rush_attempts','player_reception_yds','player_receptions','player_rush_reception_yds']);
const MLB_PROPS=new Set(['batter_doubles_alternate','batter_hits','batter_hits_alternate','batter_hits_runs_rbis_alternate','batter_home_runs','batter_rbis','batter_rbis_alternate','batter_runs_scored_alternate','batter_total_bases','batter_total_bases_alternate','pitcher_outs','pitcher_strikeouts_alternate']);
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers})}
function clean(v:unknown){return String(v??'').trim()}
function norm(v:unknown){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(jr|sr|ii|iii|iv)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function num(v:unknown){if(v===null||v===undefined||clean(v)==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function decimalFromAmerican(odds:number){return odds>0?1+odds/100:1+100/Math.abs(odds)}
function isSoccer(sport:string){return ['mls','epl','ucl'].includes(sport)||sport.startsWith('soccer_')}
function propBase(key:string){return key.endsWith('_alternate')?key.slice(0,-10):key}
function isFootballProp(key:string,sport:string){return isFootballGradingSport(sport)&&FOOTBALL_PROP_BASE.has(propBase(key))}
function isMlbProp(key:string,sport:string){return isMlbGradingSport(sport)&&MLB_PROPS.has(key)}
function isoDateAt(value:string,offset=0){const d=new Date(value);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}
const REQUEST_TIMEOUT_MS=10_000;
const JOB_BUDGET_MS=100_000;
const SCORE_WINDOW_MS=3*24*60*60*1000;
// Include body reading in the abort window. A header-only response must not hold
// a leased queue indefinitely, nor outlive the Edge Function wall-clock limit.
async function boundedFetch(input:RequestInfo|URL,init:RequestInit={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  const abort=()=>controller.abort();
  init.signal?.addEventListener('abort',abort,{once:true});
  if(init.signal?.aborted)controller.abort();
  try{
    const response=await fetch(input,{...init,signal:controller.signal});
    const raw=await response.text();
    return new Response([204,205,304].includes(response.status)?null:raw,{status:response.status,statusText:response.statusText,headers:response.headers});
  }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort)}
}
async function fetchScores(providerSport:string,apiKey:string,eventIds:string[],fetcher=boundedFetch){const params=new URLSearchParams({apiKey,daysFrom:'3',dateFormat:'iso',eventIds:eventIds.join(',')});const r=await fetcher(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(providerSport)}/scores/?${params}`);const data=await r.json();if(!r.ok||!Array.isArray(data))throw new Error('Scores provider unavailable');return data}
function scoreForTeam(game:any,teamName:string){const target=norm(teamName);const row=(Array.isArray(game?.scores)?game.scores:[]).find((s:any)=>norm(s?.name)===target);return num(row?.score)}
function finalScores(game:any){const homeName=clean(game?.home_team),awayName=clean(game?.away_team);return{home:scoreForTeam(game,homeName),away:scoreForTeam(game,awayName)}}
function gradeStandard(s:any,game:any){if(!game?.completed)return null;const homeName=clean(game?.home_team),awayName=clean(game?.away_team),{home,away}=finalScores(game);if(home===null||away===null)return null;const market=clean(s?.market_key),selection=norm(s?.selection_name),sport=clean(s?.sport_key).toLowerCase(),point=s?.point===null||s?.point===undefined||s?.point===''?null:Number(s.point);let result:'won'|'lost'|'void'|null=null;if(market==='h2h'){const hk=norm(homeName),ak=norm(awayName);if(selection==='draw'||selection==='tie')result=home===away?'won':'lost';else if(selection===hk){if(home>away)result='won';else if(home<away)result='lost';else result=isSoccer(sport)?'lost':'void'}else if(selection===ak){if(away>home)result='won';else if(away<home)result='lost';else result=isSoccer(sport)?'lost':'void'}else return null}else if(market==='spreads'){if(point===null||!Number.isFinite(point))return null;const hk=norm(homeName),ak=norm(awayName);let adjusted:number,opponent:number;if(selection===hk){adjusted=home+point;opponent=away}else if(selection===ak){adjusted=away+point;opponent=home}else return null;result=adjusted>opponent?'won':adjusted<opponent?'lost':'void'}else if(market==='totals'){if(point===null||!Number.isFinite(point))return null;const total=home+away;if(total===point)result='void';else if(selection==='over')result=total>point?'won':'lost';else if(selection==='under')result=total<point?'won':'lost';else return null}else return null;return{selection_id:String(s.id),result,final_home_score:home,final_away_score:away}}
function gradeThreshold(s:any,actual:number,game:any){const point=num(s?.point),side=norm(s?.selection_name);if(point===null||!['over','under'].includes(side))return null;let result:'won'|'lost'|'void';if(actual===point)result='void';else if(side==='over')result=actual>point?'won':'lost';else result=actual<point?'won':'lost';const{home,away}=finalScores(game);return{selection_id:String(s.id),result,final_home_score:home,final_away_score:away}}

async function apiSportsGamesForDate(key:string,date:string,fetcher=boundedFetch){const r=await fetcher(`https://v1.american-football.api-sports.io/games?date=${date}`,{headers:{'x-apisports-key':key}});const data=await r.json();if(!r.ok||Object.keys(data?.errors??{}).length||!Array.isArray(data?.response))throw new Error('Football scores unavailable');return Array.isArray(data?.response)?data.response:[]}
function apiGameTeams(g:any){return{home:clean(g?.teams?.home?.name??g?.home?.name),away:clean(g?.teams?.away?.name??g?.away?.name)}}
function apiGameStatus(g:any){return clean(g?.game?.status?.short??g?.status?.short)}
async function matchApiFootballGame(event:any,key:string,gameCache:Map<string,any[]>,fetcher=boundedFetch){const kickoff=String(event.commence_time);for(const off of [0,-1,1]){const date=isoDateAt(kickoff,off);if(!gameCache.has(date))gameCache.set(date,await apiSportsGamesForDate(key,date,fetcher));for(const g of gameCache.get(date)??[]){const t=apiGameTeams(g);if(norm(t.home)===norm(event.home_team)&&norm(t.away)===norm(event.away_team))return g}}return null}
async function fetchFootballPlayerStats(gameId:string,key:string,cache:Map<string,any[]>,fetcher=boundedFetch){if(cache.has(gameId))return cache.get(gameId)!;const r=await fetcher(`https://v1.american-football.api-sports.io/games/statistics/players?id=${encodeURIComponent(gameId)}`,{headers:{'x-apisports-key':key}});const data=await r.json();if(!r.ok||Object.keys(data?.errors??{}).length||!Array.isArray(data?.response))throw new Error('Football statistics unavailable');const rows=Array.isArray(data?.response)?data.response:[];cache.set(gameId,rows);return rows}
function playerStatRows(rows:any[],playerName:string){const target=norm(playerName),found:any[]=[];for(const team of rows)for(const group of team?.groups??[])for(const p of group?.players??[])if(norm(p?.player?.name)===target)found.push({group:clean(group?.name).toLowerCase(),stats:p?.statistics??[]});return found}
function statValue(stats:any[],name:string){const row=stats.find((x:any)=>clean(x?.name).toLowerCase()===name.toLowerCase());return num(row?.value)}
function compAtt(stats:any[]){const row=stats.find((x:any)=>clean(x?.name).toLowerCase()==='comp att');const m=clean(row?.value).match(/^(\d+)\s*\/\s*(\d+)$/);return m?{completions:Number(m[1]),attempts:Number(m[2])}:null}
function footballPropActual(key:string,rows:any[],player:string){const base=propBase(key),pr=playerStatRows(rows,player);if(!pr.length)return null;const group=(name:string)=>pr.find(x=>x.group===name.toLowerCase())?.stats??null;const passing=group('passing'),rushing=group('rushing'),receiving=group('receiving');if(base==='player_pass_yds')return passing?statValue(passing,'yards'):null;if(base==='player_pass_tds')return passing?statValue(passing,'passing touch downs'):null;if(base==='player_pass_interceptions')return passing?statValue(passing,'interceptions'):null;if(base==='player_pass_attempts'){const ca=passing?compAtt(passing):null;return ca?.attempts??null}if(base==='player_pass_completions'){const ca=passing?compAtt(passing):null;return ca?.completions??null}if(base==='player_rush_yds')return rushing?statValue(rushing,'yards'):null;if(base==='player_rush_attempts')return rushing?statValue(rushing,'total rushes'):null;if(base==='player_reception_yds')return receiving?statValue(receiving,'yards'):null;if(base==='player_receptions')return receiving?statValue(receiving,'total receptions'):null;if(base==='player_rush_reception_yds'){if(!rushing&&!receiving)return null;const r=rushing?statValue(rushing,'yards'):0,rec=receiving?statValue(receiving,'yards'):0;if(r===null||rec===null)return null;return r+rec}return null}

async function mlbJson(url:string,fetcher=boundedFetch){const r=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'GameDay-Sports/1.0'}});if(!r.ok)throw new Error('Baseball statistics unavailable');return await r.json()}
async function matchMlbGame(event:any,scheduleCache:Map<string,any[]>,fetcher=boundedFetch){for(const off of [0,-1,1]){const date=isoDateAt(String(event.commence_time),off);if(!scheduleCache.has(date)){const d=await mlbJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,fetcher);const all:any[]=[];for(const day of d?.dates??[])for(const g of day?.games??[])all.push(g);scheduleCache.set(date,all)}for(const g of scheduleCache.get(date)??[]){const home=clean(g?.teams?.home?.team?.name),away=clean(g?.teams?.away?.team?.name);if(norm(home)===norm(event.home_team)&&norm(away)===norm(event.away_team))return g}}return null}
async function fetchMlbBox(gamePk:string,cache:Map<string,any>,fetcher=boundedFetch){if(cache.has(gamePk))return cache.get(gamePk);const box=await mlbJson(`https://statsapi.mlb.com/api/v1/game/${encodeURIComponent(gamePk)}/boxscore`,fetcher);cache.set(gamePk,box);return box}
function findMlbPlayer(box:any,playerName:string,kind:'batting'|'pitching'){const target=norm(playerName);for(const side of ['away','home']){const team=box?.teams?.[side],pitcherIds=new Set((team?.pitchers??[]).map((id:any)=>String(id)));for(const p of Object.values(team?.players??{}) as any[]){if(norm(p?.person?.fullName)!==target)continue;if(kind==='batting'){const b=p?.stats?.batting;if(!b||!Object.keys(b).length||Number(b?.plateAppearances??0)<=0)return null;return b}else{if(!pitcherIds.has(String(p?.person?.id??'')))return null;const x=p?.stats?.pitching;if(!x||!Object.keys(x).length)return null;return x}}}return null}
function mlbPropActual(key:string,box:any,player:string){if(key.startsWith('pitcher_')){const x=findMlbPlayer(box,player,'pitching');if(!x)return null;if(key==='pitcher_outs')return num(x.outs);if(key==='pitcher_strikeouts_alternate')return num(x.strikeOuts);return null}const b=findMlbPlayer(box,player,'batting');if(!b)return null;if(key==='batter_doubles_alternate')return num(b.doubles);if(key==='batter_hits'||key==='batter_hits_alternate')return num(b.hits);if(key==='batter_home_runs')return num(b.homeRuns);if(key==='batter_rbis'||key==='batter_rbis_alternate')return num(b.rbi);if(key==='batter_runs_scored_alternate')return num(b.runs);if(key==='batter_total_bases'||key==='batter_total_bases_alternate')return num(b.totalBases);if(key==='batter_hits_runs_rbis_alternate'){const h=num(b.hits),r=num(b.runs),rbi=num(b.rbi);return h===null||r===null||rbi===null?null:h+r+rbi}return null}

// Database and provider filters stay bounded even for a twenty-leg parlay.
function chunks<T>(values:T[],size=100){const result:T[][]=[];for(let i=0;i<values.length;i+=size)result.push(values.slice(i,i+size));return result}
function validFinalGame(game:any){const scores=finalScores(game);return game?.completed===true&&clean(game.id)!==''&&clean(game.home_team)!==''&&clean(game.away_team)!==''&&scores.home!==null&&scores.away!==null&&scores.home>=0&&scores.away>=0}
function oldMissingReason(event:any,wager:any){
  if(['cancelled','canceled','abandoned'].includes(clean(event?.status).toLowerCase()))return 'event_cancellation_requires_review';
  const kickoff=Date.parse(clean(event?.commence_time));
  if(Number.isFinite(kickoff)&&kickoff<Date.now()-SCORE_WINDOW_MS)return 'score_missing_beyond_provider_window';
  if(!Number.isFinite(kickoff)&&Date.parse(clean(wager?.placed_at))<Date.now()-SCORE_WINDOW_MS)return 'event_metadata_missing';
  return null;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  if(!clean(req.headers.get('x-gameday-job-token')))return reply({error:'Unauthorized'},401);
  const startedAt=Date.now();
  const jobSignal=AbortSignal.timeout(JOB_BUDGET_MS);
  const jobFetch=(input:RequestInfo|URL,init:RequestInit={})=>boundedFetch(input,{...init,signal:init.signal?AbortSignal.any([init.signal,jobSignal]):jobSignal});
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const oddsKey=Deno.env.get('ODDS_API_KEY'),sportsKey=Deno.env.get('API_SPORTS_KEY');
  if(!url||!service||!oddsKey)return reply({error:'Settlement backend is not configured'},503);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:jobFetch}});
  try{
    const {data:secretRow,error:secretError}=await admin.from('internal_job_secrets').select('secret').eq('name','auto-settle-test-wagers').single();
    if(secretError||!secretRow?.secret)return reply({error:'Settlement job secret unavailable'},503);
    if(req.headers.get('x-gameday-job-token')!==secretRow.secret)return reply({error:'Unauthorized'},401);
  }catch{return reply({error:'Settlement job secret unavailable'},503)}

  const processingToken=crypto.randomUUID();
  let claimed=0,checked=0,settled=0,skippedPending=0,skippedUnsupported=0,reviewRequired=0,providerErrors=0,checkErrors=0;
  const results:any[]=[];
  try{
    const claim=await admin.rpc('claim_test_wager_settlement_batch',{p_processing_token:processingToken,p_limit:100});
    if(claim.error)throw new Error('Settlement queue unavailable');
    const wagerIds=(claim.data??[]).map((row:any)=>String(row.wager_id));
    claimed=wagerIds.length;
    if(!wagerIds.length){
      const health=await admin.rpc('get_test_wager_settlement_health');
      if(health.error)throw new Error('Settlement backlog unavailable');
      return reply({ok:true,claimed:0,checked:0,settled:0,skipped_pending:0,skipped_unsupported:0,review_required:0,provider_errors:0,queue_remaining:health.data?.pending_count??0,backlog:health.data});
    }
    const wagerRead=await admin.from('wagers').select('id,wager_type,stake,potential_return,status,placed_at,wager_selections(id,event_id,event_name,sport_key,market_key,selection_name,description,point,american_odds)').eq('is_test',true).in('status',['pending','accepted']).in('id',wagerIds);
    if(wagerRead.error)throw new Error('Settlement wagers unavailable');
    const byWagerId=new Map((wagerRead.data??[]).map((w:any)=>[String(w.id),w]));
    const wagers=wagerIds.map((id:string)=>byWagerId.get(id)).filter(Boolean) as any[];
    const eventsById=new Map<string,any>();
    const eventIds=[...new Set<string>(wagers.flatMap(w=>(w.wager_selections??[]).map((s:any)=>String(s.event_id))))];
    for(const group of chunks(eventIds)){
      const read=await admin.from('sports_events').select('provider_event_id,commence_time,home_team,away_team,status').in('provider_event_id',group);
      if(read.error)throw new Error('Settlement event metadata unavailable');
      for(const event of read.data??[])eventsById.set(String(event.provider_event_id),event);
    }
    const eventsBySport=new Map<string,Set<string>>();
    for(const wager of wagers)for(const selection of wager.wager_selections??[]){
      const sport=resolveGradingSport(selection.sport_key),market=clean(selection.market_key);
      if(sport&&(STANDARD_MARKETS.has(market)||isFootballProp(market,sport)||isMlbProp(market,sport))){
        if(!eventsBySport.has(sport))eventsBySport.set(sport,new Set());
        eventsBySport.get(sport)!.add(String(selection.event_id));
      }
    }
    const scoresBySport=new Map<string,Map<string,any>>(),failedSports=new Set<string>();
    // Read persistent receipts first. Provider outages cannot erase prior verified finals.
    for(const [sport,ids] of eventsBySport){
      const scores=new Map<string,any>();scoresBySport.set(sport,scores);
      for(const group of chunks([...ids])){
        const read=await admin.from('test_wager_final_scores').select('provider_event_id,game').eq('sport_key',sport).in('provider_event_id',group);
        if(read.error)throw new Error('Saved final scores unavailable');
        for(const row of read.data??[])if(validFinalGame(row.game))scores.set(String(row.provider_event_id),row.game);
      }
    }
    await Promise.all([...eventsBySport].map(async([sport,ids])=>{
      const receiptRows:any[]=[];
      try{
        for(const group of chunks([...ids])){
          const rows=await fetchScores(sport,oddsKey,group,jobFetch);
          for(const game of rows){
            if(!ids.has(String(game?.id)))continue;
            // An incomplete or malformed refresh must not overwrite a retained final.
            if(validFinalGame(game)){
              scoresBySport.get(sport)!.set(String(game.id),game);
              receiptRows.push({sport_key:sport,provider_event_id:String(game.id),game,captured_at:new Date().toISOString()});
            }else if(!scoresBySport.get(sport)!.has(String(game?.id)))scoresBySport.get(sport)!.set(String(game?.id),game);
          }
        }
      }catch{failedSports.add(sport)}
      // Persist completed legs before a partially completed parlay can be skipped.
      if(receiptRows.length){
        const saved=await admin.from('test_wager_final_scores').upsert(receiptRows,{onConflict:'sport_key,provider_event_id'});
        if(saved.error)throw new Error('Completed score receipt could not be saved');
      }
    }));
    const apiGamesByDate=new Map<string,any[]>(),footballStatsByGame=new Map<string,any[]>();
    const mlbScheduleCache=new Map<string,any[]>(),mlbBoxCache=new Map<string,any>();
    const finish=async(wager:any,outcome:string,reason:string|null=null,extra:any={})=>{
      const done=await admin.rpc('finish_test_wager_settlement_check',{p_wager_id:wager.id,p_processing_token:processingToken,p_outcome:outcome,p_reason:reason,...extra});
      if(done.error){
        // If the atomic RPC rejected the grade, preserve an operator-visible
        // failure. A lost committed response has already cleared this lease,
        // so this recovery call cannot alter or credit that settled wager.
        const recorded=await admin.rpc('finish_test_wager_settlement_check',{p_wager_id:wager.id,p_processing_token:processingToken,p_outcome:'error',p_reason:outcome==='settled'?'atomic_settlement_failed':'settlement_check_failed'});
        checkErrors++;
        if(recorded.data?.applied)reviewRequired++;
        results.push({wager_id:wager.id,error:'settlement_check_failed'});return null;
      }
      return done.data;
    };
    for(const wager of wagers){
      // A crash or a budget cutoff leaves a leased attempt, not a wallet change.
      // Its lease expires and the due-time ordering rotates the next batch fairly.
      if(Date.now()-startedAt>=JOB_BUDGET_MS)break;
      checked++;
      const selections=wager.wager_selections??[],grades:any[]=[];
      let outcome='waiting',reason:string|null=null,unsupported=false;
      if(!selections.length){outcome='review';reason='empty_wager';unsupported=true}
      for(const selection of selections){
        const sport=resolveGradingSport(selection.sport_key),market=clean(selection.market_key);
        if(!sport||!(STANDARD_MARKETS.has(market)||isFootballProp(market,sport)||isMlbProp(market,sport))){outcome='review';reason='unsupported_selection';unsupported=true;break}
        const game=scoresBySport.get(sport)?.get(String(selection.event_id));
        const event=eventsById.get(String(selection.event_id))??game;
        if(!game){
          if(failedSports.has(sport)){outcome='provider_error';reason='scores_unavailable'}
          else{reason=oldMissingReason(event,wager);outcome=reason?'review':'waiting'}
          break;
        }
        if(game.completed!==true){reason='event_not_completed';break}
        if(!validFinalGame(game)){outcome='review';reason='invalid_final_scores';break}
        if(STANDARD_MARKETS.has(market)){
          const grade=gradeStandard(selection,game);
          if(!grade){outcome='review';reason='selection_not_gradeable';unsupported=true;break}
          grades.push(grade);continue;
        }
        if(!event?.commence_time){outcome='review';reason='event_metadata_missing';break}
        try{
          let actual:number|null=null;
          if(isFootballProp(market,sport)){
            if(!sportsKey){outcome='provider_error';reason='football_statistics_not_configured';break}
            const apiGame=await matchApiFootballGame(event,sportsKey,apiGamesByDate,jobFetch);
            if(!apiGame||!['FT','AOT','AP'].includes(apiGameStatus(apiGame))){reason='football_result_not_available';break}
            const gameId=clean(apiGame?.game?.id??apiGame?.id);
            if(!gameId){reason='football_game_id_missing';break}
            const statRows=await fetchFootballPlayerStats(gameId,sportsKey,footballStatsByGame,jobFetch);
            actual=footballPropActual(market,statRows,clean(selection.description));
          }else{
            const mlbGame=await matchMlbGame(event,mlbScheduleCache,jobFetch);
            const final=clean(mlbGame?.status?.abstractGameState).toLowerCase()==='final'||clean(mlbGame?.status?.detailedState).toLowerCase().includes('final');
            if(!mlbGame?.gamePk||!final){reason='baseball_result_not_available';break}
            const box=await fetchMlbBox(String(mlbGame.gamePk),mlbBoxCache,jobFetch);
            actual=mlbPropActual(market,box,clean(selection.description));
          }
          if(actual===null){reason='player_statistics_not_available';break}
          const grade=gradeThreshold(selection,actual,game);
          if(!grade){outcome='review';reason='selection_not_gradeable';unsupported=true;break}
          grades.push(grade);
        }catch{outcome='provider_error';reason='player_statistics_unavailable';break}
      }
      if(grades.length!==selections.length||!selections.length){
        if(outcome==='waiting'&&reason&&reason!=='event_not_completed'&&oldMissingReason(eventsById.get(String(selections[grades.length]?.event_id)),wager))outcome='review';
        const done=await finish(wager,outcome,reason);
        if(done?.applied){
          if(outcome==='review')reviewRequired++;
          else if(outcome==='provider_error')providerErrors++;
          else skippedPending++;
          if(unsupported)skippedUnsupported++;
          results.push({wager_id:wager.id,state:outcome,reason});
        }
        continue;
      }
      const anyLost=grades.some(g=>g.result==='lost'),allVoid=grades.every(g=>g.result==='void');
      const result=anyLost?'lost':allVoid?'void':'won';
      let credit=0;
      if(result==='void')credit=Number(wager.stake);
      else if(result==='won'){
        let decimal=1;
        for(let i=0;i<grades.length;i++)if(grades[i].result==='won')decimal*=decimalFromAmerican(Number(selections[i].american_odds));
        credit=Math.round(Number(wager.stake)*decimal*100)/100;
      }
      const done=await finish(wager,'settled',null,{p_result:result,p_credit:credit,p_grades:grades});
      if(done?.applied){settled++;results.push({wager_id:wager.id,result,credit,settlement:done.settlement})}
    }
    const health=await admin.rpc('get_test_wager_settlement_health');
    if(health.error)throw new Error('Settlement backlog unavailable');
    return reply({ok:checkErrors===0,claimed,checked,settled,skipped_pending:skippedPending,skipped_unsupported:skippedUnsupported,review_required:reviewRequired,provider_errors:providerErrors,check_errors:checkErrors,deferred:claimed-checked,queue_remaining:health.data?.pending_count??0,backlog:health.data,results},checkErrors?503:200);
  }catch{
    // Claims are recoverable after their lease; never invent a settlement on error.
    return reply({ok:false,error:'Settlement checks could not finish. Leased tickets will retry.',claimed,checked,settled,results},503);
  }
});
