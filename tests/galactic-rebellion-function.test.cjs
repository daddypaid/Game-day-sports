const assert = require("node:assert/strict");
const path = require("node:path");
const { load } = require("./helpers/themed-slot-function.cjs");

// Node.js 22.13+ or 24+. Every ledger and authentication call is a local fixture.
const source = path.join(__dirname, "../supabase/functions/themed-slots-test/index.ts");
const baseline = path.join(__dirname, "fixtures/themed-slots-v5-math.ts");
const fresh = (state) => load(source, state);
const rpcCalls = (h) => h.calls.filter((call) => call.operation === "rpc");
const bonus = (unit, total = 6, remaining = 1) => ({
  id: "bonus-id", game: "galactic-rebellion", bet_per_line: unit,
  spins_remaining: remaining, total_spins: total, status: "active", total_payout: 2.5,
});

(async () => {
  let checks = 0;
  const game = fresh(), old = load(baseline);
  assert.deepEqual(game.evaluate('games["midnight-monsters"]'), old.evaluate('games["midnight-monsters"]'));
  assert.deepEqual(game.evaluate('games["galactic-rebellion"]'), old.evaluate('games["galactic-rebellion"]'));
  assert.deepEqual(game.evaluate("lines"), old.evaluate("lines"));
  checks += 3;

  // Midnight's approved fifteen-symbol math and all three bonus features are unchanged.
  for (let seed = 0; seed < 100; seed++) {
    for (const feature of ["paidFeature", "bonusFeature"]) {
      old.setSeed(seed);
      game.setSeed(seed);
      const code = `(() => {const cfg=games["midnight-monsters"],grid=makeGrid(cfg),feature=${feature}("midnight-monsters",grid,cfg);return {grid,feature,result:evaluate(grid,cfg,.1)}})()`;
      assert.deepEqual(game.evaluate(code), old.evaluate(code));
      checks++;
    }
  }

  const config = game.evaluate("galacticGameConfig");
  assert.equal(config.mode, "ways");
  assert.equal(config.ways, 243);
  assert.equal(config.free_spins, 6);
  assert.deepEqual([config.min_total_bet, config.max_total_bet, config.total_bet_step, config.default_total_bet], [0.1, 200, 0.1, 1]);
  assert.deepEqual(game.evaluate("[...new Set(galacticWays.weights)]"), [
    "STARFIGHTER", "STATION", "PLANET", "ASTEROID", "GALAXY", "PILOT", "QUEEN", "BOT",
    "CHEST", "COMPASS", "REDPLANET", "RINGED", "BLACKHOLE", "CANNON", "WILD", "SCATTER",
  ]);
  checks += 5;

  // Hand-calculated prefix fixtures: suffix rows never multiply shorter matches.
  const testConfig = { wild: "W", scatter: "S", pays: {
    A: [0, 0, 1, 3, 10], B: [0, 0, 2, 6, 20], C: [0, 0, 5, 15, 50], W: [0, 0, 3, 9, 30],
  } };
  const examples = [
    { columns: ["A--", "A--", "A--", "B--", "C--"], ways: 1, units: 1 },
    { columns: ["A--", "A--", "A--", "A--", "B--"], ways: 1, units: 3 },
    { columns: ["AA-", "AAA", "A--", "B--", "C--"], ways: 6, units: 6 },
    { columns: ["AA-", "AAA", "A--", "AA-", "C--"], ways: 12, units: 36 },
    { columns: ["AW-", "AW-", "AW-", "B--", "C--"], ways: 8, units: 13 },
    { columns: ["W--", "W--", "W--", "AB-", "---"], ways: 2, units: 9 },
    { columns: ["W--", "W--", "W--", "W--", "W--"], ways: 1, units: 50 },
    { columns: ["WWW", "WWW", "WWW", "WWW", "WWW"], ways: 243, units: 12150 },
    { columns: ["A--", "A--", "B--", "A--", "A--"], ways: 0, units: 0 },
    { columns: ["B--", "A--", "A--", "A--", "A--"], ways: 0, units: 0 },
    { columns: ["S--", "S--", "S--", "A--", "A--"], ways: 0, units: 30 },
  ];
  for (const { columns, ways, units } of examples) {
    const grid = columns.map((column) => [...column]);
    const result = game.evaluate(`evaluateWays(${JSON.stringify(grid)},${JSON.stringify(testConfig)},1)`);
    assert.equal(result.winningWays, ways, columns.join(" "));
    assert.equal(result.payout, units, columns.join(" "));
    assert.deepEqual(result.activeLines, []);
    checks++;
  }
  const actualConfig = game.evaluate("galacticWays");
  const wildPrefix = Array.from({ length: 4 }, () => ["WILD", "-", "-"]);
  for (const [last, expected, ways] of [
    [["ASTEROID", "-", "-"], 15, 1],
    [["ASTEROID", "ASTEROID", "ASTEROID"], 24, 3],
    [["ASTEROID", "STARFIGHTER", "-"], 48, 2],
  ]) {
    const result = game.evaluate(`evaluateWays(${JSON.stringify([...wildPrefix, last])},galacticWays,1)`);
    assert.equal(result.payout, expected);
    assert.equal(result.winningWays, ways);
    checks++;
  }
  const oneFighter = [["STARFIGHTER", "-", "-"], ["STARFIGHTER", "-", "-"], ["STARFIGHTER", "-", "-"], ["-", "-", "-"], ["-", "-", "-"]];
  assert.equal(game.evaluate(`evaluateWays(${JSON.stringify(oneFighter)},galacticWays,1/243).payout`), 0.02);
  checks++;

  // Every ten-cent total reaches the service-owned atomic ledger with exactly that stake.
  for (let cents = 10; cents <= 20000; cents += 10) {
    const h = fresh(), total = cents / 100;
    const response = await h.request({ game: "galactic-rebellion", total_bet: total, user_id: "other-user", payout: 9999 });
    assert.equal(response.status, 200);
    const spin = response.body.spin, rpc = rpcCalls(h)[0];
    assert.equal(spin.wager_mode, "ways");
    assert.equal(spin.math_version, "ways-v1");
    assert.equal(spin.ways, 243);
    assert.equal(spin.total_bet, total);
    assert.equal(spin.stake, total);
    assert.equal(spin.bet_per_line, total / 243);
    assert.equal(rpc.name, "play_themed_slot_paid_spin_atomic");
    assert.equal(rpc.args.p_user_id, "owned-user");
    assert.equal(rpc.args.p_stake, total);
    assert.equal(rpc.args.p_bet_per_line, total / 243);
    assert.equal(rpc.args.p_reels.length, 15);
    assert(spin.grid.every((column) => column.length === 3 && column.every((symbol) => actualConfig.weights.includes(symbol))));
    assert(Number.isFinite(spin.payout) && spin.payout >= 0);
    assert(Number.isInteger(spin.winning_ways) && spin.winning_ways <= 243);
    checks++;
  }
  for (const value of [-1, 0, 0.01, 0.09, 0.15, 0.101, 0.10000000001, 199.99, 200.1, 201, "Infinity", "NaN", null]) {
    const h = fresh(), response = await h.request({ game: "galactic-rebellion", total_bet: value, bet_per_line: 1 });
    assert.equal(response.status, 400, `invalid total accepted: ${value}`);
    assert.equal(rpcCalls(h).length, 0);
    checks++;
  }

  const trigger = fresh();
  trigger.setSequence([...Array(15).fill(15), 99, 0]);
  const triggered = await trigger.request({ game: "galactic-rebellion", total_bet: 1 });
  assert.equal(triggered.status, 200);
  assert.equal(triggered.body.spin.bonus_triggered, true);
  assert.equal(triggered.body.spin.bonus_total_spins, 6);
  assert.equal(triggered.body.spin.bonus_spins_remaining, 6);
  assert.equal(triggered.body.spin.feature_name, "FINAL ORBIT TRIGGER");
  assert.equal(triggered.body.spin.payout, 0.99); // 12 remaining Scatters ×10×2/243, rounded once.
  assert.equal(rpcCalls(trigger)[0].args.p_bonus_spins, 6);
  checks += 7;

  // Bonus mode is reconstructed from an unrounded, trusted numeric unit, not the request.
  for (const total of [0.1, 1, 9.9, 199.9, 200]) {
    const h = fresh({ session: bonus(total / 243) });
    const status = await h.request({ game: "galactic-rebellion", action: "status" });
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.game_config, config);
    assert.equal(status.body.bonus.wager_mode, "ways");
    assert.equal(status.body.bonus.total_bet, total);
    const response = await h.request({ game: "galactic-rebellion", action: "bonus_spin", session_id: "bonus-id", total_bet: 200, bet_per_line: 10 });
    assert.equal(response.status, 200);
    assert.equal(response.body.spin.stake, 0);
    assert.equal(response.body.spin.total_bet, total);
    assert.equal(response.body.spin.bonus_total_spins, 6);
    assert.equal(response.body.spin.bonus_spins_remaining, 0);
    assert.equal(response.body.spin.bonus_complete, true);
    assert.deepEqual(h.calls.find((call) => call.operation === "select" && call.selection.includes("game,")).filters, [
      ["id", "bonus-id"], ["user_id", "owned-user"], ["game", "galactic-rebellion"],
    ]);
    assert.equal(rpcCalls(h)[0].name, "settle_themed_bonus_spin_atomic");
    checks++;
  }
  const fractionalBonus = fresh({ session: bonus(0.1 / 243) });
  fractionalBonus.setSequence([0, 1, 2, 0, 3, 4, 0, 5, 6, 7, 8, 9, 10, 11, 12, 2]);
  const fractionalResult = await fractionalBonus.request({ game: "galactic-rebellion", action: "bonus_spin", session_id: "bonus-id" });
  assert.equal(fractionalResult.status, 200);
  assert.equal(fractionalResult.body.spin.payout, 0.01); // Three 3-match Fighter ways ×4×2×$0.10/243.
  assert.equal(rpcCalls(fractionalBonus)[0].args.p_payout, 0.01); // Round after the bonus multiplier, once.
  checks += 3;
  for (const unit of [1, 2, 10]) {
    const h = fresh({ session: bonus(unit) });
    const restored = await h.request({ game: "galactic-rebellion", action: "status" });
    assert.equal(restored.body.bonus.wager_mode, "lines");
    assert.equal(restored.body.bonus.lines, 20);
    assert.equal(restored.body.bonus.total_bet, unit * 20);
    const response = await h.request({ game: "galactic-rebellion", action: "bonus_spin", session_id: "bonus-id", total_bet: 0.1 });
    assert.equal(response.status, 200);
    assert.equal(response.body.spin.wager_mode, "lines");
    assert.equal(response.body.spin.total_bet, unit * 20);
    assert(response.body.spin.grid.every((column) => column.every((symbol) => !["STARFIGHTER", "STATION", "BOT", "CANNON"].includes(symbol))));
    checks++;
  }
  for (const session of [null, { ...bonus(1 / 243), status: "completed" }, { ...bonus(1 / 243), spins_remaining: 0 }, bonus(0), bonus(0.9), bonus(0.01), bonus(11)]) {
    const h = fresh({ session });
    const response = await h.request({ game: "galactic-rebellion", action: "bonus_spin", session_id: "other-bonus" });
    assert.equal(response.status, 400);
    assert.equal(rpcCalls(h).length, 0);
    checks++;
  }
  const unavailable = fresh({ statusError: "Bonus restore unavailable" });
  assert.deepEqual(await unavailable.request({ game: "galactic-rebellion", action: "status" }), {
    status: 400, body: { error: "Bonus restore unavailable" },
  });
  assert.equal(rpcCalls(unavailable).length, 0);
  checks += 2;
  for (const action of ["unknown", "SPIN", "", null, 0, false, ["spin"]]) {
    const h = fresh(), response = await h.request({ game: "galactic-rebellion", action, total_bet: 1 });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Unknown Galactic Rebellion action");
    assert.equal(rpcCalls(h).length, 0);
    checks++;
  }
  const unauthorized = fresh({ authenticated: false });
  assert.equal((await unauthorized.request(null, "POST", "{invalid")).status, 401);
  assert.deepEqual(unauthorized.calls.map((call) => call.operation), ["client", "auth"]);
  const denied = fresh({ rpcError: "Insufficient test balance" });
  assert.deepEqual(await denied.request({ game: "galactic-rebellion", total_bet: 200 }), {
    status: 400, body: { error: "Insufficient test balance" },
  });
  checks += 3;
  console.log(JSON.stringify({ status: "PASS", checks, artworkSymbols: 15, scatterSymbols: 1, ways: 243, freeSpins: 6, liveWrites: 0 }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
