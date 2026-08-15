/* ============================================================
   table-action.js — Action order + betting-round state for The Rail

   This is the ADAPTER between Practice Mode and ai-players.js.
   ai-players.js stays a pure hand-strength -> action function; everything
   about WHO acts, WHEN, and WHICH actions are legal lives here.

   IMPORTANT SCOPE: no real chip accounting. Rounds track whether a bet is
   outstanding and who has acted, but never amounts. Stacks stay cosmetic.

   Works in Node (require) and the browser (window.RailAction).
   ============================================================ */
(function(exports, AI, E){

const ACTION = { CHECK:'check', BET:'bet', CALL:'call', RAISE:'raise', FOLD:'fold' };

/* ---------- Action order ----------
   Button games: preflop starts left of the big blind (button+3), postflop
   starts left of the button (button+1). Stud games have no button — the
   bring-in acts first on 3rd street, and the best/worst board acts first
   on later streets depending on the game. */
const BUTTON_DEALCATS = new Set(['draw4','draw5','drawmaha','doubleBoard','pineapple','crazyPineapple','holdem','bigO']);

function isButtonGame(dealCat){ return BUTTON_DEALCATS.has(dealCat); }

// Seats in clockwise order starting from `start`, skipping folded/sat-out.
function orderFrom(start, tableSeats, isEligible){
  const out = [];
  for(let n = 0; n < tableSeats; n++){
    const seat = (start + n) % tableSeats;
    if(isEligible(seat)) out.push(seat);
  }
  return out;
}

/* Determines the first player to act.
   state: { dealCat, tableSeats, buttonSeat, sitOutSeat, foldedSeats:Set,
            street (0-based), upCards: {seat: [cards]} } */
function firstActor(state){
  const eligible = seat => seat !== state.sitOutSeat && !state.foldedSeats.has(seat);

  if(isButtonGame(state.dealCat)){
    if(state.buttonSeat === null || state.buttonSeat === undefined) return null;
    // Street 0/1 = preflop for these patterns (hole cards dealt, betting).
    // Preflop: UTG = button + 3 (button -> SB -> BB -> UTG).
    // Postflop: first active seat left of the button.
    const start = state.street <= 1
      ? (state.buttonSeat + 3) % state.tableSeats
      : (state.buttonSeat + 1) % state.tableSeats;
    const order = orderFrom(start, state.tableSeats, eligible);
    return order.length ? order[0] : null;
  }

  // --- Stud family ---
  // 3rd street: the BRING-IN acts first. Which card brings it in depends on
  // the game: Razz + Super-family = HIGH card brings in; Stud Hi-Lo/8b = LOW
  // card brings in. (Both conventions are documented in the app's game notes.)
  const upCards = state.upCards || {};
  const seats = [];
  for(let s = 0; s < state.tableSeats; s++) if(eligible(s)) seats.push(s);
  if(!seats.length) return null;

  const doorOf = seat => {
    const cards = upCards[seat] || [];
    return cards.length ? cards[cards.length - 1] : null;
  };
  const rankVal = c => c ? ({'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14})[c.rank] : null;

  const withDoor = seats.filter(s => doorOf(s) !== null);
  if(!withDoor.length) return seats[0];

  if(state.street === 0){
    const highBringsIn = state.highBringsIn !== false; // default per Razz/Super
    let best = withDoor[0];
    withDoor.forEach(s => {
      const a = rankVal(doorOf(s)), b = rankVal(doorOf(best));
      if(highBringsIn ? a > b : a < b) best = s;
    });
    return best;
  }
  // Later streets: best board showing acts first (approximated by highest
  // door card, which is what the app can determine from visible cards).
  let lead = withDoor[0];
  withDoor.forEach(s => { if(rankVal(doorOf(s)) > rankVal(doorOf(lead))) lead = s; });
  return lead;
}

/* ---------- Legal actions ---------- */
function legalActions(round){
  // No outstanding bet -> check or bet. Outstanding bet -> fold, call, raise.
  return round.betOutstanding
    ? [ACTION.FOLD, ACTION.CALL, ACTION.RAISE]
    : [ACTION.CHECK, ACTION.BET];
}

/* ---------- Betting round state machine ----------
   Tracks turn order and closure WITHOUT any chip amounts. */
function createRound(state){
  const first = firstActor(state);
  return {
    dealCat: state.dealCat,
    tableSeats: state.tableSeats,
    sitOutSeat: state.sitOutSeat,
    foldedSeats: new Set(state.foldedSeats),
    street: state.street,
    current: first,
    betOutstanding: false,
    aggressor: null,
    actedSinceAggression: new Set(),
    complete: first === null,
    log: []
  };
}

function activeSeats(round){
  const out = [];
  for(let s = 0; s < round.tableSeats; s++){
    if(s !== round.sitOutSeat && !round.foldedSeats.has(s)) out.push(s);
  }
  return out;
}

function nextActor(round, from){
  for(let n = 1; n <= round.tableSeats; n++){
    const seat = (from + n) % round.tableSeats;
    if(seat !== round.sitOutSeat && !round.foldedSeats.has(seat)) return seat;
  }
  return null;
}

/* Applies one action and advances the round. Returns the updated round. */
function applyAction(round, seat, action){
  if(round.complete) return round;
  if(seat !== round.current) return round; // out of turn — ignore

  round.log.push({ seat, action });

  if(action === ACTION.FOLD){
    round.foldedSeats.add(seat);
  } else if(action === ACTION.BET || action === ACTION.RAISE){
    round.betOutstanding = true;
    round.aggressor = seat;
    round.actedSinceAggression = new Set([seat]);
  } else {
    round.actedSinceAggression.add(seat);
  }

  const remaining = activeSeats(round);
  // Only one player left -> hand ends without further action.
  if(remaining.length <= 1){
    round.complete = true;
    round.current = null;
    round.endedByFolds = true;
    return round;
  }

  // Round closes when every active player has acted since the last aggression.
  const allActed = remaining.every(s => round.actedSinceAggression.has(s));
  if(allActed){
    round.complete = true;
    round.current = null;
    return round;
  }

  round.current = nextActor(round, seat);
  return round;
}

/* ---------- AI context bridge ----------
   Converts table state into the shape ai-players.js expects, calls it, and
   returns a legal action. The AI engine itself is never given UI state. */
function chooseAction(round, opts){
  const tier = opts && opts.tier !== undefined ? opts.tier : AI.TIER.WEAK;
  const legal = legalActions(round);
  const canCheck = legal.indexOf(ACTION.CHECK) !== -1;

  let action = AI.decideAction({
    tier,
    facingBet: round.betOutstanding,
    facingRaise: round.betOutstanding && round.aggressor !== null && round.log.some(l => l.action === ACTION.RAISE),
    canCheck
  });

  // The engine is position-blind, so the adapter applies a light positional
  // and style nudge. This never overrides a fold/strong-hand decision — it
  // only breaks up identical behaviour among equal-strength marginal hands.
  if(opts && opts.loosenessBias && action === ACTION.FOLD && round.betOutstanding){
    if(opts.loosenessBias > 0.75 && tier >= AI.TIER.MARGINAL) action = ACTION.CALL;
  }

  // Final safety: never return an illegal action.
  if(legal.indexOf(action) === -1){
    if(action === ACTION.CHECK && !canCheck) action = ACTION.FOLD;
    else if(action === ACTION.BET && round.betOutstanding) action = ACTION.RAISE;
    else if(action === ACTION.CALL && canCheck) action = ACTION.CHECK;
    else action = canCheck ? ACTION.CHECK : ACTION.FOLD;
  }
  return action;
}

/* Hand-strength tier for a seat, using the validated classifiers. */
function tierForSeat(cards, board, family){
  if(!cards || !cards.length) return AI.TIER.WEAK;
  try{
    switch(family){
      case 'omaha': {
        if(!board || board.length < 3) return AI.TIER.MARGINAL;
        const best = E.bestOmahaHigh(cards, board);
        return AI.classifyHigh(best.score);
      }
      case 'low-a5':  return AI.classifyA5Low(E.bestLowA5FromN(cards).score);
      case 'low-27':  return AI.classify27Low(E.bestLow27FromN(cards).score);
      case 'badugi':  return AI.classifyBadugi(E.bestBadugi(cards));
      default: {
        const all = board && board.length ? cards.concat(board) : cards;
        if(all.length < 5) return AI.TIER.MARGINAL; // too early to read
        return AI.classifyHigh(E.bestHighFromN(all).score);
      }
    }
  } catch(err){
    return AI.TIER.MARGINAL;
  }
}

exports.ACTION = ACTION;
exports.isButtonGame = isButtonGame;
exports.firstActor = firstActor;
exports.legalActions = legalActions;
exports.createRound = createRound;
exports.applyAction = applyAction;
exports.activeSeats = activeSeats;
exports.nextActor = nextActor;
exports.chooseAction = chooseAction;
exports.tierForSeat = tierForSeat;

})(
  typeof module !== 'undefined' ? module.exports : (window.RailAction = window.RailAction || {}),
  typeof module !== 'undefined' ? require('./ai-players.js') : window.RailAI,
  typeof module !== 'undefined' ? require('./cards-eval.js') : window.RailCards
);
