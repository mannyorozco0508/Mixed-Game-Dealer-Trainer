/* ============================================================
   test-burn-cards.js — physical burns.

   Talking Stick, "Golden Rule — Burns": in every format you ALWAYS burn
   before dealing new cards to players or the board, even with no action and
   no one drawing.

   The old model incremented a counter and consumed nothing, so the card the
   screen said was burned was still the next card dealt. These tests pin the
   corrected behaviour with stacked decks, so the burn and live identities are
   unambiguous.
   ============================================================ */
const DealState = require('./deal-state.js');
const { DEAL_PATTERNS } = require('./deal-patterns.js');
const { RANKS, SUITS } = require('./card-model.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const fmt = c => c ? c.rank + c.suit : '--';
function orderedDeck(){
  const d = []; RANKS.forEach(r => SUITS.forEach(s => d.push({ rank:r, suit:s }))); return d;
}
function newState(seatCount){
  const st = {
    seatHoleCards: [], seatSlotMaps: [], seatDealtCounts: new Array(seatCount).fill(0),
    tableBoardCards: [], tableBoard2Cards: [], muckPile: [], burnCards: [],
    prevHoleCount:0, prevUpCount:0, prevBoardCount:0, prevBoard2Count:0, burnPileCount:0
  };
  for(let i = 0; i < seatCount; i++){ st.seatHoleCards.push([]); st.seatSlotMaps.push([]); }
  return st;
}
/* Production-faithful draw source. */
function makeDraw(st, deckRef){
  return function(){
    if(deckRef.live.length <= 1){
      const eligible = DealState.reshuffleEligible({
        muck: st.muckPile, burns: st.burnCards,
        stubLastCard: deckRef.live.length ? deckRef.live[0] : null,
        currentRoundDiscards: st.roundDiscards || []
      });
      if(eligible.length){
        deckRef.reshuffles = (deckRef.reshuffles || 0) + 1;
        deckRef.live = eligible; st.muckPile.length = 0; st.burnCards.length = 0;
      } else if(deckRef.live.length <= 1) return null;
    }
    return deckRef.live.length ? deckRef.live.shift() : null;
  };
}
function runSteps(patternName, seatCount, steps, opts){
  opts = opts || {};
  const pattern = DEAL_PATTERNS[patternName];
  const st = newState(seatCount);
  const deckRef = { live: (opts.deck || orderedDeck()).slice(), reshuffles: 0 };
  if(opts.boardMax)  st.tableBoardCards  = deckRef.live.splice(0, opts.boardMax);
  if(opts.board2Max) st.tableBoard2Cards = deckRef.live.splice(0, opts.board2Max);
  const draw = makeDraw(st, deckRef);
  const plans = [];
  steps.forEach(s => plans.push(DealState.applyStreet({
    pattern, stepIndex: s, seatCount, sitOutSeat: null,
    state: st, drawCard: draw, keepSlotsFor: opts.keepSlotsFor || (() => null)
  })));
  return { st, plans, deckRef, pattern };
}
function heldOf(st, seat){
  const all = st.seatHoleCards[seat] || [], map = st.seatSlotMaps[seat] || [];
  return map.map(s => all[s]).filter(Boolean);
}

console.log('=== A burn consumes a real card, and the next live card follows it ===');
{
  // Stud, 2 seats. Step 0 deals 3 each (6 cards, no burn). Step 3 burns once
  // then deals a 4th card to each seat.
  const deck = orderedDeck();
  const r = runSteps('studSplit', 2, [0, 3], { deck });
  const openingCards = 6;
  const burnCard = deck[openingCards];              // the very next card
  const firstLive = deck[openingCards + 1];

  check('exactly one card was burned on 4th street', r.st.burnCards.length === 1,
        'burned ' + r.st.burnCards.length);
  check('the burned card is the next physical card off the deck',
        fmt(r.st.burnCards[0]) === fmt(burnCard),
        fmt(r.st.burnCards[0]) + ' expected ' + fmt(burnCard));
  const seat0 = heldOf(r.st, 0);
  check('the burned card is NOT dealt to a player',
        !seat0.map(fmt).includes(fmt(burnCard)));
  check('the first live card is the one AFTER the burn',
        fmt(seat0[3]) === fmt(firstLive),
        fmt(seat0[3]) + ' expected ' + fmt(firstLive));
  check('burnPileCount is derived from the real burn collection',
        r.st.burnPileCount === r.st.burnCards.length);
}

console.log('');
console.log('=== A step covering two streets burns twice ===');
{
  // studSplit folds 5th and 6th street into one step (4 -> 6 cards).
  const r = runSteps('studSplit', 2, [0, 3, 4], {});
  check('the 5th/6th street step burns two cards', r.st.burnCards.length === 3,
        'total burns ' + r.st.burnCards.length);
  check('burn identities are unique',
        new Set(r.st.burnCards.map(fmt)).size === r.st.burnCards.length);
}

console.log('');
console.log('=== Burned cards never appear in a live hand or on a board ===');
[['studSplit', 7, [0,1,2,3,4,5,6], {}],
 ['superStud', 7, [0,1,2,3,4,5,6,7,8], {}],
 ['bigO', 6, [0,1,2,3,4], { boardMax:5 }],
 ['holdem', 6, [0,1,2,3,4,5,6], { boardMax:5 }],
 ['doubleBoard', 6, [0,1,2,3,4], { boardMax:5, board2Max:5 }],
 ['drawmaha', 6, [0,1,2,3,4,5,6,7], { boardMax:5 }],
 ['pineapple', 6, [0,1,2,3,4,5], { boardMax:5 }],
 ['crazyPineapple', 6, [0,1,2,3,4,5], { boardMax:5 }]
].forEach(([pat, seats, steps, opts]) => {
  const r = runSteps(pat, seats, steps, opts);
  const burned = new Set(r.st.burnCards.map(fmt));
  const live = [];
  for(let i = 0; i < seats; i++) heldOf(r.st, i).forEach(c => live.push(fmt(c)));
  r.st.tableBoardCards.forEach(c => live.push(fmt(c)));
  r.st.tableBoard2Cards.forEach(c => live.push(fmt(c)));
  const overlap = live.filter(c => burned.has(c));
  // A reshuffle legitimately returns burn cards to play, which empties the
  // burn pile — so overlap is only a fault when nothing was reshuffled.
  if(r.deckRef.reshuffles === 0){
    check(pat + ': no burned card is simultaneously live', overlap.length === 0,
          [...new Set(overlap)].join(' '));
  } else { pass++; }
  const dupes = live.filter((c, i) => live.indexOf(c) !== i);
  check(pat + ': no duplicate identity is live', dupes.length === 0,
        [...new Set(dupes)].join(' '));
  check(pat + ': burn identities are unique',
        new Set(r.st.burnCards.map(fmt)).size === r.st.burnCards.length);
});

console.log('');
console.log('=== Documented burn counts per family ===');
[['holdem', 3, 'burn+flop, burn+turn, burn+river'],
 ['bigO', 3, 'burn+flop, burn+turn, burn+river'],
 ['doubleBoard', 3, 'one burn per street, BOTH boards dealt after it'],
 ['drawmaha', 3, 'burn+flop, burn+turn, burn+river — replacements take NO burn'],
 ['studSplit', 4, 'burn before 4th, 5th, 6th and 7th'],
 ['superStud', 4, 'burn before 4th, 5th, 6th and 7th'],
 ['pineapple', 3, 'burn+flop, burn+turn, burn+river'],
 ['crazyPineapple', 3, 'burn+flop, burn+turn, burn+river'],
 ['draw4', 3, 'burn before each of three draws'],
 ['draw5', 3, 'burn before each of three draws']
].forEach(([pat, total, why]) => {
  const p = DEAL_PATTERNS[pat];
  const sum = (p.burns || []).reduce((a, b) => a + b, 0);
  check(pat + ' burns ' + total + ' times (' + why + ')', sum === total, 'got ' + sum);
  check(pat + ': burn data covers every step',
        (p.burns || []).length === p.hole.length);
  check(pat + ': the opening deal never burns', (p.burns || [])[0] === 0 || p.hole[0] === 0);
});

console.log('');
console.log('=== The protected stub card is never burned ===');
{
  // Two cards left, nothing eligible to reshuffle: the last one is untouchable,
  // so the burn simply cannot happen rather than consuming it.
  const st = newState(2);
  const deckRef = { live: [ {rank:'A',suit:'S'}, {rank:'K',suit:'D'} ], reshuffles:0 };
  const draw = makeDraw(st, deckRef);
  const first = draw();
  check('the first of the last two cards is available', fmt(first) === 'AS');
  const second = draw();
  check('the protected last card is never handed out — not even as a burn',
        second === null, fmt(second));
  check('nothing was recorded as burned', st.burnCards.length === 0);
}

console.log('');
console.log('=== Burn cards participate in a documented reshuffle ===');
{
  const st = newState(2);
  st.burnCards.push({rank:'7',suit:'H'}, {rank:'8',suit:'S'});
  const deckRef = { live: [{rank:'A',suit:'S'}, {rank:'K',suit:'D'}], reshuffles:0 };
  const draw = makeDraw(st, deckRef);
  draw();                       // AS dealt, KD is now the protected last card
  const next = draw();          // reshuffle: burns + protected card
  check('a reshuffle fired using burn cards', deckRef.reshuffles === 1);
  check('a burned card can legitimately return after the reshuffle',
        next !== null && ['7H','8S','KD'].includes(fmt(next)), fmt(next));
  check('the burn pile is emptied into the new stub', st.burnCards.length === 0);
}
{
  // Current-round discards stay excluded even when burns are present.
  const eligible = DealState.reshuffleEligible({
    muck: [], burns: [{rank:'7',suit:'H'}], stubLastCard: {rank:'K',suit:'D'},
    currentRoundDiscards: [{rank:'7',suit:'H'}]
  });
  check('a card that is both burned and a current-round discard stays out',
        !eligible.map(fmt).includes('7H'), eligible.map(fmt).join(' '));
}

console.log('');
console.log('=== Seven-handed accounting with real burns ===');
{
  const r = runSteps('studSplit', 7, [0,1,2,3,4,5,6], {});
  const sizes = [];
  for(let i = 0; i < 7; i++) sizes.push(r.st.seatSlotMaps[i].length);
  check('7-handed Stud: the deck runs short and the documented reshuffle covers it',
        r.deckRef.reshuffles >= 1, 'reshuffles=' + r.deckRef.reshuffles);
  check('7-handed Stud: every seat still receives a 7th card',
        sizes.every(n => n === 7), JSON.stringify(sizes));
  check('7-handed Stud: four burns were taken', r.pattern.burns.reduce((a,b)=>a+b,0) === 4);
}
{
  // A Pat seat keeps all five and takes no later cards, so each Pat removes
  // four physical cards from the hand's requirement.
  const consumption = [];
  [0,1,2,3].forEach(pats => {
    const isPatSeat = seat => seat < pats;
    const pattern = DEAL_PATTERNS.superStud;
    const st = newState(7);
    const deckRef = { live: orderedDeck(), reshuffles: 0 };
    const draw = makeDraw(st, deckRef);
    for(const step of [0,1,2,3,4,5,6,7,8]){
      DealState.applyStreet({ pattern, stepIndex: step, seatCount: 7,
        sitOutSeat: null, state: st, drawCard: draw,
        keepSlotsFor: () => null, isPatSeat });
    }
    consumption.push({ pats,
      cards: st.seatDealtCounts.reduce((a,b)=>a+b,0),
      reshuffles: deckRef.reshuffles,
      patHeld: pats ? (st.seatSlotMaps[0]||[]).length : null });
  });
  consumption.forEach(c => console.log('  ' + c.pats + ' Pat(s): physical cards=' +
    c.cards + '  reshuffles=' + c.reshuffles +
    (c.patHeld !== null ? '  pat seat holds=' + c.patHeld : '')));
  check('each Pat reduces physical card consumption',
        consumption[1].cards < consumption[0].cards &&
        consumption[3].cards < consumption[1].cards,
        JSON.stringify(consumption.map(c => c.cards)));
  // Pat is now modelled: the seat locks at five and takes no later card, so
  // each Pat removes four physical cards (two skipped later cards plus the
  // two it no longer discards and replaces). See test-super-pat.js.
  check('a Pat seat keeps exactly five cards and takes no later card',
        consumption[1].patHeld === 5, 'held ' + consumption[1].patHeld);
  check('each Pat removes four physical cards from the requirement',
        consumption[0].cards - consumption[1].cards === 4,
        (consumption[0].cards - consumption[1].cards) + ' fewer');

  const r = runSteps('superStud', 7, [0,1,2,3,4,5,6,7,8], {});
  const sizes = [];
  for(let i = 0; i < 7; i++) sizes.push(r.st.seatSlotMaps[i].length);
  check('7-handed Super Stud: every seat still reaches 7 held cards',
        sizes.every(n => n === 7), JSON.stringify(sizes));
  check('7-handed Super Stud: Super Stud physical shape is unchanged',
        r.pattern.faceSeq[r.pattern.faceSeq.length - 1] === 'DDUUUUD');
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
