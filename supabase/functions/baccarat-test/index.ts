import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

type Card = { rank:string; suit:string };

const suits = ["♠","♥","♦","♣"];
const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck(): Card[] {
  return suits.flatMap(suit => ranks.map(rank => ({ rank, suit })));
}

function shuffle<T>(items:T[]):T[] {
  const a=[...items];
  const buf=new Uint32Array(1);
  for(let i=a.length-1;i>0;i--){
    crypto.getRandomValues(buf);
    const j=buf[0]%(i+1);
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function cardValue(card:Card){
  if(card.rank==="A") return 1;
  if(["10","J","Q","K"].includes(card.rank)) return 0;
  return Number(card.rank);
}

function handTotal(cards:Card[]){
  return cards.reduce((sum,c)=>sum+cardValue(c),0)%10;
}

function baccaratDeal(){
  const deck=shuffle(makeDeck());
  const player:Card[]=[deck.pop()!,deck.pop()!];
  const banker:Card[]=[deck.pop()!,deck.pop()!];
  let pt=handTotal(player);
  let bt=handTotal(banker);

  if(pt>=8 || bt>=8){
    return {player,banker,playerTotal:pt,bankerTotal:bt};
  }

  let playerThird:Card|null=null;
  if(pt<=5){
    playerThird=deck.pop()!;
    player.push(playerThird);
    pt=handTotal(player);
  }

  const thirdVal = playerThird ? cardValue(playerThird) : null;
  let bankerDraw=false;

  if(playerThird===null){
    bankerDraw = bt<=5;
  } else {
    if(bt<=2) bankerDraw=true;
    else if(bt===3) bankerDraw=thirdVal!==8;
    else if(bt===4) bankerDraw=thirdVal!==null && thirdVal>=2 && thirdVal<=7;
    else if(bt===5) bankerDraw=thirdVal!==null && thirdVal>=4 && thirdVal<=7;
    else if(bt===6) bankerDraw=thirdVal===6 || thirdVal===7;
  }

  if(bankerDraw){
    banker.push(deck.pop()!);
    bt=handTotal(banker);
  }

  return {player,banker,playerTotal:pt,bankerTotal:bt};
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:cors});

  try{
    const authHeader=req.headers.get("Authorization")||"";
    const url=Deno.env.get("SUPABASE_URL")!;
    const anon=Deno.env.get("SUPABASE_ANON_KEY")!;
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const {data:userData,error:userError}=await userClient.auth.getUser();
    if(userError || !userData.user){
      return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers:cors});
    }

    const body=await req.json();
    const action=String(body?.action||"");
    if(action==="latest" || action==="state"){
      const admin=createClient(url,service);
      let query=admin.from("baccarat_rounds")
        .select("id,bet_type,stake,player_cards,banker_cards,player_total,banker_total,result,payout,created_at")
        .eq("user_id",userData.user.id);
      if(action==="state"){
        const roundId=String(body?.round_id||"");
        if(!roundId) throw new Error("Round ID is required");
        query=query.eq("id",roundId);
      } else {
        query=query.order("created_at",{ascending:false}).limit(1);
      }
      const {data:round,error:roundError}=await query.maybeSingle();
      if(roundError) throw roundError;
      if(action==="state" && !round) throw new Error("Baccarat round not found");
      const {data:wallet,error:walletError}=await admin.from("wallets")
        .select("balance").eq("user_id",userData.user.id).single();
      if(walletError) throw walletError;
      return new Response(JSON.stringify({ok:true,round:round||null,balance:Number(wallet.balance)}),{headers:cors});
    }
    const stake=Number(body?.stake);
    const betType=String(body?.bet_type||"");
    const requestId=body?.request_id===undefined?null:String(body.request_id);
    if(requestId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("Invalid deal request ID");

    if(!Number.isFinite(stake) || stake<=0 || stake>10000) throw new Error("Invalid stake");
    if(!["player","banker","tie"].includes(betType)) throw new Error("Invalid baccarat bet");

    const dealt=baccaratDeal();
    const result = dealt.playerTotal>dealt.bankerTotal ? "player" : dealt.bankerTotal>dealt.playerTotal ? "banker" : "tie";

    let payout=0;
    if(result==="tie" && betType!=="tie"){
      payout=Math.round(stake*100)/100;
    } else if(betType===result){
      if(result==="player") payout=Math.round(stake*2*100)/100;
      else if(result==="banker") payout=Math.round(stake*1.95*100)/100;
      else payout=Math.round(stake*9*100)/100;
    }

    const admin=createClient(url,service);
    const {data:rows,error:rpcError}=await admin.rpc(requestId?"place_baccarat_test_round_idempotent":"place_baccarat_test_round_atomic",{
      p_user_id:userData.user.id,
      ...(requestId?{p_request_id:requestId}:{}),
      p_stake:stake,
      p_bet_type:betType,
      p_player_cards:dealt.player,
      p_banker_cards:dealt.banker,
      p_player_total:dealt.playerTotal,
      p_banker_total:dealt.bankerTotal,
      p_result:result,
      p_payout:payout
    });

    if(rpcError) throw new Error(rpcError.message||"Unable to save baccarat deal");
    const row=Array.isArray(rows)?rows[0]:rows;
    if(!row) throw new Error("Unable to settle baccarat round");
    if(row.error) throw new Error(String(row.error));
    if(requestId){
      const {data:saved,error:savedError}=await admin.from("baccarat_rounds")
        .select("id,bet_type,stake,player_cards,banker_cards,player_total,banker_total,result,payout,created_at")
        .eq("user_id",userData.user.id).eq("id",row.round_id).single();
      if(savedError||!saved) throw new Error("The saved deal could not be loaded; retry the same request");
      const {data:wallet,error:walletError}=await admin.from("wallets").select("balance").eq("user_id",userData.user.id).single();
      if(walletError) throw walletError;
      return new Response(JSON.stringify({ok:true,request_id:requestId,replayed:Boolean(row.replayed),round:{...saved,balance:Number(wallet.balance)}}),{headers:cors});
    }

    return new Response(JSON.stringify({
      ok:true,
      round:{
        id:row.round_id,
        bet_type:betType,
        stake,
        player_cards:dealt.player,
        banker_cards:dealt.banker,
        player_total:dealt.playerTotal,
        banker_total:dealt.bankerTotal,
        result,
        payout:Number(row.payout),
        balance:Number(row.balance)
      }
    }),{status:200,headers:cors});

  }catch(e){
    return new Response(JSON.stringify({error:e instanceof Error?e.message:"Unable to play baccarat"}),{status:400,headers:cors});
  }
});
