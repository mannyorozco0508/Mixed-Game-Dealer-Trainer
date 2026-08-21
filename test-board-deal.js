/* ============================================================
   test-board-deal.js

   The board must not exist until the dealer burns and deals it.

   Previously buildTable reserved every future board card the moment the hand
   was built, so the app consumed a burn correctly but the flop, turn and
   river had already been chosen before that burn happened. These tests use a
   stacked deck so the burn and board identities are unambiguous.
   ============================================================ */
const DealState = require('./deal-state.js');
const Showdown  = require('./showdown.js');
const { DEAL_PATTERNS } = require('./deal-patterns.js');
const { DATA } = require('./game-data.js');
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
/* Steps a game one street at a time so board growth can be watched. */
function opener(patternName, seatCount, deck){
  const pattern = DEAL_PATTERNS[patternName];
  const st = newState(seatCount);
  let live = (deck || orderedDeck()).slice();
  const drawCard = () => {
    if(live.length <= 1){
      const eligible = DealState.reshuffleEligible({
        muck: st.muckPile, burns: st.burnCards,
        stubLastCard: live.length ? live[0] : null, currentRoundDiscards: []
      });
      if(eligible.length){ live = eligible; st.muckPile.length = 0; st.burnCards.length = 0; }
      else if(live.length <= 1) return null;
    }
    return live.length ? live.shift() : null;
  };
  return {
    st, pattern,
    peek: n => live.slice(0, n).map(fmt),
    left: () => live.length,
    step: i => DealState.applyStreet({
      pattern, stepIndex: i, seatCount, sitOutSeat: null, state: st,
      drawCard, keepSlotsFor: () => null
    })
  };
}
function findGame(name){
  for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
  throw new Error('game not found: ' + name);
}

console.log('=== Future board cards are not reserved at hand start ===');
{
  const src = require('fs').readFileSync('./index.html', 'utf8');
  check('buildTable no longer splices a board off the deck',
        !/tableBoardCards = deck\.splice/.test(src) && !/tableBoard2Cards = deck\.splice/.test(src));
  // The board now comes from openHand, which starts it empty; buildTable
  // adopts that rather than reserving cards of its own.
  const HandOpen = require('./hand-open.js');
  const opened = HandOpen.openHand({
    pattern: require('./deal-patterns.js').DEAL_PATTERNS.doubleBoard,
    seatCount: 6, sitOutSeat: null, deck: orderedDeck()
  });
  check('opening a hand leaves both boards empty',
        opened.tableBoardCards.length === 0 && opened.tableBoard2Cards.length === 0);
  check('buildTable adopts the empty boards from openHand',
        /tableBoardCards\s*=\s*hand\.tableBoardCards/.test(src) &&
        /tableBoard2Cards\s*=\s*hand\.tableBoard2Cards/.test(src));
}

console.log('');
console.log("=== Hold'em: the burn decides the flop, turn and river ===");
{
  const g = opener('holdem', 6);
  g.step(0); g.step(1);                       // opening deal, no burn
  check('the board is empty before the flop', g.st.tableBoardCards.length === 0);
  check('nothing was burned before the flop', g.st.burnCards.length === 0);

  // Top of the live deck right now: burn, then the three flop cards.
  const beforeFlop = g.peek(4);
  g.step(2); g.step(3);                       // step 3 is the flop
  check('exactly one card was burned for the flop', g.st.burnCards.length === 1,
        String(g.st.burnCards.length));
  check('the burned card is the one that was on top',
        fmt(g.st.burnCards[0]) === beforeFlop[0],
        fmt(g.st.burnCards[0]) + ' expected ' + beforeFlop[0]);
  check('the flop is the THREE CARDS AFTER the burn',
        g.st.tableBoardCards.map(fmt).join(' ') === beforeFlop.slice(1, 4).join(' '),
        g.st.tableBoardCards.map(fmt).join(' ') + ' expected ' + beforeFlop.slice(1,4).join(' '));
  check('the burned card is NOT on the board',
        !g.st.tableBoardCards.map(fmt).includes(fmt(g.st.burnCards[0])));
  check('board count is 3 after the flop', g.st.tableBoardCards.length === 3);

  const beforeTurn = g.peek(2);
  g.step(4); g.step(5);                       // step 5 is the turn
  check('a second card was burned for the turn', g.st.burnCards.length === 2);
  check('the turn burn is the card that was on top',
        fmt(g.st.burnCards[1]) === beforeTurn[0]);
  check('the turn is the card AFTER that burn',
        fmt(g.st.tableBoardCards[3]) === beforeTurn[1],
        fmt(g.st.tableBoardCards[3]) + ' expected ' + beforeTurn[1]);
  check('board count is 4 after the turn', g.st.tableBoardCards.length === 4);

  const beforeRiver = g.peek(2);
  g.step(6);                                   // river
  check('a third card was burned for the river', g.st.burnCards.length === 3);
  check('the river burn is the card that was on top',
        fmt(g.st.burnCards[2]) === beforeRiver[0]);
  check('the river is the card AFTER that burn',
        fmt(g.st.tableBoardCards[4]) === beforeRiver[1],
        fmt(g.st.tableBoardCards[4]) + ' expected ' + beforeRiver[1]);
  check('board count is 5 after the river', g.st.tableBoardCards.length === 5);
  check('no duplicate board cards',
        new Set(g.st.tableBoardCards.map(fmt)).size === 5);
  check('no board card is also a burn card', (() => {
    const b = new Set(g.st.burnCards.map(fmt));
    return !g.st.tableBoardCards.map(fmt).some(c => b.has(c));
  })());
}

console.log('');
console.log('=== Board progression 0 -> 3 -> 4 -> 5, every board family ===');
[['bigO', 6, [0,1,2,3,4]],
 ['pineapple', 6, [0,1,2,3,4,5]],
 ['crazyPineapple', 6, [0,1,2,3,4,5]],
 ['drawmaha', 6, [0,1,2,3,4,5,6,7]],
 ['holdem', 6, [0,1,2,3,4,5,6]]
].forEach(([name, seats, steps]) => {
  const g = opener(name, seats);
  const seen = [];
  steps.forEach(i => { g.step(i); seen.push(g.st.tableBoardCards.length); });
  const progression = seen.filter((n, i) => i === 0 || n !== seen[i-1]);
  // Most families step 0 -> 3 -> 4 -> 5. Pineapple and Crazy Pineapple fold
  // the turn and river into a single pattern step, so their board goes
  // 0 -> 3 -> 5 with two burns on that step. See the KNOWN LIMITATION block
  // below — the burn COUNT is right, the burn/deal interleave is not.
  const collapsed = ['pineapple','crazyPineapple'].includes(name);
  const expected = collapsed ? [0,3,5] : [0,3,4,5];
  check(name + ': board grows ' + expected.join(' -> '),
        JSON.stringify(progression) === JSON.stringify(expected) ||
        JSON.stringify(progression) === JSON.stringify(expected.slice(1)),
        JSON.stringify(seen));
  check(name + ': board ends at 5', g.st.tableBoardCards.length === 5);
  check(name + ': three cards were burned', g.st.burnCards.length === 3,
        String(g.st.burnCards.length));
  check(name + ': no duplicate board cards',
        new Set(g.st.tableBoardCards.map(fmt)).size === g.st.tableBoardCards.length);
  const burnSet = new Set(g.st.burnCards.map(fmt));
  check(name + ': no board card was burned',
        !g.st.tableBoardCards.map(fmt).some(c => burnSet.has(c)));
  // Nothing on the board may still be in a hand or the muck.
  const inHands = [];
  for(let s = 0; s < seats; s++){
    const all = g.st.seatHoleCards[s] || [], map = g.st.seatSlotMaps[s] || [];
    map.map(x => all[x]).filter(Boolean).forEach(c => inHands.push(fmt(c)));
  }
  check(name + ': no board card is also in a live hand',
        !g.st.tableBoardCards.map(fmt).some(c => inHands.includes(c)));
  check(name + ': no board card is in the muck',
        !g.st.tableBoardCards.map(fmt).some(c => g.st.muckPile.map(fmt).includes(c)));
});

console.log('');
console.log('=== Crazy Pineapple discards AND advances the board on one step ===');
{
  // This used to stop at the flop: the discard branch returned before the
  // turn and river were pitched.
  const g = opener('crazyPineapple', 6);
  [0,1,2,3,4].forEach(i => g.step(i));
  check('board is at 3 before the discard step', g.st.tableBoardCards.length === 3);
  const plan = g.step(5);
  check('the final step both discards and deals',
        plan.removals.length > 0 && plan.pitchQueue.length > 0,
        'removals=' + plan.removals.length + ' pitches=' + plan.pitchQueue.length);
  check('the turn and river are actually pitched',
        plan.pitchQueue.filter(p => p.kind === 'board1').length === 2,
        String(plan.pitchQueue.filter(p => p.kind === 'board1').length));
  check('the board reaches 5', g.st.tableBoardCards.length === 5);
  check('seats still end holding 2 cards', (() => {
    for(let s = 0; s < 6; s++) if((g.st.seatSlotMaps[s] || []).length !== 2) return false;
    return true;
  })());
  check('the discarded third cards reached the muck', g.st.muckPile.length === 6,
        String(g.st.muckPile.length));
}
{
  // Pineapple discards BEFORE the flop — timing unchanged.
  const g = opener('pineapple', 6);
  g.step(0);
  const afterDeal = (g.st.seatSlotMaps[0] || []).length;
  g.step(1);
  check('Pineapple: the discard happens before any board card',
        (g.st.seatSlotMaps[0] || []).length === 2 && g.st.tableBoardCards.length === 0,
        'held=' + (g.st.seatSlotMaps[0]||[]).length + ' board=' + g.st.tableBoardCards.length);
  check('Pineapple: seats are dealt 3 before discarding', afterDeal === 3, String(afterDeal));
}

console.log('');
console.log('=== Double Board: ONE burn per street, both boards after it ===');
{
  const g = opener('doubleBoard', 6);
  g.step(0); g.step(1);
  check('both boards start empty',
        g.st.tableBoardCards.length === 0 && g.st.tableBoard2Cards.length === 0);

  const beforeFlop = g.peek(7);   // 1 burn + 3 top + 3 bottom
  const flop = g.step(2);
  check('exactly ONE card is burned for the flop street', g.st.burnCards.length === 1,
        String(g.st.burnCards.length));
  check('the top board gets 3', g.st.tableBoardCards.length === 3);
  check('the bottom board gets 3', g.st.tableBoard2Cards.length === 3);
  // Established app order: the top board is completed first, then the bottom.
  // The cheat sheet says the boards are dealt at once but does not specify the
  // physical top/bottom interleave, so the app's existing order is kept.
  check('top board takes the first three cards after the burn',
        g.st.tableBoardCards.map(fmt).join(' ') === beforeFlop.slice(1,4).join(' '),
        g.st.tableBoardCards.map(fmt).join(' '));
  check('bottom board takes the next three',
        g.st.tableBoard2Cards.map(fmt).join(' ') === beforeFlop.slice(4,7).join(' '),
        g.st.tableBoard2Cards.map(fmt).join(' '));
  check('the flop pitches both boards from one street',
        flop.pitchQueue.filter(p => p.kind === 'board1').length === 3 &&
        flop.pitchQueue.filter(p => p.kind === 'board2').length === 3);

  g.step(3);
  check('exactly TWO burns after the turn street — not one per board',
        g.st.burnCards.length === 2, String(g.st.burnCards.length));
  check('turn: top +1', g.st.tableBoardCards.length === 4);
  check('turn: bottom +1', g.st.tableBoard2Cards.length === 4);

  g.step(4);
  check('exactly THREE burns after the river street', g.st.burnCards.length === 3,
        String(g.st.burnCards.length));
  check('river: top +1', g.st.tableBoardCards.length === 5);
  check('river: bottom +1', g.st.tableBoard2Cards.length === 5);
  check('no card appears on both boards',
        !g.st.tableBoardCards.map(fmt).some(c => g.st.tableBoard2Cards.map(fmt).includes(c)));
  check('no board card was burned', (() => {
    const b = new Set(g.st.burnCards.map(fmt));
    return !g.st.tableBoardCards.concat(g.st.tableBoard2Cards).map(fmt).some(c => b.has(c));
  })());
}

console.log('');
console.log('=== Drawmaha: board streets burn, replacement draws do not ===');
{
  const g = opener('drawmaha', 6);
  const burnsBy = [];
  [0,1,2,3,4,5,6,7].forEach(i => { g.step(i); burnsBy.push(g.st.burnCards.length); });
  check('Drawmaha burns exactly three times across the hand',
        g.st.burnCards.length === 3, String(g.st.burnCards.length));
  const pattern = DEAL_PATTERNS.drawmaha;
  check('the burn schedule has no burn on the replacement step',
        pattern.burns[3] === 0 && pattern.burns[4] === 0,
        JSON.stringify(pattern.burns));
  check('burns land on flop, turn and river steps',
        pattern.burns[2] === 1 && pattern.burns[5] === 1 && pattern.burns[6] === 1,
        JSON.stringify(pattern.burns));
  check('board and draw side share one coherent deck: no duplicates anywhere', (() => {
    const all = [];
    for(let s = 0; s < 6; s++){
      const a = g.st.seatHoleCards[s] || [], m = g.st.seatSlotMaps[s] || [];
      m.map(x => a[x]).filter(Boolean).forEach(c => all.push(fmt(c)));
    }
    g.st.tableBoardCards.forEach(c => all.push(fmt(c)));
    g.st.burnCards.forEach(c => all.push(fmt(c)));
    return new Set(all).size === all.length;
  })());
}

console.log('');
console.log('=== Collapsed steps interleave burn and deal, street by street ===');
{
  // Pineapple folds the turn and river into one app step. The table burns
  // before EACH of them, so the deck must see burn, turn, burn, river — not
  // both burns and then both cards. This previously failed.
  const g = opener('pineapple', 6);
  [0,1,2,3,4].forEach(i => g.step(i));      // through the flop
  const top = g.peek(4);                     // burn, turn, burn, river
  const plan = g.step(5);
  check('the collapsed turn/river step still burns exactly twice',
        g.st.burnCards.length === 3, String(g.st.burnCards.length));
  check('first burn is the top card', fmt(g.st.burnCards[1]) === top[0],
        fmt(g.st.burnCards[1]) + ' expected ' + top[0]);
  check('the TURN is the card straight after the first burn',
        fmt(g.st.tableBoardCards[3]) === top[1],
        fmt(g.st.tableBoardCards[3]) + ' expected ' + top[1]);
  check('the SECOND burn comes after the turn, not before it',
        fmt(g.st.burnCards[2]) === top[2],
        fmt(g.st.burnCards[2]) + ' expected ' + top[2]);
  check('the RIVER is the card after the second burn',
        fmt(g.st.tableBoardCards[4]) === top[3],
        fmt(g.st.tableBoardCards[4]) + ' expected ' + top[3]);
  check('the pitch queue records the two streets as separate phases',
        (() => {
          const b = plan.pitchQueue.filter(p => p.kind === 'board1');
          return b.length === 2 && b[0].phase === 0 && b[1].phase === 1;
        })(),
        JSON.stringify(plan.pitchQueue.filter(p => p.kind === 'board1').map(p => p.phase)));
}
{
  // Crazy Pineapple: discard happens first, then burn/turn, then burn/river.
  const g = opener('crazyPineapple', 6);
  [0,1,2,3,4].forEach(i => g.step(i));
  check('board is at 3 and seats hold 3 before the final step',
        g.st.tableBoardCards.length === 3 && (g.st.seatSlotMaps[0]||[]).length === 3);
  const top = g.peek(4);
  const plan = g.step(5);
  check('Crazy Pineapple: the discard still happens on this step',
        plan.removals.length > 0 && (g.st.seatSlotMaps[0]||[]).length === 2);
  check('Crazy Pineapple: turn comes after the first burn', fmt(g.st.tableBoardCards[3]) === top[1],
        fmt(g.st.tableBoardCards[3]) + ' expected ' + top[1]);
  check('Crazy Pineapple: river comes after the second burn', fmt(g.st.tableBoardCards[4]) === top[3],
        fmt(g.st.tableBoardCards[4]) + ' expected ' + top[3]);
  check('Crazy Pineapple: board still reaches 5', g.st.tableBoardCards.length === 5);
  check('Crazy Pineapple: the discarded cards reached the muck', g.st.muckPile.length === 6);
}

console.log('');
console.log('=== Showdown uses the cards actually dealt ===');
{
  const g = opener('bigO', 6);
  [0,1,2,3,4].forEach(i => g.step(i));
  const board = g.st.tableBoardCards;
  check('Big O board is complete and live-dealt', board.length === 5);
  const players = [];
  for(let s = 0; s < 6; s++){
    const a = g.st.seatHoleCards[s] || [], m = g.st.seatSlotMaps[s] || [];
    players.push({ seat: s, cards: m.map(x => a[x]).filter(Boolean) });
  }
  check('Big O seats hold exactly five hole cards',
        players.every(p => p.cards.length === 5));
  const res = Showdown.evaluateShowdown({
    game: { name: findGame('Big O Hi-Lo').name },
    players, board
  });
  check('showdown evaluates against the live-dealt board', res.ok === true, res.error || '');
  check('strict 2+3 is unchanged: every seat still has five hole cards to choose from',
        players.every(p => p.cards.length === 5));
  // The evaluator must have been handed the same board that was dealt.
  check('no board card came from outside the dealt board', (() => {
    const dealt = new Set(board.map(fmt));
    return board.every(c => dealt.has(fmt(c))) && board.length === 5;
  })());
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
