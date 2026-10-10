/* Hand descriptions for card previews. No opponents, wagering or settlement. */
(() => {
  const ranks = new Map(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((rank, index) => [rank, index + 2]));
  const suits = new Set(['♠', '♥', '♦', '♣']);

  function combinations(cards, count) {
    const result = [];
    function choose(start, chosen) {
      if (chosen.length === count) {
        result.push(chosen);
        return;
      }
      for (let index = start; index <= cards.length - (count - chosen.length); index++) {
        choose(index + 1, [...chosen, cards[index]]);
      }
    }
    choose(0, []);
    return result;
  }

  function rankFive(cards) {
    const values = cards.map(card => ranks.get(card.rank)).sort((a, b) => b - a);
    const counts = new Map();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every(card => card.suit === cards[0].suit);
    const unique = [...counts.keys()];
    const straight = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0]
      : unique.join(',') === '14,5,4,3,2' ? 5 : 0;

    let label;
    let rank;
    if (flush && straight) {
      label = straight === 14 ? 'Royal flush' : 'Straight flush';
      rank = [8, straight];
    } else if (groups[0][1] === 4) {
      label = 'Four of a kind';
      rank = [7, groups[0][0], groups[1][0]];
    } else if (groups[0][1] === 3 && groups[1][1] === 2) {
      label = 'Full house';
      rank = [6, groups[0][0], groups[1][0]];
    } else if (flush) {
      label = 'Flush';
      rank = [5, ...values];
    } else if (straight) {
      label = 'Straight';
      rank = [4, straight];
    } else if (groups[0][1] === 3) {
      label = 'Three of a kind';
      rank = [3, groups[0][0], ...groups.slice(1).map(([value]) => value)];
    } else if (groups[0][1] === 2 && groups[1][1] === 2) {
      label = 'Two pair';
      rank = [2, groups[0][0], groups[1][0], groups[2][0]];
    } else if (groups[0][1] === 2) {
      label = 'One pair';
      rank = [1, groups[0][0], ...groups.slice(1).map(([value]) => value)];
    } else {
      label = 'High card';
      rank = [0, ...values];
    }
    return { label, category: rank[0], rank, cards: cards.map(card => ({ rank: card.rank, suit: card.suit })) };
  }

  function compare(left, right) {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (left[index] || 0) - (right[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function evaluate({ game, player, board = [] }) {
    const expected = { holdem: [2, 5], omaha: [4, 5], stud: [7, 0], draw: [5, 0] }[game];
    if (!expected || !Array.isArray(player) || !Array.isArray(board) || player.length !== expected[0] || board.length !== expected[1]) {
      throw new TypeError('A complete card preview is required to evaluate this hand.');
    }
    const all = [...player, ...board];
    if (all.some(card => !card || !ranks.has(card.rank) || !suits.has(card.suit)) || new Set(all.map(card => card.rank + card.suit)).size !== all.length) {
      throw new TypeError('The hand must contain distinct cards from the standard deck.');
    }
    const candidates = game === 'omaha'
      ? combinations(player, 2).flatMap(hole => combinations(board, 3).map(community => [...hole, ...community]))
      : combinations(all, 5);
    return candidates.map(rankFive).reduce((best, candidate) => !best || compare(candidate.rank, best.rank) > 0 ? candidate : best, null);
  }

  globalThis.GameDayPokerHands = Object.freeze({ evaluate });
})();
