const assert = require("node:assert/strict");
const path = require("node:path");

// Run with Node.js 22.13+ or 24+: node tests/midnight-monsters-function.test.cjs

const originalPath = path.join(__dirname, "fixtures/themed-slots-v4-math.ts");
const changedPath = path.join(
  __dirname,
  "../supabase/functions/themed-slots-test/index.ts",
);
const { load } = require("./helpers/themed-slot-function.cjs");

(async () => {
  let checks = 0;
  const old = load(originalPath),
    game = load(changedPath);
  assert.deepEqual(
    game.evaluate('games["galactic-rebellion"]'),
    old.evaluate('games["galactic-rebellion"]'),
  );
  checks++;
  assert.deepEqual(game.evaluate("lines"), old.evaluate("lines"));
  checks++;
  const midnight = game.evaluate('games["midnight-monsters"]');
  assert.equal(new Set(midnight.weights).size, 15);
  assert.equal(midnight.freeSpins, 10);
  for (const [symbol, pays] of Object.entries(
    old.evaluate('games["midnight-monsters"].pays'),
  ))
    assert.deepEqual(midnight.pays[symbol], pays);
  checks += 9;

  for (let seed = 0; seed < 100; seed++) {
    old.setSeed(seed);
    game.setSeed(seed);
    const simulation =
      '(() => { const cfg=games["galactic-rebellion"], grid=makeGrid(cfg), feature=paidFeature("galactic-rebellion",grid,cfg); return {grid,feature,result:evaluate(grid,cfg,3)} })()';
    assert.deepEqual(game.evaluate(simulation), old.evaluate(simulation));
    checks++;
    const bonus =
      '(() => { const cfg=games["galactic-rebellion"], grid=makeGrid(cfg), feature=bonusFeature("galactic-rebellion",grid,cfg); return {grid,feature,result:evaluate(grid,cfg,7)} })()';
    assert.deepEqual(game.evaluate(bonus), old.evaluate(bonus));
    checks++;
  }

  // Authentication must reject before parsing JSON or accessing service-role data.
  const unsigned = load(changedPath, { authenticated: false });
  assert.equal((await unsigned.request(null, "POST", "{invalid")).status, 401);
  assert.deepEqual(
    unsigned.calls.map((call) => call.operation),
    ["client", "auth"],
  );
  checks += 2;
  const preflight = load(changedPath);
  assert.equal((await preflight.request(null, "OPTIONS")).status, 200);
  assert.equal((await preflight.request(null, "GET")).status, 405);
  assert.equal(preflight.calls.length, 0);
  checks += 3;

  // Every valid ten-cent increment reaches only the owned user's atomic RPC.
  for (let cents = 10; cents <= 1000; cents += 10) {
    const h = load(changedPath);
    const response = await h.request({
      game: "midnight-monsters",
      bet_per_line: cents / 100,
      user_id: "other-user",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.spin.stake, cents / 5);
    assert.equal(response.body.spin.grid.length, 5);
    assert(
      response.body.spin.grid.every(
        (column) =>
          column.length === 3 &&
          column.every((symbol) => midnight.weights.includes(symbol)),
      ),
    );
    const rpc = h.calls.find((call) => call.operation === "rpc");
    assert.equal(rpc.name, "play_themed_slot_paid_spin_atomic");
    assert.equal(rpc.args.p_user_id, "owned-user");
    assert.equal(rpc.args.p_bet_per_line, cents / 100);
    assert.equal(rpc.args.p_stake, cents / 5);
    assert.equal(rpc.args.p_reels.length, 15);
    assert(Number.isFinite(rpc.args.p_payout) && rpc.args.p_payout >= 0);
    checks++;
  }
  for (const bet of [
    -1,
    0,
    0.01,
    0.09,
    0.15,
    0.29,
    0.101,
    0.10000000001,
    1.10000000001,
    10.01,
    11,
    "Infinity",
    "NaN",
    null,
  ]) {
    const h = load(changedPath),
      response = await h.request({
        game: "midnight-monsters",
        bet_per_line: bet,
      });
    assert.equal(response.status, 400, `invalid bet accepted: ${bet}`);
    assert.equal(
      h.calls.filter(
        (call) => call.operation === "rpc" || call.operation === "select",
      ).length,
      0,
    );
    checks++;
  }
  for (const bet of [0.1, 0.5, 1.5, 10.1]) {
    const h = load(changedPath),
      response = await h.request({
        game: "galactic-rebellion",
        bet_per_line: bet,
      });
    assert.equal(response.status, 400);
    assert.equal(h.calls.filter((call) => call.operation === "rpc").length, 0);
    checks++;
  }

  // Force scatter trigger, including ten-spin persisted award and metadata.
  const trigger = load(changedPath);
  trigger.setSequence([...Array(15).fill(11), 99]);
  const triggered = await trigger.request({
    game: "midnight-monsters",
    bet_per_line: 0.1,
  });
  assert.equal(triggered.status, 200);
  assert.equal(triggered.body.spin.bonus_triggered, true);
  assert.equal(triggered.body.spin.bonus_spins_remaining, 10);
  assert.equal(triggered.body.spin.bonus_total_spins, 10);
  assert.equal(
    trigger.calls.find((call) => call.operation === "rpc").args.p_bonus_spins,
    10,
  );
  checks += 5;

  // Old eight-spin sessions keep their total; new sessions keep ten.
  for (const total of [8, 10]) {
    const h = load(changedPath, {
      session: {
        id: "bonus-id",
        game: "midnight-monsters",
        bet_per_line: 0.1,
        spins_remaining: 1,
        total_spins: total,
        status: "active",
        total_payout: 2.5,
      },
    });
    const response = await h.request({
      game: "midnight-monsters",
      action: "bonus_spin",
      session_id: "bonus-id",
      bet_per_line: 10,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.spin.stake, 0);
    assert.equal(response.body.spin.bet_per_line, 0.1);
    assert.equal(response.body.spin.bonus_total_spins, total);
    assert.equal(response.body.spin.bonus_spins_remaining, 0);
    assert.equal(response.body.spin.bonus_complete, true);
    const select = h.calls.find((call) => call.operation === "select");
    assert(select.selection.includes("total_spins"));
    assert.deepEqual(select.filters, [
      ["id", "bonus-id"],
      ["user_id", "owned-user"],
      ["game", "midnight-monsters"],
    ]);
    assert.equal(
      h.calls.find((call) => call.operation === "rpc").name,
      "settle_themed_bonus_spin_atomic",
    );
    checks++;
  }
  const missing = load(changedPath);
  assert.equal(
    (
      await missing.request({
        game: "midnight-monsters",
        action: "bonus_spin",
        session_id: "other-bonus",
      })
    ).status,
    400,
  );
  assert.equal(
    missing.calls.filter((call) => call.operation === "rpc").length,
    0,
  );
  checks += 2;
  const unavailable = load(changedPath, {
    rpcError: "Insufficient test balance",
  });
  const rejected = await unavailable.request({
    game: "midnight-monsters",
    bet_per_line: 0.1,
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Insufficient test balance");
  assert(!rejected.body.spin);
  checks += 3;

  // A failed status restore must never appear as "no active bonus" for Midnight.
  const failedStatus = load(changedPath, {
    statusError: "Bonus restore unavailable",
  });
  const status = await failedStatus.request({
    game: "midnight-monsters",
    action: "status",
  });
  assert.equal(status.status, 400);
  assert.equal(status.body.error, "Bonus restore unavailable");
  assert(!Object.hasOwn(status.body, "bonus"));
  assert.equal(
    failedStatus.calls.filter((call) => call.operation === "rpc").length,
    0,
  );
  const failedGalacticStatus = load(changedPath, {
    statusError: "Bonus restore unavailable",
  });
  assert.deepEqual(
    await failedGalacticStatus.request({
      game: "galactic-rebellion",
      action: "status",
    }),
    { status: 400, body: { error: "Bonus restore unavailable" } },
  );
  checks += 5;
  for (const action of [
    "unknown",
    "SPIN",
    "pay",
    "bonus",
    "__proto__",
    "",
    null,
    0,
    false,
    ["spin"],
  ]) {
    const h = load(changedPath);
    const response = await h.request({
      game: "midnight-monsters",
      action,
      bet_per_line: 0.1,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Unknown Midnight Monsters action");
    assert.equal(
      h.calls.filter(
        (call) => call.operation === "rpc" || call.operation === "select",
      ).length,
      0,
    );
    checks++;
  }
  const restored = load(changedPath, {
    session: {
      id: "bonus-id",
      spins_remaining: 7,
      total_spins: 8,
      total_payout: 2,
      status: "active",
      bet_per_line: 1,
    },
  });
  const restoredStatus = await restored.request({
    game: "midnight-monsters",
    action: "status",
  });
  assert.equal(restoredStatus.status, 200);
  assert.equal(restoredStatus.body.bonus.total_spins, 8);
  assert.equal(restoredStatus.body.bonus.spins_remaining, 7);
  assert.deepEqual(
    restored.calls.find((call) => call.operation === "select").filters,
    [
      ["user_id", "owned-user"],
      ["game", "midnight-monsters"],
      ["status", "active"],
    ],
  );
  checks++;

  // Compare Galactic server outcomes with the deployed pure math fixture.
  for (const action of ["spin", "bonus_spin"]) {
    const session = {
      id: "bonus-id",
      game: "galactic-rebellion",
      bet_per_line: 2,
      spins_remaining: 3,
      total_spins: 6,
      status: "active",
      total_payout: 10,
    };
    const a = load(originalPath),
      b = load(changedPath, { session });
    const expected = a.evaluate(`(() => {
      const cfg=games["galactic-rebellion"], grid=makeGrid(cfg);
      const feature=${action === "bonus_spin" ? "bonusFeature" : "paidFeature"}("galactic-rebellion",grid,cfg);
      let result=evaluate(grid,cfg,2), payout=Math.round(result.payout*feature.mult*100)/100;
      const scatters=result.scatters;
      if (${JSON.stringify(action)} === "spin" && scatters>=3) {
        feature.cells.push(...expandWild(grid,ri(5)));feature.name="FINAL ORBIT TRIGGER";
        feature.mult=Math.max(feature.mult,2);result=evaluate(grid,cfg,2);
        payout=Math.round(result.payout*feature.mult*100)/100;
      }
      return { grid, feature, result, payout, scatters };
    })()`);
    const response = await b.request({
      game: "galactic-rebellion",
      action,
      bet_per_line: 2,
      session_id: "bonus-id",
    });
    assert.equal(response.status, 200);
    const spin = response.body.spin;
    assert.deepEqual(spin.grid, expected.grid);
    assert.equal(spin.payout, expected.payout);
    assert.equal(spin.feature_name, expected.feature.name);
    assert.equal(spin.feature_multiplier, expected.feature.mult);
    assert.deepEqual(spin.feature_cells, expected.feature.cells);
    assert.deepEqual(spin.active_lines, expected.result.activeLines);
    assert.deepEqual(spin.win_cells, [
      ...new Set([...expected.result.winCells, ...expected.feature.cells]),
    ]);
    const rpc = b.calls.find((call) => call.operation === "rpc");
    if (action === "spin") {
      const spins = expected.scatters >= 3 ? 6 : 0;
      assert.deepEqual(rpc.args, {
        p_user_id: "owned-user",
        p_game: "galactic-rebellion",
        p_stake: 40,
        p_reels: expected.grid.flatMap((column, c) =>
          column.map((symbol, r) => `galactic-rebellion:${c}:${r}:${symbol}`),
        ),
        p_payout: expected.payout,
        p_result: expected.payout > 0 ? "won" : "lost",
        p_bet_per_line: 2,
        p_bonus_spins: spins,
      });
      assert.equal(spin.bonus_total_spins, spins);
    } else {
      assert.deepEqual(rpc.args, {
        p_user_id: "owned-user",
        p_session_id: "bonus-id",
        p_grid: expected.grid,
        p_payout: expected.payout,
        p_feature: expected.feature.name,
      });
      assert.equal(spin.bonus_total_spins, 6);
    }
    checks++;
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      checks,
      symbols: new Set(midnight.weights).size,
      paylines: game.evaluate("lines.length"),
      bonusSpins: midnight.freeSpins,
      liveWrites: 0,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
