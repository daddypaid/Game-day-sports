import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:cors})}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  try{
    const authHeader=req.headers.get('Authorization')||'';
    const url=Deno.env.get('SUPABASE_URL')!;
    const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const{data:userData,error:userError}=await userClient.auth.getUser();
    if(userError||!userData.user)return reply({error:'Authentication required'},401);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data,error}=await admin.rpc('refill_test_wallet_atomic',{p_user_id:userData.user.id});
    if(error){
      const msg=String(error.message||'');
      if(msg.includes('REFILL_NOT_NEEDED'))return reply({ok:false,code:'REFILL_NOT_NEEDED',error:'Your test balance must be below $25 before it can be refilled.'},409);
      if(msg.includes('REFILL_COOLDOWN:')){
        const next=msg.split('REFILL_COOLDOWN:')[1]?.trim()||null;
        return reply({ok:false,code:'REFILL_COOLDOWN',error:'Test credits can only be refilled once every 24 hours.',next_refill_at:next},429);
      }
      throw error;
    }
    const row=Array.isArray(data)?data[0]:data;
    return reply({ok:true,balance:Number(row?.balance??0),credited:Number(row?.credited??0),next_refill_at:row?.next_refill_at??null});
  }catch(e){
    return reply({error:e instanceof Error?e.message:'Unable to refill test wallet'},400);
  }
});