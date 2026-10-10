import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

// Read-only settled receipts. Never select a shoe, remaining deck or active hand.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POKER = new Set(["holdem", "omaha", "stud", "draw"]);
const GAMES = new Set(["blackjack", "baccarat", "roulette", "jacks-or-better", ...POKER]);
const RANKS = new Set(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
const SUITS = new Set(["♠", "♥", "♦", "♣"]);
const BLACKJACK_SETTLED = ["player_blackjack", "player_bust", "dealer_bust", "won", "lost", "push"];
const COLUMNS = {
  blackjack: "id,stake,status,player_cards,player_hands,dealer_cards,player_total,dealer_total,payout,created_at,settled_at,insurance_status,insurance_stake,insurance_payout",
  baccarat: "id,stake,bet_type,player_cards,banker_cards,player_total,banker_total,result,payout,created_at",
  roulette: "id,stake,bet_type,bet_value,winning_number,winning_color,payout,result,created_at",
  jacks: "id,stake,initial_hand,final_hand,result,multiplier,payout,created_at,settled_at",
  // JSON projections deliberately exclude the private deck and betting internals.
  poker: "id,game,stake,committed,payout,created_at,settled_at,outcome:private_state->>result,player_cards:private_state->player,opponent_cards:private_state->opponent,board:private_state->board,showdown:private_state->showdown,player_rank:private_state->>playerRank,opponent_rank:private_state->>opponentRank,pot_cents:private_state->potCents,opponent_committed_cents:private_state->opponentCommittedCents",
};
class HistoryError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HistoryError("Casino history could not connect. Refresh to retry.", 503)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
async function timedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); init?.signal?.removeEventListener("abort", abort); }
}
function amount(value: unknown) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw new Error("Invalid stored amount");
  return Math.round(n * 100) / 100;
}
function cents(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid stored amount");
  return n / 100;
}
function cards(value: unknown, max = 52): { rank: string; suit: string }[] {
  if (!Array.isArray(value) || value.length > max || value.some(card => !card || !RANKS.has(card.rank) || !SUITS.has(card.suit))) throw new Error("Invalid stored cards");
  // No object spread: unexpected JSON keys must not become public receipt fields.
  return value.map(card => ({ rank: card.rank, suit: card.suit }));
}
function whole(value: unknown, min = 0, max = 100) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error("Invalid stored result");
  return Number(value);
}
function text(value: unknown) {
  if (typeof value !== "string" || value.length > 100) throw new Error("Invalid stored result");
  return value;
}
function receipt(game: string, row: Record<string, any>) {
  let stake = amount(row.stake), payout = amount(row.payout), outcome: string;
  let result: Record<string, any>;
  if (game === "blackjack") {
    const insuranceStake = amount(row.insurance_stake ?? 0), insurancePayout = amount(row.insurance_payout ?? 0);
    outcome = text(row.status);
    result = {
      main_stake: stake, main_payout: payout,
      insurance_status: text(row.insurance_status ?? "not_offered"), insurance_stake: insuranceStake, insurance_payout: insurancePayout,
      player_cards: cards(row.player_cards), dealer_cards: cards(row.dealer_cards),
      player_total: whole(row.player_total), dealer_total: whole(row.dealer_total),
      player_hands: Array.isArray(row.player_hands) ? row.player_hands.map(hand => ({
        cards: cards(hand.cards), stake: amount(hand.stake), total: whole(hand.total), status: text(hand.status), doubled: hand.doubled === true,
      })) : null,
    };
    stake = amount(stake + insuranceStake); payout = amount(payout + insurancePayout);
  } else if (game === "baccarat") {
    outcome = text(row.result);
    result = { bet_type: text(row.bet_type), player_cards: cards(row.player_cards, 3), banker_cards: cards(row.banker_cards, 3), player_total: whole(row.player_total, 0, 9), banker_total: whole(row.banker_total, 0, 9) };
  } else if (game === "roulette") {
    outcome = text(row.result);
    result = { bet_type: text(row.bet_type), bet_value: row.bet_value === null ? null : text(row.bet_value), winning_number: whole(row.winning_number, 0, 36), winning_color: text(row.winning_color) };
  } else if (game === "jacks-or-better") {
    outcome = text(row.result);
    result = { initial_hand: cards(row.initial_hand, 5), final_hand: cards(row.final_hand, 5), multiplier: amount(row.multiplier) };
  } else {
    stake = amount(row.committed);
    outcome = text(row.outcome);
    const opponent = cards(row.opponent_cards, 7), showdown = row.showdown === true;
    result = {
      ante: amount(row.stake), committed: stake, opponent_committed: cents(row.opponent_committed_cents), pot: cents(row.pot_cents),
      player_cards: cards(row.player_cards, 7), board: cards(row.board, 5), showdown,
      // A folded opponent's downcards were never shown in the game and stay hidden.
      opponent_cards: opponent.map((card, index) => showdown || (game === "stud" && index >= 2 && index <= 5) ? card : { rank: "?", suit: "" }),
      ...(showdown ? { player_rank: text(row.player_rank), opponent_rank: text(row.opponent_rank) } : {}),
    };
  }
  return { id: row.id, game, created_at: row.created_at, settled_at: row.settled_at ?? row.created_at, stake, payout, outcome, result };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers });
  try {
    const auth = req.headers.get("Authorization") || "", token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
    if (!token) throw new HistoryError("Sign in to view your casino history.", 401);
    if (Number(req.headers.get("Content-Length") || 0) > 4096) throw new HistoryError("History request is too large.", 413);
    const raw = await req.text();
    if (raw.length > 4096) throw new HistoryError("History request is too large.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new HistoryError("The history request is invalid."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HistoryError("The history request is invalid.");
    const game = body.game, limit = body.limit ?? 20, before = body.before;
    if (!GAMES.has(game)) throw new HistoryError("Choose a supported casino game.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HistoryError("History limit must be between 1 and 50.");
    if (before !== undefined && before !== null && (typeof before !== "object" || Array.isArray(before) || typeof before.id !== "string" || !UUID.test(before.id) || typeof before.created_at !== "string" || !TIMESTAMP.test(before.created_at) || !Number.isFinite(Date.parse(before.created_at)))) throw new HistoryError("The history cursor is invalid.");

    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const options = { global: { headers: { Authorization: auth }, fetch: timedFetch }, auth: { persistSession: false, autoRefreshToken: false } };
    const userClient = createClient(url, anon, options);
    const { data: userData, error: userError } = await bounded(userClient.auth.getUser(token));
    if (userError && ![401, 403].includes(Number(userError.status))) throw new HistoryError("Sign-in verification is unavailable. Refresh to reconnect.", 503);
    if (userError || !userData?.user?.id) throw new HistoryError("Your sign-in expired. Sign in again to view your casino history.", 401);
    const admin = createClient(url, service, { global: { fetch: timedFetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const source = game === "blackjack" ? "blackjack_hands" : game === "baccarat" ? "baccarat_rounds" : game === "roulette" ? "roulette_spins" : game === "jacks-or-better" ? "video_poker_hands" : "poker_test_hands";
    const columns = game === "jacks-or-better" ? COLUMNS.jacks : POKER.has(game) ? COLUMNS.poker : COLUMNS[game as "blackjack" | "baccarat" | "roulette"];
    let query = admin.from(source).select(columns).eq("user_id", userData.user.id).eq("is_test", true);
    if (game === "blackjack") query = query.in("status", BLACKJACK_SETTLED).not("settled_at", "is", null);
    else if (game === "jacks-or-better") query = query.eq("game", "jacks_or_better").eq("status", "settled").not("settled_at", "is", null);
    else if (POKER.has(game)) query = query.eq("game", game).eq("status", "settled").not("settled_at", "is", null);
    else if (game === "baccarat") query = query.in("result", ["player", "banker", "tie"]);
    else query = query.in("result", ["won", "lost"]);
    if (before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id.toLowerCase()})`);
    const { data, error } = await bounded(query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1));
    if (error || !Array.isArray(data)) throw new Error("History unavailable");
    const rows = data.slice(0, limit) as unknown as Record<string, any>[], last = rows[rows.length - 1];
    return new Response(JSON.stringify({ ok: true, rounds: rows.map(row => receipt(game, row)), next_cursor: data.length > limit && last ? { created_at: last.created_at, id: last.id } : null }), { headers });
  } catch (error) {
    const failure = error instanceof HistoryError ? error : new HistoryError("Casino history is unavailable. Refresh to try again.", 503);
    return new Response(JSON.stringify({ ok: false, error: failure.message }), { status: failure.status, headers });
  }
});
