import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  allRows,
  bounded,
  OperatorError,
  operatorFailure,
  operatorMethod,
  operatorResponse,
  requireOperator,
} from "../_shared/operator-auth.ts";
const cash = (value: unknown, optional = false) => {
  if (optional && value == null) return 0;
  const n = Number(value);
  if (
    value == null || !Number.isFinite(n) || n < 0 ||
    !Number.isSafeInteger(Math.round(n * 100)) ||
    Math.abs(n * 100 - Math.round(n * 100)) > 1e-6
  ) {
    throw new OperatorError(
      "Stored analytics amounts are invalid. No totals were inferred.",
    );
  }
  return Math.round(n * 100);
};
const sum = (rows: any[], key: string) =>
  rows.reduce((n, row) => n + cash(row[key]), 0) / 100;
const countBy = (rows: any[], key: string) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = typeof row[key] === "string"
      ? row[key].slice(0, 200)
      : "unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Object.fromEntries(counts);
};
const top = (counts: Record<string, number>, n = 5) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n).map(([name, count]) => ({ name, count }));
Deno.serve(async (req: Request) => {
  const method = operatorMethod(req);
  if (method) return method;
  try {
    const db = await requireOperator(req), asOf = new Date().toISOString();
    const [
      wagers,
      selections,
      tx,
      blackjack,
      roulette,
      baccarat,
      slots,
      video,
      three,
      ultimate,
      caribbean,
      poker,
      bonus,
    ] = await bounded(Promise.all([
      allRows(
        db,
        "wagers",
        "id,stake,potential_return,status,placed_at",
        asOf,
        "placed_at",
      ),
      allRows(
        db,
        "wager_selections",
        "id,sport_key,market_key,result,created_at,wagers!inner(is_test)",
        asOf,
        "created_at",
        false,
      ),
      allRows(
        db,
        "wallet_transactions",
        "id,transaction_type,amount,created_at",
        asOf,
        "created_at",
        false,
      ),
      allRows(
        db,
        "blackjack_hands",
        "id,stake,payout,status,insurance_stake,insurance_payout,created_at",
        asOf,
      ),
      allRows(db, "roulette_spins", "id,stake,payout,result,created_at", asOf),
      allRows(db, "baccarat_rounds", "id,stake,payout,result,created_at", asOf),
      allRows(db, "slot_spins", "id,stake,payout,result,created_at", asOf),
      allRows(
        db,
        "video_poker_hands",
        "id,stake,payout,status,result,created_at",
        asOf,
      ),
      allRows(
        db,
        "three_card_poker_rounds",
        "id,ante,decision,payout,status,result,created_at",
        asOf,
      ),
      allRows(
        db,
        "ultimate_texas_holdem_rounds",
        "id,ante,blind,play_bet,payout,status,result,created_at",
        asOf,
      ),
      allRows(
        db,
        "caribbean_stud_rounds",
        "id,ante,raise_bet,payout,status,result,created_at",
        asOf,
      ),
      allRows(
        db,
        "poker_test_hands",
        "id,game,committed,payout,status,created_at",
        asOf,
      ),
      allRows(
        db,
        "themed_slot_bonus_spins",
        "id,game,payout,created_at",
        asOf,
        "created_at",
        false,
      ),
    ]));
    const casino = [
      ...blackjack.map((row) => ({
        ...row,
        game: "Blackjack",
        handle: cash(row.stake) + cash(row.insurance_stake, true),
        returned: cash(row.payout) + cash(row.insurance_payout, true),
      })),
      ...[
        [roulette, "Roulette"],
        [baccarat, "Baccarat"],
        [slots, "Paid slots"],
        [video, "Video Poker"],
      ].flatMap(([rows, game]) =>
        (rows as any[]).map((row) => ({
          ...row,
          game,
          handle: cash(row.stake),
          returned: cash(row.payout),
        }))
      ),
      ...three.map((row) => ({
        ...row,
        game: "Three Card Poker",
        handle: cash(row.ante) * (row.decision === "play" ? 2 : 1),
        returned: cash(row.payout),
      })),
      ...ultimate.map((row) => ({
        ...row,
        game: "Ultimate Texas Hold’em",
        handle: cash(row.ante) + cash(row.blind) + cash(row.play_bet, true),
        returned: cash(row.payout),
      })),
      ...caribbean.map((row) => ({
        ...row,
        game: "Caribbean Stud",
        handle: cash(row.ante) + cash(row.raise_bet, true),
        returned: cash(row.payout),
      })),
      ...poker.map((row) => ({
        ...row,
        game: ({
          holdem: "Texas Hold’em",
          omaha: "Omaha",
          stud: "Seven-Card Stud",
          draw: "Five-Card Draw",
        } as Record<string, string>)[row.game] || "Poker",
        handle: cash(row.committed),
        returned: cash(row.payout),
      })),
      ...bonus.map((row) => ({
        ...row,
        game: "Free slot spins",
        handle: 0,
        returned: cash(row.payout),
      })),
    ];
    const handle = casino.reduce((n, row) => n + row.handle, 0) / 100,
      payout = casino.reduce((n, row) => n + row.returned, 0) / 100,
      cutoff = Date.now() - 7 * 86400000;
    const debits = tx.filter((row) => row.transaction_type === "wager_debit"),
      credits = tx.filter((row) => row.transaction_type === "wager_credit"),
      refunds = tx.filter((row) => row.transaction_type === "refund");
    return operatorResponse({
      ok: true,
      mode: "TEST MODE",
      generated_at: asOf,
      status: "measured",
      sportsbook: {
        wagers: wagers.length,
        handle: sum(wagers, "stake"),
        potential_return: sum(wagers, "potential_return"),
        statuses: countBy(wagers, "status"),
        recent_7d: wagers.filter((row) =>
          Date.parse(row.placed_at) >= cutoff
        ).length,
        top_sports: top(countBy(selections, "sport_key")),
        top_markets: top(countBy(selections, "market_key")),
      },
      casino: {
        rounds: casino.length,
        handle,
        payout,
        simulated_net: Math.round((handle - payout) * 100) / 100,
        recent_7d: casino.filter((row) =>
          Date.parse(row.created_at) >= cutoff
        ).length,
        game_mix: top(countBy(casino, "game"), 20),
        bonus_spins: bonus.length,
        poker_rounds: poker.length,
      },
      wallet: {
        transactions: tx.length,
        wager_debits: debits.length,
        wager_debit_amount: sum(debits, "amount"),
        wager_credits: credits.length,
        wager_credit_amount: sum(credits, "amount"),
        refunds: refunds.length,
        refund_amount: sum(refunds, "amount"),
      },
      note:
        "All figures are TEST MODE simulation metrics, not real-money revenue. Complete keyset pages are read up to request time; reads do not form a single transaction snapshot.",
    });
  } catch (error) {
    return operatorFailure(error);
  }
});
