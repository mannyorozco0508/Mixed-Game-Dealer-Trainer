/* ============================================================
   cards-eval.js — Hand evaluation library for The Rail
   Card format: { rank: 'A'|'2'..'9'|'T'|'J'|'Q'|'K', suit: 'S'|'H'|'D'|'C' }
   No DOM dependencies — pure functions, safe to unit test with plain node.
   Works in both Node (require) and the browser (window.RailCards).
   ============================================================ */
(function(exports){

const RANK_ORDER_HIGH = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['S','H','D','C'];

function rankValue(rank){
  const idx = RANK_ORDER_HIGH.indexOf(rank);
  if(idx === -1) throw new Error('Unknown rank: ' + rank);
  return idx + 2; // 2..14, Ace = 14 (high)
}
function rankValueAceLow(rank){
  return rank === 'A' ? 1 : rankValue(rank); // Ace = 1, everything else same 2..13
}

function freshDeck(){
  const d = [];
  RANK_ORDER_HIGH.forEach(r => SUITS.forEach(s => d.push({ rank:r, suit:s })));
  for(let i = d.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function combinations(arr, k){
  const result = [];
  function helper(start, combo){
    if(combo.length === k){ result.push(combo.slice()); return; }
    for(let i = start; i < arr.length; i++){
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

/* ---------- Standard 5-card HIGH evaluation ----------
   Returns a comparable score array: [category, tiebreak...]
   category: 8=straight flush 7=quads 6=full house 5=flush 4=straight
             3=trips 2=two pair 1=one pair 0=high card
   Higher score array = better hand (lexicographic compare). */
function evaluate5High(cards){
  const ranks = cards.map(c => rankValue(c.rank)).sort((a,b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
  const groups = Object.entries(counts).map(([r,c]) => ({ rank:+r, count:c }))
    .sort((a,b) => b.count - a.count || b.rank - a.rank);

  const uniqueDesc = [...new Set(ranks)];
  let isStraight = false, straightHigh = 0;
  if(uniqueDesc.length === 5){
    if(uniqueDesc[0] - uniqueDesc[4] === 4){
      isStraight = true; straightHigh = uniqueDesc[0];
    } else if(uniqueDesc[0] === 14 && uniqueDesc[1] === 5 && uniqueDesc[2] === 4 && uniqueDesc[3] === 3 && uniqueDesc[4] === 2){
      isStraight = true; straightHigh = 5; // wheel plays as 5-high straight
    }
  }

  if(isStraight && isFlush) return [8, straightHigh];
  if(groups[0].count === 4) return [7, groups[0].rank, groups[1].rank];
  if(groups[0].count === 3 && groups[1] && groups[1].count === 2) return [6, groups[0].rank, groups[1].rank];
  if(isFlush) return [5, ...ranks];
  if(isStraight) return [4, straightHigh];
  if(groups[0].count === 3) return [3, groups[0].rank, ...groups.slice(1).map(g => g.rank)];
  if(groups[0].count === 2 && groups[1] && groups[1].count === 2){
    const pairRanks = [groups[0].rank, groups[1].rank].sort((a,b) => b - a);
    return [2, ...pairRanks, groups[2].rank];
  }
  if(groups[0].count === 2) return [1, groups[0].rank, ...groups.slice(1).map(g => g.rank)];
  return [0, ...ranks];
}

function compareArrays(a, b){ // positive = a better/higher
  const len = Math.max(a.length, b.length);
  for(let i = 0; i < len; i++){
    const av = a[i] === undefined ? -1 : a[i];
    const bv = b[i] === undefined ? -1 : b[i];
    if(av !== bv) return av - bv;
  }
  return 0;
}

/* Best 5-card HIGH hand from any N cards (Stud, Hold'em: best-5-of-however-many). */
function bestHighFromN(cards){
  let best = null, bestScore = null;
  combinations(cards, 5).forEach(combo => {
    const score = evaluate5High(combo);
    if(!bestScore || compareArrays(score, bestScore) > 0){ bestScore = score; best = combo; }
  });
  return { cards: best, score: bestScore };
}

/* Best Omaha HIGH: exactly 2 from hole + exactly 3 from board. */
function bestOmahaHigh(holeCards, boardCards){
  let best = null, bestScore = null;
  combinations(holeCards, 2).forEach(h => {
    combinations(boardCards, 3).forEach(b => {
      const combo = [...h, ...b];
      const score = evaluate5High(combo);
      if(!bestScore || compareArrays(score, bestScore) > 0){ bestScore = score; best = combo; }
    });
  });
  return { cards: best, score: bestScore };
}

/* Worst-of-N (minimum evaluate5High score) — used as the building block for 2-7 low,
   since 2-7 low ranking is exactly the INVERSE of standard high ranking. */
function worstHighFromN(cards){
  let worst = null, worstScore = null;
  combinations(cards, 5).forEach(combo => {
    const score = evaluate5High(combo);
    if(!worstScore || compareArrays(score, worstScore) < 0){ worstScore = score; worst = combo; }
  });
  return { cards: worst, score: worstScore };
}
function worstOmahaHigh(holeCards, boardCards){
  let worst = null, worstScore = null;
  combinations(holeCards, 2).forEach(h => {
    combinations(boardCards, 3).forEach(b => {
      const combo = [...h, ...b];
      const score = evaluate5High(combo);
      if(!worstScore || compareArrays(score, worstScore) < 0){ worstScore = score; worst = combo; }
    });
  });
  return { cards: worst, score: worstScore };
}

/* ---------- A-5 LOW (ace low, straights/flushes irrelevant) ----------
   Returns [tier, ...tiebreak] where LOWER is BETTER.
   tier: 0=5 distinct ranks(no pair) 1=pair 2=two pair 3=trips 4=full house 5=quads */
function evaluate5LowA5(cards){
  const ranks = cards.map(c => rankValueAceLow(c.rank)).sort((a,b) => a - b);
  const counts = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
  const groups = Object.entries(counts).map(([r,c]) => ({ rank:+r, count:c }))
    .sort((a,b) => b.count - a.count || a.rank - b.rank);

  if(groups[0].count === 4) return [5, groups[0].rank, groups[1].rank];
  if(groups[0].count === 3 && groups[1] && groups[1].count === 2) return [4, groups[0].rank, groups[1].rank];
  if(groups[0].count === 3) return [3, groups[0].rank, ...groups.slice(1).map(g => g.rank).sort((a,b) => a - b)];
  if(groups[0].count === 2 && groups[1] && groups[1].count === 2){
    const pairRanks = [groups[0].rank, groups[1].rank].sort((a,b) => a - b);
    return [2, ...pairRanks, groups[2].rank];
  }
  if(groups[0].count === 2) return [1, groups[0].rank, ...groups.slice(1).map(g => g.rank).sort((a,b) => a - b)];
  return [0, ...ranks]; // already ascending
}
function compareLow(a, b){ // positive = a better (lower value hand)
  const len = Math.max(a.length, b.length);
  for(let i = 0; i < len; i++){
    const av = a[i] === undefined ? Infinity : a[i];
    const bv = b[i] === undefined ? Infinity : b[i];
    if(av !== bv) return bv - av;
  }
  return 0;
}
function bestLowA5FromN(cards){
  let best = null, bestScore = null;
  combinations(cards, 5).forEach(combo => {
    const score = evaluate5LowA5(combo);
    if(!bestScore || compareLow(score, bestScore) > 0){ bestScore = score; best = combo; }
  });
  return { cards: best, score: bestScore };
}
function bestOmahaLowA5(holeCards, boardCards){
  let best = null, bestScore = null;
  combinations(holeCards, 2).forEach(h => {
    combinations(boardCards, 3).forEach(b => {
      const combo = [...h, ...b];
      // A-5 Omaha low also requires all 5 cards to be 8-or-lower to even be considered a valid low combo elsewhere;
      // this function returns the best low regardless, qualifierCheck below determines if it counts.
      const score = evaluate5LowA5(combo);
      if(!bestScore || compareLow(score, bestScore) > 0){ bestScore = score; best = combo; }
    });
  });
  return { cards: best, score: bestScore };
}
/* 8-or-better qualifier check for A-5-style low hands (Stud 8, Big O Hi-Lo, Archie low side). */
function qualifiesEightLow(lowScore){
  if(lowScore[0] !== 0) return false; // must be 5 distinct ranks (no pair)
  return lowScore.every(v => v <= 8 || v === 0); // tier 0 marker is fine; all rank values must be <=8
}

/* ---------- 2-7 LOW (ace high, straights/flushes count against you) ----------
   This is exactly the inverse of standard high ranking — reuse evaluate5High,
   just select the MINIMUM score instead of the maximum. */
const bestLow27FromN = worstHighFromN;
const bestOmahaLow27 = worstOmahaHigh;

/* ---------- BADUGI (4-card, all distinct ranks AND suits) ----------
   rankFn lets callers choose ace-low (standard Badugi) or ace-high (Baducey's badugi side). */
function isLowerBadugiVals(a, b){ // both descending-sorted same length; true if a is the lower (better) hand
  for(let i = 0; i < a.length; i++){
    if(a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
function bestBadugi(cards, rankFn){
  rankFn = rankFn || rankValueAceLow;
  for(let size = Math.min(4, cards.length); size >= 1; size--){
    const combos = combinations(cards, size).filter(combo => {
      const suits = combo.map(c => c.suit);
      const ranks = combo.map(c => c.rank);
      return new Set(suits).size === combo.length && new Set(ranks).size === combo.length;
    });
    if(combos.length > 0){
      let best = null, bestVals = null;
      combos.forEach(combo => {
        const vals = combo.map(c => rankFn(c.rank)).sort((a,b) => b - a); // descending
        if(!bestVals || isLowerBadugiVals(vals, bestVals)){ best = combo; bestVals = vals; }
      });
      return { cards: best, size, tiebreak: bestVals };
    }
  }
  return { cards: [], size: 0, tiebreak: [] };
}
function compareBadugi(resA, resB){ // positive = A better
  if(resA.size !== resB.size) return resA.size - resB.size; // bigger badugi always wins
  if(isLowerBadugiVals(resA.tiebreak, resB.tiebreak)) return 1;
  if(isLowerBadugiVals(resB.tiebreak, resA.tiebreak)) return -1;
  return 0;
}

/* ---------- Drawmaha 49 point count (A=1, face=0, number=value) ----------
   Players hold exactly 5 hole cards after the draw, so this is a straight sum, no combinatorics. */
function pointCount49(cards){
  return cards.reduce((sum, c) => {
    if(c.rank === 'A') return sum + 1;
    if(['J','Q','K'].includes(c.rank)) return sum + 0;
    if(c.rank === 'T') return sum + 10;
    return sum + parseInt(c.rank, 10);
  }, 0);
}

exports.RANK_ORDER_HIGH = RANK_ORDER_HIGH;
exports.SUITS = SUITS;
exports.rankValue = rankValue;
exports.rankValueAceLow = rankValueAceLow;
exports.freshDeck = freshDeck;
exports.combinations = combinations;
exports.evaluate5High = evaluate5High;
exports.compareArrays = compareArrays;
exports.bestHighFromN = bestHighFromN;
exports.bestOmahaHigh = bestOmahaHigh;
exports.worstHighFromN = worstHighFromN;
exports.worstOmahaHigh = worstOmahaHigh;
exports.evaluate5LowA5 = evaluate5LowA5;
exports.compareLow = compareLow;
exports.bestLowA5FromN = bestLowA5FromN;
exports.bestOmahaLowA5 = bestOmahaLowA5;
exports.qualifiesEightLow = qualifiesEightLow;
exports.bestLow27FromN = bestLow27FromN;
exports.bestOmahaLow27 = bestOmahaLow27;
exports.bestBadugi = bestBadugi;
exports.compareBadugi = compareBadugi;
exports.pointCount49 = pointCount49;
})(typeof module !== 'undefined' ? module.exports : (window.RailCards = window.RailCards || {}));
