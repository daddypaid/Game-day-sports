import { bounded } from "./operator-auth.ts";

type Source = {
  name: string;
  table: string;
  columns: string;
  time?: string;
  latest?: string;
  test?: boolean;
};
export async function collectOperatorHealth(db: any, now = new Date()) {
  const cutoff = new Date(now.getTime() - 86400000).toISOString();
  const sources: Source[] = [
    {
      name: "events",
      table: "sports_events",
      columns: "id",
      time: "updated_at",
    },
    { name: "markets", table: "sports_markets", columns: "id" },
    { name: "outcomes", table: "sports_outcomes", columns: "id" },
    {
      name: "snapshots",
      table: "sports_provider_snapshots",
      columns: "id,captured_at",
      latest: "captured_at",
    },
    {
      name: "caches",
      table: "odds_response_cache",
      columns: "cache_key,updated_at,expires_at",
      latest: "updated_at",
    },
    {
      name: "wagers",
      table: "wagers",
      columns: "id",
      time: "placed_at",
      test: true,
    },
    {
      name: "tx",
      table: "wallet_transactions",
      columns: "id",
      time: "created_at",
    },
    ...[
      "blackjack_hands",
      "roulette_spins",
      "baccarat_rounds",
      "slot_spins",
      "video_poker_hands",
      "three_card_poker_rounds",
      "ultimate_texas_holdem_rounds",
      "caribbean_stud_rounds",
      "poker_test_hands",
    ].map((table) => ({
      name: table,
      table,
      columns: "id",
      time: "created_at",
      test: true,
    })),
    {
      name: "themed_slot_bonus_spins",
      table: "themed_slot_bonus_spins",
      columns: "id",
      time: "created_at",
    },
  ];
  const values = await Promise.all(sources.map(async (source) => {
    try {
      let query = db.from(source.table).select(source.columns, {
        count: "exact",
      }).limit(1);
      if (source.time) {
        query = query.gte(source.time, cutoff).lte(
          source.time,
          now.toISOString(),
        );
      }
      if (source.latest) {
        query = query.order(source.latest, { ascending: false });
      }
      if (source.test) query = query.eq("is_test", true);
      const { data, count, error } = await bounded<any>(query);
      if (
        error || !Array.isArray(data) || !Number.isSafeInteger(count) ||
        count < 0
      ) throw new Error("Read unavailable");
      return [source.name, {
        count,
        row: data[0] || null,
        error: false,
      }] as const;
    } catch {
      return [source.name, { count: null, row: null, error: true }] as const;
    }
  }));
  const r: Record<string, any> = Object.fromEntries(values);
  const time = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? Date.parse(value)
      : null;
  const latestSnapshot = r.snapshots.row?.captured_at ?? null,
    latestCache = r.caches.row?.updated_at ?? null,
    cacheExpiry = r.caches.row?.expires_at ?? null;
  const recent = (value: unknown) => {
    const stamp = time(value);
    return stamp !== null && stamp >= now.getTime() - 600000 &&
      stamp <= now.getTime() + 60000;
  };
  const providerFresh = recent(latestSnapshot),
    cacheFresh = recent(latestCache) &&
      (time(cacheExpiry) ?? 0) > now.getTime();
  const casinoNames = sources.filter((source) =>
    source.name.endsWith("_hands") || source.name.endsWith("_rounds") ||
    source.name.endsWith("_spins")
  ).map((source) => source.name);
  const casinoError = casinoNames.some((name) => r[name].error);
  const casinoCount = casinoError
    ? null
    : casinoNames.reduce((n, name) => n + r[name].count, 0);
  const anyError = values.some(([, result]) => result.error);
  const countDetail = (source: string, noun: string) =>
    r[source].error
      ? `${noun} read unavailable; no count was inferred.`
      : `${r[source].count} ${noun} in 24h; database read measured.`;
  let settlement: any = null;
  let settlementError = false;
  try {
    const { data, error } = await bounded<any>(
      db.rpc("get_test_wager_settlement_health"),
    );
    const integerKeys = [
      "pending_count",
      "review_required_count",
      "provider_error_count",
      "check_error_count",
      "unchecked_count",
      "retry_due_count",
      "active_lease_count",
      "max_pending_age_seconds",
    ];
    const dateKeys = [
      "oldest_unresolved_at",
      "oldest_checked_at",
      "last_check_at",
      "last_attempt_at",
      "last_success_at",
    ];
    if (
      error || !data || integerKeys.some((key) =>
        !Number.isSafeInteger(data[key]) || data[key] < 0
      ) ||
      dateKeys.some((key) =>
        data[key] !== null && time(data[key]) === null
      )
    ) throw new Error("Settlement read unavailable");
    // Only whitelisted aggregate values leave the privileged boundary.
    settlement = Object.fromEntries(
      [...integerKeys, ...dateKeys].map((key) => [key, data[key]]),
    );
  } catch {
    settlementError = true;
  }
  const lastCheck = time(settlement?.last_check_at),
    oldestPending = time(settlement?.oldest_unresolved_at);
  const gradingStalled = !!settlement && settlement.retry_due_count > 0 &&
    (lastCheck !== null
      ? lastCheck < now.getTime() - 900000
      : oldestPending !== null && oldestPending < now.getTime() - 900000);
  const checks = [
    {
      key: "database",
      label: "Database reads",
      status: anyError || settlementError ? "degraded" : "healthy",
      detail: anyError || settlementError
        ? `${
          values.filter(([, result]) => !result.error).length
        }/${values.length} reads succeeded; some sources are unavailable.`
        : `${values.length}/${values.length} aggregate reads and settlement health succeeded.`,
      measured: true,
    },
    {
      key: "sports_data",
      label: "Sports data reads",
      status: [r.events, r.markets, r.outcomes].some((x) => x.error)
        ? "degraded"
        : "healthy",
      detail: [r.events, r.markets, r.outcomes].some((x) => x.error)
        ? "Sports source reads are unavailable."
        : countDetail("events", "updated events"),
      measured: true,
    },
    {
      key: "provider",
      label: "Stored provider snapshots",
      status: r.snapshots.error
        ? "degraded"
        : providerFresh
        ? "healthy"
        : "stale",
      detail: r.snapshots.error
        ? "Snapshot read unavailable."
        : latestSnapshot
        ? `Most recent captured snapshot ${latestSnapshot}. External provider availability was not tested.`
        : "No stored provider snapshot; external provider availability was not tested.",
      measured: true,
    },
    {
      key: "cache",
      label: "Stored odds cache",
      status: r.caches.error ? "degraded" : cacheFresh ? "healthy" : "stale",
      detail: r.caches.error
        ? "Cache read unavailable."
        : latestCache
        ? `Last refresh ${latestCache}; expiry ${cacheExpiry ?? "unavailable"}.`
        : "No stored cache record.",
      measured: true,
    },
    {
      key: "wallet",
      label: "Wallet ledger reads",
      status: r.tx.error ? "degraded" : "healthy",
      detail: countDetail("tx", "transactions"),
      measured: true,
    },
    {
      key: "sportsbook",
      label: "Sportsbook test activity",
      status: r.wagers.error ? "degraded" : "healthy",
      detail: countDetail("wagers", "test wagers"),
      measured: true,
    },
    {
      key: "settlement",
      label: "Sportsbook grading backlog",
      status: settlementError
        ? "degraded"
        : settlement.review_required_count > 0 ||
            settlement.provider_error_count > 0 ||
            settlement.check_error_count > 0 || gradingStalled
        ? "stale"
        : "healthy",
      detail: settlementError
        ? "Grading backlog read unavailable; no status was inferred."
        : `${settlement.pending_count} pending; ${settlement.review_required_count} require review; ${settlement.provider_error_count} provider errors; ${settlement.check_error_count} grading errors; ${settlement.retry_due_count} checks due. Last check ${
          settlement.last_check_at ?? "not yet recorded"
        }.${
          gradingStalled
            ? " Grading checks have not advanced within 15 minutes."
            : ""
        } Ticket age alone does not indicate an error.`,
      measured: true,
    },
    {
      key: "casino",
      label: "Casino test activity",
      status: casinoError ? "degraded" : "healthy",
      detail: casinoError
        ? "One or more casino source reads unavailable; no total was inferred."
        : `${casinoCount} test rounds/spins in 24h, including poker and bonus spins.`,
      measured: true,
    },
  ];
  return {
    ok: true,
    mode: "TEST MODE",
    overall: checks.some((c) => c.status === "degraded")
      ? "degraded"
      : checks.some((c) => c.status === "stale")
      ? "attention"
      : "healthy",
    generated_at: now.toISOString(),
    scope:
      "Measured database reachability, stored-data freshness and test activity only; gameplay, external provider availability, payments and launch readiness are not verified.",
    checks,
    settlement,
    totals: {
      markets: r.markets.count,
      outcomes: r.outcomes.count,
      provider_snapshots: r.snapshots.count,
      cache_entries: r.caches.count,
      casino_rounds_24h: casinoCount,
    },
    freshness: {
      provider_captured_at: latestSnapshot,
      cache_updated_at: latestCache,
      cache_expires_at: cacheExpiry,
      threshold_seconds: 600,
    },
  };
}
