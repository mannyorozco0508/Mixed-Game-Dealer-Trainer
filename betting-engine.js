/* ============================================================
   betting-engine.js — Chip and pot math for The Rail
   Pure functions, no DOM dependencies — safe to unit test with plain node.
   Works in both Node (require) and the browser (window.RailBetting).
   ============================================================ */
(function(exports){

/* ---------- Pot-Limit max raise ----------
   "The maximum raise = the size of the pot AFTER the acting player calls."
   potBeforeAction = everything already in the pot (previous streets + bets this round so far)
   amountToCall    = what the acting player must put in just to call
   Returns the maximum ADDITIONAL raise on top of the call (not the total wager). */
function potLimitMaxRaise(potBeforeAction, amountToCall){
  return potBeforeAction + amountToCall;
  // "Pot for raise" = everything currently on the table (incl. the bet being faced) + the call
  // this player still owes. That sum IS the size of the pot after they call — which is the max raise.
}
function potLimitMaxTotalWager(potBeforeAction, amountToCall){
  return amountToCall + potLimitMaxRaise(potBeforeAction, amountToCall);
  // = potBeforeAction + (2 * amountToCall)
}

/* ---------- Fixed-Limit betting round ----------
   Standard cardroom rule: a bet plus a maximum of 3 raises per round (4 total bets), unless heads-up. */
function makeFixedLimitRound({ betSize, headsUp }){
  return {
    betSize,
    betsThisRound: 0,
    maxBets: headsUp ? Infinity : 4,
    canRaise(){ return this.betsThisRound < this.maxBets; },
    registerBet(){ this.betsThisRound += 1; }
  };
}

/* ---------- Side pots ----------
   contributions: [{ playerId, total, folded }]
   `total` = everything that player has put into the pot this hand (all streets combined).
   `folded` players' chips stay in whichever pot they contributed to, but they're not
   eligible to WIN any pot.
   Returns: [{ amount, eligiblePlayerIds: [...] }, ...] main pot first, then side pots in order. */
function buildSidePots(contributions){
  const active = contributions.filter(c => c.total > 0);
  if(active.length === 0) return [];

  const levels = [...new Set(active.map(c => c.total))].sort((a,b) => a - b);
  const pots = [];
  let priorLevel = 0;

  levels.forEach(level => {
    const layerHeight = level - priorLevel;
    if(layerHeight <= 0){ priorLevel = level; return; }
    // Everyone who contributed AT LEAST this level pays into this layer.
    const payers = active.filter(c => c.total >= level);
    const amount = layerHeight * payers.length;
    // Only NON-FOLDED players who are in this deep are eligible to win this layer.
    const eligiblePlayerIds = payers.filter(c => !c.folded).map(c => c.playerId);
    if(amount > 0){
      pots.push({ amount, eligiblePlayerIds });
    }
    priorLevel = level;
  });

  return pots;
}

/* ---------- Hi-Lo pot split with odd-chip handling ----------
   pot: { amount, eligiblePlayerIds }
   highWinners: array of playerIds tied for best high among eligiblePlayerIds
   lowWinners: array of playerIds tied for best qualifying low among eligiblePlayerIds (or [] if no qualifier)
   oddChipTo: 'high' (TDA default for a hi-lo split of the total pot) or a specific playerId for tie-breaks.
   Returns: { [playerId]: amountWon } */
function splitPotHiLo(pot, highWinners, lowWinners, oddChipRule){
  oddChipRule = oddChipRule || 'high';
  const result = {};
  const addTo = (id, amt) => { result[id] = (result[id] || 0) + amt; };

  if(lowWinners.length === 0){
    // No qualifying low — high scoops the entire pot.
    distributeEven(pot.amount, highWinners, addTo, oddChipRule === 'high' ? 'first' : oddChipRule);
    return result;
  }

  const half = Math.floor(pot.amount / 2);
  const remainder = pot.amount - half * 2; // 0 or 1 (odd chip)

  distributeEven(half, highWinners, addTo, 'first');
  distributeEven(half, lowWinners, addTo, 'first');

  if(remainder > 0){
    // TDA default: odd chip from splitting the total pot goes to the HIGH side.
    const target = oddChipRule === 'low' ? lowWinners[0] : highWinners[0];
    addTo(target, remainder);
  }
  return result;
}
function distributeEven(amount, winnerIds, addTo, oddChipStrategy){
  if(winnerIds.length === 0) return;
  const share = Math.floor(amount / winnerIds.length);
  const remainder = amount - share * winnerIds.length;
  winnerIds.forEach(id => addTo(id, share));
  if(remainder > 0){
    // 'first' = first seat gets the odd chip (simplification of "first left of button" rule,
    // caller should pre-sort winnerIds by seat order relative to the button for exact TDA compliance).
    addTo(winnerIds[0], remainder);
  }
}

exports.potLimitMaxRaise = potLimitMaxRaise;
exports.potLimitMaxTotalWager = potLimitMaxTotalWager;
exports.makeFixedLimitRound = makeFixedLimitRound;
exports.buildSidePots = buildSidePots;
exports.splitPotHiLo = splitPotHiLo;
exports.distributeEven = distributeEven;
})(typeof module !== 'undefined' ? module.exports : (window.RailBetting = window.RailBetting || {}));
