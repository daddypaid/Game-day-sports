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

// Explicit versioning keeps cached clients on their original one-line rules.
const luckyVersion = "five-lines-v1";
const luckySymbols = [
  "RED7", "BLUE7", "GOLD7", "FOOTBALL", "SOCCER", "HOCKEY",
  "BASKETBALL", "BOXING", "GOALPOST",
];
const luckyLines = [
  [0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0],
];
const luckyLineNames = ["Top", "Middle", "Bottom", "Diagonal ↘", "Diagonal ↗"];
const luckyPays: Record<string, number> = {
  RED7: 200, BLUE7: 150, GOLD7: 100,
  FOOTBALL: 40, SOCCER: 40, HOCKEY: 40,
  BASKETBALL: 40, BOXING: 40, GOALPOST: 40,
};
const luckyConfig = {
  mode: "lines",
  math_version: luckyVersion,
  reels: 3,
  rows: 3,
  lines: 5,
  paylines: luckyLines,
  line_names: luckyLineNames,
  symbols: luckySymbols,
  pays: luckyPays,
  min_total_bet: 0.1,
  max_total_bet: 200,
  total_bet_step: 0.1,
  default_total_bet: 1,
  free_spins: 0,
  // Nine equally likely symbols, with only three-identical-symbol awards.
  // Linearity of expectation applies even though the five lines share cells.
  rtp: 690 / 729,
  rtp_fraction: "690/729",
};
function pickLuckySymbol() {
  const buf = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % luckySymbols.length);
  // Rejection avoids modulo bias; the legacy symbol picker remains unchanged.
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return luckySymbols[buf[0] % luckySymbols.length];
}
function makeLuckyGrid() {
  return Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => pickLuckySymbol())
  );
}
function evaluateLucky(grid: string[][], totalCents: number) {
  const unitCents = totalCents / luckyLines.length;
  const lineWins = luckyLines.flatMap((rows, lineIndex) => {
    const symbol = grid[0][rows[0]];
    const multiplier = luckyPays[symbol] || 0;
    if (!multiplier || !rows.every((row, col) => grid[col][row] === symbol))
      return [];
    return [{
      line_index: lineIndex,
      line_name: luckyLineNames[lineIndex],
      symbol,
      multiplier,
      payout: multiplier * unitCents / 100,
    }];
  });
  // Compute all awards in integer cents, then convert once for settlement.
  const payoutCents = lineWins.reduce((sum, win) =>
    sum + win.multiplier * unitCents, 0
  );
  const activeLines = lineWins.map((win) => win.line_index);
  const winCells = [...new Set(activeLines.flatMap((line) =>
    luckyLines[line].map((row, col) => row * 3 + col)
  ))];
  return { payout: payoutCents / 100, activeLines, winCells, lineWins };
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
    const luckyRequest = body?.game !== undefined || body?.math_version !== undefined;
    if (luckyRequest) {
      if (body?.game !== "lucky-7s" || body?.math_version !== luckyVersion)
        throw new Error("Unsupported Lucky 7s game or math version");
      const action = body?.action === undefined ? "spin" : body.action;
      if (action === "status")
        return new Response(JSON.stringify({
          ok: true, bonus: null, game_config: luckyConfig,
        }), { headers: cors });
      if (action !== "spin") throw new Error("Unknown Lucky 7s action");
      const total = body?.total_bet;
      const cents = Math.round(total * 100);
      if (
        typeof total !== "number" || !Number.isFinite(total) ||
        total !== cents / 100 || cents < 10 || cents > 20000 || cents % 10 !== 0
      ) throw new Error("Total bet must be $0.10 to $200.00 in $0.10 steps");
      const grid = makeLuckyGrid();
      const award = evaluateLucky(grid, cents);
      const result = award.payout > 0 ? "won" : "lost";
      const admin = createClient(url, service);
      const { data: rows, error: rpcError } = await admin.rpc(
        "play_slot_test_spin_atomic", {
          p_user_id: userData.user.id,
          p_stake: total,
          p_reels: grid.flatMap((column, col) =>
            column.map((symbol, row) => `lucky-7s:${col}:${row}:${symbol}`)
          ),
          p_payout: award.payout,
          p_result: result,
        }
      );
      if (rpcError) throw rpcError;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error("Unable to settle slot spin");
      return new Response(JSON.stringify({
        ok: true,
        game_config: luckyConfig,
        spin: {
          id: row.spin_id,
          game: "lucky-7s",
          math_version: luckyVersion,
          grid,
          total_bet: total,
          stake: total,
          bet_per_line: cents / 5 / 100,
          lines: 5,
          payout: Number(row.payout),
          balance: Number(row.balance),
          result,
          active_lines: award.activeLines,
          win_lines: award.activeLines,
          win_cells: award.winCells,
          line_wins: award.lineWins,
          free_spin: false,
          bonus_triggered: false,
        },
      }), { headers: cors });
    }
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
