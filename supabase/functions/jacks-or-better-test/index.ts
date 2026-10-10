import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Card={rank:string,suit:string};

const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};

const suits=["♠","♥","♦","♣"];
const ranks=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const GAME="jacks_or_better";

function buildDeck():Card[]{
  const out:Card[]=[];
  for(const suit of suits) for(const rank of ranks) out.push({rank,suit});
  return out;
}

function shuffle<T>(items:T[]):T[]{
  const a=[...items];
  for(let i=a.length-1;i>0;i--){
    const buf=new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j=buf[0]%(i+1);
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function value(rank:string){return ranks.indexOf(rank)+2}

function evaluate(hand:Card[]){
  const vals=hand.map(c=>value(c.rank)).sort((a,b)=>a-b);
  const flush=new Set(hand.map(c=>c.suit)).size===1;
  const counts=new Map<number,number>();
  for(const v of vals) counts.set(v,(counts.get(v)||0)+1);
  const groups=[...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const unique=[...new Set(vals)];
  let straight=false;
  if(unique.length===5){
    straight=unique[4]-unique[0]===4;
    if(JSON.stringify(unique)===JSON.stringify([2,3,4,5,14])) straight=true;
  }
  const royal=flush&&[10,11,12,13,14].every(v=>vals.includes(v));
  if(royal) return {result:"Royal Flush",multiplier:800};
  if(straight&&flush) return {result:"Straight Flush",multiplier:50};
  if(groups[0]?.[1]===4) return {result:"Four of a Kind",multiplier:25};
  if(groups[0]?.[1]===3&&groups[1]?.[1]===2) return {result:"Full House",multiplier:9};
  if(flush) return {result:"Flush",multiplier:6};
  if(straight) return {result:"Straight",multiplier:4};
  if(groups[0]?.[1]===3) return {result:"Three of a Kind",multiplier:3};
  if(groups[0]?.[1]===2&&groups[1]?.[1]===2) return {result:"Two Pair",multiplier:2};
  if(groups[0]?.[1]===2&&groups[0][0]>=11) return {result:"Jacks or Better",multiplier:1};
  return {result:"No Win",multiplier:0};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers});
  try{
    const auth=req.headers.get("Authorization")||"";
    const url=Deno.env.get("SUPABASE_URL")!;
    const anon=Deno.env.get("SUPABASE_ANON_KEY")!;
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
    const {data:userData,error:userError}=await userClient.auth.getUser();
    if(userError||!userData.user){
      return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers});
    }
    const userId=userData.user.id;
    const admin=createClient(url,service);
    const body=await req.json();
    const action=String(body?.action||"");

    const publicColumns="id,game,stake,initial_hand,final_hand,status,created_at,settled_at,result,multiplier,payout";
    const loadBalance=async()=>{
      const {data,error}=await admin.from("wallets").select("balance").eq("user_id",userId).single();
      if(error) throw error;
      return Number(data.balance);
    };

    if(action==="resume"){
      const {data,error}=await admin.from("video_poker_hands")
        .select(publicColumns)
        .eq("user_id",userId).eq("game",GAME).eq("status","active").maybeSingle();
      if(error) throw error;
      let latest=null;
      if(body?.include_latest===true){
        const {data:latestData,error:latestError}=await admin.from("video_poker_hands")
          .select(publicColumns).eq("user_id",userId).eq("game",GAME)
          .order("created_at",{ascending:false}).limit(1).maybeSingle();
        if(latestError) throw latestError;
        latest=latestData;
      }
      return new Response(JSON.stringify({
        ok:true,hand:data||null,balance:await loadBalance(),
        ...(body?.include_latest===true?{latest_hand:latest||null}:{})
      }),{headers});
    }

    if(action==="state"){
      const handId=String(body?.hand_id||"");
      if(!handId) throw new Error("Hand ID is required");
      const {data,error}=await admin.from("video_poker_hands")
        .select(publicColumns).eq("id",handId).eq("user_id",userId).eq("game",GAME).maybeSingle();
      if(error) throw error;
      if(!data) throw new Error("Jacks or Better hand not found");
      return new Response(JSON.stringify({ok:true,hand:data,balance:await loadBalance()}),{headers});
    }

    if(action==="deal"){
      const stake=Number(body?.stake);
      if(!Number.isFinite(stake)||stake<=0||stake>1000) throw new Error("Invalid stake");
      const d=shuffle(buildDeck());
      const hand=d.slice(0,5);
      const remaining=d.slice(5);
      const {data:rows,error}=await admin.rpc("deal_video_poker_test_atomic",{
        p_user_id:userId,
        p_stake:stake,
        p_initial_hand:hand,
        p_deck_remaining:remaining,
        p_game:GAME
      });
      if(error) throw error;
      const row=Array.isArray(rows)?rows[0]:rows;
      return new Response(JSON.stringify({
        ok:true,
        hand:{id:row.hand_id,game:GAME,stake,initial_hand:hand,status:"active"},
        balance:Number(row.balance)
      }),{headers});
    }

    if(action==="draw"){
      const handId=String(body?.hand_id||"");
      const holdsRaw=Array.isArray(body?.holds)?body.holds:[];
      const holds=[...new Set(holdsRaw.map((x:any)=>Number(x)).filter((x:number)=>Number.isInteger(x)&&x>=0&&x<5))];
      const {data:active,error}=await admin.from("video_poker_hands")
        .select("id,user_id,game,stake,initial_hand,deck_remaining,status")
        .eq("id",handId).eq("user_id",userId).eq("game",GAME).eq("status","active").maybeSingle();
      if(error) throw error;
      if(!active) throw new Error("Active Jacks or Better hand not found");

      const initial=active.initial_hand as Card[];
      const remaining=active.deck_remaining as Card[];
      const final:Card[]=[];
      let cursor=0;
      for(let i=0;i<5;i++) final.push(holds.includes(i)?initial[i]:remaining[cursor++]);
      const judged=evaluate(final);
      const payout=Math.round(Number(active.stake)*judged.multiplier*100)/100;
      const {data:rows,error:rpcError}=await admin.rpc("settle_video_poker_test_atomic",{
        p_user_id:userId,
        p_hand_id:handId,
        p_final_hand:final,
        p_result:judged.result,
        p_multiplier:judged.multiplier,
        p_payout:payout
      });
      if(rpcError) throw rpcError;
      const row=Array.isArray(rows)?rows[0]:rows;
      return new Response(JSON.stringify({
        ok:true,
        hand:{
          id:handId,game:GAME,stake:Number(active.stake),initial_hand:initial,
          final_hand:final,result:judged.result,multiplier:judged.multiplier,
          payout:Number(row.payout),status:"settled"
        },
        balance:Number(row.balance)
      }),{headers});
    }

    throw new Error("Unsupported action");
  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:"Unable to play Jacks or Better"}),{status:400,headers});
  }
});
