/* ============================================================
   ai-players.js — Opponent decision logic for The Rail
   Built on cards-eval.js. Pure functions — no DOM dependencies.
   Works in both Node (require) and the browser (window.RailAI).

   Design: every ranking system gets a classifyX() function that turns a
   raw evaluator score into a tier (0=WEAK 1=MARGINAL 2=STRONG 3=PREMIUM).
   Thresholds are calibrated directly against the strategy research
   (e.g. "any 7 almost always wins" in 2-7 -> highest card <=7 = PREMIUM).
   A single decideAction() policy then converts tier + context into a move,
   so every game family shares one well-tested decision core.
   ============================================================ */
(function(exports, E){

const TIER = { WEAK: 0, MARGINAL: 1, STRONG: 2, PREMIUM: 3 };
const ACTION = { FOLD: 'fold', CHECK: 'check', CALL: 'call', BET: 'bet', RAISE: 'raise' };

/* ---------- Tier classifiers ---------- */

// 2-7 Low: uses the standard-high score (inverted), since 2-7 = inverse of high ranking.
// Research: "any 7 almost always wins; 8-lows usually win; 9-lows are situational; 10-low+ presses your luck."
function classify27Low(score){
  if(score[0] !== 0) return TIER.WEAK; // any pair, straight, or flush is bad for 2-7
  const high = score[1];
  if(high <= 7) return TIER.PREMIUM;
  if(high === 8) return TIER.STRONG;
  if(high === 9) return TIER.MARGINAL;
  return TIER.WEAK;
}

// A-5 Low: Research: "pat 7-lows or better" = premium, "smooth 8-lows" = strong.
function classifyA5Low(score){
  if(score[0] !== 0) return TIER.WEAK; // any pair is bad for A-5
  const high = score[score.length - 1]; // ascending array, last = highest card
  if(high <= 7) return TIER.PREMIUM;
  if(high === 8) return TIER.STRONG;
  if(high <= 10) return TIER.MARGINAL;
  return TIER.WEAK;
}

// Standard high (Hold'em/Omaha/Stud). Category-based, generic tiering.
function classifyHigh(score){
  const cat = score[0];
  if(cat >= 6) return TIER.PREMIUM;       // full house or better
  if(cat >= 3) return TIER.STRONG;        // trips, straight, flush
  if(cat === 2) return TIER.MARGINAL;     // two pair
  if(cat === 1) return score[1] >= 10 ? TIER.MARGINAL : TIER.WEAK; // big pair vs small pair
  return TIER.WEAK;                       // high card only
}

// Badugi. Research: raise pat 8-highs or better; fold/break king-highs; value 3-card draws under 8.
function classifyBadugi(result){
  if(result.size === 4){
    const high = result.tiebreak[0]; // descending, first = highest card
    if(high <= 8) return TIER.PREMIUM;
    if(high <= 12) return TIER.STRONG; // up through Q-high
    return TIER.MARGINAL; // K-high pat, often correct to break instead of value-betting
  }
  if(result.size === 3){
    const high = result.tiebreak[0];
    return high <= 8 ? TIER.MARGINAL : TIER.WEAK; // strong 3-card draw vs weak one
  }
  return TIER.WEAK;
}

// Omaha Hi-Lo two-way value: combine the high tier and whether a low qualifies into one score,
// since split games should be judged on scoop potential, not either half alone.
// Research: "the biggest recurring leak is playing one-way hands."
function classifyOmahaHiLo(highScore, lowScore){
  const highTier = classifyHigh(highScore);
  const lowQualifies = lowScore && E.qualifiesEightLow(lowScore);
  const lowTier = lowQualifies ? classifyA5Low(lowScore) : TIER.WEAK;

  if(highTier >= TIER.STRONG && lowTier >= TIER.STRONG) return TIER.PREMIUM; // two-way scoop threat
  if(highTier >= TIER.PREMIUM || lowTier >= TIER.PREMIUM) return TIER.STRONG; // strong one way, at least live the other
  if(highTier >= TIER.MARGINAL || lowTier >= TIER.MARGINAL) return TIER.MARGINAL;
  return TIER.WEAK;
}

/* ---------- Decision policy ----------
   context: { tier, facingBet(bool), facingRaise(bool), street('early'|'late'),
              canCheck(bool), potOdds(0-1, optional) }
   Returns one of ACTION.* */
function decideAction(context){
  const { tier, facingBet, facingRaise, canCheck } = context;

  if(tier === TIER.PREMIUM){
    return facingBet ? ACTION.RAISE : ACTION.BET;
  }
  if(tier === TIER.STRONG){
    if(facingRaise) return ACTION.CALL;
    return facingBet ? ACTION.CALL : ACTION.BET;
  }
  if(tier === TIER.MARGINAL){
    if(facingRaise) return canCheck ? ACTION.CHECK : ACTION.FOLD;
    if(facingBet) return ACTION.CALL;
    return canCheck ? ACTION.CHECK : ACTION.CALL;
  }
  // WEAK
  if(facingBet) return ACTION.FOLD;
  return canCheck ? ACTION.CHECK : ACTION.FOLD;
}

/* ---------- Draw guidance ----------
   Given a hand and a target evaluator, returns which cards to KEEP (the rest get discarded). */
function drawGuidanceBadugi(cards, rankFn){
  const best = E.bestBadugi(cards, rankFn);
  return { keep: best.cards, discardCount: cards.length - best.cards.length, tier: classifyBadugi(best) };
}
function drawGuidanceA5(cards){
  const best = E.bestLowA5FromN(cards);
  return { keep: best.cards, discardCount: cards.length - best.cards.length, tier: classifyA5Low(best.score) };
}
function drawGuidance27(cards){
  const best = E.bestLow27FromN(cards);
  return { keep: best.cards, discardCount: cards.length - best.cards.length, tier: classify27Low(best.score) };
}

exports.TIER = TIER;
exports.ACTION = ACTION;
exports.classify27Low = classify27Low;
exports.classifyA5Low = classifyA5Low;
exports.classifyHigh = classifyHigh;
exports.classifyBadugi = classifyBadugi;
exports.classifyOmahaHiLo = classifyOmahaHiLo;
exports.decideAction = decideAction;
exports.drawGuidanceBadugi = drawGuidanceBadugi;
exports.drawGuidanceA5 = drawGuidanceA5;
exports.drawGuidance27 = drawGuidance27;
})(
  typeof module !== 'undefined' ? module.exports : (window.RailAI = window.RailAI || {}),
  typeof module !== 'undefined' ? require('./cards-eval.js') : window.RailCards
);
