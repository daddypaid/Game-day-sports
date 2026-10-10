import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";
import { resolveGradingSport, isFootballGradingSport, isMlbGradingSport } from "./sport-keys.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const STANDARD=new Set(['h2h','spreads','totals']);
const FOOTBALL_PROP_BASE=new Set(['player_pass_yds','player_pass_tds','player_pass_attempts','player_pass_completions','player_pass_interceptions','player_rush_yds','player_rush_attempts','player_reception_yds','player_receptions','player_rush_reception_yds']);
const MLB_PROPS=new Set(['batter_doubles_alternate','batter_hits','batter_hits_alternate','batter_hits_runs_rbis_alternate','batter_home_runs','batter_rbis','batter_rbis_alternate','batter_runs_scored_alternate','batter_total_bases','batter_total_bases_alternate','pitcher_outs','pitcher_strikeouts_alternate']);
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:cors})}
function text(v:unknown){return String(v??'').trim()}
function norm(v:unknown){return text(v).toLowerCase().replace(/\s+/g,' ')}
function sameNumber(a:unknown,b:unknown){if(a===null||a===undefined||a==='')return b===null||b===undefined||b==='';if(b===null||b===undefined||b==='')return false;const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<0.000001}
function propBase(key:string){return key.endsWith('_alternate')?key.slice(0,-10):key}
function isSupportedFootballProp(key:string,sport:string){return isFootballGradingSport(sport)&&FOOTBALL_PROP_BASE.has(propBase(key))}
function isSupportedMlbProp(key:string,sport:string){return isMlbGradingSport(sport)&&MLB_PROPS.has(key)}
function isSupportedProp(key:string,sport:string){return isSupportedFootballProp(key,sport)||isSupportedMlbProp(key,sport)}
async function edgeJson(url:string,anon:string,body:any,label:string){const internal=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';const r=await fetch(`${url}/functions/v1/gameday-odds`,{method:'POST',headers:{'Content-Type':'application/json','apikey':anon,'Authorization':`Bearer ${anon}`,'x-gameday-fresh':internal},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const raw=await r.text();let data:any={};try{data=raw?JSON.parse(raw):{}}catch{}if(!r.ok)throw new Error(data?.detail||data?.error||`Unable to validate ${label}`);return data}
async function loadCurrentGames(url:string,anon:string,sport:string){const data=await edgeJson(url,anon,{mode:'games',sport},`${sport} line`);return Array.isArray(data?.games)?data.games:[]}
async function loadCurrentProps(url:string,anon:string,sport:string,eventId:string,markets:string[]){const data=await edgeJson(url,anon,{mode:'props',sport,event_id:eventId,markets},'player prop');return data?.event||null}
function currentOutcomeFor(selection:any,games:any[]){const game=games.find((g:any)=>text(g?.id)===selection.event_id);if(!game||game?.completed)return{ok:false,code:'LINE_SUSPENDED',message:'This event is no longer available for wagering.'};const bookmaker=Array.isArray(game?.bookmakers)?game.bookmakers[0]:null;const market=bookmaker?.markets?.find((m:any)=>text(m?.key)===selection.market_key);if(!market)return{ok:false,code:'LINE_SUSPENDED',message:'This market is currently suspended.'};const outcomes=Array.isArray(market?.outcomes)?market.outcomes:[];const sameName=outcomes.filter((o:any)=>norm(o?.name)===norm(selection.selection_name));const exact=sameName.find((o:any)=>norm(o?.description)===norm(selection.description)&&sameNumber(o?.point,selection.point));if(!exact){const moved=sameName.find((o:any)=>norm(o?.description)===norm(selection.description))||sameName[0];if(moved)return{ok:false,code:'LINE_CHANGED',message:'The line changed after you selected it.',current_line:{point:moved?.point??null,american_odds:Number(moved?.price)}};return{ok:false,code:'LINE_SUSPENDED',message:'This selection is currently unavailable.'}}const currentOdds=Number(exact?.price);if(!Number.isInteger(currentOdds)||currentOdds===0)return{ok:false,code:'LINE_SUSPENDED',message:'This selection is currently unavailable.'};if(currentOdds!==selection.american_odds)return{ok:false,code:'LINE_CHANGED',message:'The odds changed after you selected this line.',current_line:{point:exact?.point??null,american_odds:currentOdds}};return{ok:true}}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return response({error: 'Method not allowed'},405);
  let admin: any, userId: string | undefined, requestId: string | undefined;
  let processingToken: string | undefined;
  async function rpc(name: string, args: any) {
    const {data,error} = await admin.rpc(name,args);
    if (error) throw error;
    return data;
  }
  async function reject(code: string, message: string, extra: any = {}) {
    const receipt = await rpc('sportsbook_test_request_reject', {
      p_user_id:userId,p_request_id:requestId,p_processing_token:processingToken,
      p_code:code,p_message:message,
    });
    // A competing processor may have committed already. Its receipt always
    // takes precedence over this processor's quote-validation failure.
    return response({...receipt,...(receipt.state === 'rejected' ? extra : {})},
      receipt.state === 'rejected' ? 409 : 200);
  }
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization') || ''}},
      auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError} = await userClient.auth.getUser();
    if (userError || !userData.user) return response({error:'Authentication required'},401);
    userId = userData.user.id;
    admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const body = await req.json();
    requestId = text(body?.request_id).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
      return response({ok:false,code:'REQUEST_ID_REQUIRED',
        error:'Reload GameDay to update wagering, then try again. No test credits were charged.',no_credits_charged:true},400);
    }
    if (body?.recover === true) {
      return response(await rpc('sportsbook_test_request_receipt',{p_user_id:userId,p_request_id:requestId}));
    }
    const wagerType = body?.wager_type, stake = Number(body?.stake);
    const selections = Array.isArray(body?.selections) ? body.selections : [];
    if (!['single','parlay'].includes(wagerType)) throw new Error('Invalid wager type');
    if (!Number.isFinite(stake) || stake <= 0 || stake > 100000 || Math.abs(stake*100-Math.round(stake*100)) > 0.000001) throw new Error('Invalid stake');
    if ((wagerType === 'single' && selections.length !== 1) ||
      (wagerType === 'parlay' && (selections.length < 2 || selections.length > 20))) throw new Error('Invalid selection count');
    const validationTime = new Date().toISOString();
    const normalized = selections.map((s:any) => {
      const odds = Number(s?.american_odds);
      if (!Number.isInteger(odds) || odds === 0) throw new Error('Invalid selection odds');
      if (!text(s?.event_id) || !text(s?.event_name) || !text(s?.market_key) || !text(s?.selection_name)) throw new Error('Selection data is incomplete');
      const point = s.point === null || s.point === undefined || s.point === '' ? null : Number(s.point);
      if (point !== null && !Number.isFinite(point)) throw new Error('Invalid selection point');
      const supplied = s?.quoted_at ? new Date(s.quoted_at) : null;
      if (supplied && Number.isNaN(supplied.getTime())) throw new Error('Invalid quote timestamp');
      return {event_id:text(s.event_id),event_name:text(s.event_name),
        sport_key:resolveGradingSport(s.sport_key) ?? text(s.sport_key).toLowerCase(),
        market_key:text(s.market_key),market_title:text(s.market_title) || null,
        selection_name:text(s.selection_name),description:text(s.description) || null,
        point,american_odds:odds,quoted_at:supplied ? supplied.toISOString() : validationTime};
    });
    const payload = {wager_type:wagerType,stake,selections:normalized.map(({quoted_at,...s}:any) => s)};
    processingToken = crypto.randomUUID();
    const preparation = await rpc('sportsbook_test_request_prepare', {
      p_user_id:userId,p_request_id:requestId,p_payload:payload,p_processing_token:processingToken,
    });
    if (!preparation.processing) return response(preparation,preparation.state === 'conflict' ? 409 : 200);
    if (wagerType === 'parlay' && new Set(normalized.map((s:any) => s.event_id.toLowerCase())).size !== normalized.length) {
      return await reject('SAME_EVENT_PARLAY','Parlays must use different events. Same-event selections are not available. No test credits were charged.');
    }
    const unsupported = normalized.find((s:any) => !resolveGradingSport(s.sport_key) ||
      (!STANDARD.has(s.market_key) && !isSupportedProp(s.market_key,s.sport_key)));
    if (unsupported) return await reject('SETTLEMENT_UNAVAILABLE',
      'This sport or market is view-only in TEST MODE until its automatic grading rule is verified. No test credits were charged.',
      {selection:{event_id:unsupported.event_id,event_name:unsupported.event_name,market_key:unsupported.market_key,selection_name:unsupported.selection_name}});
    const standardSelections = normalized.filter((s:any) => STANDARD.has(s.market_key));
    const sports = [...new Set<string>(standardSelections.map((s:any) => s.sport_key))];
    const gamesBySport = new Map<string,any[]>();
    await Promise.all(sports.map(async sport => gamesBySport.set(sport,await loadCurrentGames(url,anon,sport))));
    for (const s of standardSelections) {
      const verdict:any = currentOutcomeFor(s,gamesBySport.get(s.sport_key) || []);
      if (!verdict.ok) return await reject(verdict.code,verdict.message,{current_line:verdict.current_line || null});
    }
    const propGroups = new Map<string,any[]>();
    for (const s of normalized.filter((s:any) => isSupportedProp(s.market_key,s.sport_key))) {
      if (!s.description || s.point === null) return await reject('SETTLEMENT_UNAVAILABLE',
        'This player prop does not contain enough information for safe grading. No test credits were charged.');
      const key = `${s.sport_key}|${s.event_id}`;
      if (!propGroups.has(key)) propGroups.set(key,[]);
      propGroups.get(key)!.push(s);
    }
    for (const group of propGroups.values()) {
      const sport = group[0].sport_key, eventId = group[0].event_id;
      const uniqueMarkets = [...new Set(group.map((s:any) => s.market_key))], eventMarketMaps:any[] = [];
      for (let i=0;i<uniqueMarkets.length;i+=8) {
        const chunk = uniqueMarkets.slice(i,i+8), event = await loadCurrentProps(url,anon,sport,eventId,chunk);
        if (!event) return await reject('LINE_SUSPENDED','This player prop is currently unavailable.');
        eventMarketMaps.push(event);
      }
      for (const s of group) {
        const candidates = eventMarketMaps.filter((e:any) => Array.isArray(e?.bookmakers?.[0]?.markets) &&
          e.bookmakers[0].markets.some((m:any) => text(m?.key) === s.market_key));
        const verdict:any = currentOutcomeFor(s,candidates.length ? candidates : eventMarketMaps);
        if (!verdict.ok) return await reject(verdict.code,verdict.message,{current_line:verdict.current_line || null});
      }
    }
    return response(await rpc('sportsbook_test_request_commit', {
      p_user_id:userId,p_request_id:requestId,p_processing_token:processingToken,p_selections:normalized,
    }));
  } catch (e:any) {
    const message = e?.message || 'Unable to place test wager';
    if (processingToken && admin && userId && requestId) {
      try { return await reject('PLACEMENT_REJECTED',message); }
      catch { return response({ok:false,state:'pending',request_id:requestId,retry_same_request:true,
        error:'Your wager result is being checked. Recover this request before placing another wager.'},503); }
    }
    // A malformed replay must not claim the original wager was uncharged.
    // Its owner can still recover the original receipt through recover:true.
    if (admin && userId && requestId) {
      try {
        const existing = await rpc('sportsbook_test_request_receipt',{p_user_id:userId,p_request_id:requestId});
        if (existing.state !== 'not_found') return response({ok:false,state:'conflict',request_id:requestId,
          code:'REQUEST_CONFLICT',error:'This saved wager request cannot be changed. Recover its original result first.'},409);
      } catch {
        return response({ok:false,state:'pending',request_id:requestId,retry_same_request:true,
          error:'Your wager result could not be checked. Recover this request before placing another wager.'},503);
      }
    }
    return response({ok:false,state:'rejected',request_id:requestId,code:'INVALID_REQUEST',
      error:message,no_credits_charged:true},400);
  }
});
