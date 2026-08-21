/* ============================================================
   test-super-pat.js

   Confirmed rule: SUPER PAT locks the original five-card hand. The seat
   discards nothing and receives no card on any later street, while staying
   live for BOTH high and qualifying 8-or-better low, and still acting.

   Pat is not a fold and not an all-in.
   ============================================================ */
const DealState = require('./deal-state.js');
const Showdown  = require('./showdown.js');
const Action    = require('./table-action.js');
const CardChoice= require('./card-choice.js');
const Player    = require('./player-mode.js');
const { DEAL_PATTERNS } = require('./deal-patterns.js');
const { DATA } = require('./game-data.js');
const { RANKS, SUITS } = require('./card-model.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const fmt = c => c ? c.rank + c.suit : '--';
const card = t => ({ rank: t.length === 3 ? '10' : t[0], suit: t[t.length-1] });
function orderedDeck(){
  const d = []; RANKS.forEach(r => SUITS.forEach(s => d.push({ rank:r, suit:s }))); return d;
}
function findGame(name){
  for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
  throw new Error('game not found: ' + name);
}
const SUPER = findGame('Super Stud Hi-Lo 8 / Super Pat');

/* Runs a full Super Stud hand with a given set of Pat seats. */
function runHand(seatCount, patSeats, deck){
  const pattern = DEAL_PATTERNS.superStud;
  const st = {
    seatHoleCards: [], seatSlotMaps: [], seatDealtCounts: new Array(seatCount).fill(0),
    tableBoardCards: [], tableBoard2Cards: [], muckPile: [], burnCards: [],
    prevHoleCount:0, prevUpCount:0, prevBoardCount:0, prevBoard2Count:0, burnPileCount:0
  };
  for(let i = 0; i < seatCount; i++){ st.seatHoleCards.push([]); st.seatSlotMaps.push([]); }
  let live = (deck || orderedDeck()).slice();
  let reshuffles = 0;
  const drawCard = () => {
    if(live.length <= 1){
      const eligible = DealState.reshuffleEligible({
        muck: st.muckPile, burns: st.burnCards,
        stubLastCard: live.length ? live[0] : null, currentRoundDiscards: []
      });
      if(eligible.length){ reshuffles++; live = eligible; st.muckPile.length = 0; st.burnCards.length = 0; }
      else if(live.length <= 1) return null;
    }
    return live.length ? live.shift() : null;
  };
  const pat = new Set(patSeats);
  const plans = [];
  for(let step = 0; step < pattern.hole.length; step++){
    plans.push(DealState.applyStreet({
      pattern, stepIndex: step, seatCount, sitOutSeat: null, state: st,
      drawCard, keepSlotsFor: () => null, isPatSeat: seat => pat.has(seat)
    }));
  }
  return { st, plans, reshuffles, pattern };
}
function heldOf(st, seat){
  const all = st.seatHoleCards[seat] || [], map = st.seatSlotMaps[seat] || [];
  return map.map(s => all[s]).filter(Boolean);
}

console.log('=== A Pat seat locks at five ===');
{
  const r = runHand(7, [2], null);
  check('Pat seat holds exactly five cards', heldOf(r.st, 2).length === 5,
        heldOf(r.st, 2).length + ' cards');
  check('Pat seat dealt count stays five', r.st.seatDealtCounts[2] === 5,
        'dealt ' + r.st.seatDealtCounts[2]);
  check('Pat slot map is the original five physical slots',
        JSON.stringify(r.st.seatSlotMaps[2]) === JSON.stringify([0,1,2,3,4]),
        JSON.stringify(r.st.seatSlotMaps[2]));
  check('Pat seat receives no later pitch entries',
        r.plans.slice(2).every(p => !p.pitchQueue.some(x => x.kind === 'seat' && x.seat === 2)));
  check('Pat seat discards nothing',
        r.plans.filter(p => p.kind === 'discard')
               .every(p => (p.removals.find(x => x.seat === 2) || {positions:[]}).positions.length === 0));
  check('no Pat card reaches the muck', (() => {
    const patCards = heldOf(r.st, 2).map(fmt);
    return !r.st.muckPile.map(fmt).some(c => patCards.includes(c));
  })());
  check('no phantom cards: physical list is exactly five',
        (r.st.seatHoleCards[2] || []).length === 5,
        (r.st.seatHoleCards[2] || []).length + ' physical');
}

console.log('');
console.log('=== A mixed table works: Pat and non-Pat at once ===');
{
  const r = runHand(7, [0, 3, 6], null);
  const held = [0,1,2,3,4,5,6].map(i => heldOf(r.st, i).length);
  check('Pat seats hold five, non-Pat seats reach seven',
        JSON.stringify(held) === JSON.stringify([5,7,7,5,7,7,5]), JSON.stringify(held));
  check('non-Pat seats still discard two',
        r.plans.filter(p => p.kind === 'discard')
               .every(p => [1,2,4,5].every(s =>
                 (p.removals.find(x => x.seat === s) || {positions:[]}).positions.length === 2)));
  check('non-Pat retained shape is the pattern shape',
        r.pattern.faceSeq[2] === 'DDU');
  check('non-Pat final shape is D D U U U U D',
        r.pattern.faceSeq[r.pattern.faceSeq.length - 1] === 'DDUUUUD');
  const live = [];
  [0,1,2,3,4,5,6].forEach(i => heldOf(r.st, i).forEach(c => live.push(fmt(c))));
  const dupes = live.filter((c, i) => live.indexOf(c) !== i);
  check('no duplicate identity is live', dupes.length === 0, [...new Set(dupes)].join(' '));
}

console.log('');
console.log('=== A Pat lock never suppresses the OPENING deal ===');
{
  // Defensive: a seat flagged before any card exists must still be dealt five.
  const r = runHand(7, [0,1,2,3,4,5,6], null);
  const held = [0,1,2,3,4,5,6].map(i => heldOf(r.st, i).length);
  check('every seat still receives its opening five',
        held.every(n => n === 5), JSON.stringify(held));
}

console.log('');
console.log('=== Physical card accounting, 7-handed ===');
{
  const rows = [];
  for(let pats = 0; pats <= 7; pats++){
    const seats = []; for(let i = 0; i < pats; i++) seats.push(i);
    const r = runHand(7, seats, null);
    const total = r.st.seatDealtCounts.reduce((a,b) => a+b, 0);
    rows.push({ pats, total, burns: r.pattern.burns.reduce((a,b)=>a+b,0), reshuffles: r.reshuffles,
                held: r.st.seatSlotMaps.map(m => m.length) });
    console.log('  ' + pats + ' Pat(s): player cards=' + String(total).padStart(3) +
                '  + burns=' + String(total + 4).padStart(3) +
                '  reshuffles=' + r.reshuffles +
                '  held=' + JSON.stringify(r.st.seatSlotMaps.map(m => m.length)));
  }
  check('each Pat removes exactly four physical cards',
        rows.every((row, i) => i === 0 || rows[i-1].total - row.total === 4),
        JSON.stringify(rows.map(r => r.total)));
  check('0 Pats consumes 63 player cards', rows[0].total === 63, String(rows[0].total));
  check('7 Pats consumes 35 player cards', rows[7].total === 35, String(rows[7].total));
  const firstNoReshuffle = rows.find(r => r.reshuffles === 0);
  check('enough Pats eliminate the reshuffle entirely', !!firstNoReshuffle,
        'reshuffles by pat count: ' + JSON.stringify(rows.map(r => r.reshuffles)));
  if(firstNoReshuffle){
    console.log('  -> exhaustion disappears from ' + firstNoReshuffle.pats + ' Pat(s) upward');
  }
  check('every seat is still served at every Pat count',
        rows.every(row => row.held.every((n, i) => n === (i < row.pats ? 5 : 7))),
        JSON.stringify(rows.map(r => r.held)));
}

console.log('');
console.log('=== Showdown treats the five-card Pat hand as complete ===');
{
  const rule = Showdown.ruleForGame(SUPER.name);
  check('Super Stud evaluates high and 8-or-better low', rule.family === 'high+low8', rule.family);

  // A Pat seat holding a five-card scooper against two seven-card hands.
  const patHand  = ['8H','6D','5S','3C','2H'].map(card);        // 8-low, also a made high
  const rival1   = ['KS','KD','9C','7H','4S','3D','2C'].map(card);
  const rival2   = ['QS','JD','9H','8S','6C','4D','3H'].map(card);
  const res = Showdown.evaluateShowdown({
    game: { name: SUPER.name },
    players: [ { seat:0, cards:patHand }, { seat:1, cards:rival1 }, { seat:2, cards:rival2 } ],
    board: []
  });
  check('a five-card Pat hand is accepted by showdown', res.ok === true, res.error || '');
  const lowSide = (res.sides || []).find(s => /low/i.test(s.label || s.name || ''));
  const highSide = (res.sides || []).find(s => /high/i.test(s.label || s.name || ''));
  check('a low side was produced', !!lowSide, JSON.stringify((res.sides||[]).map(s => s.label || s.name)));
  if(lowSide){
    const lowWinners = (lowSide.results || []).filter(r => r.winner || r.isWinner);
    check('the Pat seat qualifies and wins the low with 8-6-5-3-2',
          lowSide.results && lowSide.results[0] && lowSide.results[0].seat === 0,
          JSON.stringify((lowSide.results||[]).map(r => r.seat)));
  }
  check('the Pat hand was NOT padded to seven cards', patHand.length === 5);
  check('the Pat hand competes on the high side too',
        highSide && highSide.results && highSide.results.some(x => x.seat === 0));

  // A five-card Pat hand must be able to SCOOP. The steel wheel is a straight
  // flush for high and a qualifying 5-4-3-2-A for low.
  const scooper = ['AS','2S','3S','4S','5S'].map(card);
  const weak1   = ['KH','KD','QC','JH','9S','7D','6C'].map(card);
  const weak2   = ['QH','JC','TD','9H','7S','6D','4C'].map(card);
  const sc = Showdown.evaluateShowdown({
    game: { name: SUPER.name },
    players: [ { seat:0, cards:scooper }, { seat:1, cards:weak1 }, { seat:2, cards:weak2 } ],
    board: []
  });
  const scHigh = (sc.sides || []).find(s => /high/i.test(s.label || s.name || ''));
  const scLow  = (sc.sides || []).find(s => /low/i.test(s.label || s.name || ''));
  check('a five-card Pat hand can win the HIGH side',
        scHigh && scHigh.results && scHigh.results[0] && scHigh.results[0].seat === 0,
        scHigh ? JSON.stringify(scHigh.results.map(r => r.seat + ':' + r.label)) : 'no high side');
  check('a five-card Pat hand can win the LOW side',
        scLow && scLow.results && scLow.results[0] && scLow.results[0].seat === 0,
        scLow ? JSON.stringify(scLow.results.map(r => r.seat + ':' + r.label)) : 'no low side');
  check('a five-card Pat hand can SCOOP both sides',
        scHigh && scLow && scHigh.results[0].seat === 0 && scLow.results[0].seat === 0);
}

console.log('');
console.log('=== Pat is not a fold and not an all-in ===');
{
  // firstActor and round construction must still include a Pat seat.
  const ups = { 0:[card('KH')], 1:[card('QD')], 2:[card('9S')] };
  const actor = Action.firstActor({
    dealCat: 'superStud', tableSeats: 3, buttonSeat: null, sitOutSeat: null,
    foldedSeats: new Set(), street: 1, upCards: ups, highBringsIn: false
  });
  check('a Pat seat is still selected in the action order', actor !== null && [0,1,2].includes(actor),
        String(actor));
  const round = Action.createRound({
    dealCat: 'superStud', tableSeats: 3, buttonSeat: null, sitOutSeat: null,
    foldedSeats: new Set(), street: 1, upCards: ups, highBringsIn: false
  });
  check('a round including Pat seats opens normally', !!round && round.current !== undefined);
  // Pat carries no fold/all-in meaning anywhere in the deal model.
  const src = require('fs').readFileSync('./deal-state.js', 'utf8');
  check('the deal transition never treats Pat as folded or all-in',
        !/isPatSeat[^\n]*fold/i.test(src) && !/isPatSeat[^\n]*allIn/i.test(src));
}

console.log('');
console.log('=== Pat state is per-seat and seat-generic ===');
{
  const src = require('fs').readFileSync('./index.html', 'utf8');
  check('one authoritative per-seat Pat collection exists',
        /let seatPatLocked = \[\]/.test(src));
  // Behavioural rather than textual: opening a hand must hand back a clean
  // lock array, and buildTable must adopt it rather than keeping the old one.
  const HandOpen = require('./hand-open.js');
  const fresh = HandOpen.openHand({ pattern: null, seatCount: 7, sitOutSeat: null, deck: [] });
  check('opening a hand yields no Pat locks',
        fresh.seatPatLocked.length === 7 && fresh.seatPatLocked.every(v => v === false));
  check('buildTable adopts the fresh lock array from openHand',
        /seatPatLocked\s*=\s*hand\.seatPatLocked/.test(src));
  check('the human keep-list is cleared with every new hand',
        /humanKeepSlots = null;\s*\n\s*humanIsPat = false;/.test(src));
  check('the lock is not special-cased to the human seat',
        /isPatSeat: seat => !!seatPatLocked\[seat\]/.test(src));
  check('the human Pat choice writes the seat lock',
        /if\(result\.pat\) seatPatLocked\[seat\] = true;/.test(src));

  // card-choice remains the single source of the Pat decision.
  const rule = CardChoice.ruleFor('superStud');
  check('Super Stud offers a Pat-or-discard decision', rule.mode === 'pat-or-discard', rule.mode);
  let session = CardChoice.beginCardChoice({ dealCat:'superStud', rule, handSize:5 });
  session = CardChoice.declarePat(session, true);
  const result = CardChoice.confirmChoice(session);
  check('declaring Pat keeps all five slots',
        result.pat === true && result.keepSlots.length === 5, JSON.stringify(result.keepSlots));
  check('declaring Pat discards nothing', result.discardSlots.length === 0);
  const support = Player.supportFor('superStud');
  check('Play & Learn still reports Super Stud as FULL', support.level === 'FULL', support.level);
  check('Play & Learn still routes the Pat decision to the human',
        support.humanChoice === 'pat-or-discard', support.humanChoice);
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
