/* ============================================================
   card-highlight.js — Which cards actually play

   Maps the card identities an evaluator ALREADY returned back to the
   physical cards on the table, so a trainee can see exactly which two hole
   cards and three board cards made an Omaha hand.

   THIS MODULE CALCULATES NOTHING. Every card it highlights came from a
   result produced by cards-eval.js. There is no second solver, and nothing
   here changes card identity, face state, hand contents, money or payout.

   Works in Node (require) and the browser (window.RailHighlight).
   ============================================================ */
(function(exports){

const key = c => (c && c.rank !== undefined) ? c.rank + c.suit : null;

/* Builds a highlight set for one side of a showdown.
   side    : a side object from showdown.js (has results[] with .cards)
   seat    : whose hand to highlight
   sources : { hole: [...], board: [...], board2: [...] } as displayed
   Returns { holeSlots, boardSlots, board2Slots, cards, count } — index
   positions into each displayed row, so the UI marks existing elements
   rather than rendering a second set of cards. */
function highlightFor(side, seat, sources){
  const empty = { holeSlots:[], boardSlots:[], board2Slots:[], cards:[], count:0 };
  if(!side || !sources) return empty;
  const res = (side.results || []).find(r => r.seat === seat);
  if(!res || !res.cards || !res.cards.length) return empty;

  const playing = res.cards.map(key).filter(Boolean);
  const remaining = playing.slice();

  const matchRow = row => {
    const slots = [];
    (row || []).forEach((c, i) => {
      const k = key(c);
      const at = remaining.indexOf(k);
      if(at !== -1){ slots.push(i); remaining.splice(at, 1); }
    });
    return slots;
  };

  // Board first for double-board games so a top-board hand can never claim
  // a bottom-board card of the same rank and suit position.
  const boardSlots  = matchRow(sources.board);
  const board2Slots = matchRow(sources.board2);
  const holeSlots   = matchRow(sources.hole);

  return {
    holeSlots, boardSlots, board2Slots,
    cards: res.cards.slice(),
    count: playing.length
  };
}

/* Validates an Omaha-family highlight against the exact 2+3 rule. Returns
   { valid, holeUsed, boardUsed } so a test or the UI can assert it. */
function checkOmahaShape(hl){
  const holeUsed = hl ? hl.holeSlots.length : 0;
  const boardUsed = hl ? (hl.boardSlots.length + hl.board2Slots.length) : 0;
  return { valid: holeUsed === 2 && boardUsed === 3, holeUsed, boardUsed };
}

/* Highlights for every winner of a side, so ties each get their own set. */
function winnersHighlight(side, sources){
  if(!side || !side.winners) return [];
  return side.winners.map(seat => ({
    seat,
    highlight: highlightFor(side, seat, sourcesForSeat(sources, seat))
  }));
}

// sources may be a flat object or a per-seat lookup.
function sourcesForSeat(sources, seat){
  if(!sources) return null;
  if(sources.bySeat && sources.bySeat[seat]){
    return {
      hole: sources.bySeat[seat],
      board: sources.board,
      board2: sources.board2
    };
  }
  return sources;
}

/* A side is highlightable only if it actually has a winner. An unqualified
   low must never light up a losing set of cards. */
function shouldHighlight(side){
  return !!(side && side.winners && side.winners.length > 0);
}

/* Which side the presenter should currently be highlighting, given the
   stage sequence. Returns null when no highlight applies. */
function activeSideForStage(sides, stageIndex){
  if(!sides || !sides.length) return null;
  const showable = sides.filter(shouldHighlight);
  if(!showable.length) return null;
  const i = Math.max(0, Math.min(stageIndex || 0, showable.length - 1));
  return showable[i];
}

/* Coach text explaining what is lit up — educational, never strategic. */
function highlightCoach(side, hl, opts){
  if(!side || !hl || !hl.count) return '';
  const o = opts || {};
  const holeN = hl.holeSlots.length;
  const boardN = hl.boardSlots.length + hl.board2Slots.length;

  if(o.omaha){
    return 'These ' + holeN + ' hole cards and ' + boardN +
      ' board cards make the ' + side.label.toLowerCase() + '. Omaha requires exactly two and exactly three.';
  }
  if(o.badugi){
    return 'These ' + hl.count + ' cards form the badugi — all different suits and different ranks.';
  }
  if(boardN > 0){
    return 'These ' + hl.count + ' cards play for the ' + side.label.toLowerCase() + '.';
  }
  return 'These ' + hl.count + ' cards make the ' + side.label.toLowerCase() + '.';
}

/* Clears state between sides so a high highlight never bleeds into low. */
function emptyHighlight(){
  return { holeSlots:[], boardSlots:[], board2Slots:[], cards:[], count:0 };
}

/* Integrity helper: highlighted cards must exist in the displayed sources
   and must not be invented. */
function verifyAgainstSources(hl, sources){
  if(!hl || !sources) return true;
  const present = []
    .concat(sources.hole || [], sources.board || [], sources.board2 || [])
    .map(key);
  return hl.cards.every(c => present.indexOf(key(c)) !== -1);
}

exports.highlightFor = highlightFor;
exports.checkOmahaShape = checkOmahaShape;
exports.winnersHighlight = winnersHighlight;
exports.shouldHighlight = shouldHighlight;
exports.activeSideForStage = activeSideForStage;
exports.highlightCoach = highlightCoach;
exports.emptyHighlight = emptyHighlight;
exports.verifyAgainstSources = verifyAgainstSources;

})(typeof module !== 'undefined' ? module.exports : (window.RailHighlight = window.RailHighlight || {}));
