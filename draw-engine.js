/* ============================================================
   draw-engine.js — Real draw/replacement mechanics

   THE PROBLEM THIS SOLVES: deal patterns were flat (5 -> 5 -> 5 -> 5), so
   no card was ever removed or replaced during a draw. Draws existed only
   as narrative scenario steps. This module performs the actual mutation.

   Each draw round:
     held hand  ->  selected identities removed  ->  those cards enter the
     muck  ->  exactly that many replacements drawn from the live deck  ->
     new hand becomes authoritative.

   CARD IDENTITY IS SACRED. Discards are the actual { rank, suit } objects
   the player held. Nothing is cloned, nothing is mutated, and a card can
   only return to play through the existing legitimate muck reshuffle.

   SLOT POLICY: replacements REFILL THE VACATED SLOTS. Retained cards keep
   their slot and their position, so a hand never reorders unpredictably
   across draws — which matters most in stud-style rendering.

   Works in Node (require) and the browser (window.RailDraw).
   ============================================================ */
(function(exports, E){

/* ---------- Draw configuration per deal category ----------
   drawRounds is the number of REAL draw opportunities. maxDiscard is
   capped by the hand size unless a game says otherwise. */
const DRAW_RULES = {
  draw4:    { drawRounds:3, handSize:4, maxDiscard:4, standPatAllowed:true },
  draw5:    { drawRounds:3, handSize:5, maxDiscard:5, standPatAllowed:true },
  drawmaha: { drawRounds:1, handSize:5, maxDiscard:5, standPatAllowed:true }
};

function rulesFor(dealCat){ return DRAW_RULES[dealCat] || null; }
function isDrawGame(dealCat){ return !!DRAW_RULES[dealCat]; }
function drawRoundCount(dealCat){
  const r = rulesFor(dealCat);
  return r ? r.drawRounds : 0;
}

/* ---------- Draw round state ----------
   Explicit rather than inferred from the DOM. */
function createDrawRound(opts){
  const o = opts || {};
  return {
    dealCat: o.dealCat,
    drawNumber: o.drawNumber || 1,
    order: (o.order || []).slice(),      // seats in correct draw order
    position: 0,                          // index into order
    pending: {},                          // seat -> {discardSlots, pat}
    completed: {},                        // seat -> {discarded, drawn, pat}
    complete: false,
    generation: o.generation || 0
  };
}

function currentDrawer(round){
  if(!round || round.complete) return null;
  return round.position < round.order.length ? round.order[round.position] : null;
}

/* Validates a requested discard against the game rule and the actual hand. */
function isLegalDraw(dealCat, heldCount, discardSlots){
  const r = rulesFor(dealCat);
  if(!r) return false;
  const slots = discardSlots || [];
  if(slots.length === 0) return r.standPatAllowed !== false;
  if(slots.length > Math.min(r.maxDiscard, heldCount)) return false;
  if(new Set(slots).size !== slots.length) return false;          // no repeats
  return slots.every(s => s >= 0 && s < heldCount);
}

/* ---------- The authoritative mutation ----------
   hand      : array of { rank, suit } the seat currently holds
   discardSlots : indices into that array
   drawCard  : () => card | null   (the app's live-deck draw, which already
               handles muck reshuffle)
   muck      : array discards are pushed onto

   Returns { hand, discarded, drawn, pat } with hand being a NEW array in
   stable slot order. Never mutates the input hand. */
function applyDraw(hand, discardSlots, drawCard, muck){
  const held = (hand || []).slice();
  const slots = (discardSlots || []).slice().sort((a,b) => a - b);

  if(slots.length === 0){
    return { hand: held, discarded: [], drawn: [], pat: true };
  }

  const discarded = [];
  slots.forEach(s => { if(held[s]) discarded.push(held[s]); });

  // Replacements are drawn FIRST, before the discards reach the muck.
  // Otherwise an exhausted deck would reshuffle the muck and hand a player
  // back the very card they just threw away — which is not a legal draw.
  const next = held.slice();
  const drawn = [];
  slots.forEach(s => {
    const card = drawCard ? drawCard() : null;
    if(card){ next[s] = card; drawn.push(card); }
    else next[s] = null;              // deck genuinely exhausted
  });

  // Only now do the discards leave play. They cannot remain in the hand and
  // cannot reach showdown; only a later legitimate reshuffle returns them.
  if(muck) discarded.forEach(c => muck.push(c));

  const finalHand = next.filter(c => c !== null && c !== undefined);
  return { hand: finalHand, discarded, drawn, pat: false };
}

/* Records one seat's completed draw and advances to the next drawer. */
function completeSeatDraw(round, seat, result){
  if(!round) return round;
  round.completed[seat] = {
    discarded: (result && result.discarded) || [],
    drawn: (result && result.drawn) || [],
    pat: !!(result && result.pat)
  };
  round.position++;
  if(round.position >= round.order.length){
    round.complete = true;
  }
  return round;
}

/* ---------- AI draw choice ----------
   Routing used to be a chain of regexes over the GAME NAME, which silently
   dropped every game whose name didn't match: Archie, Drawmaha Hi, Drawmaha
   49 and Drawmaha Badugi all fell through to "no guidance -> stand pat", and
   Badacey/Baducey matched only their lowball half so the badugi side was
   never considered at all.

   Objectives now come from the same registry the SHOWDOWN uses, so what a
   seat draws toward is by construction what the pot actually pays. An
   unmapped family still stands pat rather than inventing a policy. */
const DRAW_OBJECTIVE = {
  'badugi-only':    'badugi',
  'a5-only':        'a5',
  '27-only':        'low27',
  'badugi+a5':      'badugi+a5',
  'badugi+27':      'badugi+27',
  'archie':         'high+a5',
  'omaha+drawhigh': 'high',
  'omaha+a5hole':   'a5',
  'omaha+27hole':   'low27',
  'omaha+points':   'points49',
  'omaha+badugi':   'badugi',
  'high+low8':      'high+a5'
};

function objectiveFor(gameName, showdown){
  const rules = showdown && showdown.SHOWDOWN_RULES;
  const entry = rules ? rules[gameName] : null;
  return entry ? (DRAW_OBJECTIVE[entry.family] || null) : null;
}

function guidanceFor(objective, held, ai){
  switch(objective){
    case 'badugi':    return ai.drawGuidanceBadugi ? ai.drawGuidanceBadugi(held) : null;
    case 'a5':        return ai.drawGuidanceA5 ? ai.drawGuidanceA5(held) : null;
    case 'low27':     return ai.drawGuidance27 ? ai.drawGuidance27(held) : null;
    case 'high':      return ai.drawGuidanceHigh ? ai.drawGuidanceHigh(held) : null;
    case 'points49':  return ai.drawGuidance49 ? ai.drawGuidance49(held) : null;
    case 'badugi+a5': return ai.drawGuidanceSplit
      ? ai.drawGuidanceSplit(held, ai.drawGuidanceBadugi, ai.drawGuidanceA5) : null;
    case 'badugi+27': return ai.drawGuidanceSplit
      ? ai.drawGuidanceSplit(held, ai.drawGuidanceBadugi, ai.drawGuidance27) : null;
    case 'high+a5':   return ai.drawGuidanceSplit
      ? ai.drawGuidanceSplit(held, ai.drawGuidanceHigh, ai.drawGuidanceA5) : null;
    default: return null;
  }
}

function aiDiscardSlots(dealCat, gameName, hand, ai, showdown){
  const held = hand || [];
  if(!ai || held.length === 0) return [];

  let guidance = null;
  try {
    const objective = objectiveFor(gameName, showdown);
    guidance = objective ? guidanceFor(objective, held, ai) : null;
    // Badugi is a four-card game; if the registry is unavailable fall back to
    // the one thing the deal category tells us for certain.
    if(!guidance && dealCat === 'draw4' && ai.drawGuidanceBadugi){
      guidance = ai.drawGuidanceBadugi(held);
    }
  } catch(err){ guidance = null; }

  if(!guidance || !guidance.keep) return [];      // no guidance -> stand pat

  // Convert "keep these cards" into slot indices to discard.
  const keepSet = guidance.keep.map(c => c.rank + c.suit);
  const slots = [];
  const used = {};
  held.forEach((c, i) => {
    const key = c.rank + c.suit;
    const idx = keepSet.indexOf(key);
    if(idx !== -1 && !used[key]){ used[key] = true; return; }   // retained
    slots.push(i);
  });
  return slots;
}

/* ---------- Dealer coach text, from real draw state ---------- */
function drawCoach(round, seat, result){
  if(!result) {
    const cur = currentDrawer(round);
    if(cur === null) return 'The draw is complete. Betting resumes.';
    return 'Waiting on Player ' + (cur + 1) + ' to declare their draw.';
  }
  if(result.pat) return 'Player ' + (seat + 1) + ' stands pat. No cards are replaced.';
  const n = result.discarded.length;
  return 'Player ' + (seat + 1) + ' draws ' + n + '. Collect the ' + n +
    ' discard' + (n === 1 ? '' : 's') + ' into the muck, then deal ' + n +
    ' replacement' + (n === 1 ? '' : 's') + '.';
}

/* Compact table indicator: DRAW 2 / STANDS PAT */
function drawLabel(result){
  if(!result) return '';
  return result.pat ? 'STANDS PAT' : 'DRAW ' + result.discarded.length;
}

/* ---------- Player help (rules only) ---------- */
function drawHelp(dealCat, drawNumber){
  const r = rulesFor(dealCat);
  if(!r) return '';
  const remaining = r.drawRounds - drawNumber;
  const parts = ['Tap the cards you want to replace, then confirm.'];
  if(r.standPatAllowed) parts.push('You may also stand pat and keep all of them.');
  if(remaining > 0) parts.push(remaining + ' more draw' + (remaining === 1 ? '' : 's') + ' after this one.');
  else parts.push('This is the final draw.');
  return parts.join(' ');
}

/* ---------- Integrity helper for tests and safety ---------- */
function collectAllCards(hands, board, muck, deck){
  const out = [];
  (hands || []).forEach(h => (h || []).forEach(c => c && out.push(c.rank + c.suit)));
  (board || []).forEach(c => c && out.push(c.rank + c.suit));
  (muck || []).forEach(c => c && out.push(c.rank + c.suit));
  (deck || []).forEach(c => c && out.push(c.rank + c.suit));
  return out;
}
function hasDuplicates(keys){ return new Set(keys).size !== keys.length; }

exports.DRAW_RULES = DRAW_RULES;
exports.rulesFor = rulesFor;
exports.isDrawGame = isDrawGame;
exports.drawRoundCount = drawRoundCount;
exports.createDrawRound = createDrawRound;
exports.currentDrawer = currentDrawer;
exports.isLegalDraw = isLegalDraw;
exports.applyDraw = applyDraw;
exports.completeSeatDraw = completeSeatDraw;
/* ---------- Super Pat ----------
   A Super Stud seat may keep all five original cards instead of trimming to
   three. The question is not "is this hand strong on some general scale" but
   "do I ALREADY hold a made hand worth locking, by THIS game's scoring".

   The old decision asked window.RailAction.tierForSeat with the game's
   BETTING family, which is not the same thing. Super Baducey and Super
   Badacey have no name match, so they fell through to the plain 'high'
   family, and a 40,000-hand sample showed them locking a diamond flush
   (KD JD 4D QD 7D) and trip sevens (7C 7S QC 8H 7D) — in badugi split games
   those are the WORST possible holdings: a one-card badugi, and a flush or
   trips against a 2-7 or A-5 low. They were patting exactly the hands they
   should be throwing away.

   Objectives come from the same showdown registry the draw strategy uses, so
   what a seat locks for is by construction what the pot pays. */
function madeEightLow(cards){
  const low = E.bestLowA5FromN(cards);
  return !!(low && low.score && E.qualifiesEightLow(low.score));
}
function madeHigh(cards, ai){
  // Trips or better: a hand already worth playing without improvement.
  const s = E.bestHighFromN(cards).score;
  return s[0] >= 3;
}
function made27Low(cards){
  // Five distinct ranks, no straight, no flush, nine-high or better.
  if(cards.length < 5) return false;
  const vals = cards.map(c => E.rankValue(c.rank)).sort((a,b) => a - b);
  if(new Set(vals).size !== 5) return false;
  if(vals[4] > 9) return false;
  if(cards.every(c => c.suit === cards[0].suit)) return false;
  if(vals.every((v,i) => i === 0 || v === vals[i-1] + 1)) return false;
  return true;
}
function madeBadugi(cards, ceiling){
  const b = E.bestBadugi(cards);
  return !!(b && b.size === 4 && b.tiebreak && b.tiebreak[0] <= (ceiling || 10));
}

/* Returns true when the five cards are worth locking. */
function superPatDecision(gameName, hand, showdown, ai){
  const held = hand || [];
  if(held.length < 5) return false;
  try {
    const objective = objectiveFor(gameName, showdown);
    switch(objective){
      // Stud Hi-Lo 8: lock a made eight-or-better low, or a made high.
      // The low is the whole point of the game — a 7-low at five cards is a
      // hand you keep, and it scores as high-card on any general tier.
      case 'high+a5':   return madeEightLow(held) || madeHigh(held, ai);
      // Badugi + 2-7: a complete badugi, or a made deuce-to-seven low.
      case 'badugi+27': return madeBadugi(held, 8) || made27Low(held);
      // Badugi + A-5: a complete badugi, or a made eight-or-better low.
      case 'badugi+a5': return madeBadugi(held, 8) || madeEightLow(held);
      default: return false;   // a game with no Pat objective never locks
    }
  } catch(err){ return false; }
}

/* Back-compatible signature. Callers that supply a game name and the showdown
   registry get the objective-aware decision; the old tier-function form is
   still honoured so nothing that already calls it changes meaning. */
function aiPatDecision(hand, tierFn, minTier){
  const held = hand || [];
  if(typeof tierFn !== 'function' || held.length < 5) return false;
  try {
    return tierFn(held) >= (minTier === undefined ? 2 : minTier);  // STRONG or better
  } catch(err){ return false; }
}

exports.aiDiscardSlots = aiDiscardSlots;
exports.superPatDecision = superPatDecision;
exports.madeEightLow = madeEightLow;
exports.made27Low = made27Low;
exports.madeBadugi = madeBadugi;
exports.objectiveFor = objectiveFor;
exports.aiPatDecision = aiPatDecision;
exports.DRAW_OBJECTIVE = DRAW_OBJECTIVE;
exports.drawCoach = drawCoach;
exports.drawLabel = drawLabel;
exports.drawHelp = drawHelp;
exports.collectAllCards = collectAllCards;
exports.hasDuplicates = hasDuplicates;

})(
  typeof module !== 'undefined' ? module.exports : (window.RailDraw = window.RailDraw || {}),
  typeof module !== 'undefined' ? require('./cards-eval.js') : window.RailCards
);
