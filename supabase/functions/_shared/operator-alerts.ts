import { bounded } from './operator-auth.ts';

export type AlertRow = { alert_id: string; lease_id: string; payload: unknown; attempt: number };
export type AlertConfiguration = { url: string; signingSecret: string; timeoutMs?: number; allowLocalHttpForTest?: boolean; signal?: AbortSignal };

export function validAlertConfiguration(config: AlertConfiguration): boolean {
  if (config.signingSecret.length < 32) return false;
  try {
    const url = new URL(config.url);
    const hostname = url.hostname.toLowerCase();
    if (url.username || url.password || url.hash) return false;
    if (config.allowLocalHttpForTest && url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(hostname)) return true;
    return url.protocol === 'https:' && !['localhost','metadata.google.internal'].includes(hostname) && !hostname.endsWith('.local') && !hostname.endsWith('.internal') && !hostname.includes(':') && !/^[0-9.]+$/.test(hostname);
  } catch { return false; }
}

export async function deliverOperatorAlert(row: AlertRow, config: AlertConfiguration, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<{ delivered: boolean; errorCode: string | null }> {
  if (!validAlertConfiguration(config)) return { delivered:false, errorCode:'invalid_config' };
  const sentAt = String(Math.floor(now()/1000));
  const body = JSON.stringify({ ...row.payload as object, alert_id:row.alert_id });
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(config.signingSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(sentAt+'.'+body)));
  const signature = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const controller = new AbortController();
  const abort=()=>controller.abort();
  config.signal?.addEventListener('abort',abort,{once:true});
  if(config.signal?.aborted)controller.abort();
  const timer = setTimeout(()=>controller.abort(),config.timeoutMs??4000);
  try {
    const response = await fetcher(config.url,{method:'POST',headers:{'Content-Type':'application/json','x-gameday-alert-id':row.alert_id,'x-gameday-sent-at':sentAt,'x-gameday-signature':'v1='+signature},body,signal:controller.signal,redirect:'error'});
    // Never store response bodies, redirect locations, URLs or exception text.
    void response.body?.cancel().catch(()=>{});
    return response.ok ? {delivered:true,errorCode:null} : {delivered:false,errorCode:'http_'+response.status};
  } catch { return {delivered:false,errorCode:controller.signal.aborted?'timeout':'network_error'}; }
  finally { clearTimeout(timer); config.signal?.removeEventListener('abort',abort); }
}

export async function dispatchOperatorAlerts(admin: any, config: AlertConfiguration, fetcher: typeof fetch = fetch): Promise<{ delivered:number; failed:number; configured:boolean }> {
  if (!validAlertConfiguration(config)) return {delivered:0,failed:0,configured:false};
  if(config.signal?.aborted)throw new Error('Alert dispatch deadline reached');
  const {data,error} = await bounded<any>(admin.rpc('claim_operator_alerts',{p_limit:20}));
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (error||!Array.isArray(data)||data.length>20||data.some(row=>!row||!uuid.test(row.alert_id)||!uuid.test(row.lease_id)||!Number.isSafeInteger(row.attempt)||row.attempt<1||row.attempt>8||!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload)||!Number.isSafeInteger(row.payload.transition_sequence)||row.payload.transition_sequence<1)) throw new Error('Alert queue unavailable');
  let delivered = 0, failed = 0, cursor=0, acknowledgementFailed=false;
  const rows=data;
  async function worker(){
    while(cursor<rows.length&&!config.signal?.aborted){
      const row=rows[cursor++];
      const result=await deliverOperatorAlert(row,config,fetcher);
      try{
        const {data:finished,error:finishError}=await bounded<any>(admin.rpc('finish_operator_alert',{p_alert_id:row.alert_id,p_lease_id:row.lease_id,p_delivered:result.delivered,p_error_code:result.errorCode}));
        if(finishError||finished!==true)throw new Error('Acknowledgement unavailable');
        if(result.delivered)delivered++;else failed++;
      }catch{acknowledgementFailed=true;return;}
    }
  }
  // The SQL claim returns at most one outstanding notification for each check.
  // Five workers bound a full twenty-alert HTTP timeout batch to four waves.
  await Promise.all(Array.from({length:Math.min(5,rows.length)},()=>worker()));
  if(acknowledgementFailed)throw new Error('Alert delivery acknowledgement unavailable');
  if(config.signal?.aborted)throw new Error('Alert dispatch deadline reached');
  return {delivered,failed,configured:true};
}
