const S = require('./showdown.js');

let pass = 0, fail = 0;
function check(label, cond){ if(cond){ pass++; } else { fail++; console.log('FAIL: ' + label); } }
function card(str){ return { rank: str.slice(0, -1), suit: str.slice(-1) }; }
function cards(str){ return str.split(' ').map(card); }
function g(name){ return { name }; }

/* ================= HOLD'EM ================= */
console.log('=== Hold\'em ===');
{
  // 1. pair vs pair
  const r = S.evaluateShowdown({
    game: g("Texas Hold'em"),
    players: [
      { seat:0, cards: cards('AS AH') },
      { seat:1, cards: cards('KS KH') }
    ],
    board: cards('2C 7D 9S JH 3C')
  });
  check('Hold\'em pair vs pair: aces beat kings', r.ok && r.winners.length === 1 && r.winners[0] === 0);
  check('Hold\'em label reads "Pair of Aces"', r.sides[0].results.find(x => x.seat === 0).label === 'Pair of Aces');

  // 2. board-made hand (both play the board)
  const r2 = S.evaluateShowdown({
    game: g("Texas Hold'em"),
    players: [
      { seat:0, cards: cards('2C 3D') },
      { seat:1, cards: cards('4C 5D') }
    ],
    board: cards('AS KS QS JS TS') // royal flush on the board
  });
  check('Hold\'em board-made royal: both players tie', r2.ok && r2.winners.length === 2);
  check('Hold\'em board-made royal is labelled Royal Flush', r2.sides[0].results[0].label === 'Royal Flush');

  // 3. explicit tie
  const r3 = S.evaluateShowdown({
    game: g("Texas Hold'em"),
    players: [
      { seat:0, cards: cards('AS 2H') },
      { seat:1, cards: cards('AD 3H') }
    ],
    board: cards('AC AH KS KD 9C') // both play aces full of kings
  });
  check('Hold\'em tie detected (both play the same best five)', r3.ok && r3.hasTie && r3.winners.length === 2);

  // 4. flush comparison
  const r4 = S.evaluateShowdown({
    game: g("Texas Hold'em"),
    players: [
      { seat:0, cards: cards('AS 4S') },
      { seat:1, cards: cards('KS 4H') }
    ],
    board: cards('2S 7S 9S JH 3C')
  });
  check('Hold\'em ace-high flush beats king-high flush', r4.ok && r4.winners[0] === 0 && r4.winners.length === 1);

  // 5. full house comparison
  const r5 = S.evaluateShowdown({
    game: g("Texas Hold'em"),
    players: [
      { seat:0, cards: cards('KS KH') },
      { seat:1, cards: cards('9S 9H') }
    ],
    board: cards('KD 9C 9D 2S 3C')
  });
  check('Hold\'em quad nines beat kings full', r5.ok && r5.winners.length === 1 && r5.winners[0] === 1);
}

/* ================= OMAHA (exact 2+3) ================= */
console.log('');
console.log('=== Omaha exact-card enforcement ===');
{
  // 6/7. THE FAKE FLUSH TRAP: player holds four spades, board has three spades.
  // In Hold'em they'd have a flush. In Omaha they must use EXACTLY two hole
  // cards — holding 4 spades + 3 spades on board still makes a flush (2 from
  // hand + 3 from board), so use a stricter trap: only ONE spade in hand.
  const trap = S.evaluateShowdown({
    game: g('Drawmaha Hi'),
    players: [
      { seat:0, cards: cards('AS 2H 3D 4C 5H') },  // one spade only
      { seat:1, cards: cards('9C 9D 2S 3S 7H') }
    ],
    board: cards('KS QS JS 4H 5D') // three spades on board
  });
  const p0omaha = trap.sides.find(s => s.key === 'omaha').results.find(r => r.seat === 0);
  check('Omaha: one hole spade + three board spades does NOT make a flush', p0omaha.label.indexOf('Flush') === -1);

  const legit = S.evaluateShowdown({
    game: g('Drawmaha Hi'),
    players: [
      { seat:0, cards: cards('AS TS 3D 4C 5H') } // two spades — legal flush
    ],
    board: cards('KS QS JS 4H 5D')
  });
  const legitOmaha = legit.sides.find(s => s.key === 'omaha').results[0];
  check('Omaha: two hole spades + three board spades DOES make a flush', legitOmaha.label.indexOf('Flush') !== -1);

  // 8. Omaha high/low split (Drawmaha A-5)
  const split = S.evaluateShowdown({
    game: g('Drawmaha A-5'),
    players: [
      { seat:0, cards: cards('AS KS QH JD 9C') },
      { seat:1, cards: cards('AH 2D 3C 4S 6H') }
    ],
    board: cards('TS 9S 8H 7D 2C')
  });
  check('Drawmaha A-5 produces two sides (omaha high + a5 low)', split.ok && split.sides.length === 2);
  check('Drawmaha A-5 low side has a winner', split.sides.find(s => s.key === 'low').winners.length > 0);
}

/* ================= HIGH/LOW, QUALIFY, SCOOP ================= */
console.log('');
console.log('=== High/Low, qualification, scoop ===');
{
  // 9. no qualifying low
  const noLow = S.evaluateShowdown({
    game: g('Stud Hi-Lo / 8-or-Better'),
    players: [
      { seat:0, cards: cards('AS AH KD KS QC JH 9D') },
      { seat:1, cards: cards('TS TH 9C 9H KC QD JS') }
    ],
    board: []
  });
  const lowSide = noLow.sides.find(s => s.key === 'low');
  check('Stud Hi-Lo with no qualifying low: low side has zero winners', lowSide.winners.length === 0);
  check('Unqualified side is reported explicitly', noLow.unqualifiedSides.indexOf('low') !== -1);
  check('High still has a winner when no low qualifies', noLow.sides.find(s => s.key === 'high').winners.length > 0);
  check('Player label reads "No qualifying low"', lowSide.results[0].label === 'No qualifying low');

  // 10. scoop — one seat wins both sides
  const scoop = S.evaluateShowdown({
    game: g('Stud Hi-Lo / 8-or-Better'),
    players: [
      { seat:0, cards: cards('AS 2S 3S 4S 5S 9H KD') }, // straight flush AND a wheel low
      { seat:1, cards: cards('KH QD JC 9S 8H 7D 2C') }
    ],
    board: []
  });
  check('Scoop detected when one seat wins both high and low', scoop.ok && scoop.isScoop && scoop.winners.length === 1 && scoop.winners[0] === 0);
}

/* ================= STUD FAMILY ================= */
console.log('');
console.log('=== Stud family ===');
{
  // 11. stud high
  const sh = S.evaluateShowdown({
    game: g('Super Stud Hi-Lo 8 / Super Pat'),
    players: [
      { seat:0, cards: cards('AS AH AD KS KH 2C 3D') },
      { seat:1, cards: cards('9S 9H 9D 2S 3H 4C 5D') }
    ],
    board: []
  });
  check('Stud high: aces full beats trip nines', sh.ok && sh.winners.length === 1 && sh.winners[0] === 0);

  // 13. Razz — low only, no high-hand phrasing
  const razz = S.evaluateShowdown({
    game: g('Razz'),
    players: [
      { seat:0, cards: cards('AS 2H 3D 4C 5S KH QD') }, // wheel
      { seat:1, cards: cards('2S 3H 4D 5C 7S KD QC') }  // 7-high
    ],
    board: []
  });
  check('Razz: wheel beats 7-low', razz.ok && razz.winners.length === 1 && razz.winners[0] === 0);
  check('Razz side is labelled "Low", not a high-hand category', razz.sides[0].label === 'Low');
  check('Razz hand reads as ranks (5-4-3-2-A), not "Five High"', razz.sides[0].results[0].label === '5-4-3-2-A');

  // 14. Super Stud discard state — evaluator receives the final 7 cards
  const ss = S.evaluateShowdown({
    game: g('Super Stud Hi-Lo 8 / Super Pat'),
    players: [{ seat:0, cards: cards('AS KS QS JS TS 2H 3D') }],
    board: []
  });
  check('Super Stud evaluates the final 7-card holding (royal found)', ss.sides[0].results[0].label === 'Royal Flush');
}

/* ================= BADUGI ================= */
console.log('');
console.log('=== Badugi ===');
{
  // 15. 4-card vs 3-card badugi
  const b = S.evaluateShowdown({
    game: g('Badugi'),
    players: [
      { seat:0, cards: cards('9S 7H 4D 2C') }, // full 4-card badugi
      { seat:1, cards: cards('AS 2S 3D 4C') }  // suit conflict -> 3-card only
    ],
    board: []
  });
  check('Badugi: any 4-card badugi beats a 3-card badugi', b.ok && b.winners.length === 1 && b.winners[0] === 0);
  check('Badugi label states the card count', b.sides[0].results[0].label.indexOf('4-Card Badugi') === 0);
  check('3-card badugi is represented correctly', b.sides[0].results[1].label.indexOf('3-Card Badugi') === 0);
}

/* ================= LOWBALL DRAW ================= */
console.log('');
console.log('=== Lowball draw games ===');
{
  // 16. 2-7 lowball
  const l27 = S.evaluateShowdown({
    game: g('2-7 Lowball'),
    players: [
      { seat:0, cards: cards('7S 5H 4D 3C 2S') }, // the 2-7 nuts
      { seat:1, cards: cards('8S 5H 4D 3C 2H') }
    ],
    board: []
  });
  check('2-7: 7-5-4-3-2 beats 8-low', l27.ok && l27.winners.length === 1 && l27.winners[0] === 0);

  // 2-7: a wheel is a STRAIGHT and therefore bad
  const l27b = S.evaluateShowdown({
    game: g('2-7 Lowball'),
    players: [
      { seat:0, cards: cards('AS 2H 3D 4C 5S') }, // straight — terrible for 2-7
      { seat:1, cards: cards('9S 7H 5D 3C 2S') }  // 9-low
    ],
    board: []
  });
  check('2-7: a wheel (straight) LOSES to a 9-low', l27b.winners.length === 1 && l27b.winners[0] === 1);

  // 17. A-5 lowball
  const a5 = S.evaluateShowdown({
    game: g('A-5 Lowball'),
    players: [
      { seat:0, cards: cards('AS 2H 3D 4C 5S') }, // wheel = best A-5
      { seat:1, cards: cards('AH 2D 3C 4S 6H') }
    ],
    board: []
  });
  check('A-5: the wheel wins', a5.ok && a5.winners.length === 1 && a5.winners[0] === 0);
}

/* ================= DOUBLE BOARD ================= */
console.log('');
console.log('=== Double board ===');
{
  // 18. different winners per board
  const db = S.evaluateShowdown({
    game: g('Double Board Omaha'),
    players: [
      { seat:0, cards: cards('AS KS 2H 3D 4C') },
      { seat:1, cards: cards('9C 9D TH TS 2C') }
    ],
    board:  cards('QS JS TC 5H 6D'),   // seat 0 makes a strong straight/flush draw board
    board2: cards('9H TD 2S 3H 4S')    // seat 1 makes trips/two pair here
  });
  check('Double board returns two independent board sides', db.ok && db.sides.length === 2 && db.sides[0].key === 'board1' && db.sides[1].key === 'board2');
  check('Each board independently has a winner', db.sides[0].winners.length > 0 && db.sides[1].winners.length > 0);

  // 19. double board tie (identical hole cards -> same result both boards)
  const dbTie = S.evaluateShowdown({
    game: g('Double Board Omaha'),
    players: [
      { seat:0, cards: cards('2C 3D 4H 5S 7C') },
      { seat:1, cards: cards('2D 3H 4S 5C 7D') }
    ],
    board:  cards('AS KS QS JH TH'),
    board2: cards('AH KH QH JS TS')
  });
  check('Double board tie is detected', dbTie.ok && dbTie.hasTie);
}

/* ================= EVERY GAME HAS A RULE ================= */
console.log('');
console.log('=== Coverage: every canonical game ===');
{
  // The roster now has ONE authoritative home. Assert the module agrees with
  // the independent list below, so game-data.js and SHOWDOWN_RULES can never
  // drift apart again the way DATA, the footer and these tests once did.
  const GameData = require('./game-data.js');
  let dataGames = 0, nonGames = 0;
  GameData.DATA.forEach(cat => cat.games.forEach(g => { g.dealCat ? dataGames++ : nonGames++; }));
  // The canonical poker roster, listed independently of SHOWDOWN_RULES on
  // purpose: a coverage test that derived this from the registry it is
  // checking would assert nothing. General Floor Rules is a reference card,
  // not a poker game, so it has no showdown rule and is absent here.
  // Legacy names are NOT listed — they live in LEGACY_GAME_ALIASES and are
  // covered separately below.
  const allGames = [
    'Badugi','A-5 Lowball','2-7 Lowball','Badacey','Baducey','Archie',
    'Stud Hi-Lo / 8-or-Better','Razz','Super Stud Hi-Lo 8 / Super Pat',
    'Super Baducey','Super Badacey','Big O Hi-Lo','Big O PLO',
    'Drawmaha Hi','Drawmaha A-5','Drawmaha 2-7',
    'Drawmaha 49','Drawmaha Badugi','Double Board Omaha','Pineapple',
    'Crazy Pineapple',"Texas Hold'em"
  ];
  const GAME_COUNT = allGames.length;
  check('game-data.js holds exactly the canonical poker roster', dataGames === allGames.length,
        'game-data=' + dataGames + ' expected=' + allGames.length);
  check('General Floor Rules is carried separately, not as a poker game', nonGames === 1,
        'non-game entries=' + nonGames);
  const rosterNames = [];
  GameData.DATA.forEach(cat => cat.games.forEach(g => { if(g.dealCat) rosterNames.push(g.name); }));
  const drift = rosterNames.filter(n => allGames.indexOf(n) === -1)
    .concat(allGames.filter(n => rosterNames.indexOf(n) === -1));
  check('no drift between game-data.js and the expected roster (drift: ' + (drift.join(', ') || 'none') + ')',
        drift.length === 0);
  check('legacy Super Stud names are absent from the roster',
        rosterNames.indexOf('Super Stud / Super Pat') === -1 &&
        rosterNames.indexOf('Super Hi-Lo Stud') === -1);
  const missing = allGames.filter(n => !S.SHOWDOWN_RULES[n]);
  check('All ' + GAME_COUNT + ' games have a configured showdown rule (missing: ' + (missing.join(', ') || 'none') + ')', missing.length === 0);
  const extra = Object.keys(S.SHOWDOWN_RULES).filter(n => allGames.indexOf(n) === -1);
  check('Registry contains exactly the ' + GAME_COUNT + ' canonical games (unexpected: ' + (extra.join(', ') || 'none') + ')',
        Object.keys(S.SHOWDOWN_RULES).length === GAME_COUNT && extra.length === 0);

  // Legacy names must resolve through the alias layer without reappearing
  // in the registry as games in their own right.
  Object.keys(S.LEGACY_GAME_ALIASES).forEach(old => {
    check('Legacy name "' + old + '" is not a registry game', !S.SHOWDOWN_RULES[old]);
    check('Legacy name "' + old + '" still resolves to a rule', !!S.ruleForGame(old));
  });

  // every game actually evaluates without throwing
  let evalFails = [];
  allGames.forEach(name => {
    const rule = S.SHOWDOWN_RULES[name];
    const holeCount = 7; // generous; evaluators take best-N
    const players = [
      { seat:0, cards: cards('AS KS QS JS TS 9H 8D').slice(0, holeCount) },
      { seat:1, cards: cards('2C 3D 4H 5S 7C 9S TD').slice(0, holeCount) }
    ];
    const r = S.evaluateShowdown({
      game: g(name),
      players,
      board:  rule.needsBoard  ? cards('2S 7D 9C JH 3H') : [],
      board2: rule.needsBoard2 ? cards('4D 8C KH QD 5C') : []
    });
    if(!r.ok) evalFails.push(name + ' (' + r.error + ')');
  });
  check('Every game evaluates without error (failed: ' + (evalFails.join('; ') || 'none') + ')', evalFails.length === 0);
}

/* ================= ERROR HANDLING ================= */
console.log('');
console.log('=== Error handling ===');
{
  const unknown = S.evaluateShowdown({ game: g('Nonexistent Game'), players:[{seat:0,cards:cards('AS KS')}], board:[] });
  check('Unknown game returns a controlled error, does not throw', unknown.ok === false && unknown.error.indexOf('No showdown rule') === 0);

  const shortBoard = S.evaluateShowdown({
    game: g("Texas Hold'em"),
    players: [{ seat:0, cards: cards('AS KS') }],
    board: cards('2C 7D') // only 2 board cards
  });
  check('Insufficient board returns a descriptive error', shortBoard.ok === false && shortBoard.error.indexOf('needs 5 board cards') !== -1);

  const noPlayers = S.evaluateShowdown({ game: g("Texas Hold'em"), players: [], board: cards('2C 7D 9S JH 3C') });
  check('No eligible players returns a controlled error', noPlayers.ok === false && noPlayers.error.indexOf('no eligible players') !== -1);
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail > 0 ? 1 : 0);
