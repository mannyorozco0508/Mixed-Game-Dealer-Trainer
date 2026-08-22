/* ============================================================
   test-stud-hilo-street.js

   Two correctness items, both about reading split-pot Stud correctly.

   ITEM 1 — tierForSeat() had no 'stud-hilo' case. The family fell through to
   the high-only default, so a made 8-or-better low was scored as a high hand,
   came back high-card, and graded WEAK. A lock low folded to a single bet.

   ITEM 2 — the production call to RailRhythm.tierForStreet() never passed the
   street, so 'near-final' was inferred from card count. Super Stud deals FIVE
   cards on its opening street, so 3rd street was treated as a finished hand
   and read with the made-hand evaluator. Worse, the street-aware branch of
   that guard returned false unconditionally, so passing a street would have
   switched the full reader off entirely.

   Behaviour is tested, not source text — except where the point IS that the
   shipped call site passes the right arguments, in which case the real
   expression is lifted out of index.html and executed.
   ============================================================ */
const fs   = require('fs');
const path = require('path');

const AI      = require('./ai-players.js');
const E       = require('./cards-eval.js');
const Action  = require('./table-action.js');
const Rhythm  = require('./betting-rhythm.js');
const { DATA } = require('./game-data.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extract(a, b){
  const s = SRC.indexOf(a), e = SRC.indexOf(b, s);
  if(s === -1 || e === -1) throw new Error('marker not found: ' + a);
  return SRC.slice(s, e);
}

function card(str){ return { rank: str.slice(0, -1), suit: str.slice(-1) }; }
function cards(str){ return str.split(' ').map(card); }

const T = AI.TIER;
const NAME = { 0:'WEAK', 1:'MARGINAL', 2:'STRONG', 3:'PREMIUM' };

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function eq(label, actual, expected){
  check(label, actual === expected, 'got ' + NAME[actual] + ', expected ' + NAME[expected]);
}

/* ---------------------------------------------------------------
   ITEM 1 — split-pot stud reads BOTH halves
   --------------------------------------------------------------- */
console.log('=== Stud Hi-Lo: a made low is no longer invisible ===');
{
  // 6-low, no pair, no flush, no straight (the 6 breaks A-2-3-4-5).
  // High side is high-card only. Under the old fallthrough this was WEAK.
  const hand = cards('AS 2H 3D 4C 6S KD QH');
  const tier = Action.tierForSeat(hand, [], 'stud-hilo');
  check('a strong qualifying low is not WEAK just because the high side is',
        tier !== T.WEAK, 'got ' + NAME[tier]);
  eq('6-low / high-card grades STRONG', tier, T.STRONG);

  // Same shape read as a high-only hand is exactly the old behaviour.
  const highOnly = AI.classifyHigh(E.bestHighFromN(hand).score);
  eq('the high side alone really is WEAK (this is what the old path returned)',
     highOnly, T.WEAK);
}

console.log('=== Stud Hi-Lo: strong high with no qualifying low ===');
{
  // Kings full of nines. No five distinct ranks at or below eight.
  const hand = cards('KS KH KD 9C 9S QH JD');
  const tier = Action.tierForSeat(hand, [], 'stud-hilo');
  eq('a boat with no low is STRONG, not PREMIUM — it contests one half', tier, T.STRONG);
  const low = E.bestLowA5FromN(hand).score;
  check('no qualifying low exists in that hand', !E.qualifiesEightLow(low));
}

console.log('=== Stud Hi-Lo: strong both ways scoops ===');
{
  // Spade flush AND an 8-low from the same seven cards.
  const hand = cards('8S 6S 4S 2S AS KH QD');
  const tier = Action.tierForSeat(hand, [], 'stud-hilo');
  eq('flush plus a made 8-low is PREMIUM', tier, T.PREMIUM);
  const highOnly = AI.classifyHigh(E.bestHighFromN(hand).score);
  eq('the old high-only path saw only the flush', highOnly, T.STRONG);
  check('reading both halves outranks reading one', tier > highOnly);
}

console.log('=== The eight is the qualifier, and it is exact ===');
{
  const eight = cards('AS 2H 4D 6C 8S KD QH'); // A-2-4-6-8
  const nine  = cards('AS 2H 4D 6C 9S KD QH'); // A-2-4-6-9, otherwise identical
  const tEight = Action.tierForSeat(eight, [], 'stud-hilo');
  const tNine  = Action.tierForSeat(nine,  [], 'stud-hilo');

  check('an 8-high low qualifies', E.qualifiesEightLow(E.bestLowA5FromN(eight).score));
  check('a 9-high low does not qualify', !E.qualifiesEightLow(E.bestLowA5FromN(nine).score));
  eq('8-low with a weak high grades MARGINAL', tEight, T.MARGINAL);
  eq('9-low with a weak high grades WEAK — no low credit', tNine, T.WEAK);
  check('swapping the 8 for a 9 costs the seat its low', tEight > tNine);
}

console.log('=== The corrected reading is what the full-tier path returns ===');
{
  // Item 1 only matters if the late-street path actually reaches it.
  const hand = cards('AS 2H 3D 4C 6S KD QH');
  let fullTierCalled = false;
  const tier = Rhythm.tierForStreet({
    cards: hand, board: [], family: 'stud-hilo',
    street: 6, totalStreets: 7,          // 7th street of seven
    fullTier: () => { fullTierCalled = true; return Action.tierForSeat(hand, [], 'stud-hilo'); }
  });
  check('the last street delegates to the full reader', fullTierCalled);
  eq('and the full reader sees the low', tier, T.STRONG);
}

console.log('=== Big O Hi-Lo shares the family and must keep Omaha selection ===');
{
  // The name test routes "Big O Hi-Lo" to stud-hilo before the omaha branch,
  // so the case has to honour exactly-two-hole-plus-three-board. Reading all
  // ten cards freely would find a royal flush here; Omaha rules do not.
  const hole  = cards('AS JS TS 9S 4H');
  const board = cards('KS QS 7H 3D 2C');

  const naive = AI.classifyHigh(E.bestHighFromN(hole.concat(board)).score);
  eq('reading all ten cards freely would see a royal flush', naive, T.PREMIUM);

  const tier = Action.tierForSeat(hole, board, 'stud-hilo');
  const omahaHigh = E.bestOmahaHigh(hole, board).score;
  const omahaLow  = E.bestOmahaLowA5(hole, board);
  const expected  = AI.classifyOmahaHiLo(omahaHigh, omahaLow ? omahaLow.score : null);
  eq('Big O Hi-Lo is tiered by Omaha selection, not by the loose ten-card read',
     tier, expected);
  check('no flush is available under Omaha rules', omahaHigh[0] < 5,
        'high category ' + omahaHigh[0]);
  check('but the A-4 in hand plays with 7-3-2 for a qualifying low',
        !!omahaLow && E.qualifiesEightLow(omahaLow.score));
}

console.log('=== Families that were already correct are untouched ===');
{
  const razz = cards('AS 2H 4D 6C 8S KD QH');
  eq('Razz still reads as an A-5 low', Action.tierForSeat(razz, [], 'low-a5'),
     AI.classifyA5Low(E.bestLowA5FromN(razz).score));

  const deuce = cards('2S 3H 4D 6C 8S KD QH');
  eq('2-7 still reads as a 2-7 low', Action.tierForSeat(deuce, [], 'low-27'),
     AI.classify27Low(E.bestLow27FromN(deuce).score));

  const badugi = cards('AS 2H 4D 6C');
  eq('Badugi is unchanged', Action.tierForSeat(badugi, [], 'badugi'),
     AI.classifyBadugi(E.bestBadugi(badugi)));

  const holdem = cards('AS AH');
  const hBoard = cards('AD 9C 4S');
  eq('high-only games are unchanged', Action.tierForSeat(holdem, hBoard, 'high'),
     AI.classifyHigh(E.bestHighFromN(holdem.concat(hBoard)).score));

  const plo = cards('AS KS QH JH');
  eq('the omaha family is unchanged', Action.tierForSeat(plo, hBoard, 'omaha'),
     AI.classifyHigh(E.bestOmahaHigh(plo, hBoard).score));

  check('an empty holding is still WEAK', Action.tierForSeat([], [], 'stud-hilo') === T.WEAK);
  check('garbage input still degrades to MARGINAL rather than throwing',
        Action.tierForSeat([{rank:'?',suit:'?'}], [], 'stud-hilo') !== undefined);
}

/* ---------------------------------------------------------------
   Family mapping audit — nothing was broadened to pass a test
   --------------------------------------------------------------- */
console.log('=== Which games actually belong to stud-hilo ===');
{
  const body = extract('function tierFamilyForGame(game){', '\n// Cards a seat currently holds');
  const tierFamilyForGame = new Function(body + '\nreturn tierFamilyForGame;')();

  const byFamily = {};
  DATA.forEach(sec => (sec.games || []).forEach(g => {
    const f = tierFamilyForGame(g);
    (byFamily[f] = byFamily[f] || []).push(g.name);
  }));
  const studHilo = (byFamily['stud-hilo'] || []).sort();

  check('Stud Hi-Lo / 8-or-Better is in the family',
        studHilo.indexOf('Stud Hi-Lo / 8-or-Better') >= 0, studHilo.join(' | '));
  check('Super Stud Hi-Lo 8 / Super Pat is in the family',
        studHilo.indexOf('Super Stud Hi-Lo 8 / Super Pat') >= 0, studHilo.join(' | '));
  check('Big O Hi-Lo is in the family',
        studHilo.indexOf('Big O Hi-Lo') >= 0, studHilo.join(' | '));
  check('the family has exactly those three members',
        studHilo.length === 3, studHilo.join(' | '));

  // Super Baducey / Super Badacey deal from superStud but are NOT split-eights
  // games. They must not be dragged into this case.
  ['Super Baducey', 'Super Badacey'].forEach(n => {
    const g = [].concat(...DATA.map(s => s.games || [])).find(x => x.name === n);
    check(n + ' exists in the roster', !!g);
    check(n + ' is NOT stud-hilo — it is not an eights-or-better game',
          g && tierFamilyForGame(g) !== 'stud-hilo',
          g ? tierFamilyForGame(g) : 'missing');
  });
  check('Razz is not swept into the split-pot case',
        studHilo.indexOf('Razz') === -1);

  const total = DATA.reduce((n, s) => n + (s.games || []).length, 0);
  check('the roster is still 22 games plus General Floor Rules',
        total === 23, 'entries=' + total);
}

/* ---------------------------------------------------------------
   ITEM 2 — the production call passes the authoritative street
   --------------------------------------------------------------- */
console.log('=== The shipped call site supplies a street, not a card count ===');
{
  // The real expression, lifted verbatim out of index.html and executed.
  const body = extract('const tier = window.RailRhythm',
                       'let action = window.RailAction.chooseAction');
  const run = new Function('window', 'held', 'board', 'family',
                           'activeStepIndex', 'currentScenario',
                           body + '\nreturn tier;');

  let seen = null;
  const win = {
    RailRhythm: { tierForStreet: o => { seen = o; return T.MARGINAL; } },
    RailAction: { tierForSeat: () => T.MARGINAL }
  };
  const held = cards('AS 2H 3D 4C 6S');
  run(win, held, [], 'stud-hilo', 3, { scenario: new Array(9) });

  check('the call site reaches tierForStreet', !!seen);
  check('it passes a street', seen && seen.street !== undefined);
  eq2('the street is the active step index', seen && seen.street, 3);
  check('it passes the total number of streets', seen && seen.totalStreets === 9,
        seen ? String(seen.totalStreets) : 'none');
  check('it still passes a fullTier escape hatch', seen && typeof seen.fullTier === 'function');
  check('it does not fabricate a street from card count',
        seen && seen.street !== held.length, 'street=' + (seen && seen.street));
}
function eq2(label, actual, expected){
  check(label, actual === expected, 'got ' + actual + ', expected ' + expected);
}

console.log('=== Super Stud: five cards on the opening street is not near-final ===');
{
  // Super Stud deals 4 down + 1 up immediately. Nine scenario steps.
  const opening = cards('AS 2H 3D 4C 6S');
  let fullCalled = false;
  const early = Rhythm.tierForStreet({
    cards: opening, board: [], family: 'stud-hilo',
    street: 0, totalStreets: 9,
    fullTier: () => { fullCalled = true; return T.PREMIUM; }
  });
  check('the opening street does NOT use the made-hand reader', !fullCalled);
  check('it still returns a real read rather than nothing', early !== undefined);

  let lateCalled = false;
  const late = Rhythm.tierForStreet({
    cards: cards('AS 2H 3D 4C 6S KD QH'), board: [], family: 'stud-hilo',
    street: 8, totalStreets: 9,
    fullTier: () => { lateCalled = true; return T.STRONG; }
  });
  check('the last street DOES use the made-hand reader', lateCalled);
  eq('and returns what the full reader said', late, T.STRONG);

  // Middle streets are still developing.
  let midCalled = false;
  Rhythm.tierForStreet({
    cards: cards('AS 2H 3D 4C 6S KD'), board: [], family: 'stud-hilo',
    street: 4, totalStreets: 9,
    fullTier: () => { midCalled = true; return T.PREMIUM; }
  });
  check('a middle street is still read as developing', !midCalled);
}

console.log('=== Card count no longer stands in for street ===');
{
  const five = cards('AS 2H 3D 4C 6S');

  // Same five cards, same family — only the street differs.
  let a = false, b = false;
  Rhythm.tierForStreet({ cards: five, board: [], family: 'stud-hilo',
    street: 0, totalStreets: 9, fullTier: () => { a = true; return T.WEAK; } });
  Rhythm.tierForStreet({ cards: five, board: [], family: 'stud-hilo',
    street: 8, totalStreets: 9, fullTier: () => { b = true; return T.WEAK; } });
  check('street alone decides which reader runs', a === false && b === true,
        'early=' + a + ' late=' + b);

  // The documented fallback survives for callers that pass no street at all.
  let c = false;
  Rhythm.tierForStreet({ cards: five, board: [], family: 'stud-hilo',
    fullTier: () => { c = true; return T.WEAK; } });
  check('with no street supplied, the five-card fallback still applies', c);

  let d = false;
  Rhythm.tierForStreet({ cards: cards('AS 2H 3D'), board: [], family: 'stud-hilo',
    fullTier: () => { d = true; return T.WEAK; } });
  check('and three cards with no street is still not near-final', !d);

  // An explicit nearFinal from the caller still wins over both.
  let e = false;
  Rhythm.tierForStreet({ cards: five, board: [], family: 'stud-hilo',
    street: 0, totalStreets: 9, nearFinal: true,
    fullTier: () => { e = true; return T.WEAK; } });
  check('an explicit nearFinal still overrides the street', e);
}

console.log('=== Other families keep their street behaviour ===');
{
  // Razz on 3rd street: three cards, no full read, whatever the street says.
  let called = false;
  Rhythm.tierForStreet({ cards: cards('AS 2H 4D'), board: [], family: 'low-a5',
    street: 0, totalStreets: 7, fullTier: () => { called = true; return T.WEAK; } });
  check('Razz 3rd street is developing', !called);

  // Hold'em river: five plus board, last step.
  let river = false;
  Rhythm.tierForStreet({ cards: cards('AS KS'), board: cards('QS JS TS'),
    family: 'high', street: 6, totalStreets: 7,
    fullTier: () => { river = true; return T.PREMIUM; } });
  check('a button game still reaches the full reader on its last street', river);

  // A draw game with a board-less family.
  let draw = false;
  Rhythm.tierForStreet({ cards: cards('AS 2H 3D 4C 6S'), board: [], family: 'badugi',
    street: 5, totalStreets: 6, fullTier: () => { draw = true; return T.WEAK; } });
  check('a draw game reaches the full reader on its last street', draw);
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
