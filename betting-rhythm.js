/* ============================================================
   betting-rhythm.js — Believable action across every street

   THE PROBLEM THIS SOLVES: hand strength was read by making the best
   five-card hand. With fewer than five cards available — every preflop
   street, and stud third through fifth — that returned MARGINAL for
   everyone, and MARGINAL with no bet outstanding means CHECK. So the whole
   table checked until enough cards existed to read, then acted all at once.

   WHAT THIS IS NOT: a poker solver. It reads incomplete hands well enough
   to produce believable dealer situations — bets, calls, raises and folds
   spread across streets. Strategy quality is deliberately basic.

   Personalities are stable per seat so seven players do not behave
   identically, and are derived from the seat index rather than random, so
   a hand replays the same way in tests.

   Works in Node (require) and the browser (window.RailRhythm).
   ============================================================ */
(function(exports, AI){

const RANK_VALUE = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

/* ---------- Personalities ----------
   Derived deterministically from seat index: same seat behaves the same way
   all hand, and tests are repeatable.

   betBias/callBias/foldBias tilt the ordinary decisions. trapBias and
   bluffBias are separate on purpose: "how often do you underplay a monster"
   and "how often do you attack with nothing" are different traits, and
   collapsing them into aggression is what made the old table readable —
   every strong hand raised, every weak hand folded, forever.

   Seat 6 used to be a second copy of 'balanced', so seven seats held six
   behaviours. It is now 'tricky': ordinary on the raw aggression axis but
   the highest trap AND high bluff, so it is the hardest seat to read
   rather than simply the loudest. */
const PERSONALITIES = [
  { id:'tight-passive',    betBias:-1.0, callBias: 0.0, foldBias: 1.2, trapBias:0.8, bluffBias:0.2 },
  { id:'balanced',         betBias: 0.0, callBias: 0.0, foldBias: 0.0, trapBias:1.0, bluffBias:0.8 },
  { id:'loose-passive',    betBias:-1.0, callBias: 1.4, foldBias:-1.0, trapBias:1.3, bluffBias:0.3 },
  { id:'aggressive',       betBias: 1.4, callBias: 0.0, foldBias:-0.2, trapBias:0.5, bluffBias:1.5 },
  { id:'tight-aggressive', betBias: 1.2, callBias:-1.0, foldBias: 1.2, trapBias:0.7, bluffBias:1.0 },
  { id:'loose-aggressive', betBias: 2.0, callBias: 1.0, foldBias:-1.2, trapBias:0.6, bluffBias:1.8 },
  { id:'tricky',           betBias: 1.0, callBias: 0.6, foldBias:-0.3, trapBias:1.7, bluffBias:2.2 }
];
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function personalityFor(seat){
  const i = ((seat % PERSONALITIES.length) + PERSONALITIES.length) % PERSONALITIES.length;
  return PERSONALITIES[i];
}

/* ---------- Early-street hand reading ----------
   Reads an incomplete holding so preflop is not blind. Returns a tier on the
   same scale the AI engine already uses. */
function readIncompleteHigh(cards){
  const c = cards || [];
  if(c.length === 0) return AI.TIER.WEAK;

  const vals = c.map(x => RANK_VALUE[x.rank] || 0).sort((a,b) => b - a);
  const counts = {};
  c.forEach(x => { counts[x.rank] = (counts[x.rank] || 0) + 1; });
  const pairs = Object.keys(counts).filter(k => counts[k] >= 2);
  const trips = Object.keys(counts).filter(k => counts[k] >= 3);
  const suits = {};
  c.forEach(x => { suits[x.suit] = (suits[x.suit] || 0) + 1; });
  const maxSuited = Math.max.apply(null, Object.keys(suits).map(s => suits[s]));

  if(trips.length) return AI.TIER.PREMIUM;
  if(pairs.length){
    const pv = Math.max.apply(null, pairs.map(k => RANK_VALUE[k] || 0));
    if(pv >= 12) return AI.TIER.PREMIUM;      // queens or better
    if(pv >= 9)  return AI.TIER.STRONG;       // nines through jacks
    return AI.TIER.MARGINAL;
  }
  // Unpaired: high cards, suitedness and connectedness carry some weight.
  const high = vals[0] || 0;
  const second = vals[1] || 0;
  const gap = high - second;
  let score = 0;
  if(high >= 13) score += 2;                  // ace or king
  else if(high >= 11) score += 1;
  if(second >= 11) score += 1;
  if(maxSuited >= 3) score += 1;              // three to a suit in a 5-card game
  else if(maxSuited >= 2 && c.length <= 3) score += 1;
  if(gap <= 2 && second >= 9) score += 1;

  if(score >= 4) return AI.TIER.STRONG;
  if(score >= 2) return AI.TIER.MARGINAL;
  return AI.TIER.WEAK;
}

/* Early reading for lowball families — fewer cards, lower is better. */
function readIncompleteLow(cards, aceLow){
  const c = cards || [];
  if(c.length === 0) return AI.TIER.WEAK;
  const val = x => (aceLow !== false && x.rank === 'A') ? 1 : (RANK_VALUE[x.rank] || 0);
  const vals = c.map(val).sort((a,b) => a - b);
  const counts = {};
  c.forEach(x => { counts[x.rank] = (counts[x.rank] || 0) + 1; });
  const paired = Object.keys(counts).some(k => counts[k] >= 2);

  const lowCards = vals.filter(v => v <= 8).length;
  if(paired) return lowCards >= 3 ? AI.TIER.MARGINAL : AI.TIER.WEAK;
  if(lowCards === c.length && c.length >= 3) return AI.TIER.PREMIUM;
  if(lowCards >= c.length - 1) return AI.TIER.STRONG;
  if(lowCards >= 2) return AI.TIER.MARGINAL;
  return AI.TIER.WEAK;
}

/* ---------- Tier for any street ----------
   Uses the full evaluator when five or more cards exist, and the incomplete
   reader otherwise, so no street is blind. */
function tierForStreet(opts){
  const o = opts || {};
  const cards = o.cards || [];
  const board = o.board || [];
  const all = board.length ? cards.concat(board) : cards;
  const family = o.family || 'high';

  // The made-hand evaluator is only meaningful once a hand is essentially
  // complete. A 5-card stud holding on 3rd street is nearly always just
  // high-card, which classified almost every seat WEAK. Use the developing
  // reader until the hand is genuinely near-final.
  /* When the caller knows the real street, that is authoritative and card
     count is not consulted. Super Stud deals five cards on the FIRST street,
     so the count heuristic called 3rd street near-final and read a developing
     hand as a finished one. Card count only stands in when no street is
     supplied. Note the previous street-aware branch returned false
     unconditionally, so supplying a street would have disabled the full
     reader entirely — the branch had no meaning until now. */
  const nearFinal = o.nearFinal !== undefined
    ? o.nearFinal
    : (o.street === undefined
        ? all.length >= 5
        : (streetPhase(o.street, o.totalStreets) === 'late' && all.length >= 5));
  if(nearFinal && all.length >= 5 && typeof o.fullTier === 'function'){
    return o.fullTier();
  }
  // Split-pot games must read BOTH halves. Reading only the high side made a
  // made 8-low score WEAK, which is what folded most of the Super Stud field.
  if(family === 'stud-hilo' || family === 'high-low' || family === 'omaha-hilo'){
    const hi = readIncompleteHigh(cards);
    const lo = readIncompleteLow(cards, true);
    // Live for BOTH halves is genuinely premium, but that is rare. Otherwise
    // take the better half and step it down one, because a hand strong for
    // only one half is contesting only half the pot.
    if(hi >= AI.TIER.PREMIUM && lo >= AI.TIER.STRONG) return AI.TIER.PREMIUM;
    if(hi >= AI.TIER.STRONG && lo >= AI.TIER.PREMIUM) return AI.TIER.PREMIUM;
    const best = Math.max(hi, lo);
    if(hi >= AI.TIER.STRONG && lo >= AI.TIER.STRONG) return AI.TIER.STRONG;
    return best === AI.TIER.PREMIUM ? AI.TIER.STRONG : best;
  }
  if(family === 'low-a5' || family === 'low-27') return readIncompleteLow(cards, family === 'low-a5');
  if(family === 'badugi'){
    const suits = {};
    cards.forEach(c => { suits[c.suit] = (suits[c.suit] || 0) + 1; });
    const distinct = Object.keys(suits).length;
    if(distinct >= 4) return AI.TIER.PREMIUM;
    if(distinct === 3) return AI.TIER.STRONG;
    if(distinct === 2) return AI.TIER.MARGINAL;
    return AI.TIER.WEAK;
  }
  return readIncompleteHigh(cards);
}

/* ---------- Street phase ----------
   Games differ, so phase is derived from progress through the game's own
   streets rather than forced into Hold'em terminology. */
function streetPhase(step, totalSteps){
  if(!totalSteps || totalSteps <= 1) return 'early';
  const p = step / (totalSteps - 1);
  if(p <= 0.34) return 'early';
  if(p <= 0.67) return 'middle';
  return 'late';
}

/* ---------- Price ----------
   Pot odds, expressed as the share of the resulting pot a call would cost.
   Calling $20 into $200 is cheap (0.09); calling $80 into $40 is dear (0.67).
   This is arithmetic on money that already exists — not new poker math. */
function callPrice(toCall, potSize){
  const c = Math.max(0, toCall || 0);
  const p = Math.max(0, potSize || 0);
  if(c === 0) return 0;
  return c / (p + c);
}
function priceBand(price){
  if(price <= 0) return 'free';
  if(price <= 0.15) return 'cheap';
  if(price <= 0.30) return 'fair';
  if(price <= 0.45) return 'steep';
  return 'terrible';
}

/* How committed a seat already is. Money in the pot makes folding harder,
   which is how real players behave. */
function commitment(invested, stack){
  const inv = Math.max(0, invested || 0);
  const st = Math.max(1, (stack || 0) + inv);
  return inv / st;
}

/* Whether a hand is worth continuing for a given price. Returns a
   -2..+2 adjustment used by the shaper, never a decision on its own. */
function priceAdjust(tier, price, opts){
  const o = opts || {};
  let adj = 0;
  const band = priceBand(price);
  if(band === 'free') adj += 2;
  else if(band === 'cheap') adj += 1;
  else if(band === 'steep') adj -= 1;
  else if(band === 'terrible') adj -= 2;

  // Already invested: harder to release.
  if(o.commitment >= 0.25) adj += 1;
  // Multiway pots offer better odds, so more hands continue. Graded rather
  // than a single step at four: three-handed and six-handed used to be
  // indistinguishable, which made field size invisible in the action.
  const pl = o.playersLeft === undefined ? 3 : o.playersLeft;
  if(pl >= 5) adj += 1.5;
  else if(pl === 4) adj += 1;
  else if(pl === 3) adj += 0.3;
  else if(pl <= 2) adj -= 1;
  return adj;
}

/* How much appetite is left for yet another raise on this street. Legality is
   never touched — the fixed-limit cap and its heads-up exemption are the
   engine's business. This is only willingness. A real player who has already
   four-bet does not keep firing at a constant rate, but the old model did:
   P(raise) measured 10.0% after zero raises and 11.2% after twenty, which is
   what produced 40-raise heads-up wars until the stacks vanished. */
function escalationDamping(raisesSoFar){
  const n = Math.max(0, (raisesSoFar || 0) - 2);
  return Math.pow(0.55, n);
}

/* ---------- Action shaping ----------
   Nudges the engine's decision by personality and street, WITHOUT ever
   returning an action the round says is illegal. Deterministic rng is
   injectable so tests never flake. */
function shapeAction(baseAction, ctx){
  const c = ctx || {};
  const p = c.personality || personalityFor(c.seat || 0);
  const legal = c.legal || [];
  const rng = typeof c.rng === 'function' ? c.rng : Math.random;
  const phase = c.phase || 'middle';
  const tier = c.tier === undefined ? AI.TIER.MARGINAL : c.tier;

  const allow = a => legal.indexOf(a) !== -1;
  const price = callPrice(c.toCall, c.potSize);
  const adj = priceAdjust(tier, price, {
    commitment: commitment(c.invested, c.stack),
    playersLeft: c.playersLeft === undefined ? 3 : c.playersLeft
  });
  let action = baseAction;
  const escalate = escalationDamping(c.raisesSoFar);

  /* ---- Premium is no longer a script ----
     ai-players.decideAction returns RAISE (facing a bet) or BET (open) for
     every premium hand, and nothing downstream ever reconsidered it: measured
     100% raise / 0% call / 0% check. A monster that always raises is the most
     readable seat at the table. Trapping is the correction, and trapBias
     decides who does it. Folding a premium hand is still not on the menu. */
  if(tier >= AI.TIER.PREMIUM && action === AI.ACTION.RAISE && allow(AI.ACTION.CALL)){
    let trap = 0.22 * p.trapBias;
    if(c.playersLeft >= 4) trap -= 0.06;   // less inclined to trap a big field
    if(phase === 'late') trap += 0.05;
    if(price > 0.45) trap += 0.08;         // very dear: sometimes just call it off
    trap += (1 - escalate) * 0.45;         // stop re-raising a war forever
    if(rng() < clamp(trap, 0.05, 0.85)) action = AI.ACTION.CALL;
  }
  else if(tier >= AI.TIER.PREMIUM && action === AI.ACTION.BET && allow(AI.ACTION.CHECK)){
    let trap = 0.14 * p.trapBias;
    if(phase === 'early') trap += 0.04;
    if(c.playersLeft <= 2) trap += 0.05;   // easier to check-raise heads-up
    if(rng() < clamp(trap, 0.03, 0.35)) action = AI.ACTION.CHECK;
  }

  // A marginal hand that would simply check sometimes bets instead — this is
  // what breaks the check-around without changing strong-hand behavior.
  else if(action === AI.ACTION.CHECK && allow(AI.ACTION.BET)){
    let chance;
    if(tier === AI.TIER.WEAK){
      // A pure bluff. Driven by bluffBias, not raw aggression, so a passive
      // seat almost never does it and a tricky seat regularly does.
      chance = 0.07 * p.bluffBias;
      if(phase === 'late') chance += 0.03;
      if(c.playersLeft <= 2) chance += 0.04;
      else if(c.playersLeft >= 4) chance -= 0.02;
    } else {
      chance = 0.16 + p.betBias * 0.07;
      if(phase === 'early') chance += 0.08;    // action early, where it was absent
      if(tier >= AI.TIER.STRONG) chance += 0.18;
    }
    if(rng() < Math.max(0, Math.min(0.55, chance))) action = AI.ACTION.BET;
  }

  // A calling hand occasionally raises, so action reopens before the river.
  // A CALL is re-examined in ONE place, in the order a real player thinks:
  // is the price wrong (fold), is the hand worth attacking (raise), or do I
  // just call? These were separate else-if branches, so the raise branch
  // consumed every CALL and price never reached the fold logic at all.
  else if(action === AI.ACTION.CALL){
    let resolved = AI.ACTION.CALL;

    if(allow(AI.ACTION.FOLD) && tier === AI.TIER.WEAK){
      let fold = 0.55 + p.foldBias * 0.15 - adj * 0.10;
      if(rng() < Math.max(0.10, Math.min(0.92, fold))) resolved = AI.ACTION.FOLD;
    } else if(allow(AI.ACTION.FOLD) && tier > AI.TIER.WEAK && tier < AI.TIER.PREMIUM){
      let fold = 0.06;
      if(price > 0.45) fold = 0.55;
      else if(price > 0.30) fold = 0.34;
      else if(price > 0.15) fold = 0.16;
      if(tier === AI.TIER.STRONG) fold *= 0.45;
      // Personality tilts the decision without making it deterministic —
      // a tight player still calls sometimes, a sticky player still folds.
      fold += p.foldBias * 0.16;
      fold -= p.callBias * 0.16;
      // Chips already committed and a bigger field both make releasing
      // harder. priceAdjust carries both, and this branch never consulted
      // it — prior investment measured as having NO effect on folding.
      // Kept small so sunk cost tilts the decision without excusing any call.
      fold -= adj * 0.05;
      fold -= clamp(commitment(c.invested, c.stack), 0, 0.6) * 0.22;
      fold = Math.max(0.08, Math.min(0.85, fold));
      if(phase === 'late') fold += 0.06;
      if(rng() < Math.max(0, Math.min(0.7, fold))) resolved = AI.ACTION.FOLD;
    }

    if(resolved === AI.ACTION.CALL && allow(AI.ACTION.RAISE)){
      let chance = 0.05 + p.betBias * 0.05;
      if(tier >= AI.TIER.PREMIUM) chance += 0.14;
      else if(tier >= AI.TIER.STRONG) chance += 0.07;
      if(phase === 'late') chance += 0.03;
      if(price > 0.30) chance -= 0.04;
      chance *= escalate;                  // appetite fades as the war drags on
      if(rng() < Math.max(0, Math.min(0.32, chance))) resolved = AI.ACTION.RAISE;
    }
    action = resolved;
  }

  // An engine FOLD may be reconsidered when the price is genuinely good.
  else if(action === AI.ACTION.FOLD && allow(AI.ACTION.CALL)){
    let chance = 0.04;
    if(tier === AI.TIER.MARGINAL) chance = 0.20;
    else if(tier === AI.TIER.STRONG) chance = 0.38;
    else if(tier === AI.TIER.PREMIUM) chance = 0.58;
    chance += adj * 0.07;
    chance += p.callBias * 0.14;
    chance -= p.foldBias * 0.14;
    if(phase === 'early') chance += 0.06;
    if(phase === 'late') chance -= 0.08;
    if(rng() < Math.max(0, Math.min(0.85, chance))) action = AI.ACTION.CALL;

    /* Semi-bluff. A hand with nothing occasionally attacks instead of giving
       up, which is the only reason anyone at this table ever has to doubt a
       raise. Measured WEAK raise rate was exactly 0.0%, so every raise was a
       real hand and the whole table was readable. Deliberately small, and
       scaled by bluffBias so passive seats stay honest. */
    if(action === AI.ACTION.FOLD && allow(AI.ACTION.RAISE) && tier <= AI.TIER.MARGINAL){
      let bluff = 0.018 * p.bluffBias;
      if(phase === 'late') bluff += 0.008;
      if(c.playersLeft <= 2) bluff += 0.015;      // easier heads-up
      else if(c.playersLeft >= 4) bluff -= 0.006; // rarely into a big field
      if(price > 0.45) bluff *= 0.5;
      bluff *= escalate;
      if(rng() < clamp(bluff, 0, 0.08)) action = AI.ACTION.RAISE;
    }
  }

  // Legality is absolute: never return something the round rejects.
  return allow(action) ? action : baseAction;
}

/* Timing varies by action so the table has rhythm without long pauses. */
function actionDelay(action, baseDelay){
  const b = baseDelay || 450;
  switch(action){
    case AI.ACTION.CHECK: return Math.round(b * 0.7);
    case AI.ACTION.CALL:  return b;
    case AI.ACTION.BET:   return Math.round(b * 1.2);
    case AI.ACTION.RAISE: return Math.round(b * 1.35);
    case AI.ACTION.FOLD:  return Math.round(b * 0.85);
    default: return b;
  }
}

/* A tiny seeded generator so distribution tests are repeatable. */
function seededRng(seed){
  // Mix the seed before use. A raw LCG's FIRST output barely changes between
  // sequential seeds (0.236, 0.237, 0.238...), so callers creating a fresh
  // generator per decision got near-identical values and behavior looked
  // deterministic when it was not meant to be.
  let s = (seed || 1) >>> 0;
  s = (s ^ 0x9E3779B9) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x85EBCA6B) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 0xC2B2AE35) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0;
  return function(){
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

exports.callPrice = callPrice;
exports.priceBand = priceBand;
exports.commitment = commitment;
exports.priceAdjust = priceAdjust;
exports.PERSONALITIES = PERSONALITIES;
exports.personalityFor = personalityFor;
exports.readIncompleteHigh = readIncompleteHigh;
exports.readIncompleteLow = readIncompleteLow;
exports.tierForStreet = tierForStreet;
exports.streetPhase = streetPhase;
exports.shapeAction = shapeAction;
exports.actionDelay = actionDelay;
exports.seededRng = seededRng;

})(
  typeof module !== 'undefined' ? module.exports : (window.RailRhythm = window.RailRhythm || {}),
  typeof module !== 'undefined' ? require('./ai-players.js') : window.RailAI
);
