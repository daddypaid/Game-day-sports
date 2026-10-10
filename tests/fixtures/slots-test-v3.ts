// Compatibility snapshot of deployed slots-test v3 before Lucky 7s five-line support.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const symbols = ["🍒","🍋","🔔","⭐","7️⃣","💎"];

function pickSymbol(){
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return symbols[buf[0] % symbols.length];
}

function payoutMultiplier(reels:string[]){
  const [a,b,c] = reels;
  if(a===b && b===c){
    if(a==="💎") return 20;
    if(a==="7️⃣") return 15;
    if(a==="⭐") return 10;
    if(a==="🔔") return 8;
    if(a==="🍒") return 6;
    if(a==="🍋") return 5;
  }
  if(a===b || b===c || a===c) return 2;
  return 0;
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:cors});

  try{
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {global:{headers:{Authorization:authHeader}}});
    const {data:userData,error:userError} = await userClient.auth.getUser();
    if(userError || !userData.user){
      return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers:cors});
    }

    const body = await req.json();
    const stake = Number(body?.stake);
    if(!Number.isFinite(stake) || stake<=0 || stake>1000) throw new Error("Invalid stake");

    const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
    const multiplier = payoutMultiplier(reels);
    const payout = Math.round(stake * multiplier * 100) / 100;
    const result = payout > 0 ? "won" : "lost";

    const admin = createClient(url, service);
    const {data:rows,error:rpcError} = await admin.rpc("play_slot_test_spin_atomic",{
      p_user_id:userData.user.id,
      p_stake:stake,
      p_reels:reels,
      p_payout:payout,
      p_result:result
    });

    if(rpcError) throw rpcError;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if(!row) throw new Error("Unable to settle slot spin");

    return new Response(JSON.stringify({
      ok:true,
      spin:{
        id:row.spin_id,
        reels,
        stake,
        multiplier,
        payout:Number(row.payout),
        result,
        balance:Number(row.balance)
      }
    }),{status:200,headers:cors});
  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:"Unable to play slots"}),{status:400,headers:cors});
  }
});
