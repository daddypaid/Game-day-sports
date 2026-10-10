const assert=require('node:assert/strict');
require('../gameday-poker-hand-evaluation.js');
const {evaluate}=globalThis.GameDayPokerHands;
const cards=text=>text.split(' ').map(token=>({rank:token.slice(0,-1),suit:token.slice(-1)}));
const draw=text=>evaluate({game:'draw',player:cards(text)});
const cases=[
 ['Royal flush','A♠ K♠ Q♠ J♠ 10♠',[8,14]],
 ['Straight flush','6♥ 5♥ 4♥ 3♥ 2♥',[8,6]],
 ['Four of a kind','Q♠ Q♥ Q♦ Q♣ A♠',[7,12,14]],
 ['Full house','J♠ J♥ J♦ 2♠ 2♥',[6,11,2]],
 ['Flush','A♦ J♦ 8♦ 4♦ 2♦',[5,14,11,8,4,2]],
 ['Straight','9♠ 8♥ 7♦ 6♣ 5♠',[4,9]],
 ['Straight','A♠ 2♥ 3♦ 4♣ 5♠',[4,5]],
 ['Straight flush','A♣ 2♣ 3♣ 4♣ 5♣',[8,5]],
 ['Three of a kind','7♠ 7♥ 7♦ K♠ 2♥',[3,7,13,2]],
 ['Two pair','10♠ 10♥ 8♦ 8♣ A♠',[2,10,8,14]],
 ['One pair','4♠ 4♥ A♦ Q♣ 9♠',[1,4,14,12,9]],
 ['High card','A♠ Q♥ 8♦ 6♣ 3♠',[0,14,12,8,6,3]],
 ['High card','A♠ K♥ Q♦ J♣ 9♠',[0,14,13,12,11,9]],
 ['High card','A♠ 2♥ 3♦ 4♣ 6♠',[0,14,6,4,3,2]]
];
for(const [label,hand,rank] of cases){const got=draw(hand);assert.equal(got.label,label,hand);assert.deepEqual(got.rank,rank,hand);assert.equal(got.cards.length,5);}
const holdem=evaluate({game:'holdem',player:cards('2♣ 3♦'),board:cards('A♠ K♠ Q♠ J♠ 10♠')});
assert.equal(holdem.label,'Royal flush');assert.deepEqual(holdem.rank,[8,14]);assert.deepEqual(holdem.cards,cards('A♠ K♠ Q♠ J♠ 10♠'));
const stud=evaluate({game:'stud',player:cards('A♠ A♥ A♦ K♠ K♥ K♦ 2♣')});
assert.deepEqual(stud.rank,[6,14,13]);
// A royal-flush board cannot be played on its own in Omaha.
const omahaBoardOnly=evaluate({game:'omaha',player:cards('2♣ 3♦ 4♥ 5♣'),board:cards('A♠ K♠ Q♠ J♠ 10♠')});
assert.equal(omahaBoardOnly.category,0);
// One spade in the hole is insufficient even with four spades on the board.
const omahaOneHole=evaluate({game:'omaha',player:cards('A♠ 2♣ 3♦ 4♥'),board:cards('K♠ Q♠ J♠ 10♠ 9♦')});
assert.equal(omahaOneHole.category,0);
const omahaRoyal=evaluate({game:'omaha',player:cards('A♠ K♠ 2♣ 3♦'),board:cards('Q♠ J♠ 10♠ 7♥ 8♦')});
assert.deepEqual(omahaRoyal.rank,[8,14]);
const omahaWheel=evaluate({game:'omaha',player:cards('A♠ 2♥ K♦ Q♣'),board:cards('3♠ 4♥ 5♦ 9♣ 10♥')});
assert.deepEqual(omahaWheel.rank,[4,5]);
for(const hand of [omahaBoardOnly,omahaOneHole,omahaRoyal,omahaWheel]){assert.equal(hand.cards.length,5);}
assert.throws(()=>evaluate({game:'holdem',player:cards('A♠ K♠'),board:cards('Q♠ J♠ 10♠')}),TypeError);
assert.throws(()=>evaluate({game:'omaha',player:cards('A♠ K♠ 2♣'),board:cards('Q♠ J♠ 10♠ 7♥ 8♦')}),TypeError);
assert.throws(()=>draw('A♠ A♠ 3♥ 4♥ 5♥'),TypeError);
assert.throws(()=>draw('Z♠ 2♥ 3♥ 4♥ 5♥'),TypeError);
assert.throws(()=>draw('A? 2♥ 3♥ 4♥ 5♥'),TypeError);
assert.throws(()=>evaluate({game:'unsupported',player:cards('A♠ K♠ Q♠ J♠ 10♠')}),TypeError);
console.log(`PASS: ${cases.length} five-card rank cases, Holdem board-only, Stud two-trip full house, four Omaha constraints and six invalid/incomplete inputs.`);
