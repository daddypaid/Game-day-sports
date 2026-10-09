// Mathematical baseline from deployed themed-slots-test before the Midnight artwork update.
// Fixture contains no server handler or database access.

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
    ],
    wild: "WILD",
    scatter: "SCATTER",
    bonusName: "CRYPT FREE SPINS",
    freeSpins: 8,
    pays: {
      VAMP: [0, 0, 4, 10, 40],
      WOLF: [0, 0, 3, 8, 30],
      ZOMB: [0, 0, 2, 6, 24],
      POTION: [0, 0, 2, 5, 18],
      BAT: [0, 0, 1, 3, 10],
      CANDLE: [0, 0, 1, 2, 8],
      WILD: [0, 0, 5, 15, 50],
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
