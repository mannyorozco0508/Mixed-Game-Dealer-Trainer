/* ============================================================
   money-state.js — Authoritative chip accounting for The Rail

   All math that betting-engine.js already validates (pot-limit sizing,
   side-pot layering, hi-lo splitting, odd chips) is DELEGATED to it.
   This module supplies what the engine has no concept of: stacks,
   per-street and per-hand contributions, blinds/antes, all-in state,
   uncalled-bet returns, and payout application.

   MONEY UNIT: integer WHOLE DOLLARS. No floating point anywhere. All
   training stakes in the 20/40 mixed rotation are whole dollars, so cents
   would add rounding surface for no benefit. If cents are ever needed,
   change UNIT_NAME and scale the structure values — nothing else assumes
   dollars.

   Works in Node (require) and the browser (window.RailMoney).
   ============================================================ */
(function(exports, BE){

const UNIT_NAME = 'whole dollars';

/* ============================================================
   HOUSE RULES — CONFIRMED vs UNCONFIRMED
   ------------------------------------------------------------
   Verified rules are stated explicitly here rather than buried inside
   generic math or UI code, so they can be audited and changed in one place.
   Anything still unverified is flagged so it is never taught as fact.
   ============================================================ */
const HOUSE_RULES = {
  // CONFIRMED: 20/40 Stud family.
  // The bring-in is a forced PARTIAL wager of $5. A player who completes
  // brings the wager TO $20 total (not $5 + $20 = $25). A player who already
  // posted the $5 bring-in therefore owes only the $15 difference to call.
  stud20_40: {
    confirmed: true,
    bringIn: 5,
    completionTo: 20   // TOTAL street wager after completion, not an increment
  },
  // CONFIRMED: Big O Double Board is HIGH ONLY on both boards.
  // The pot layer splits between the top and bottom board; when a layer
  // cannot divide evenly, the odd chip goes to the TOP board.
  bigODoubleBoard: {
    confirmed: true,
    highOnly: true,
    boardSplit: 'top-bottom',
    oddBoardChip: 'top'
  },
  // NOT CONFIRMED: the 4-bet cap is a common convention, not a verified
  // house rule for this room. It stays configurable and must never be
  // presented to a trainee as established procedure.
  raiseCap: {
    confirmed: false,
    betsPerStreet: 4,
    note: 'UNCONFIRMED default — common convention, not verified for this room'
  }
};

/* ---------- Betting structure registry ----------
   Keyed by dealCat so it is configuration, not scattered name checks.
   The 20/40 mixed rotation uses smallBet 20 / bigBet 40. bigBetFromStep is
   the scenario step at which the limit doubles. */
const BETTING_RULES = {
  holdem:         { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  bigO:           { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  bigOPLO:        { type:'potlimit', sb:10, bb:20, raiseCap:null },
  drawmaha:       { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:3, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  doubleBoard:    { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  pineapple:      { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  crazyPineapple: { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  draw4:          { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  draw5:          { type:'limit',    smallBet:20, bigBet:40, bigBetFromStep:2, sb:10, bb:20, raiseCap:HOUSE_RULES.raiseCap.betsPerStreet },
  // Stud family: ante + bring-in rather than blinds. Marked partial because
  // the bring-in AMOUNT convention is house-specific and unconfirmed.
  // CONFIRMED 20/40 Stud: bring-in $5, completion TO $20 total.
  studSplit:      { type:'limit', smallBet:20, bigBet:40, bigBetFromStep:2,
                    bringIn:HOUSE_RULES.stud20_40.bringIn,
                    completionTo:HOUSE_RULES.stud20_40.completionTo,
                    raiseCap:HOUSE_RULES.raiseCap.betsPerStreet, studForcedBets:true },
  superStud:      { type:'limit', smallBet:20, bigBet:40, bigBetFromStep:2,
                    bringIn:HOUSE_RULES.stud20_40.bringIn,
                    completionTo:HOUSE_RULES.stud20_40.completionTo,
                    raiseCap:HOUSE_RULES.raiseCap.betsPerStreet, studForcedBets:true }
};

function rulesFor(dealCat, gameName){
  if(gameName === 'Big O PLO') return BETTING_RULES.bigOPLO;
  return BETTING_RULES[dealCat] || BETTING_RULES.holdem;
}

/* ---------- Money state ---------- */
function createMoneyState({ seats, startingStack, dealCat, gameName, sitOutSeat }){
  const rules = rulesFor(dealCat, gameName);
  const stacks = {}, streetContrib = {}, handContrib = {}, allIn = {};
  seats.forEach(s => {
    stacks[s] = startingStack;
    streetContrib[s] = 0;
    handContrib[s] = 0;
    allIn[s] = false;
  });
  return {
    rules,
    seats: seats.slice(),
    sitOutSeat,
    stacks, streetContrib, handContrib, allIn,
    pot: 0,                 // chips already collected from closed streets
    currentBet: 0,          // highest street contribution this street
    lastRaiseSize: 0,       // for minimum-raise enforcement
    raisesThisStreet: 0,
    startingStacks: Object.assign({}, stacks),
    log: []
  };
}

/* Total chips anywhere in the hand — used by the conservation invariant. */
function totalChips(ms){
  let sum = ms.pot;
  ms.seats.forEach(s => { sum += ms.stacks[s] + ms.streetContrib[s]; });
  return sum;
}

/* Moves `amount` from a seat's stack into its street contribution.
   Caps at the stack (short all-in) and flags all-in. Returns actual amount. */
function commit(ms, seat, amount){
  const available = ms.stacks[seat];
  const actual = Math.min(Math.max(0, Math.floor(amount)), available);
  ms.stacks[seat] -= actual;
  ms.streetContrib[seat] += actual;
  ms.handContrib[seat] += actual;
  if(ms.stacks[seat] === 0 && actual > 0) ms.allIn[seat] = true;
  if(ms.streetContrib[seat] > ms.currentBet) ms.currentBet = ms.streetContrib[seat];
  return actual;
}

/* ---------- Forced bets ---------- */
/* Posts the Stud bring-in. bringInSeat is determined by the door card
   (handled by table-action.js); this only moves the money.
   CONFIRMED house rule: bring-in is $5, a forced PARTIAL wager. */
function postBringIn(ms, bringInSeat){
  const r = ms.rules;
  if(!r.studForcedBets || bringInSeat === null || bringInSeat === undefined) return 0;
  const amt = commit(ms, bringInSeat, r.bringIn);
  ms.log.push({ seat:bringInSeat, action:'bring-in', amount:amt });
  ms.lastRaiseSize = r.bringIn;
  return amt;
}

/* Completes the bring-in TO the full small bet ($20 total, NOT +$20).
   Returns the amount this seat actually added. */
function completeBet(ms, seat){
  const r = ms.rules;
  if(!r.studForcedBets) return 0;
  const owed = Math.max(0, r.completionTo - ms.streetContrib[seat]);
  const amt = commit(ms, seat, owed);
  ms.lastRaiseSize = r.completionTo - r.bringIn;
  ms.raisesThisStreet++;
  ms.log.push({ seat, action:'complete', amount:amt, to:r.completionTo });
  return amt;
}

function postBlinds(ms, buttonSeat, tableSeats){
  const r = ms.rules;
  const active = ms.seats.filter(s => s !== ms.sitOutSeat);
  if(r.studForcedBets) return; // stud uses postBringIn instead
  if(r.ante){
    active.forEach(s => { const a = commit(ms, s, r.ante); ms.log.push({ seat:s, action:'ante', amount:a }); });
    // Antes are dead money: sweep them into the pot and reopen the street.
    active.forEach(s => { ms.pot += ms.streetContrib[s]; ms.streetContrib[s] = 0; });
    ms.currentBet = 0;
    return;
  }
  if(buttonSeat === null || buttonSeat === undefined) return;
  const nextActive = from => {
    for(let n = 1; n <= tableSeats; n++){
      const s = (from + n) % tableSeats;
      if(s !== ms.sitOutSeat && ms.seats.indexOf(s) !== -1) return s;
    }
    return null;
  };
  const sbSeat = nextActive(buttonSeat);
  const bbSeat = sbSeat === null ? null : nextActive(sbSeat);
  if(sbSeat !== null){ const a = commit(ms, sbSeat, r.sb); ms.log.push({ seat:sbSeat, action:'sb', amount:a }); }
  if(bbSeat !== null){ const a = commit(ms, bbSeat, r.bb); ms.log.push({ seat:bbSeat, action:'bb', amount:a }); }
  ms.lastRaiseSize = r.bb;
}

/* ---------- Legal amounts ---------- */
function callAmount(ms, seat){
  // Only the DIFFERENCE owed, never the full current bet.
  return Math.max(0, Math.min(ms.currentBet - ms.streetContrib[seat], ms.stacks[seat]));
}
function isAllInCall(ms, seat){
  return ms.currentBet - ms.streetContrib[seat] > ms.stacks[seat];
}
function betSizeForStreet(ms, step){
  const r = ms.rules;
  if(r.type === 'potlimit') return null;
  return (step >= (r.bigBetFromStep || 99)) ? r.bigBet : r.smallBet;
}
function minRaiseTo(ms, step){
  const r = ms.rules;
  if(r.type === 'limit'){
    const inc = betSizeForStreet(ms, step);
    return ms.currentBet + inc;
  }
  // Pot-limit minimum raise = current bet + size of the last bet/raise.
  return ms.currentBet + Math.max(ms.lastRaiseSize, ms.rules.bb || 0);
}
function maxRaiseTo(ms, seat, step){
  const r = ms.rules;
  if(r.type === 'limit') return minRaiseTo(ms, step); // fixed increment
  // POT LIMIT — delegate to the validated engine.
  const potBeforeAction = ms.pot + ms.seats.reduce((n,s) => n + ms.streetContrib[s], 0);
  const toCall = ms.currentBet - ms.streetContrib[seat];
  const maxTotal = BE.potLimitMaxTotalWager(potBeforeAction, toCall);
  const cap = ms.streetContrib[seat] + ms.stacks[seat]; // can't exceed the stack
  return Math.min(ms.streetContrib[seat] + maxTotal, cap);
}
function raiseCapReached(ms){
  const cap = ms.rules.raiseCap;
  return cap ? ms.raisesThisStreet >= cap : false;
}

/* ---------- Applying an action with real money ---------- */
function applyMoneyAction(ms, seat, action, step, opts){
  const before = totalChips(ms);
  let amount = 0;
  switch(action){
    case 'fold':
      break; // committed chips stay in the pot
    case 'check':
      break;
    case 'call':
      amount = commit(ms, seat, callAmount(ms, seat));
      break;
    case 'bet': {
      const size = ms.rules.type === 'limit'
        ? betSizeForStreet(ms, step)
        : Math.min((opts && opts.desiredTo) || maxRaiseTo(ms, seat, step), maxRaiseTo(ms, seat, step));
      amount = commit(ms, seat, ms.rules.type === 'limit' ? size : size - ms.streetContrib[seat]);
      ms.lastRaiseSize = amount;
      ms.raisesThisStreet++;
      break;
    }
    case 'raise': {
      const target = ms.rules.type === 'limit'
        ? minRaiseTo(ms, step)
        : Math.max(minRaiseTo(ms, step), Math.min((opts && opts.desiredTo) || maxRaiseTo(ms, seat, step), maxRaiseTo(ms, seat, step)));
      const priorBet = ms.currentBet;
      amount = commit(ms, seat, target - ms.streetContrib[seat]);
      ms.lastRaiseSize = Math.max(0, ms.currentBet - priorBet);
      ms.raisesThisStreet++;
      break;
    }
  }
  ms.log.push({ seat, action, amount, allIn: ms.allIn[seat] });
  const after = totalChips(ms);
  if(before !== after) throw new Error('Chip conservation broken on ' + action + ': ' + before + ' -> ' + after);
  return amount;
}

/* ---------- Street close ---------- */
function closeStreet(ms){
  ms.seats.forEach(s => { ms.pot += ms.streetContrib[s]; ms.streetContrib[s] = 0; });
  ms.currentBet = 0;
  ms.lastRaiseSize = 0;
  ms.raisesThisStreet = 0;
}

/* ---------- Uncalled bet return ----------
   If the final aggressor put in more than anyone matched, the unmatched
   excess is returned before the pot is collected. */
function returnUncalledBet(ms, foldedSeats){
  const contenders = ms.seats.filter(s => s !== ms.sitOutSeat && !foldedSeats.has(s));
  if(contenders.length === 0) return null;
  // Highest street contribution across everyone still live, and the next
  // highest that anyone actually matched.
  let top = null, topAmt = -1, secondAmt = 0;
  ms.seats.forEach(s => {
    const c = ms.streetContrib[s];
    if(c > topAmt){ secondAmt = topAmt < 0 ? 0 : topAmt; top = s; topAmt = c; }
    else if(c > secondAmt){ secondAmt = c; }
  });
  if(top === null || topAmt <= secondAmt) return null;
  const refund = topAmt - secondAmt;
  ms.streetContrib[top] -= refund;
  ms.handContrib[top] -= refund;
  ms.stacks[top] += refund;
  if(ms.stacks[top] > 0) ms.allIn[top] = false;
  ms.log.push({ seat: top, action:'uncalled-return', amount: refund });
  return { seat: top, amount: refund };
}

/* ---------- Pot layers ---------- */
function potLayers(ms, foldedSeats){
  const contributions = ms.seats.map(s => ({
    playerId: s,
    total: ms.handContrib[s],
    folded: foldedSeats.has(s)
  }));
  return BE.buildSidePots(contributions);
}

/* ---------- Double Board payout ----------
   CONFIRMED house rule: Big O Double Board is HIGH ONLY on both boards.
   Each pot LAYER splits between the top and bottom board; if a layer cannot
   divide evenly the odd chip goes to the TOP board. This is deliberately NOT
   the hi/lo splitter — there is no low side and no low qualification here.

   Note the two DISTINCT odd-chip decisions:
     1. board allocation odd chip -> TOP board (this rule)
     2. odd chip when a board's share is split among TIED winners ->
        the engine's validated tied-winner rule
   These must never be conflated. */
function awardDoubleBoardPots(ms, foldedSeats, boardWinnersFor){
  const layers = potLayers(ms, foldedSeats);
  const payouts = {};
  const detail = [];
  const add = (seat, amt) => { payouts[seat] = (payouts[seat] || 0) + amt; };

  layers.forEach(layer => {
    const eligible = layer.eligiblePlayerIds;
    if(eligible.length === 0) return;
    if(eligible.length === 1){ add(eligible[0], layer.amount); return; }

    // 1. Split THIS layer between the boards; odd chip to the top board.
    const bottomShare = Math.floor(layer.amount / 2);
    const topShare = layer.amount - bottomShare; // takes the odd chip
    const res = boardWinnersFor(eligible) || {};
    const topWinners = (res.topWinners || []).filter(s => eligible.indexOf(s) !== -1);
    const bottomWinners = (res.bottomWinners || []).filter(s => eligible.indexOf(s) !== -1);

    // 2. Award each board share among that board's winners, using the
    //    engine's validated even-split/odd-chip logic for ties.
    if(topWinners.length) BE.distributeEven(topShare, topWinners, add, 'first');
    else eligible.forEach(() => {}); // no winner determinable: leave unawarded
    if(bottomWinners.length) BE.distributeEven(bottomShare, bottomWinners, add, 'first');

    detail.push({ layerAmount: layer.amount, topShare, bottomShare, topWinners, bottomWinners, eligible });
  });

  Object.keys(payouts).forEach(id => {
    const seat = isNaN(+id) ? id : +id;
    ms.stacks[seat] += payouts[seat];
  });
  ms.pot = 0;
  return { layers, payouts, detail };
}

/* ---------- Payout ----------
   showdownFor(eligibleSeats) must return { highWinners, lowWinners } for
   that specific layer, so each layer is judged only among its contenders. */
function awardPots(ms, foldedSeats, showdownFor){
  const layers = potLayers(ms, foldedSeats);
  const payouts = {};
  layers.forEach((layer, idx) => {
    const eligible = layer.eligiblePlayerIds;
    if(eligible.length === 0) return;
    if(eligible.length === 1){
      payouts[eligible[0]] = (payouts[eligible[0]] || 0) + layer.amount;
      return;
    }
    const res = showdownFor(eligible) || {};
    const highWinners = (res.highWinners || []).filter(s => eligible.indexOf(s) !== -1);
    const lowWinners  = (res.lowWinners  || []).filter(s => eligible.indexOf(s) !== -1);
    const winners = highWinners.length ? highWinners : eligible;
    const split = BE.splitPotHiLo({ amount: layer.amount, eligiblePlayerIds: eligible },
      winners, lowWinners, 'high');
    Object.keys(split).forEach(id => {
      const seat = isNaN(+id) ? id : +id;
      payouts[seat] = (payouts[seat] || 0) + split[id];
    });
  });
  Object.keys(payouts).forEach(id => {
    const seat = isNaN(+id) ? id : +id;
    ms.stacks[seat] += payouts[seat];
  });
  ms.pot = 0;
  return { layers, payouts };
}

/* Awards the whole pot to a single remaining player (everyone else folded). */
function awardToSinglePlayer(ms, seat){
  closeStreet(ms);
  const amount = ms.pot;
  ms.stacks[seat] += amount;
  ms.pot = 0;
  ms.log.push({ seat, action:'win-by-folds', amount });
  return amount;
}

exports.HOUSE_RULES = HOUSE_RULES;
exports.UNIT_NAME = UNIT_NAME;
exports.BETTING_RULES = BETTING_RULES;
exports.rulesFor = rulesFor;
exports.createMoneyState = createMoneyState;
exports.totalChips = totalChips;
exports.commit = commit;
exports.postBlinds = postBlinds;
exports.callAmount = callAmount;
exports.isAllInCall = isAllInCall;
exports.betSizeForStreet = betSizeForStreet;
exports.minRaiseTo = minRaiseTo;
exports.maxRaiseTo = maxRaiseTo;
exports.raiseCapReached = raiseCapReached;
exports.applyMoneyAction = applyMoneyAction;
exports.closeStreet = closeStreet;
exports.returnUncalledBet = returnUncalledBet;
exports.potLayers = potLayers;
exports.awardPots = awardPots;
exports.awardDoubleBoardPots = awardDoubleBoardPots;
exports.postBringIn = postBringIn;
exports.completeBet = completeBet;
exports.awardToSinglePlayer = awardToSinglePlayer;

})(
  typeof module !== 'undefined' ? module.exports : (window.RailMoney = window.RailMoney || {}),
  typeof module !== 'undefined' ? require('./betting-engine.js') : window.RailBetting
);
