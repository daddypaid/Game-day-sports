import { createClient } from 'npm:@supabase/supabase-js@2.115.0'

declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
}
function json(data: unknown, status = 200) {
  // Provider account usage is operational data. Preserve it in internal cache
  // and snapshots, while excluding it from every public response path.
  let customer = data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const { quota: _quota, ...visible } = data as Record<string, unknown>;
    customer = visible;
  }
  return new Response(JSON.stringify(customer), { status, headers: corsHeaders });
}
function secretKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) return null
  try { const parsed = JSON.parse(raw); return parsed.default ?? Object.values(parsed)[0] ?? null } catch { return null }
}
function clean(v: unknown, max=120) { return String(v ?? '').trim().slice(0,max) }
function marketTitle(key: string) {
  if (key === 'h2h') return 'Moneyline'
  if (key === 'spreads') return 'Spread'
  if (key === 'totals') return 'Total'
  if (key === 'outrights') return 'Futures'
  return key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function outcomeKey(outcome: any) { return `${String(outcome?.name ?? '')}|||${String(outcome?.description ?? '')}` }
const MODES=new Set(['sports','games','events','prop_markets','props','future_markets','futures'])
function safeToken(v:unknown,max=120){const s=clean(v,max);return /^[A-Za-z0-9_.:-]*$/.test(s)?s:''}
function safeMarkets(v:unknown){const raw=Array.isArray(v)?v:String(v??'').split(',');return raw.map(x=>safeToken(x,80)).filter(Boolean).slice(0,20)}
function cacheTtl(mode:string){if(mode==='sports')return 3600;if(mode==='future_markets')return 900;if(mode==='events'||mode==='prop_markets'||mode==='futures')return 300;if(mode==='props'||mode==='games')return 60;return 60}
function requestCacheKey(mode:string,body:any){return JSON.stringify({mode,sport:body.sport??'',event_id:body.event_id??'',future_key:body.future_key??'',all:body.all??'',markets:body.markets??[]})}
function filterSportsCatalog(data:any){
  if(!data||!Array.isArray(data.sports))return data
  const sports=data.sports.filter((s:any)=>clean(s?.group,80).toLowerCase()!=='politics')
  const groups=[...new Set(sports.map((s:any)=>clean(s?.group,80)).filter(Boolean))]
  const featured=Array.isArray(data.featured)?data.featured.filter((s:any)=>clean(s?.group,80).toLowerCase()!=='politics'):data.featured
  return {...data,sports,count:sports.length,groups,featured}
}
function staleResponse(payload:any){
  if(payload && typeof payload==='object' && !Array.isArray(payload)){
    return {...payload,cached:true,stale:true,source_status:'cached',notice:'Showing cached GameDay odds while live odds refresh is temporarily unavailable.'}
  }
  return payload
}

const FALLBACK_SPORT_KEYS:Record<string,string>={
  nfl:'americanfootball_nfl',football:'americanfootball_nfl',nba:'basketball_nba',basketball:'basketball_nba',
  wnba:'basketball_wnba',mlb:'baseball_mlb',baseball:'baseball_mlb',nhl:'icehockey_nhl',hockey:'icehockey_nhl',
  ncaaf:'americanfootball_ncaaf',ncaab:'basketball_ncaab',mls:'soccer_usa_mls',epl:'soccer_epl',premierleague:'soccer_epl',
  ucl:'soccer_uefa_champs_league',championsleague:'soccer_uefa_champs_league'
}
function resolveFallbackSport(s:string){const v=clean(s,120).toLowerCase();return FALLBACK_SPORT_KEYS[v]??v}
async function persistedGamesFallback(admin:any,sport:string){
  const sportKey=resolveFallbackSport(sport)
  const cutoff=new Date(Date.now()-6*60*60*1000).toISOString()
  const {data:events,error:eventErr}=await admin.from('sports_events')
    .select('id,provider_event_id,sport_key,sport_title,commence_time,home_team,away_team,status,last_seen_at')
    .eq('sport_key',sportKey)
    .in('status',['scheduled','live'])
    .gte('commence_time',cutoff)
    .order('commence_time',{ascending:true})
    .limit(100)
  if(eventErr||!events?.length)return null
  const eventIds=events.map((e:any)=>e.id)
  const {data:markets,error:marketErr}=await admin.from('sports_markets')
    .select('id,event_id,provider_market_key,market_title,status,line_method,updated_at')
    .in('event_id',eventIds)
    .eq('market_type','game')
    .eq('status','open')
  if(marketErr||!markets?.length)return null
  const marketIds=markets.map((m:any)=>m.id)
  const {data:outcomes,error:outcomeErr}=await admin.from('sports_outcomes')
    .select('market_id,outcome_name,description,point,american_odds,source_book_count,is_active,updated_at')
    .in('market_id',marketIds)
    .eq('is_active',true)
  if(outcomeErr||!outcomes?.length)return null
  const outcomesByMarket=new Map<string,any[]>()
  let newestLineAt:string|null=null
  for(const o of outcomes){
    if(!outcomesByMarket.has(o.market_id))outcomesByMarket.set(o.market_id,[])
    outcomesByMarket.get(o.market_id)!.push({name:o.outcome_name,description:o.description,point:o.point,price:o.american_odds})
    if(o.updated_at&&(!newestLineAt||new Date(o.updated_at)>new Date(newestLineAt)))newestLineAt=o.updated_at
  }
  const marketsByEvent=new Map<string,any[]>()
  for(const m of markets){
    const os=outcomesByMarket.get(m.id)??[]
    if(!os.length)continue
    if(!marketsByEvent.has(m.event_id))marketsByEvent.set(m.event_id,[])
    marketsByEvent.get(m.event_id)!.push({key:m.provider_market_key,last_update:m.updated_at,source_books:null,outcomes:os})
  }
  const games=events.map((e:any)=>{
    const ms=marketsByEvent.get(e.id)??[]
    return {id:e.provider_event_id,sport_key:e.sport_key,sport_title:e.sport_title,commence_time:e.commence_time,home_team:e.home_team,away_team:e.away_team,line_method:'persisted_last_known',source_book_count:null,bookmakers:ms.length?[{key:'gameday',title:'GameDay Sports',markets:ms}]:[]}
  }).filter((g:any)=>g.bookmakers.length)
  if(!games.length)return null
  return {source:'stored',provider:'gameday-database',brand:'GameDay Sports',mode:'games',sport_key:sportKey,sport:clean(sport,120).toLowerCase(),markets:['h2h','spreads','totals'],odds_format:'american',line_method:'persisted_last_known',count:games.length,games,cached:true,stale:true,source_status:'stored_fallback',last_line_update:newestLineAt,notice:'Live provider quota is unavailable. Showing last known GameDay lines from the database; these are not current live odds.'}
}

async function verifyGameScores(data: any) {
  const empty = { visible: data, persist: data, completedScores: [] as any[] }
  if (!data || data.mode !== 'games' || !Array.isArray(data.games) || !data.games.length) return empty
  const apiKey = Deno.env.get('ODDS_API_KEY')
  const sportKey = data.sport_key
  if (!apiKey || !sportKey) return empty
  try {
    const params = new URLSearchParams({ apiKey, daysFrom: '1', dateFormat: 'iso' })
    const response = await fetch(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(String(sportKey))}/scores/?${params}`)
    if (!response.ok) return empty
    const scores = await response.json()
    if (!Array.isArray(scores)) return empty
    const byId = new Map(scores.map((s: any) => [String(s.id), s]))
    const enriched = data.games.map((g:any) => {
      const score = byId.get(String(g.id))
      return { ...g, completed: Boolean(score?.completed), scores: score?.scores ?? null, last_score_update: score?.last_update ?? null }
    })
    const visibleGames = enriched.filter((g:any) => !g.completed)
    return { visible: { ...data, games: visibleGames, count: visibleGames.length }, persist: { ...data, games: enriched, count: enriched.length }, completedScores: scores.filter((s:any) => Boolean(s?.completed)) }
  } catch (e) {
    console.error('GameDay scores verification failed:', e instanceof Error ? e.message : String(e))
    return empty
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const key = secretKey()
  const internal = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !key || !internal) return json({ error: 'GameDay backend is not configured' }, 503)

  let rawBody:any={}
  const requestUrl=new URL(req.url)
  if(req.method==='POST'){try{rawBody=await req.json()}catch{return json({error:'Invalid JSON body'},400)}}
  const requestedMode=clean(requestUrl.searchParams.get('mode')??rawBody?.mode??'games',30).toLowerCase()
  if(!MODES.has(requestedMode))return json({error:'Unsupported GameDay mode'},400)
  const sport=safeToken(requestUrl.searchParams.get('sport')??requestUrl.searchParams.get('sport_key')??rawBody?.sport??rawBody?.sport_key,120).toLowerCase()
  const eventId=safeToken(requestUrl.searchParams.get('event_id')??rawBody?.event_id,120)
  const futureKey=safeToken(requestUrl.searchParams.get('future_key')??rawBody?.future_key,120)
  const allRaw=requestUrl.searchParams.get('all')??rawBody?.all
  const all=(allRaw===true||String(allRaw).toLowerCase()==='true'||String(allRaw)==='1')?'true':''
  const markets=safeMarkets(requestUrl.searchParams.get('markets')??rawBody?.markets??rawBody?.market)
  if(requestedMode!=='sports'&&!sport)return json({error:'Sport is required'},400)
  if(['prop_markets','props'].includes(requestedMode)&&!eventId)return json({error:'Event is required'},400)
  if(requestedMode==='props'&&!markets.length)return json({error:'At least one prop market is required'},400)
  if(requestedMode==='futures'&&!futureKey)return json({error:'Future market is required'},400)
  const body:any={mode:requestedMode}
  if(sport)body.sport=sport
  if(eventId)body.event_id=eventId
  if(futureKey)body.future_key=futureKey
  if(all)body.all=all
  if(markets.length)body.markets=markets
  const fresh=req.headers.get('x-gameday-fresh')===internal
  const cacheKey=requestCacheKey(requestedMode,body)

  const admin=createClient(supabaseUrl,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{'X-Client-Info':'gameday-odds'}}})
  let stalePayload:any=null
  if(!fresh){
    try{
      const{data:cached}=await admin.from('odds_response_cache').select('payload,expires_at').eq('cache_key',cacheKey).maybeSingle()
      if(cached?.payload){
        stalePayload=cached.payload
        if(new Date(cached.expires_at).getTime()>Date.now())return json(cached.payload,200)
      }
    }catch(e){console.error('GameDay cache read failed:',e instanceof Error?e.message:String(e))}
  }

  const upstream=new URL(`${supabaseUrl}/functions/v1/odds-engine`)
  try {
    const upstreamResponse=await fetch(upstream,{method:'POST',headers:{'Content-Type':'application/json','x-gameday-internal':internal},body:JSON.stringify(body)})
    const raw=await upstreamResponse.text();let data:any
    try{data=raw?JSON.parse(raw):null}catch{data={error:raw||'Invalid upstream response'}}
    if(!upstreamResponse.ok){
      if(!fresh&&stalePayload)return json(staleResponse(stalePayload),200)
      if(!fresh&&requestedMode==='games'){
        try{const fallback=await persistedGamesFallback(admin,sport);if(fallback)return json(fallback,200)}catch(e){console.error('Stored GameDay fallback failed:',e instanceof Error?e.message:String(e))}
      }
      console.error('GameDay upstream unavailable:',upstreamResponse.status,clean(data?.error??data?.message??'upstream error',200))
      return json({error:'Live GameDay odds are temporarily unavailable. Please try again shortly.'},503)
    }
    if(requestedMode==='sports')data=filterSportsCatalog(data)
    let persistData=data;let completedScores:any[]=[]
    if(requestedMode==='games'){const verified=await verifyGameScores(data);data=verified.visible;persistData=verified.persist;completedScores=verified.completedScores}
    try{await admin.from('odds_response_cache').upsert({cache_key:cacheKey,payload:data,expires_at:new Date(Date.now()+cacheTtl(requestedMode)*1000).toISOString(),updated_at:new Date().toISOString()})}catch(e){console.error('GameDay cache write failed:',e instanceof Error?e.message:String(e))}

    const persistGame=async(game:any,marketType:'game'|'prop'|'future')=>{
      if(!game?.id||!game?.sport_key||!game?.commence_time)return
      const isLive=!game.completed&&new Date(game.commence_time).getTime()<=Date.now()
      const{data:eventRow,error:eventError}=await admin.from('sports_events').upsert({provider_event_id:String(game.id),sport_key:String(game.sport_key),sport_title:game.sport_title??null,commence_time:game.commence_time,home_team:game.home_team??null,away_team:game.away_team??null,status:game.completed?'final':(isLive?'live':'scheduled'),last_seen_at:new Date().toISOString()},{onConflict:'provider_event_id'}).select('id').single()
      if(eventError||!eventRow?.id)throw eventError??new Error('Event upsert failed')
      const marketTasks:Promise<void>[]=[]
      for(const bookmaker of game.bookmakers??[]){for(const m of bookmaker.markets??[]){marketTasks.push((async()=>{const{data:marketRow,error:marketError}=await admin.from('sports_markets').upsert({event_id:eventRow.id,provider_market_key:String(m.key),market_title:marketTitle(String(m.key)),market_type:marketType,status:game.completed?'closed':'open',line_method:game.line_method??'consensus_median'},{onConflict:'event_id,provider_market_key'}).select('id').single();if(marketError||!marketRow?.id)throw marketError??new Error('Market upsert failed');const rows=(m.outcomes??[]).filter((o:any)=>typeof o?.price==='number').map((o:any)=>({market_id:marketRow.id,outcome_key:outcomeKey(o),outcome_name:String(o.name??''),description:o.description??null,point:o.point??null,american_odds:Math.round(o.price),source_book_count:m.source_books??game.source_book_count??null,is_active:!game.completed}));if(rows.length){const{error}=await admin.from('sports_outcomes').upsert(rows,{onConflict:'market_id,outcome_key'});if(error)throw error}})())}}
      await Promise.all(marketTasks)
    }
    const persistFinalScore=async(score:any)=>{if(!score?.id||!score?.sport_key||!score?.commence_time||!score?.completed)return;const{data:eventRow,error:eventError}=await admin.from('sports_events').upsert({provider_event_id:String(score.id),sport_key:String(score.sport_key),sport_title:score.sport_title??null,commence_time:score.commence_time,home_team:score.home_team??null,away_team:score.away_team??null,status:'final',last_seen_at:new Date().toISOString()},{onConflict:'provider_event_id'}).select('id').single();if(eventError||!eventRow?.id)throw eventError??new Error('Final event upsert failed');const{data:ms,error:me}=await admin.from('sports_markets').select('id').eq('event_id',eventRow.id);if(me)throw me;const ids=(ms??[]).map((m:any)=>m.id);if(ids.length){const{error:e1}=await admin.from('sports_markets').update({status:'closed'}).in('id',ids);if(e1)throw e1;const{error:e2}=await admin.from('sports_outcomes').update({is_active:false}).in('market_id',ids);if(e2)throw e2}}
    const persist=async()=>{try{const snapshotSport=data?.sport_key??sport??null;await admin.from('sports_provider_snapshots').insert({provider:data?.provider??'the-odds-api',mode:requestedMode,sport_key:snapshotSport,provider_event_id:data?.event?.id??null,payload:data});if(requestedMode==='games'){await Promise.all((persistData?.games??[]).map((g:any)=>persistGame(g,'game')));await Promise.all(completedScores.map(persistFinalScore))}else if(requestedMode==='props'&&data?.event)await persistGame(data.event,'prop');else if(requestedMode==='futures')await Promise.all((data?.futures??[]).map((g:any)=>persistGame(g,'future')));else if(requestedMode==='events'){const rows=(data?.events??[]).filter((e:any)=>e?.id&&e?.sport_key&&e?.commence_time).map((e:any)=>({provider_event_id:String(e.id),sport_key:String(e.sport_key),sport_title:e.sport_title??null,commence_time:e.commence_time,home_team:e.home_team??null,away_team:e.away_team??null,status:new Date(e.commence_time).getTime()<=Date.now()?'live':'scheduled',last_seen_at:new Date().toISOString()}));if(rows.length)await admin.from('sports_events').upsert(rows,{onConflict:'provider_event_id'})}}catch(e){console.error('GameDay background persistence failed:',e instanceof Error?e.message:String(e))}}
    EdgeRuntime.waitUntil(persist())
    return json(data,200)
  }catch(error){
    console.error('GameDay wrapper failed:',error instanceof Error?error.message:String(error))
    if(!fresh&&stalePayload)return json(staleResponse(stalePayload),200)
    if(!fresh&&requestedMode==='games'){
      try{const fallback=await persistedGamesFallback(admin,sport);if(fallback)return json(fallback,200)}catch(e){console.error('Stored GameDay fallback failed:',e instanceof Error?e.message:String(e))}
    }
    return json({error:'Live GameDay odds are temporarily unavailable. Please try again shortly.'},502)
  }
})
