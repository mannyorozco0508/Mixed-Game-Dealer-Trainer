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
   all hand, and tests are repeatable. */
const PERSONALITIES = [
  { id:'tight-passive',    betBias:-1, callBias: 0, foldBias: 1 },
  { id:'balanced',         betBias: 0, callBias: 0, foldBias: 0 },
  { id:'loose-passive',    betBias:-1, callBias: 1, foldBias:-1 },
  { id:'aggressive',       betBias: 1, callBias: 0, foldBias: 0 },
  { id:'tight-aggressive', betBias: 1, callBias:-1, foldBias: 1 },
  { id:'loose-aggressive', betBias: 2, callBias: 1, foldBias:-1 },
  { id:'balanced',         betBias: 0, callBias: 0, foldBias: 0 }
];
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

  if(all.length >= 5 && typeof o.fullTier === 'function'){
    return o.fullTier();
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
  let action = baseAction;

  // A marginal hand that would simply check sometimes bets instead — this is
  // what breaks the check-around without changing strong-hand behavior.
  if(action === AI.ACTION.CHECK && allow(AI.ACTION.BET)){
    let chance = 0.18 + p.betBias * 0.12;
    if(phase === 'early') chance += 0.10;      // more action early, where it was absent
    if(tier >= AI.TIER.STRONG) chance += 0.25;
    if(tier === AI.TIER.WEAK) chance -= 0.10;
    if(rng() < Math.max(0, Math.min(0.75, chance))) action = AI.ACTION.BET;
  }

  // A calling hand occasionally raises, so action reopens before the river.
  else if(action === AI.ACTION.CALL && allow(AI.ACTION.RAISE)){
    let chance = 0.12 + p.betBias * 0.10;
    if(tier >= AI.TIER.STRONG) chance += 0.20;
    if(phase === 'late') chance += 0.05;
    if(rng() < Math.max(0, Math.min(0.6, chance))) action = AI.ACTION.RAISE;
  }

  // A weak hand facing a bet folds more readily when tight, so pots narrow
  // before showdown instead of everyone limping to the end.
  else if(action === AI.ACTION.CALL && tier === AI.TIER.WEAK && allow(AI.ACTION.FOLD)){
    const chance = 0.35 + p.foldBias * 0.15;
    if(rng() < Math.max(0, Math.min(0.85, chance))) action = AI.ACTION.FOLD;
  }

  // A loose personality calls some hands it would otherwise fold.
  else if(action === AI.ACTION.FOLD && allow(AI.ACTION.CALL) && p.callBias > 0){
    const chance = 0.20 * p.callBias;
    if(tier >= AI.TIER.MARGINAL && rng() < chance) action = AI.ACTION.CALL;
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
  let s = (seed || 1) >>> 0;
  return function(){
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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
