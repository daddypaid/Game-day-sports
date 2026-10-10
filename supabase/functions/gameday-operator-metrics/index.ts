import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  bounded,
  exactCount,
  operatorFailure,
  operatorMethod,
  operatorResponse,
  requireOperator,
} from "../_shared/operator-auth.ts";

const TABLES = [
  "profiles",
  "wallets",
  "wagers",
  "wager_selections",
  "wallet_transactions",
  "blackjack_hands",
  "roulette_spins",
  "baccarat_rounds",
  "slot_spins",
  "video_poker_hands",
  "three_card_poker_rounds",
  "ultimate_texas_holdem_rounds",
  "caribbean_stud_rounds",
  "poker_test_hands",
  "themed_slot_bonus_spins",
  "sports_events",
  "sports_markets",
  "sports_outcomes",
  "sports_line_history",
  "sports_provider_snapshots",
  "odds_response_cache",
];
const CASINO = [
  "blackjack_hands",
  "roulette_spins",
  "baccarat_rounds",
  "slot_spins",
  "video_poker_hands",
  "three_card_poker_rounds",
  "ultimate_texas_holdem_rounds",
  "caribbean_stud_rounds",
  "poker_test_hands",
  "themed_slot_bonus_spins",
];
Deno.serve(async (req: Request) => {
  const method = operatorMethod(req);
  if (method) return method;
  try {
    const db = await requireOperator(req);
    const measured = await bounded(Promise.all(TABLES.map(async (table) => {
      const key = table === "odds_response_cache" ? "cache_key" : "id";
      let query = db.from(table).select(
        table === "wager_selections" ? "id,wagers!inner(is_test)" : key,
        { count: "exact", head: true },
      );
      if (
        table === "wagers" ||
        (CASINO.includes(table) && table !== "themed_slot_bonus_spins")
      ) query = query.eq("is_test", true);
      if (table === "wager_selections") {
        query = query.eq("wagers.is_test", true);
      }
      return [table, await exactCount(query)] as const;
    })));
    const counts = Object.fromEntries(measured);
    return operatorResponse({
      ok: true,
      mode: "TEST MODE",
      generated_at: new Date().toISOString(),
      status: "measured",
      scope:
        "Aggregate database reads; does not verify gameplay or launch readiness.",
      users: counts.profiles,
      wallets: counts.wallets,
      wagers: counts.wagers,
      wager_selections: counts.wager_selections,
      wallet_transactions: counts.wallet_transactions,
      casino_rounds: CASINO.reduce((n, t) => n + counts[t], 0),
      poker_rounds: counts.poker_test_hands,
      bonus_spins: counts.themed_slot_bonus_spins,
      sports_events: counts.sports_events,
      sports_markets: counts.sports_markets,
      sports_outcomes: counts.sports_outcomes,
      line_history: counts.sports_line_history,
      provider_snapshots: counts.sports_provider_snapshots,
      odds_cache_records: counts.odds_response_cache,
    });
  } catch (error) {
    return operatorFailure(error);
  }
});
