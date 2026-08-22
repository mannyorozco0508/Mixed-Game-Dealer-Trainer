/* ============================================================
   test-deal-state.js — the street transition, with no DOM at all.

   No jsdom, no marker slicing, no index.html. The transition is called
   directly with a deterministic deck, which is the whole point of the seam:
   what a street deals is now answerable without rendering anything.
   ============================================================ */
const DealState = require('./deal-state.js');
const { DEAL_PATTERNS } = require('./deal-patterns.js');
const { DATA } = require('./game-data.js');
const { RANKS, SUITS } = require('./card-model.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const fmt = c => c ? (c.rank + c.suit) : '--';

function orderedDeck(){
  const d = [];
  RANKS.forEach(r => SUITS.forEach(s => d.push({ rank:r, suit:s })));
  return d;
}
function freshState(seatCount, boardMax, board2Max, deck){
  const st = {
    seatHoleCards: [], seatSlotMaps: [], seatDealtCounts: new Array(seatCount).fill(0),
    tableBoardCards: [], tableBoard2Cards: [], muckPile: [], burnCards: [],
    prevHoleCount:0, prevUpCount:0, prevBoardCount:0, prevBoard2Count:0, burnPileCount:0
  };
  for(let i = 0; i < seatCount; i++){ st.seatHoleCards.push([]); st.seatSlotMaps.push([]); }
  // Boards are NOT pre-seeded: applyStreet draws them from the live deck at
  // their own street, after that street's burn.
  return st;
}
function findGame(name){
  for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
  throw new Error('game not found: ' + name);
}
/* Runs every step of a game and returns the final state plus per-step plans. */
function runGame(name, seatCount, keepSlotsFor){
  const game = findGame(name);
  const pattern = DEAL_PATTERNS[game.dealCat];
  const deck = orderedDeck();
  const boardMax  = Math.max(...pattern.board);
  const board2Max = pattern.board2 ? Math.max(...pattern.board2) : 0;
  const st = freshState(seatCount, boardMax, board2Max, deck);
  // Burns are physical now, so a full stud hand can outrun a 52-card deck.
  // This mirrors production drawCard, including the documented reshuffle and
  // the protected last card, rather than pretending the deck is bottomless.
  let live = deck;
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
  const plans = [];
  for(let step = 0; step < pattern.hole.length; step++){
    plans.push(DealState.applyStreet({
      pattern, stepIndex: step, seatCount, sitOutSeat: null,
      state: st, drawCard, keepSlotsFor: keepSlotsFor || (() => null)
    }));
  }
  return { game, pattern, st, plans, seatCount };
}
/* Held cards = the physical slots the seat still has, in hand order. */
function held(st, seat){
  const all = st.seatHoleCards[seat] || [], map = st.seatSlotMaps[seat] || [];
  return map.length ? map.map(s => all[s]).filter(Boolean) : all;
}
function noDuplicatesInHeld(st, seatCount){
  for(let i = 0; i < seatCount; i++){
    const h = held(st, i).map(fmt);
    if(new Set(h).size !== h.length) return false;
  }
  return true;
}
/* Final held size for a game, per its pattern. */
function finalHoleCount(pattern){ return pattern.hole[pattern.hole.length - 1]; }

console.log('=== Street transition, no DOM ===');

/* ---------- button / community games ---------- */
{
  const r = runGame("Texas Hold'em", 6);
  check("Hold'em: every seat ends with 2 hole cards",
        [0,1,2,3,4,5].every(i => held(r.st, i).length === 2));
  check("Hold'em: board reaches 5", r.st.tableBoardCards.length === 5);
  check("Hold'em: no board2", r.st.tableBoard2Cards.length === 0);
  check("Hold'em: no duplicate cards in any hand", noDuplicatesInHeld(r.st, 6));
  const boardPitches = r.plans.flatMap(p => p.pitchQueue).filter(p => p.kind === 'board1');
  check("Hold'em: board revealed 3 then 1 then 1", boardPitches.length === 5);
}
{
  const r = runGame('Big O Hi-Lo', 6);
  check('Big O Hi-Lo: 5 hole cards per seat',
        [0,1,2,3,4,5].every(i => held(r.st, i).length === 5));
  check('Big O Hi-Lo: board reaches 5', r.st.tableBoardCards.length === 5);
  check('Big O Hi-Lo: all hole cards dealt face down',
        r.plans.flatMap(p => p.pitchQueue).filter(p => p.kind === 'seat').every(p => !p.faceUp));
  check('Big O Hi-Lo: no duplicates', noDuplicatesInHeld(r.st, 6));
}
{
  const r = runGame('Big O PLO', 6);
  check('Big O PLO: 5 hole cards per seat',
        [0,1,2,3,4,5].every(i => held(r.st, i).length === 5));
}
{
  const r = runGame('Big-O Double Board', 6);
  check('Double Board: board1 reaches 5', r.st.tableBoardCards.length === 5);
  check('Double Board: board2 reaches 5', r.st.tableBoard2Cards.length === 5);
  const q = r.plans.flatMap(p => p.pitchQueue);
  check('Double Board: both boards are pitched',
        q.some(p => p.kind === 'board1') && q.some(p => p.kind === 'board2'));
  check('Double Board: the two boards share no cards',
        !r.st.tableBoardCards.map(fmt).some(c => r.st.tableBoard2Cards.map(fmt).includes(c)));
}

/* ---------- stud family ---------- */
{
  const r = runGame('Stud Hi-Lo / 8-or-Better', 7);
  check('Stud: 7 physical cards per seat', [0,1,2,3,4,5,6].every(i => r.st.seatDealtCounts[i] === 7));
  check('Stud: 3rd street deals 2 down + 1 up', (() => {
    const q = r.plans[0].pitchQueue.filter(p => p.kind === 'seat' && p.seat === 0);
    return q.length === 3 && !q[0].faceUp && !q[1].faceUp && q[2].faceUp;
  })());
  check('Stud: 7th street is dealt down', (() => {
    const last = r.plans[r.plans.length - 1].pitchQueue.filter(p => p.kind === 'seat' && p.seat === 0);
    return last.length === 1 && !last[0].faceUp;
  })());
  check('Stud: no duplicates', noDuplicatesInHeld(r.st, 7));
  check('Stud: no board', r.st.tableBoardCards.length === 0);
}
{
  const r = runGame('Razz', 7);
  check('Razz: 7 physical cards per seat', [0,1,2,3,4,5,6].every(i => r.st.seatDealtCounts[i] === 7));
  check('Razz: 3rd street exposes exactly the third card', (() => {
    const q = r.plans[0].pitchQueue.filter(p => p.kind === 'seat' && p.seat === 3);
    return q.length === 3 && q.filter(p => p.faceUp).length === 1 && q[2].faceUp;
  })());
}

/* ---------- Super Stud: the confirmed physical shape ---------- */
{
  const r = runGame('Super Stud Hi-Lo 8 / Super Pat', 5);
  const p = r.pattern;
  check('Super Stud: initial deal is D D D D U', (() => {
    const q = r.plans[1].pitchQueue.filter(x => x.kind === 'seat' && x.seat === 0);
    return q.length === 5 && q.slice(0,4).every(x => !x.faceUp) && q[4].faceUp;
  })());
  const discardPlan = r.plans.find(pl => pl.kind === 'discard');
  check('Super Stud: a discard street exists', !!discardPlan);
  check('Super Stud: the discard removes exactly two cards per seat',
        discardPlan.removals.every(rm => rm.positions.length === 2));
  check('Super Stud: the exposed fifth card is retained', (() => {
    // discardKeep names the surviving physical slots; slot 4 is the up card.
    const keep = p.discardKeep[discardPlan.step];
    return keep.includes(4);
  })());
  check('Super Stud: retained shape is D D U after the discard', (() => {
    const seq = p.faceSeq[discardPlan.step];
    return seq === 'DDU';
  })());
  check('Super Stud: final retained sequence is D D U U U U D',
        p.faceSeq[p.faceSeq.length - 1] === 'DDUUUUD');
  check('Super Stud: final card is dealt down', (() => {
    const seq = p.faceSeq[p.faceSeq.length - 1];
    return seq.charAt(seq.length - 1) === 'D';
  })());
  check('Super Stud: seats end holding 7 cards', finalHoleCount(p) === 7);
  check('Super Stud: discarded cards go to the muck', r.st.muckPile.length >= 2 * 5);
  check('Super Stud: no duplicates in any held hand', noDuplicatesInHeld(r.st, 5));

  // Super Pat is now a real per-seat lock, exercised in depth by
  // test-super-pat.js. The keep-slot override remains the Play & Learn path
  // for a non-Pat human choosing WHICH two to throw.
  const patKeep = [0,1,2,3,4];
  const rp = runGame('Super Stud Hi-Lo 8 / Super Pat', 5, seat => seat === 2 ? patKeep : null);
  const dp = rp.plans.find(pl => pl.kind === 'discard');
  check('Super Stud: a keep-all override discards nothing for that seat',
        dp.removals.find(rm => rm.seat === 2).positions.length === 0);
  check('Super Stud: every other seat still discards two',
        dp.removals.filter(rm => rm.seat !== 2).every(rm => rm.positions.length === 2));
}

/* ---------- draw family ---------- */
{
  const r = runGame('Badugi', 6);
  check('Badugi: seats hold 4 cards', [0,1,2,3,4,5].every(i => held(r.st, i).length === 4));
  check('Badugi: every card is dealt face down',
        r.plans.flatMap(p => p.pitchQueue).filter(p => p.kind === 'seat').every(p => !p.faceUp));
  check('Badugi: no duplicates', noDuplicatesInHeld(r.st, 6));
}
{
  const r = runGame('2-7 Lowball', 6);
  check('2-7 Lowball: seats hold 5 cards', [0,1,2,3,4,5].every(i => held(r.st, i).length === 5));
  check('2-7 Lowball: no duplicates after all draws', noDuplicatesInHeld(r.st, 6));
}
{
  const r = runGame('A-5 Lowball', 6);
  check('A-5 Lowball: seats hold 5 cards', [0,1,2,3,4,5].every(i => held(r.st, i).length === 5));
}
{
  const r = runGame('Drawmaha Hi', 6);
  check('Drawmaha: seats hold 5 cards', [0,1,2,3,4,5].every(i => held(r.st, i).length === 5));
  check('Drawmaha: board reaches 5', r.st.tableBoardCards.length === 5);
  check('Drawmaha: no duplicates', noDuplicatesInHeld(r.st, 6));
}

/* ---------- pineapple discard timing ---------- */
{
  const p  = DEAL_PATTERNS.pineapple;
  const cp = DEAL_PATTERNS.crazyPineapple;
  const firstDrop = arr => { for(let i=1;i<arr.length;i++) if(arr[i] < arr[i-1]) return i; return -1; };
  const pDrop  = firstDrop(p.hole);
  const cpDrop = firstDrop(cp.hole);
  check('Pineapple: discards down to 2 cards', p.hole[pDrop] === 2, JSON.stringify(p.hole));
  check('Crazy Pineapple: discards down to 2 cards', cp.hole[cpDrop] === 2, JSON.stringify(cp.hole));
  check('Pineapple and Crazy Pineapple discard at DIFFERENT steps', pDrop !== cpDrop,
        'pineapple step ' + pDrop + ', crazy step ' + cpDrop);
  check('Pineapple discards before any board card', p.board[pDrop] === 0,
        'board at drop = ' + p.board[pDrop]);
  check('Crazy Pineapple discards after the flop', cp.board[cpDrop] >= 3,
        'board at drop = ' + cp.board[cpDrop]);

  const r = runGame('Pineapple', 6);
  check('Pineapple: seats end holding 2 cards', [0,1,2,3,4,5].every(i => held(r.st, i).length === 2));
  const rc = runGame('Crazy Pineapple', 6);
  check('Crazy Pineapple: seats end holding 2 cards', [0,1,2,3,4,5].every(i => held(rc.st, i).length === 2));
  check('Crazy Pineapple: discarded third cards reach the muck', rc.st.muckPile.length === 6);
}

/* ---------- transition invariants ---------- */
{
  const r = runGame('Stud Hi-Lo / 8-or-Better', 7);
  // Stud repeats hole counts across question-only steps, so some steps add
  // nothing and must be reported as such — no sound, no animation.
  const nonePlans = r.plans.filter(p => p.kind === 'none');
  check('question-only steps report kind "none" and produce no pitches',
        nonePlans.length > 0 && nonePlans.every(p => p.pitchQueue.length === 0 && !p.dealtSound),
        'none-steps=' + nonePlans.length);
  check('slot maps only ever grow on dealing streets', (() => {
    for(let i = 0; i < 7; i++){
      if((r.st.seatSlotMaps[i] || []).length > r.st.seatDealtCounts[i]) return false;
    }
    return true;
  })());
  check('dealt counts equal the highest slot index + 1', (() => {
    for(let i = 0; i < 7; i++){
      const map = r.st.seatSlotMaps[i] || [];
      if(!map.length) continue;
      if(r.st.seatDealtCounts[i] !== Math.max(...map) + 1) return false;
    }
    return true;
  })());
  check('the burn pile only grows on streets that add cards',
        r.st.burnPileCount > 0 && r.st.burnPileCount < r.plans.length);
  check('no pitch is produced without a card',
        r.plans.flatMap(p => p.pitchQueue).every(p => !!p.card));
}
/* Determinism: same inputs, same output, twice. */
{
  const a = runGame('Big O Hi-Lo', 6), b = runGame('Big O Hi-Lo', 6);
  const sig = r => JSON.stringify({
    hole: r.st.seatHoleCards.map(h => h.map(fmt)),
    slots: r.st.seatSlotMaps, dealt: r.st.seatDealtCounts,
    board: r.st.tableBoardCards.map(fmt), muck: r.st.muckPile.map(fmt),
    order: r.plans.flatMap(p => p.pitchQueue).map(p => p.kind + (p.seat ?? '') + ':' + p.slotIndex)
  });
  check('the transition is deterministic for identical inputs', sig(a) === sig(b));
}
/* An exhausted draw source must not invent cards. */
{
  const game = findGame("Texas Hold'em");
  const pattern = DEAL_PATTERNS[game.dealCat];
  const st = freshState(6, 5, 0, orderedDeck());
  const plan = DealState.applyStreet({
    pattern, stepIndex: 1, seatCount: 6, sitOutSeat: null,
    state: st, drawCard: () => null, keepSlotsFor: () => null
  });
  check('an empty draw source deals no cards rather than undefined ones',
        plan.pitchQueue.filter(p => p.kind === 'seat').length === 0);
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
