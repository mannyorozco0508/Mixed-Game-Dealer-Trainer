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
// Ace-high rank value, from the validated evaluator rather than a second table.
const rankValue = c => E.rankValue(c.rank);
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

/* Lowball keep-selection.

   BUG THIS FIXES: drawGuidanceA5 and drawGuidance27 delegated to
   bestLowA5FromN / bestLow27FromN, which choose the best FIVE cards out of N.
   Handed a five-card draw hand there is exactly one combination, so they
   returned "keep all five" for every hand ever dealt — a paired 2-2-K-Q-J and
   a made 6-low were treated identically, and the AI stood pat 100% of the
   time. Those evaluators are correct for what they were written for (picking
   five out of seven at showdown); they simply cannot express a draw.

   The draw question is different: which cards are worth keeping AT ALL.
   Keep one card per rank — a pair is never useful in a lowball draw — taking
   the lowest first, and only those at or below the playable ceiling. If
   nothing qualifies, keep the single best card and draw the rest rather than
   throwing the whole hand away.

   valueOf decides what "low" means, so the ace is the best card in A-5 and
   the worst in 2-7 without either rule leaking into the other. */
function keepLowDraw(cards, valueOf, ceiling, handSize){
  const sorted = (cards || []).slice().sort((a, b) => valueOf(a) - valueOf(b));
  const keep = [], seenRank = {};
  sorted.forEach(c => {
    if(keep.length >= handSize) return;
    if(seenRank[c.rank]) return;              // never keep a pair
    if(valueOf(c) > ceiling) return;          // too high to build a low around
    seenRank[c.rank] = true;
    keep.push(c);
  });
  if(keep.length === 0 && sorted.length) keep.push(sorted[0]);
  return keep;
}
/* A 2-7 hand that is five distinct low cards can still be a straight or a
   flush, both of which are disasters in that game. Break the top card. */
function break27StraightOrFlush(keep){
  if(keep.length < 5) return keep;
  const vals = keep.map(c => rankValue(c)).sort((a, b) => a - b);
  const flush = keep.every(c => c.suit === keep[0].suit);
  const straight = vals.every((v, i) => i === 0 || v === vals[i-1] + 1);
  if(!flush && !straight) return keep;
  let highest = keep[0];
  keep.forEach(c => { if(rankValue(c) > rankValue(highest)) highest = c; });
  return keep.filter(c => c !== highest);
}

function drawGuidanceBadugi(cards, rankFn){
  const best = E.bestBadugi(cards, rankFn);
  return { keep: best.cards, discardCount: cards.length - best.cards.length, tier: classifyBadugi(best) };
}
function drawGuidanceA5(cards){
  const hand = cards || [];
  // Ace plays low. Eight-or-better is the playable ceiling in every A-5 game
  // this room spreads.
  const keep = keepLowDraw(hand, c => E.rankValueAceLow(c.rank), 8, 5);
  return { keep, discardCount: hand.length - keep.length,
           tier: classifyA5Low(E.bestLowA5FromN(hand.length >= 5 ? hand : hand).score) };
}
function drawGuidance27(cards){
  const hand = cards || [];
  // Ace is the WORST card here, and straights and flushes count against you.
  const keep = break27StraightOrFlush(keepLowDraw(hand, rankValue, 8, 5));
  return { keep, discardCount: hand.length - keep.length,
           tier: classify27Low(E.bestLow27FromN(hand).score) };
}
/* High draw hand (Drawmaha Hi, and the high half of Archie). Keep whatever is
   already working — pairs, trips, four to a flush, four to a straight — and
   throw the rest. */
function drawGuidanceHigh(cards){
  const hand = (cards || []).slice();
  if(!hand.length) return { keep: [], discardCount: 0, tier: TIER.WEAK };
  const byRank = {}, bySuit = {};
  hand.forEach(c => {
    (byRank[c.rank] = byRank[c.rank] || []).push(c);
    (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  });
  const groups = Object.keys(byRank).filter(r => byRank[r].length >= 2);
  const flushSuit = Object.keys(bySuit).find(s => bySuit[s].length >= 4);

  let keep;
  if(flushSuit && !groups.length){
    keep = bySuit[flushSuit].slice(0, 5);                 // four or five to a flush
  } else if(groups.length){
    keep = [];
    groups.forEach(r => byRank[r].forEach(c => keep.push(c)));   // pairs/trips/two pair
    if(keep.length < 3){
      // A lone pair keeps one high kicker, the way a draw player would.
      const rest = hand.filter(c => keep.indexOf(c) === -1)
        .sort((a, b) => rankValue(b) - rankValue(a));
      if(rest.length) keep.push(rest[0]);
    }
  } else {
    // Nothing made: keep the high cards and draw.
    keep = hand.slice().sort((a, b) => rankValue(b) - rankValue(a)).slice(0, 2);
  }
  return { keep, discardCount: hand.length - keep.length,
           tier: classifyHigh(E.bestHighFromN(hand.length >= 5 ? hand : hand).score) };
}
/* Drawmaha 49: the draw hand is scored by point count, aiming AT 49 across
   the combined hand. Face cards are worth nothing, so they are exactly what
   you throw; tens and aces are the extremes. */
function drawGuidance49(cards){
  const hand = (cards || []).slice();
  const pts = c => (c.rank === 'A' ? 1 : (['J','Q','K'].indexOf(c.rank) !== -1 ? 0
                   : (c.rank === 'T' ? 10 : parseInt(c.rank, 10))));
  const keep = hand.filter(c => pts(c) >= 7);            // 7,8,9,T carry the count
  if(!keep.length){
    const best = hand.slice().sort((a, b) => pts(b) - pts(a));
    if(best.length) keep.push(best[0]);
  }
  return { keep, discardCount: hand.length - keep.length, tier: TIER.MARGINAL };
}
/* Split-pot draw games (Badacey = badugi + A-5, Baducey = badugi + 2-7,
   Archie = qualifying high + 8-or-better low). Both halves are evaluated and
   the side the hand is CLOSER TO is played, rather than one half being
   optimised while the other is ignored. This is deliberately modest: it is a
   real consideration of both components, not full split-pot optimisation. */
function drawGuidanceSplit(cards, a, b){
  const ga = a(cards), gb = b(cards);
  const keepA = (ga && ga.keep) ? ga.keep.length : 0;
  const keepB = (gb && gb.keep) ? gb.keep.length : 0;
  const chosen = keepA >= keepB ? ga : gb;
  return { keep: chosen.keep, discardCount: cards.length - chosen.keep.length,
           tier: chosen.tier, sides: { a: keepA, b: keepB } };
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
exports.drawGuidanceHigh = drawGuidanceHigh;
exports.drawGuidance49 = drawGuidance49;
exports.drawGuidanceSplit = drawGuidanceSplit;
exports.keepLowDraw = keepLowDraw;
})(
  typeof module !== 'undefined' ? module.exports : (window.RailAI = window.RailAI || {}),
  typeof module !== 'undefined' ? require('./cards-eval.js') : window.RailCards
);
