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
(function(exports){

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
   Reuses the guidance already in ai-players.js where it exists. Where it
   does not, the fallback is deliberately simple and NOT presented as
   strategy: it stands pat rather than inventing a discard policy. */
function aiDiscardSlots(dealCat, gameName, hand, ai){
  const held = hand || [];
  if(!ai || held.length === 0) return [];

  let guidance = null;
  try {
    if(dealCat === 'draw4' || /Badugi/.test(gameName || '')){
      guidance = ai.drawGuidanceBadugi ? ai.drawGuidanceBadugi(held) : null;
    } else if(/2-7|Baducey/.test(gameName || '')){
      guidance = ai.drawGuidance27 ? ai.drawGuidance27(held) : null;
    } else if(/A-5|Badacey|Razz/.test(gameName || '')){
      guidance = ai.drawGuidanceA5 ? ai.drawGuidanceA5(held) : null;
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
exports.aiDiscardSlots = aiDiscardSlots;
exports.drawCoach = drawCoach;
exports.drawLabel = drawLabel;
exports.drawHelp = drawHelp;
exports.collectAllCards = collectAllCards;
exports.hasDuplicates = hasDuplicates;

})(typeof module !== 'undefined' ? module.exports : (window.RailDraw = window.RailDraw || {}));
