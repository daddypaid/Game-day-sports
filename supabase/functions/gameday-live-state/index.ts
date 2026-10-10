import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { clean, routeFor, mapEspnEvent, mapMlbGame, withoutCurrentTime, type Route } from './live-state-model.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Content-Type':'application/json',
  'Cache-Control':'no-store',
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:corsHeaders})
function serviceKey(){const legacy=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(legacy)return legacy;try{const parsed=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}');return parsed.default??Object.values(parsed)[0]??null}catch{return null}}
function date(offset:number){return new Date(Date.now()+offset*86400000).toISOString().slice(0,10)}
// Timeout includes both headers and body, including SDK cache requests.
async function boundedFetch(input:any,init:any={},timeout=5000) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(input,{...init,signal:controller.signal});
    const bytes=await response.arrayBuffer();
    return new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
  } finally {clearTimeout(timer)}
}
async function providerJson(url:string){
  const r=await boundedFetch(url,{headers:{Accept:'application/json','User-Agent':'GameDay-Sports/1.0'}});
  if(!r.ok)throw new Error('Provider unavailable');
  const providerDate=Date.parse(r.headers.get('date')??''),age=Number(r.headers.get('age')??0);
  if((Number.isFinite(providerDate)&&Math.abs(Date.now()-providerDate)>90000)||!Number.isFinite(age)||age>90)throw new Error('Aged provider response');
  return await r.json();
}
async function providerStates(route:Route,sport:string){
  const isMlb=route.kind==='baseball';
  const results=await Promise.allSettled([0,-1].map(async offset=>{
    const day=date(offset),url=isMlb
      ?`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}&hydrate=linescore`
      :`https://site.api.espn.com/apis/site/v2/sports/${route.path}/scoreboard?dates=${day.replaceAll('-','')}&limit=100${route.path==='football/college-football'?'&groups=80':''}`;
    const data=await providerJson(url),fetchedAt=new Date().toISOString();
    if(isMlb){if(!Array.isArray(data?.dates))throw new Error('Invalid provider response');return data.dates.flatMap((d:any)=>(d.games??[]).map((g:any)=>mapMlbGame(g,sport,fetchedAt,route.preseason)).filter(Boolean))}
    if(!Array.isArray(data?.events)||!data?.leagues?.some((l:any)=>l.slug===route.path.split('/')[1]))throw new Error('Invalid provider league');
    return data.events.flatMap((e:any)=>mapEspnEvent(e,route,sport,fetchedAt));
  }));
  // A partial outage cannot prove that an event missing from a failed date ended.
  if(results.some(r=>r.status==='rejected'))throw new Error('Provider unavailable');
  const unique=new Map<string,any>();for(const result of results)if(result.status==='fulfilled')for(const s of result.value)unique.set(`${s.provider}:${s.provider_event_id}`,s);
  return [...unique.values()];
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
  if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
  let body:any={};if(req.method==='POST'){try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}}
  const sport=clean(new URL(req.url).searchParams.get('sport')??body?.sport).toLowerCase();
  if(!/^[a-z0-9_]{1,100}$/.test(sport))return json({error:'A valid sport is required'},400);
  const route=routeFor(sport);
  if(!route)return json({provider:null,sport,count:0,states:[],fetched_at:new Date().toISOString(),stale:false,configured:false,warning:'Live time is not available for this competition.'});
  const cacheKey=`live-state:verified-v2:${sport}`,url=Deno.env.get('SUPABASE_URL'),svc=serviceKey();let admin:any=null,stalePayload:any=null;
  if(url&&svc){
    admin=createClient(url,svc,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},global:{fetch:(input:any,init:any)=>boundedFetch(input,init,2000)}});
    try{const{data}=await admin.from('odds_response_cache').select('payload,expires_at').eq('cache_key',cacheKey).maybeSingle();
      if(data?.payload?.sport===sport){stalePayload=data.payload;const age=Date.now()-Date.parse(data.payload.fetched_at);if(new Date(data.expires_at).getTime()>Date.now()&&age>=0&&age<30000)return json(data.payload)}
    }catch{console.warn('Live-state cache read unavailable')}
  }
  try{
    const states=await providerStates(route,sport),now=new Date(),ttl=15000;
    const payload={provider:route.kind==='baseball'?'mlb':'espn',sport,count:states.length,states,fetched_at:now.toISOString(),stale:false,configured:true,cache_ttl_seconds:ttl/1000};
    if(admin){try{const{error}=await admin.from('odds_response_cache').upsert({cache_key:cacheKey,payload,expires_at:new Date(now.getTime()+ttl).toISOString(),updated_at:now.toISOString()},{onConflict:'cache_key'});if(error)console.warn('Live-state cache write unavailable')}catch{console.warn('Live-state cache write unavailable')}}
    return json(payload);
  }catch{
    console.warn('Verified live-state provider unavailable');
    if(stalePayload)return json(withoutCurrentTime(stalePayload));
    return json({error:'Live game time is temporarily unavailable',sport,stale:true,states:[]},502);
  }
})
