/* ============================================================
   deal-patterns.js — per-family dealing shapes

   Authoritative source. index.html consumes this module; it does not keep a
   second copy. Loaded as a plain <script> in the browser and required() by
   the test suite, so it must stay free of DOM, timers and app state.
   ============================================================ */
(function(root, factory){
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) root.RailDealPatterns = api;
})(typeof window !== 'undefined' ? window : null, function(){
  const DEAL_PATTERNS = {
    draw4:          { hole:[0,4,4,4,4,4],
    burns:  [0,1,1,0,1,0],     upCount:[0,0,0,0,0,0],     board:[0,0,0,0,0,0],
                      faceSeq:['','DDDD','DDDD','DDDD','DDDD','DDDD'] },
    // 6 steps for games carrying a scoring question (no new cards on that step);
    // games with 5 steps simply never reach index 5.
    draw5:          { hole:[0,5,5,5,5,5,5],
    burns:  [0,1,1,0,1,0,0],   upCount:[0,0,0,0,0,0,0],   board:[0,0,0,0,0,0,0],
                      faceSeq:['','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD'] },
    // Real 7-card stud: 2 down + 1 up on 3rd street, up cards on 4th-6th,
    // 7th street dealt face down.
    // 6 steps: bring-in seat task, completion-owed task (no new cards), then
    // 4th/6th/7th street dealing.
    studSplit:      { hole:[3,3,3,4,6,6,7],
    burns:  [0,0,0,1,2,0,1],
    phases: { 4: [ {burn:1, hole:1}, {burn:1, hole:1} ] },   upCount:[1,1,1,2,4,4,4],   board:[0,0,0,0,0,0,0],
                      faceSeq:['DDU','DDU','DDU','DDUU','DDUUUU','DDUUUU','DDUUUUD'] },
    // Super Stud: four down then the fifth face up, discard two DOWN cards
    // (keeping the up card), then up cards until four are exposed, final down.
    // 8 steps: deal, discard, two Pat-rule questions (no new cards), then streets.
    // 9 steps: deal, discard, Pat-eligibility + two Pat-rule questions (no new
    // cards on those), then the exposed streets and the final down card.
    superStud:      { hole:[0,5,3,3,3,3,3,3,7],
    burns:  [0,0,0,0,0,0,0,0,4],
    phases: { 8: [ {burn:1, hole:1}, {burn:1, hole:1}, {burn:1, hole:1}, {burn:1, hole:1} ] }, upCount:[0,1,1,1,1,1,1,1,4], board:[0,0,0,0,0,0,0,0,0],
                      faceSeq:['','DDDDU','DDU','DDU','DDU','DDU','DDU','DDU','DDUUUUD'],
                      discardKeep:{ 2:[0,1,4] } },
    // 7 steps for variants carrying a draw-side scoring question (no new cards
    // on that step); Drawmaha Hi has 6 and simply never reaches index 6.
    drawmaha:       { hole:[0,5,5,5,5,5,5,5],
    burns:  [0,0,1,0,0,1,1,0], upCount:[0,0,0,0,0,0,0,0], board:[0,0,3,3,3,4,5,5],
                      faceSeq:['','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD'] },
    // Big O: five face-down hole cards, standard complete community board.
    // Both Hi-Lo and PLO share this dealing shape — they differ only at showdown.
    // Six entries because Big O Hi-Lo has a sixth showdown question; PLO reads
    // the first five and simply never advances to index 5.
    // 8 steps for Big O Hi-Lo's fuller ladder; Big O PLO has 6 and stops early.
    bigO:           { hole:[0,5,5,5,5,5,5,5],
    burns:  [0,0,1,1,1,0,0,0], upCount:[0,0,0,0,0,0,0,0], board:[0,0,3,4,5,5,5,5],
                      faceSeq:['','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD'] },
    doubleBoard:    { hole:[0,5,5,5,5,5],
    burns:  [0,0,1,1,1,0],     upCount:[0,0,0,0,0,0],     board:[0,0,3,4,5,5], board2:[0,0,3,4,5,5],
                      faceSeq:['','DDDDD','DDDDD','DDDDD','DDDDD','DDDDD'] },
    // 6 steps: deal(3), discard to 2, two ruling questions (no new cards), flop, turn/river
    pineapple:      { hole:[3,2,2,2,2,2],
    burns:  [0,0,0,0,1,2],
    phases: { 5: [ {burn:1, board:1}, {burn:1, board:1} ] },     upCount:[0,0,0,0,0,0],     board:[0,0,0,0,3,5],
                      faceSeq:['DDD','DD','DD','DD','DD','DD'], discardKeep:{ 1:[0,1] } },
    // 6 steps: deal(3), preflop(3), flop(3 held), two ruling questions, discard to 2
    crazyPineapple: { hole:[3,3,3,3,3,2],
    burns:  [0,0,1,0,0,2],
    phases: { 5: [ {burn:1, board:1}, {burn:1, board:1} ] },     upCount:[0,0,0,0,0,0],     board:[0,0,3,3,3,5],
                      faceSeq:['DDD','DDD','DDD','DDD','DDD','DD'], discardKeep:{ 5:[0,1] } },
    // 5 steps: deal, call-amount task (no new cards), flop, turn/river, showdown
    // 7 steps: deal, call-amount task, flop, two rule questions, turn/river, showdown.
    holdem:         { hole:[0,2,2,2,2,2,2],
    burns:  [0,0,0,1,0,1,1],   upCount:[0,0,0,0,0,0,0],   board:[0,0,0,3,3,4,5],
                      faceSeq:['','DD','DD','DD','DD','DD','DD'] }
  };

  return { DEAL_PATTERNS };
});
