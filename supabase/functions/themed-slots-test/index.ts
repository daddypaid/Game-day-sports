import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const lines: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [0, 2, 2, 2, 0],
  [2, 0, 0, 0, 2],
  [1, 1, 0, 1, 1],
];
type Cfg = {
  weights: string[];
  wild: string;
  scatter: string;
  pays: Record<string, number[]>;
  bonusName: string;
  freeSpins: number;
};
const games: Record<string, Cfg> = {
  "midnight-monsters": {
    weights: [
      "VAMP",
      "WOLF",
      "ZOMB",
      "POTION",
      "BAT",
      "CANDLE",
      "BAT",
      "CANDLE",
      "ZOMB",
      "POTION",
      "WILD",
      "SCATTER",
      "SPADE",
      "CLUB",
      "HEART",
      "DIAMOND",
      "SKULL",
      "BOOK",
      "RING",
    ],
    wild: "WILD",
    scatter: "SCATTER",
    bonusName: "CRYPT FREE SPINS",
    freeSpins: 10,
    pays: {
      VAMP: [0, 0, 4, 10, 40],
      WOLF: [0, 0, 3, 8, 30],
      ZOMB: [0, 0, 2, 6, 24],
      POTION: [0, 0, 2, 5, 18],
      BAT: [0, 0, 1, 3, 10],
      CANDLE: [0, 0, 1, 2, 8],
      WILD: [0, 0, 5, 15, 50],
      SPADE: [0, 0, 1, 2, 4],
      CLUB: [0, 0, 1, 2, 4],
      HEART: [0, 0, 1, 2, 4],
      DIAMOND: [0, 0, 1, 2, 4],
      SKULL: [0, 0, 1, 2, 6],
      BOOK: [0, 0, 1, 2, 6],
      RING: [0, 0, 1, 2, 6],
    },
  },
  "galactic-rebellion": {
    weights: [
      "FIGHTER",
      "PLANET",
      "DROID",
      "ENERGY",
      "SAT",
      "COMET",
      "SAT",
      "COMET",
      "DROID",
      "ENERGY",
      "WILD",
      "SCATTER",
    ],
    wild: "WILD",
    scatter: "SCATTER",
    bonusName: "FINAL ORBIT FREE SPINS",
    freeSpins: 6,
    pays: {
      FIGHTER: [0, 0, 4, 10, 40],
      PLANET: [0, 0, 3, 8, 30],
      DROID: [0, 0, 2, 6, 24],
      ENERGY: [0, 0, 2, 5, 18],
      SAT: [0, 0, 1, 3, 10],
      COMET: [0, 0, 1, 2, 8],
      WILD: [0, 0, 5, 15, 50],
    },
  },
};
// Old cached clients and existing bonus sessions keep their original 20-line math.
// New Galactic wagers use total_bet; their stored per-way unit is below $1 because
// the total wager is capped at $200. Legacy units are whole dollars from $1–$10.
const galacticWays: Cfg = {
  weights: [
    "STARFIGHTER", "STATION", "PLANET", "ASTEROID", "GALAXY", "PILOT",
    "QUEEN", "BOT", "CHEST", "COMPASS", "REDPLANET", "RINGED",
    "BLACKHOLE", "CANNON", "WILD", "SCATTER", "STATION", "ASTEROID",
    "BOT", "CANNON",
  ],
  wild: "WILD",
  scatter: "SCATTER",
  bonusName: "FINAL ORBIT FREE SPINS",
  freeSpins: 6,
  pays: {
    STARFIGHTER: [0, 0, 4, 10, 40],
    STATION: [0, 0, 1, 3, 10],
    PLANET: [0, 0, 3, 8, 30],
    ASTEROID: [0, 0, 1, 2, 8],
    GALAXY: [0, 0, 1, 2, 6],
    PILOT: [0, 0, 3, 8, 30],
    QUEEN: [0, 0, 4, 10, 40],
    BOT: [0, 0, 2, 6, 24],
    CHEST: [0, 0, 2, 6, 24],
    COMPASS: [0, 0, 1, 3, 10],
    REDPLANET: [0, 0, 1, 2, 8],
    RINGED: [0, 0, 1, 2, 8],
    BLACKHOLE: [0, 0, 2, 5, 18],
    CANNON: [0, 0, 2, 5, 18],
    WILD: [0, 0, 5, 15, 50],
  },
};
const galacticGameConfig = {
  mode: "ways",
  ways: 243,
  min_total_bet: 0.1,
  max_total_bet: 200,
  total_bet_step: 0.1,
  default_total_bet: 1,
  free_spins: galacticWays.freeSpins,
  pays: galacticWays.pays,
  scatter_multiplier: 10,
  payout_divisor: 243,
};
function galacticWagerMeta(unit: number) {
  const legacy = Number.isInteger(unit) && unit >= 1 && unit <= 10;
  const total = Math.round(unit * (legacy ? 20 : 243) * 100) / 100;
  if (!legacy && (
    !Number.isFinite(unit) || unit <= 0 || total < 0.1 || total > 200 ||
    Math.round(total * 100) % 10 !== 0 || Math.abs(unit * 243 - total) > 0.000001
  )) throw new Error("Invalid Galactic Rebellion bonus wager");
  return {
    wager_mode: legacy ? "lines" : "ways",
    math_version: legacy ? "lines-v1" : "ways-v1",
    total_bet: total,
    ...(legacy ? { lines: 20 } : { ways: 243 }),
  };
}
function ri(max: number) {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] % max;
}
function pick(a: string[]) {
  return a[ri(a.length)];
}
function makeGrid(cfg: Cfg) {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => pick(cfg.weights)),
  );
}
function expandWild(grid: string[][], reel: number) {
  for (let r = 0; r < 3; r++) grid[reel][r] = "WILD";
  return [0, 1, 2].map((r) => r * 5 + reel);
}
function infect(grid: string[][], cfg: Cfg) {
  const cells: number[] = [];
  for (let i = 0; i < 3; i++) {
    const c = ri(5),
      r = ri(3);
    if (grid[c][r] !== cfg.scatter) {
      grid[c][r] = "WILD";
      cells.push(r * 5 + c);
    }
  }
  return cells;
}
function evaluate(grid: string[][], cfg: Cfg, bet: number) {
  let lineWin = 0;
  const activeLines: number[] = [];
  const winCells: number[] = [];
  lines.forEach((line, li) => {
    let base: string | null = null,
      count = 0;
    for (let c = 0; c < 5; c++) {
      const s = grid[c][line[c]];
      if (s === cfg.scatter) break;
      if (base === null && s !== cfg.wild) base = s;
      if (base === null && s === cfg.wild) {
        count++;
        continue;
      }
      if (s === base || s === cfg.wild) count++;
      else break;
    }
    if (count >= 3) {
      const sym = base || cfg.wild;
      const mult = (cfg.pays[sym] || [])[count - 1] || 0;
      if (mult > 0) {
        lineWin += mult * bet;
        activeLines.push(li);
        for (let c = 0; c < count; c++) winCells.push(line[c] * 5 + c);
      }
    }
  });
  const scatters = grid.flat().filter((s) => s === cfg.scatter).length;
  const scatterWin = scatters >= 3 ? scatters * 10 * bet : 0;
  return {
    payout: Math.round((lineWin + scatterWin) * 100) / 100,
    activeLines,
    winCells: [...new Set(winCells)],
    scatters,
  };
}
function evaluateWays(grid: string[][], cfg: Cfg, unit: number) {
  type Win = { rows: number[]; multiplier: number };
  const wins = new Map<string, Win>();
  for (const [symbol, pays] of Object.entries(cfg.pays)) {
    const matching = grid.map((column) => column.flatMap((value, row) =>
      value === symbol || value === cfg.wild ? [row] : []
    ));
    let count = 0;
    while (count < 5 && matching[count].length) count++;
    const multiplier = pays[count - 1] || 0;
    if (count < 3 || multiplier <= 0) continue;
    const visit = (rows: number[]) => {
      const col = rows.length;
      if (col < count) {
        for (const row of matching[col]) visit([...rows, row]);
        return;
      }
      const key = rows.join(",");
      const prior = wins.get(key);
      if (!prior || multiplier > prior.multiplier) wins.set(key, {
        rows,
        multiplier,
      });
    };
    visit([]);
  }
  type Node = { win?: Win; children: Map<number, Node> };
  const tree: Node = { children: new Map() };
  for (const win of wins.values()) {
    let node = tree;
    for (const row of win.rows) {
      if (!node.children.has(row)) node.children.set(row, { children: new Map() });
      node = node.children.get(row)!;
    }
    node.win = win;
  }
  // Wild-only prefixes may overlap longer substitutions. Choose the highest
  // combined award from disjoint prefixes; never count the same match twice.
  const best = (node: Node): Win[] => {
    const descendants = [...node.children.values()].flatMap(best);
    const award = descendants.reduce((sum, win) => sum + win.multiplier, 0);
    return node.win && node.win.multiplier >= award ? [node.win] : descendants;
  };
  const paid = best(tree);
  const winCells = paid.flatMap((win) => win.rows.map((row, c) => row * 5 + c));
  const scatters = grid.flat().filter((symbol) => symbol === cfg.scatter).length;
  const waysWin = paid.reduce((sum, win) => sum + win.multiplier * unit, 0);
  const scatterWin = scatters >= 3 ? scatters * 10 * unit : 0;
  return {
    payout: Math.round((waysWin + scatterWin) * 100) / 100,
    rawPayout: waysWin + scatterWin,
    activeLines: [] as number[],
    winCells: [...new Set(winCells)],
    scatters,
    winningWays: paid.length,
  };
}
function paidFeature(game: string, grid: string[][], cfg: Cfg) {
  let name: null | string = null;
  let cells: number[] = [];
  let mult = 1;
  if (game === "midnight-monsters" && ri(100) < 18) {
    const n = ri(3);
    if (n === 0) {
      name = "BLOOD MOON";
      mult = 2;
    } else if (n === 1) {
      name = "WEREWOLF CLAW";
      const reel = ri(5);
      cells = expandWild(grid, reel);
    } else {
      name = "ZOMBIE INFECTION";
      cells = infect(grid, cfg);
    }
  }
  if (game === "galactic-rebellion" && ri(100) < 20) {
    name = "REBEL STRIKE";
    const reel = ri(5);
    cells = expandWild(grid, reel);
  }
  return { name, cells, mult };
}
function bonusFeature(game: string, grid: string[][], cfg: Cfg) {
  let name = "FREE SPIN";
  let cells: number[] = [];
  let mult = 2;
  if (game === "midnight-monsters") {
    const n = ri(3);
    if (n === 0) {
      name = "BLOOD MOON FREE SPIN";
      mult = 3;
    } else if (n === 1) {
      name = "WEREWOLF WILD REEL";
      cells = expandWild(grid, ri(5));
    } else {
      name = "ZOMBIE WILD INFECTION";
      cells = infect(grid, cfg);
    }
  } else {
    name = "FINAL ORBIT WILD REEL";
    cells = expandWild(grid, ri(5));
    mult = 2;
  }
  return { name, cells, mult };
}

function requestId(value: unknown) {
  if (typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error("A valid request_id is required");
  return value;
}
async function receipt(admin: any, userId: string, id: string, game: string, payload: object | null) {
  const { data, error } = await admin.rpc("get_slot_request_receipt", {
    p_user_id: userId, p_request_id: id, p_game: game, p_payload: payload,
  });
  if (error) throw error;
  return data;
}
async function settleReceipt(admin: any, userId: string, id: string, game: string,
  action: string, payload: object, spin: object, settlement: object) {
  const { data, error } = await admin.rpc("settle_slot_request_atomic", {
    p_user_id: userId, p_request_id: id, p_game: game, p_action: action,
    p_payload: payload, p_response: { ok: true, spin,
      ...(game === "galactic-rebellion" ? { game_config: galacticGameConfig } : {}),
    }, p_settlement: settlement,
  });
  if (error) throw error;
  if (!data?.spin) throw new Error("Unable to recover slot receipt");
  return new Response(JSON.stringify(data), { headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: cors,
    });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user)
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: cors },
      );
    const admin = createClient(url, service);
    const body = await req.json();
    const game = String(body?.game || "");
    if (body?.action === "history") {
      const limit = body.limit === undefined ? 20 : body.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid history limit");
      const before = body.before;
      if (before && (!Number.isFinite(Date.parse(before.created_at)) || !before.id))
        throw new Error("Invalid history cursor");
      const { data, error } = await admin.rpc("get_slot_request_history", {
        p_user_id: userData.user.id, p_limit: limit + 1,
        p_before_created_at: before?.created_at || null,
        p_before_id: before ? requestId(before.id) : null,
      });
      if (error) throw error;
      const rows = data || [], receipts = rows.slice(0, limit), last = receipts.at(-1);
      return new Response(JSON.stringify({ ok: true, receipts,
        next_cursor: rows.length > limit && last ? { created_at: last.created_at, id: last.id } : null,
      }), { headers: cors });
    }
    let cfg = games[game];
    if (!cfg) throw new Error("Unknown themed slot");
    const action = body?.action === undefined ? "spin" : body.action;
    if (action === "receipt") {
      const stored = await receipt(admin, userData.user.id, requestId(body.request_id), game, null);
      return new Response(JSON.stringify(stored ? { ...stored, found: true } :
        { ok: true, found: false }), { headers: cors });
    }
    if (
      !["spin", "status", "bonus_spin"].includes(action)
    )
      throw new Error(game === "midnight-monsters"
        ? "Unknown Midnight Monsters action" : "Unknown Galactic Rebellion action");
    if (action === "status") {
      const { data: s, error: statusError } = await admin
        .from("themed_slot_bonus_sessions")
        .select(
          "id,spins_remaining,total_spins,total_payout,status,bet_per_line",
        )
        .eq("user_id", userData.user.id)
        .eq("game", game)
        .eq("status", "active")
        .maybeSingle();
      if (statusError) throw statusError;
      return new Response(JSON.stringify({
        ok: true,
        bonus: s && game === "galactic-rebellion"
          ? { ...s, ...galacticWagerMeta(Number(s.bet_per_line)) } : s || null,
        ...(game === "galactic-rebellion" ? { game_config: galacticGameConfig } : {}),
      }), {
        headers: cors,
      });
    }
    if (action === "bonus_spin") {
      const sessionId = String(body?.session_id || "");
      const id = body.request_id === undefined ? null : requestId(body.request_id);
      const payload = { game, action: "bonus_spin", session_id: sessionId };
      if (id) {
        const stored = await receipt(admin, userData.user.id, id, game, payload);
        if (stored) return new Response(JSON.stringify(stored), { headers: cors });
      }
      const { data: session, error: se } = await admin
        .from("themed_slot_bonus_sessions")
        .select(
          "id,game,bet_per_line,spins_remaining,total_spins,status,total_payout",
        )
        .eq("id", sessionId)
        .eq("user_id", userData.user.id)
        .eq("game", game)
        .single();
      if (
        se ||
        !session ||
        session.status !== "active" ||
        session.spins_remaining <= 0
      ) {
        // The final free spin may have committed while this duplicate was
        // reading its session. Recover the original instead of rejecting it.
        if (id) {
          const stored = await receipt(admin, userData.user.id, id, game, payload);
          if (stored) return new Response(JSON.stringify(stored), { headers: cors });
        }
        throw new Error("No active free-spin session");
      }
      const bet = Number(session.bet_per_line);
      const wagerMeta = game === "galactic-rebellion" ? galacticWagerMeta(bet) : null;
      const ways = wagerMeta?.wager_mode === "ways";
      if (ways) cfg = galacticWays;
      const grid = makeGrid(cfg);
      const feat = bonusFeature(game, grid, cfg);
      const out = ways ? evaluateWays(grid, cfg, bet) : evaluate(grid, cfg, bet);
      const payout = Math.round(("rawPayout" in out ? out.rawPayout as number : out.payout) * feat.mult * 100) / 100;
      if (id) return await settleReceipt(admin, userData.user.id, id, game,
        "bonus_spin", payload, {
          game, grid, bet_per_line: bet,
          ...(wagerMeta || { lines: 20, total_bet: Math.round(bet * 20 * 100) / 100 }),
          ...(ways && "winningWays" in out ? { winning_ways: out.winningWays } : {}),
          stake: 0, payout, result: payout > 0 ? "won" : "lost",
          active_lines: out.activeLines, win_cells: [...new Set([...out.winCells, ...feat.cells])],
          scatters: out.scatters, feature_name: feat.name, feature_cells: feat.cells,
          feature_multiplier: feat.mult, free_spin: true, bonus_session_id: sessionId,
          bonus_total_spins: Number(session.total_spins),
        }, { session_id: sessionId });
      const { data: rows, error: re } = await admin.rpc(
        "settle_themed_bonus_spin_atomic",
        {
          p_user_id: userData.user.id,
          p_session_id: sessionId,
          p_grid: grid,
          p_payout: payout,
          p_feature: feat.name,
        },
      );
      if (re) throw re;
      const row = Array.isArray(rows) ? rows[0] : rows;
      return new Response(
        JSON.stringify({
          ok: true,
          spin: {
            game,
            grid,
            bet_per_line: bet,
            ...(wagerMeta || { lines: 20 }),
            ...(ways && "winningWays" in out ? { winning_ways: out.winningWays } : {}),
            stake: 0,
            payout,
            balance: Number(row.balance),
            active_lines: out.activeLines,
            win_cells: [...new Set([...out.winCells, ...feat.cells])],
            scatters: out.scatters,
            feature_name: feat.name,
            feature_cells: feat.cells,
            feature_multiplier: feat.mult,
            free_spin: true,
            bonus_session_id: sessionId,
            bonus_spins_remaining: Number(row.spins_remaining),
            bonus_total_spins: Number(session.total_spins),
            bonus_total_payout: Number(row.total_payout),
            bonus_complete: row.session_status === "completed",
          },
        }),
        { headers: cors },
      );
    }
    const ways = game === "galactic-rebellion" && body?.total_bet !== undefined;
    const requestedBet = Number(ways ? body.total_bet : body?.bet_per_line);
    if (game === "midnight-monsters") {
      const cents = Math.round(requestedBet * 100);
      if (
        !Number.isFinite(requestedBet) ||
        requestedBet !== cents / 100 ||
        cents < 10 ||
        cents > 1000 ||
        cents % 10 !== 0
      )
        throw new Error("Bet per line must be $0.10 to $10.00 in $0.10 steps");
    } else if (ways) {
      const cents = Math.round(requestedBet * 100);
      if (
        !Number.isFinite(requestedBet) || requestedBet !== cents / 100 ||
        cents < 10 || cents > 20000 || cents % 10 !== 0
      ) throw new Error("Total bet must be $0.10 to $200.00 in $0.10 steps");
      cfg = galacticWays;
    } else if (
      !Number.isFinite(requestedBet) ||
      requestedBet < 1 ||
      requestedBet > 10 ||
      Math.floor(requestedBet) !== requestedBet
    )
      throw new Error("Bet per line must be 1 to 10 test credits");
    const bet = ways ? requestedBet / 243 : requestedBet;
    const stake =
      ways ? requestedBet : game === "midnight-monsters"
        ? Math.round(bet * 20 * 100) / 100
        : bet * 20;
    const id = body.request_id === undefined ? null : requestId(body.request_id);
    const payload = { game, action: "spin",
      ...(ways ? { total_bet: requestedBet } : { bet_per_line: requestedBet }),
    };
    if (id) {
      const stored = await receipt(admin, userData.user.id, id, game, payload);
      if (stored) return new Response(JSON.stringify(stored), { headers: cors });
    }
    const grid = makeGrid(cfg);
    const feat = paidFeature(game, grid, cfg);
    let out = ways ? evaluateWays(grid, cfg, bet) : evaluate(grid, cfg, bet);
    let payout = Math.round(("rawPayout" in out ? out.rawPayout as number : out.payout) * feat.mult * 100) / 100;
    const scatters = out.scatters;
    let bonusSpins = scatters >= 3 ? cfg.freeSpins : 0;
    let bonusName = scatters >= 3 ? cfg.bonusName : null;
    if (game === "galactic-rebellion" && scatters >= 3) {
      const more = expandWild(grid, ri(5));
      feat.cells.push(...more);
      feat.name = "FINAL ORBIT TRIGGER";
      feat.mult = Math.max(feat.mult, 2);
      out = ways ? evaluateWays(grid, cfg, bet) : evaluate(grid, cfg, bet);
      payout = Math.round(("rawPayout" in out ? out.rawPayout as number : out.payout) * feat.mult * 100) / 100;
    }
    if (game === "midnight-monsters" && scatters >= 3) {
      feat.name = feat.name || "CRYPT AWAKENING";
      feat.mult = Math.max(feat.mult, 2);
      payout = Math.round(out.payout * feat.mult * 100) / 100;
    }
    const result = payout > 0 ? "won" : "lost";
    const flat = grid.flatMap((col, c) =>
      col.map((s, r) => `${game}:${c}:${r}:${s}`),
    );
    if (id) return await settleReceipt(admin, userData.user.id, id, game,
      "spin", payload, {
        game, grid, bet_per_line: bet,
        ...(game === "galactic-rebellion" ? galacticWagerMeta(bet) : { lines: 20, total_bet: stake }),
        ...(ways && "winningWays" in out ? { winning_ways: out.winningWays } : {}),
        stake, payout, result, active_lines: out.activeLines,
        win_cells: [...new Set([...out.winCells, ...feat.cells])], scatters,
        feature_name: feat.name, feature_cells: feat.cells, feature_multiplier: feat.mult,
        bonus_triggered: bonusSpins > 0, bonus_name: bonusName,
        bonus_total_spins: bonusSpins > 0 ? cfg.freeSpins : 0, free_spin: false,
      }, { reels: flat, bonus_spins: bonusSpins });
    const { data: rows, error: pe } = await admin.rpc(
      "play_themed_slot_paid_spin_atomic",
      {
        p_user_id: userData.user.id,
        p_game: game,
        p_stake: stake,
        p_reels: flat,
        p_payout: payout,
        p_result: result,
        p_bet_per_line: bet,
        p_bonus_spins: bonusSpins,
      },
    );
    if (pe) throw pe;
    const row = Array.isArray(rows) ? rows[0] : rows;
    return new Response(
      JSON.stringify({
        ok: true,
        spin: {
          id: row.spin_id,
          game,
          grid,
          bet_per_line: bet,
          ...(game === "galactic-rebellion" ? galacticWagerMeta(bet) : { lines: 20 }),
          ...(ways && "winningWays" in out ? { winning_ways: out.winningWays } : {}),
          stake,
          payout,
          result,
          balance: Number(row.balance),
          active_lines: out.activeLines,
          win_cells: [...new Set([...out.winCells, ...feat.cells])],
          scatters,
          feature_name: feat.name,
          feature_cells: feat.cells,
          feature_multiplier: feat.mult,
          bonus_triggered: bonusSpins > 0,
          bonus_name: bonusName,
          bonus_session_id: row.bonus_session_id,
          bonus_spins_remaining: Number(row.bonus_spins_remaining || 0),
          bonus_total_spins: bonusSpins > 0 ? cfg.freeSpins : 0,
          free_spin: false,
        },
      }),
      { headers: cors },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message :
      typeof e === "object" && e !== null && "message" in e ? String(e.message) : "Unable to play themed slots";
    const conflict = message.includes("REQUEST_CONFLICT");
    return new Response(
      JSON.stringify({
        error: conflict ? "This request was already used for a different wager" : message,
        ...(conflict ? { code: "REQUEST_CONFLICT" } : {}),
      }),
      { status: conflict ? 409 : 400, headers: cors },
    );
  }
});
