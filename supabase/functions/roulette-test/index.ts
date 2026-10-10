import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const BET_TYPES = ["red", "black", "odd", "even", "low", "high", "number", "column1", "column2", "column3"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_COLUMNS = "id,request_id,winning_number,winning_color,bet_type,bet_value,stake,payout,result,is_test,created_at";

function colorOf(n:number){
  if(n===0) return "green";
  return RED.has(n) ? "red" : "black";
}

function settleBet(type:string, value:string|null, n:number){
  if(type === "number") return String(n) === String(value ?? "") ? 36 : 0;
  if(n === 0) return 0;
  if(type === "red") return colorOf(n) === "red" ? 2 : 0;
  if(type === "black") return colorOf(n) === "black" ? 2 : 0;
  if(type === "odd") return n % 2 === 1 ? 2 : 0;
  if(type === "even") return n % 2 === 0 ? 2 : 0;
  if(type === "low") return n >= 1 && n <= 18 ? 2 : 0;
  if(type === "high") return n >= 19 && n <= 36 ? 2 : 0;
  if(type.startsWith("column")) return (n - 1) % 3 + 1 === Number(type.slice(-1)) ? 3 : 0;
  return 0;
}

function winningNumber(){
  const sample = new Uint32Array(1);
  const boundary = Math.floor(0x100000000 / 37) * 37;
  do { crypto.getRandomValues(sample); } while(sample[0] >= boundary);
  return sample[0] % 37;
}

function requestId(value:unknown){
  if(typeof value !== "string" || !UUID.test(value)) throw new Error("A valid request ID is required");
  return value.toLowerCase();
}

Deno.serve(async (req) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if(req.method !== "POST") return new Response(JSON.stringify({error:"Method not allowed"}), {status:405, headers:cors});

  let spinRequested = false;
  let spinAttempted = false;
  let knownRollback = false;
  try{
    const body = await req.json();
    const action = String(body?.action || "spin");
    spinRequested = action !== "state" && action !== "latest";
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global:{ headers:{ Authorization: authHeader }}});
    const { data:userData, error:userError } = await userClient.auth.getUser();
    if(userError || !userData.user){
      return new Response(JSON.stringify({error:"Authentication required", spin_rejected:spinRequested}), {status:401, headers:cors});
    }

    const userId = userData.user.id;
    const admin = createClient(url, service);
    const loadBalance = async () => {
      const { data:wallet, error } = await admin.from("wallets").select("balance").eq("user_id", userId).single();
      if(error) throw error;
      if(!wallet || !Number.isFinite(Number(wallet.balance))) throw new Error("Unable to load test wallet");
      return Number(wallet.balance);
    };

    if(action === "state" || action === "latest"){
      let query = admin.from("roulette_spins").select(PUBLIC_COLUMNS).eq("user_id", userId).eq("is_test", true);
      if(action === "state") query = query.eq("request_id", requestId(body?.request_id));
      else query = query.order("created_at", { ascending:false }).order("id", { ascending:false }).limit(1);
      const { data:spin, error } = await query.maybeSingle();
      if(error) throw error;
      const balance = await loadBalance();
      return new Response(JSON.stringify({ ok:true, spin:spin ? { ...spin, stake:Number(spin.stake), payout:Number(spin.payout), balance } : null, balance }), { headers:cors });
    }
    if(action !== "spin") throw new Error("Invalid roulette action");

    const id = requestId(body?.request_id);
    let stake = body?.stake;
    const betType = String(body?.bet_type || "");
    let betValue:string|null = null;

    if(typeof stake !== "number" || !Number.isFinite(stake) || stake < 0.01 || stake > 10000 || Math.abs(stake * 100 - Math.round(stake * 100)) > 1e-7) throw new Error("Stake must be between $0.01 and $10,000 with at most two decimal places");
    stake = Math.round(stake * 100) / 100;
    if(!BET_TYPES.includes(betType)) throw new Error("Invalid bet type");
    if(betType === "number"){
      const input = body?.bet_value;
      if((typeof input !== "string" && typeof input !== "number") || String(input).trim() === "") throw new Error("Choose a number from 0 to 36");
      const v = Number(input);
      if(!Number.isInteger(v) || v < 0 || v > 36) throw new Error("Choose a number from 0 to 36");
      betValue = String(v);
    }

    const number = winningNumber();
    const winningColor = colorOf(number);
    const multiplier = settleBet(betType, betValue, number);
    const payout = Math.round(stake * multiplier * 100) / 100;
    const result = payout > 0 ? "won" : "lost";

    spinAttempted = true;
    const { data:rows, error:rpcError } = await admin.rpc("play_test_roulette_atomic", {
      p_user_id:userId,
      p_stake:stake,
      p_bet_type:betType,
      p_bet_value:betValue,
      p_winning_number:number,
      p_winning_color:winningColor,
      p_payout:payout,
      p_result:result,
      p_request_id:id
    });
    if(rpcError){
      // P0001 is raised by the transactional RPC: all changes in that call rolled back.
      knownRollback = rpcError.code === "P0001";
      throw new Error(rpcError.message || "Unable to play roulette");
    }

    const row = Array.isArray(rows) ? rows[0] : rows;
    if(!row) throw new Error("Unable to settle roulette spin");
    const balance = await loadBalance();

    return new Response(JSON.stringify({
      ok:true,
      spin:{
        id:row.spin_id,
        request_id:row.request_id,
        winning_number:row.winning_number,
        winning_color:row.winning_color,
        bet_type:row.bet_type,
        bet_value:row.bet_value,
        stake:Number(row.stake),
        payout:Number(row.payout),
        result:row.result,
        balance,
        is_test:true,
        created_at:row.created_at
      },
      balance
    }), {status:200, headers:cors});
  }catch(e){
    return new Response(JSON.stringify({
      error:e instanceof Error ? e.message : "Unable to play roulette",
      spin_rejected:spinRequested && (!spinAttempted || knownRollback)
    }), {status:400, headers:cors});
  }
});
