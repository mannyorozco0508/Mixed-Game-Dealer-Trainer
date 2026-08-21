/* ============================================================
   test-phases.js — ordered physical streets inside one app step.

   A training step may cover several real streets, but the deck must
   experience them in the exact order the table does: burn, deal, burn, deal.
   Taking every burn first and then dealing gets the burn COUNT right and the
   card IDENTITIES wrong.
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
function opener(patternName, seatCount, patSeats){
  const pattern = DEAL_PATTERNS[patternName];
  const st = {
    seatHoleCards: [], seatSlotMaps: [], seatDealtCounts: new Array(seatCount).fill(0),
    tableBoardCards: [], tableBoard2Cards: [], muckPile: [], burnCards: [],
    prevHoleCount:0, prevUpCount:0, prevBoardCount:0, prevBoard2Count:0, burnPileCount:0
  };
  for(let i = 0; i < seatCount; i++){ st.seatHoleCards.push([]); st.seatSlotMaps.push([]); }
  let live = orderedDeck();
  const pat = new Set(patSeats || []);
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
    step: i => DealState.applyStreet({
      pattern, stepIndex: i, seatCount, sitOutSeat: null, state: st,
      drawCard, keepSlotsFor: () => null, isPatSeat: s => pat.has(s)
    })
  };
}
function heldOf(st, seat){
  const all = st.seatHoleCards[seat] || [], map = st.seatSlotMaps[seat] || [];
  return map.map(s => all[s]).filter(Boolean);
}

console.log('=== Phase data covers exactly the collapsed steps ===');
{
  // A step is collapsed when it takes more than one burn.
  const collapsed = [];
  Object.keys(DEAL_PATTERNS).forEach(k => {
    const p = DEAL_PATTERNS[k];
    (p.burns || []).forEach((b, i) => { if(b > 1) collapsed.push(k + ':' + i); });
  });
  check('every multi-burn step has ordered phase data', collapsed.every(id => {
    const [k, i] = id.split(':');
    return DEAL_PATTERNS[k].phases && DEAL_PATTERNS[k].phases[i];
  }), collapsed.join(' '));
  check('the collapsed steps are exactly the four expected',
        collapsed.sort().join(' ') === 'crazyPineapple:5 pineapple:5 studSplit:4 superStud:8',
        collapsed.join(' '));
  // Phase burn totals must agree with the per-step burn count.
  Object.keys(DEAL_PATTERNS).forEach(k => {
    const p = DEAL_PATTERNS[k];
    if(!p.phases) return;
    Object.keys(p.phases).forEach(i => {
      const sum = p.phases[i].reduce((a, ph) => a + (ph.burn || 0), 0);
      check(k + ' step ' + i + ': phase burns match the step burn count',
            sum === p.burns[i], sum + ' vs ' + p.burns[i]);
    });
  });
  check('simple patterns need no phase data',
        ['holdem','bigO','doubleBoard','drawmaha','draw4','draw5']
          .every(k => !DEAL_PATTERNS[k].phases));
}

console.log('');
console.log('=== Stud: 5th and 6th street are dealt one at a time ===');
{
  const SEATS = 4;
  const g = opener('studSplit', SEATS);
  [0,1,2,3].forEach(i => g.step(i));            // through 4th street
  const before = g.st.seatSlotMaps.map(m => m.length);
  check('every seat holds 4 before the collapsed step',
        before.every(n => n === 4), JSON.stringify(before));

  // burn, one card to each seat, burn, one card to each seat.
  const top = g.peek(1 + SEATS + 1 + SEATS);
  const burnsBefore = g.st.burnCards.length;
  const plan = g.step(4);

  check('the step takes two burns', g.st.burnCards.length - burnsBefore === 2,
        String(g.st.burnCards.length - burnsBefore));
  check('the 5th-street burn is the top card',
        fmt(g.st.burnCards[burnsBefore]) === top[0],
        fmt(g.st.burnCards[burnsBefore]) + ' expected ' + top[0]);
  check('5th street is dealt from the cards straight after that burn', (() => {
    for(let s = 0; s < SEATS; s++){
      if(fmt(heldOf(g.st, s)[4]) !== top[1 + s]) return false;
    }
    return true;
  })(), [0,1,2,3].map(s => fmt(heldOf(g.st, s)[4])).join(' ') + ' expected ' + top.slice(1, 1+SEATS).join(' '));
  check('the 6th-street burn comes AFTER 5th street is dealt',
        fmt(g.st.burnCards[burnsBefore + 1]) === top[1 + SEATS],
        fmt(g.st.burnCards[burnsBefore + 1]) + ' expected ' + top[1 + SEATS]);
  check('6th street is dealt after the second burn', (() => {
    for(let s = 0; s < SEATS; s++){
      if(fmt(heldOf(g.st, s)[5]) !== top[2 + SEATS + s]) return false;
    }
    return true;
  })(), [0,1,2,3].map(s => fmt(heldOf(g.st, s)[5])).join(' '));
  check('every seat holds 6 after the step',
        g.st.seatSlotMaps.every(m => m.length === 6),
        JSON.stringify(g.st.seatSlotMaps.map(m => m.length)));
  check('the pitch queue separates the two streets into phases 0 and 1', (() => {
    const seat = plan.pitchQueue.filter(p => p.kind === 'seat');
    return seat.filter(p => p.phase === 0).length === SEATS &&
           seat.filter(p => p.phase === 1).length === SEATS;
  })(), JSON.stringify(plan.pitchQueue.filter(p => p.kind === 'seat').map(p => p.phase)));
  check('both streets are dealt face UP', (() => {
    return plan.pitchQueue.filter(p => p.kind === 'seat').every(p => p.faceUp);
  })());
  // 7th street stays down.
  g.step(5); g.step(6);
  check('7th street is dealt face down', (() => {
    const seq = g.pattern.faceSeq[6];
    return seq === 'DDUUUUD' && seq.charAt(seq.length - 1) === 'D';
  })());
  check('no duplicate card in any hand', (() => {
    for(let s = 0; s < SEATS; s++){
      const h = heldOf(g.st, s).map(fmt);
      if(new Set(h).size !== h.length) return false;
    }
    return true;
  })());
}

console.log('');
console.log('=== Super Stud: four streets in one step, Pat seats skipped ===');
{
  const SEATS = 5;
  const PAT = [1, 3];
  const g = opener('superStud', SEATS, PAT);
  [0,1,2,3,4,5,6,7].forEach(i => g.step(i));    // opening deal + discard
  const beforeHeld = g.st.seatSlotMaps.map(m => m.length);
  check('Pat seats hold 5 and non-Pat hold 3 before the collapsed step',
        JSON.stringify(beforeHeld) === JSON.stringify([3,5,3,5,3]), JSON.stringify(beforeHeld));

  const burnsBefore = g.st.burnCards.length;
  const nonPat = [0,2,4];
  // Each of the four streets: 1 burn then one card to each NON-PAT seat.
  const top = g.peek(4 * (1 + nonPat.length));
  const plan = g.step(8);

  check('the step takes four burns', g.st.burnCards.length - burnsBefore === 4,
        String(g.st.burnCards.length - burnsBefore));
  check('burn and deal alternate across all four streets', (() => {
    let idx = 0;
    for(let street = 0; street < 4; street++){
      if(fmt(g.st.burnCards[burnsBefore + street]) !== top[idx]) return false;
      idx++;
      for(const s of nonPat){
        if(fmt(heldOf(g.st, s)[3 + street]) !== top[idx]) return false;
        idx++;
      }
    }
    return true;
  })(), 'burns=' + g.st.burnCards.slice(burnsBefore).map(fmt).join(' '));
  check('Pat seats received nothing in any phase',
        plan.pitchQueue.filter(p => p.kind === 'seat').every(p => !PAT.includes(p.seat)));
  check('Pat seats still hold exactly five',
        PAT.every(s => (g.st.seatSlotMaps[s] || []).length === 5),
        JSON.stringify(PAT.map(s => (g.st.seatSlotMaps[s]||[]).length)));
  check('non-Pat seats reach seven',
        nonPat.every(s => (g.st.seatSlotMaps[s] || []).length === 7),
        JSON.stringify(nonPat.map(s => (g.st.seatSlotMaps[s]||[]).length)));
  check('the four streets appear as four phases in the queue', (() => {
    const seat = plan.pitchQueue.filter(p => p.kind === 'seat');
    return [0,1,2,3].every(ph => seat.filter(p => p.phase === ph).length === nonPat.length);
  })(), JSON.stringify(plan.pitchQueue.filter(p => p.kind === 'seat').map(p => p.phase)));
  check('the final retained card is face down', (() => {
    const seat = plan.pitchQueue.filter(p => p.kind === 'seat' && p.phase === 3);
    return seat.every(p => !p.faceUp);
  })());
  check('the three middle streets are face up', (() => {
    const seat = plan.pitchQueue.filter(p => p.kind === 'seat' && p.phase < 3);
    return seat.every(p => p.faceUp);
  })());
  check('Super Stud shape is unchanged',
        g.pattern.faceSeq[1] === 'DDDDU' && g.pattern.faceSeq[2] === 'DDU' &&
        g.pattern.faceSeq[8] === 'DDUUUUD');
  check('no duplicate identity across all hands', (() => {
    const all = [];
    for(let s = 0; s < SEATS; s++) heldOf(g.st, s).forEach(c => all.push(fmt(c)));
    return new Set(all).size === all.length;
  })());
}

console.log('');
console.log('=== Triple draw: one burn per REAL draw, not per quiz label ===');
{
  ['draw4','draw5'].forEach(name => {
    const p = DEAL_PATTERNS[name];
    const total = (p.burns || []).reduce((a,b) => a+b, 0);
    check(name + ': exactly three burns for three draws', total === 3, String(total));
    check(name + ': no step burns more than once', (p.burns||[]).every(b => b <= 1),
          JSON.stringify(p.burns));
    check(name + ': needs no phase data (no step covers two draws)', !p.phases);
    check(name + ': the opening deal does not burn', (p.burns||[])[1] !== 0 || p.hole[1] === 0);
  });
  const g = opener('draw5', 6);
  [0,1,2,3,4,5,6].forEach(i => g.step(i));
  check('draw5: three physical burn cards were consumed', g.st.burnCards.length === 3,
        String(g.st.burnCards.length));
}

console.log('');
console.log('=== Drawmaha: replacement draw still takes no burn ===');
{
  const p = DEAL_PATTERNS.drawmaha;
  check('Drawmaha burns only on flop, turn and river',
        p.burns[2] === 1 && p.burns[5] === 1 && p.burns[6] === 1, JSON.stringify(p.burns));
  check('Drawmaha: the replacement steps burn nothing',
        p.burns[3] === 0 && p.burns[4] === 0, JSON.stringify(p.burns));
  const g = opener('drawmaha', 6);
  [0,1,2,3,4,5,6,7].forEach(i => g.step(i));
  check('Drawmaha: three burns total across the hand', g.st.burnCards.length === 3,
        String(g.st.burnCards.length));
  check('Drawmaha: board reaches 5', g.st.tableBoardCards.length === 5);
}

console.log('');
console.log('=== Double Board: one burn per street, never one per board ===');
{
  const p = DEAL_PATTERNS.doubleBoard;
  check('Double Board takes no phase data — each street is a single phase', !p.phases);
  const g = opener('doubleBoard', 6);
  g.step(0); g.step(1);
  const top = g.peek(7);
  const plan = g.step(2);
  check('exactly one burn for the flop street', g.st.burnCards.length === 1,
        String(g.st.burnCards.length));
  check('the burn is the top card', fmt(g.st.burnCards[0]) === top[0]);
  check('top board takes the next three (established app order)',
        g.st.tableBoardCards.map(fmt).join(' ') === top.slice(1,4).join(' '));
  check('bottom board takes the three after that',
        g.st.tableBoard2Cards.map(fmt).join(' ') === top.slice(4,7).join(' '));
  check('both boards belong to the SAME phase',
        plan.pitchQueue.filter(p2 => p2.kind !== 'seat').every(p2 => p2.phase === 0));
  g.step(3); g.step(4);
  check('three burns total, not six', g.st.burnCards.length === 3, String(g.st.burnCards.length));
  check('both boards reach five',
        g.st.tableBoardCards.length === 5 && g.st.tableBoard2Cards.length === 5);
  check('no card appears on both boards',
        !g.st.tableBoardCards.map(fmt).some(c => g.st.tableBoard2Cards.map(fmt).includes(c)));
}

console.log('');
console.log('=== A reshuffle inside a collapsed step happens at the right moment ===');
{
  // Super Stud 7-handed runs the deck dry inside its four-street step, so the
  // reshuffle must fire between phases rather than after the whole step.
  const g = opener('superStud', 7);
  [0,1,2,3,4,5,6,7,8].forEach(i => g.step(i));
  check('every seat still reaches seven cards through the reshuffle',
        g.st.seatSlotMaps.every(m => m.length === 7),
        JSON.stringify(g.st.seatSlotMaps.map(m => m.length)));
  check('no duplicate identity is live after the reshuffle', (() => {
    const all = [];
    for(let s = 0; s < 7; s++) heldOf(g.st, s).forEach(c => all.push(fmt(c)));
    return new Set(all).size === all.length;
  })());
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
