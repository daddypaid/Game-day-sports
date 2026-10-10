import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { startGame, actGame, publicHand, type EngineState, type Game } from "./engine.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
const games = new Set(["holdem", "omaha", "stud", "draw"]);
const playActions = new Set(["fold", "check", "call", "bet", "raise", "all-in", "pot", "bring-in", "complete", "draw"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const handColumns = "id,game,status,action_count,private_state,started_request_id,last_request_id";

class PokerError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_REQUEST") { super(message); }
}
function dollarsToCents(value: unknown, name: string, max = 10000) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new PokerError(`${name} must be a valid amount in dollars and cents.`);
  }
  return Math.round(value * 100);
}
function requestUuid(value: unknown, name: string) {
  if (typeof value !== "string" || !uuid.test(value)) throw new PokerError(`${name} is required.`);
  return value.toLowerCase();
}
function readCents(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100))) {
    throw new PokerError("Unable to refresh your test balance. Check your hand before playing again.", 503, "UNAVAILABLE");
  }
  return Math.round(number * 100);
}
function dbFailure(error: { message?: string } | null) {
  if (!error) return;
  const code = error.message || "";
  const known: Record<string, [number, string]> = {
    HAND_CHANGED: [409, "Your hand changed. Check your hand before playing again."],
    WALLET_CHANGED: [409, "Your test balance changed. Check your hand before playing again."],
    ACTIVE_HAND_EXISTS: [409, "You already have an active hand at this table. Check your hand to continue."],
    REQUEST_CONFLICT: [409, "This request belongs to a different action. Check your hand before playing again."],
    HAND_NOT_FOUND: [404, "Poker hand not found."],
    INSUFFICIENT_BALANCE: [400, "Your wager exceeds your test balance. Reduce the wager and try again."],
    WALLET_NOT_FOUND: [400, "Your GameDay test wallet is unavailable. Open Account to check your wallet."]
  };
  if (known[code]) throw new PokerError(known[code][1], known[code][0], code);
  // Unexpected database failures may contain private state or implementation details.
  throw new PokerError("GameDay could not confirm this action. Check your hand before playing again.", 503, "UNAVAILABLE");
}
function engineFailure(error: unknown): never {
  if (!(error instanceof Error) || error.name === "TypeError" || /deck|hand ledger|hand is not complete/i.test(error.message)) {
    throw new PokerError("GameDay could not confirm this action. Check your hand before playing again.", 503, "UNAVAILABLE");
  }
  throw new PokerError(error.message);
}
async function timedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); init?.signal?.removeEventListener("abort", abort); }
}
function publicResponse(row: Record<string, any> | null, balanceCents: number) {
  if (!row) return { ok: true, hand: null, balance: balanceCents / 100 };
  const safeHand = publicHand(row.private_state as EngineState, balanceCents);
  return {
    ok: true,
    hand: {
      ...safeHand, id: row.id || row.hand_id,
      started_request_id: row.started_request_id,
      last_request_id: row.last_request_id || row.request_id,
      balance: balanceCents / 100
    },
    balance: balanceCents / 100
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
    if (!token) throw new PokerError("Sign in to play with GameDay test credits.", 401, "AUTH_REQUIRED");
    if (Number(req.headers.get("Content-Length") || 0) > 16384) throw new PokerError("Request is too large.", 413);
    const text = await req.text();
    if (text.length > 16384) throw new PokerError("Request is too large.", 413);
    let body;
    try { body = JSON.parse(text); } catch (_) { throw new PokerError("The poker request is invalid."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PokerError("The poker request is invalid.");
    const game = body.game as Game;
    const action = body.action;
    if (!games.has(game)) throw new PokerError("Choose a supported GameDay poker table.");
    if (!["latest", "state", "deal"].includes(action) && !playActions.has(action)) throw new PokerError("That action is not available at this table.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth }, fetch: timedFetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user?.id) throw new PokerError("Your session expired. Sign in again to continue your hand.", 401, "AUTH_REQUIRED");
    const userId = userData.user.id;
    const admin = createClient(url, service, { global: { fetch: timedFetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const loadBalance = async () => {
      const { data, error } = await admin.from("wallets").select("balance").eq("user_id", userId).single();
      dbFailure(error);
      if (!data) throw new PokerError("Your GameDay test wallet is unavailable.", 400, "WALLET_NOT_FOUND");
      return readCents(data.balance);
    };
    const loadHand = async (id: string) => {
      const { data, error } = await admin.from("poker_test_hands").select(handColumns)
        .eq("id", id).eq("user_id", userId).eq("game", game).eq("is_test", true).maybeSingle();
      dbFailure(error);
      if (!data) throw new PokerError("Poker hand not found.", 404, "HAND_NOT_FOUND");
      return data;
    };

    if (action === "latest" || action === "state") {
      let row;
      if (action === "state") row = await loadHand(requestUuid(body.hand_id, "Hand ID"));
      else {
        const { data, error } = await admin.from("poker_test_hands").select(handColumns)
          .eq("user_id", userId).eq("game", game).eq("is_test", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
        dbFailure(error); row = data;
      }
      return new Response(JSON.stringify(publicResponse(row, await loadBalance())), { headers });
    }

    const requestId = requestUuid(body.request_id, "Request ID");
    let handId: string | null = null, expectedCount = -1;
    let amountCents = 0, stakeCents = 0, discards: number[] = [];
    let payload: Record<string, any> = { game, action };
    if (action === "deal") {
      stakeCents = dollarsToCents(body.stake, "Wager", 10000);
      if (stakeCents < 100) throw new PokerError("Choose a wager of at least $1 before Deal.");
      payload.stake = stakeCents / 100;
    } else {
      handId = requestUuid(body.hand_id, "Hand ID");
      expectedCount = body.action_count;
      if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > 10000) throw new PokerError("Check your hand before playing again.");
      if (body.amount !== undefined) amountCents = dollarsToCents(body.amount, "Bet");
      if (body.discards !== undefined) {
        if (!Array.isArray(body.discards) || body.discards.length > 5 || body.discards.some((index: unknown) => !Number.isInteger(index) || Number(index) < 0 || Number(index) > 4) || new Set(body.discards).size !== body.discards.length) throw new PokerError("Select up to five different cards to discard.");
        discards = [...body.discards].sort((a, b) => a - b);
      }
      payload = { ...payload, hand_id: handId, action_count: expectedCount, amount: amountCents / 100, discards };
    }

    // Check receipts before engine validation so retries still work after a hand settles.
    const { data: receipt, error: receiptError } = await admin.from("poker_test_actions")
      .select("hand_id,game,request_payload,state_result,balance,started_request_id,request_id")
      .eq("user_id", userId).eq("request_id", requestId).maybeSingle();
    dbFailure(receiptError);
    if (receipt) {
      const previous = receipt.request_payload;
      if (receipt.game !== game || JSON.stringify(previous) !== JSON.stringify(payload)) {
        // PostgreSQL JSONB does not preserve key order; compare canonical fields.
        const keys = Object.keys(payload).sort();
        if (receipt.game !== game || JSON.stringify(Object.keys(previous).sort()) !== JSON.stringify(keys) || keys.some(key => JSON.stringify(previous[key]) !== JSON.stringify(payload[key]))) {
          throw new PokerError("This request belongs to a different action. Check your hand before playing again.", 409, "REQUEST_CONFLICT");
        }
      }
      return new Response(JSON.stringify(publicResponse({ ...receipt, private_state: receipt.state_result }, readCents(receipt.balance))), { headers });
    }

    const balanceCents = await loadBalance();
    let transition;
    if (action === "deal") {
      try { transition = startGame(game, stakeCents, balanceCents); }
      catch (error) { engineFailure(error); }
    }
    else {
      const row = await loadHand(handId!);
      if (row.status !== "active" || row.action_count !== expectedCount) throw new PokerError("Your hand changed. Check your hand before playing again.", 409, "HAND_CHANGED");
      try { transition = actGame(row.private_state as EngineState, action, amountCents, discards, balanceCents); }
      catch (error) { engineFailure(error); }
    }
    const { data: rows, error: commitError } = await admin.rpc("commit_poker_test_hand_atomic", {
      p_user_id: userId, p_game: game, p_request_id: requestId, p_request_payload: payload,
      p_hand_id: handId, p_expected_action_count: expectedCount, p_expected_balance: balanceCents / 100,
      p_state: transition.state, p_debit: transition.debitCents / 100, p_payout: transition.payoutCents / 100
    });
    dbFailure(commitError);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.hand_id || !row?.private_state) throw new PokerError("GameDay could not confirm this action. Check your hand before playing again.", 503, "UNAVAILABLE");
    return new Response(JSON.stringify(publicResponse(row, readCents(row.balance))), { headers });
  } catch (error) {
    let failure: PokerError;
    if (error instanceof PokerError) failure = error;
    else if (error instanceof Error && error.name === "AbortError") failure = new PokerError("Connection timed out. Check your hand before playing again.", 503, "UNAVAILABLE");
    else failure = new PokerError("GameDay could not confirm this action. Check your hand before playing again.", 503, "UNAVAILABLE");
    return new Response(JSON.stringify({ ok: false, error: failure.message, code: failure.code }), { status: failure.status, headers });
  }
});
