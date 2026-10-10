import 'jsr:@supabase/functions-js@2.117.3/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { collectOperatorHealth } from '../_shared/operator-health.ts';
import { dispatchOperatorAlerts } from '../_shared/operator-alerts.ts';
import { bounded,operatorFetch } from '../_shared/operator-auth.ts';

const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
const reply = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers});
async function equalSecret(a:string,b:string) {
  const encoded = new TextEncoder();
  const [aHash,bHash] = await Promise.all([crypto.subtle.digest('SHA-256',encoded.encode(a)),crypto.subtle.digest('SHA-256',encoded.encode(b))]);
  const x = new Uint8Array(aHash),y = new Uint8Array(bHash);
  let difference=0; for(let i=0;i<x.length;i++)difference|=x[i]^y[i]; return difference===0;
}

Deno.serve(async (req:Request) => {
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  const token=req.headers.get('x-gameday-job-token')||'';
  if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Unauthorized'},401);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply({error:'Monitoring backend is not configured'},503);
  const deadline=new AbortController(),cancel=()=>deadline.abort();
  req.signal.addEventListener('abort',cancel,{once:true});
  if(req.signal.aborted)cancel();
  const timer=setTimeout(cancel,90000);
  async function monitor(){
    const admin=createClient(url!,key!,{global:{fetch:(input,init)=>operatorFetch(input,{...init,signal:deadline.signal})},db:{retry:false},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:secret,error:secretError}=await bounded<any>(admin.from('operator_monitor_job_secret').select('secret').eq('singleton',true).single());
    if(secretError||typeof secret?.secret!=='string'||!/^[a-f0-9]{64}$/.test(secret.secret))return reply({error:'Monitoring job authentication unavailable'},503);
    if(!await equalSecret(token,secret.secret))return reply({error:'Unauthorized'},401);
    const health=await collectOperatorHealth(admin);
    const observedAt=health.generated_at;
    const {data:queued,error:queueError}=await bounded<any>(admin.rpc('record_operator_health_alerts',{p_checks:health.checks,p_observed_at:observedAt}));
    if(queueError||!Number.isSafeInteger(queued)||queued<0||queued>64)throw new Error('Health alert recording unavailable');
    let webhookUrl=Deno.env.get('GAMEDAY_OPERATOR_ALERT_WEBHOOK_URL')||'',signingSecret=Deno.env.get('GAMEDAY_OPERATOR_ALERT_SIGNING_SECRET')||'';
    if(!webhookUrl&&!signingSecret){
      const {data:configuration,error:configurationError}=await bounded<any>(admin.from('operator_monitor_delivery_config').select('webhook_url,signing_secret').eq('singleton',true).maybeSingle());
      if(configurationError)throw new Error('Alert delivery configuration unavailable');
      webhookUrl=configuration?.webhook_url||'';signingSecret=configuration?.signing_secret||'';
    }
    const result=await dispatchOperatorAlerts(admin,{url:webhookUrl,signingSecret,signal:deadline.signal});
    const {error:stateError}=await bounded<any>(admin.from('operator_monitor_state').upsert({singleton:true,checked_at:observedAt,overall_status:health.overall,delivery_configured:result.configured,delivered_count:result.delivered,failed_count:result.failed}));
    if(stateError)throw new Error('Monitoring status recording unavailable');
    return reply({ok:true,mode:'TEST MODE',overall:health.overall,observed_at:observedAt,enqueued:queued??0,...result});
  }
  try {return await bounded(monitor(),90000);}
  catch { return reply({error:'Operator monitoring could not complete'},503); }
  finally {clearTimeout(timer);cancel();req.signal.removeEventListener('abort',cancel);}
});
