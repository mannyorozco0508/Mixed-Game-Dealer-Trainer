/* ============================================================
   test-uncontested.js

   REAL DEVICE FAILURE, Play & Learn:
   every opponent was marked FOLD, the human was the only live seat, and the
   UI still showed "YOUR ACTION / CHECK / BET $40" while the Dealer Training
   panel was already asking the showdown question. The app simultaneously
   believed betting was finished and that the human still owed an action.

   ROOT CAUSE: handEndedByFolds was WRITTEN in three places and READ in none.
   applyAction() correctly marked a round complete when the field emptied, but
   startActionRound() then opened a BRAND NEW round on the next street, and
   createRound() happily returned the sole survivor as first actor — nothing
   asked whether the pot was still contested. Every later street offered the
   survivor a bet into an empty field.

   The fix is in the engine, not the UI: createRound() marks itself complete
   and uncontested below two contenders, and startActionRound()/runNextAction()
   terminate rather than opening a round or presenting controls.
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs   = require('fs');
const path = require('path');
const A    = require('./table-action.js');
const M    = require('./money-state.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extract(a, b){
  const s = SRC.indexOf(a), e = SRC.indexOf(b, s);
  if(s === -1 || e === -1) throw new Error('marker not found: ' + a);
  return SRC.slice(s, e);
}
const RailCardModel    = require('./card-model.js');
const RailDealPatterns = require('./deal-patterns.js');
const RailGameData     = require('./game-data.js');
const RailDealState    = require('./deal-state.js');
const RailHandOpen     = require('./hand-open.js');
const RailPlayerReal   = require('./player-mode.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return (s>>>0)/4294967296; };
}

/* ---------------------------------------------------------------
   ENGINE LEVEL — the round itself must know
   --------------------------------------------------------------- */
function round(over){
  return A.createRound(Object.assign({
    dealCat:'holdem', tableSeats:7, buttonSeat:0, sitOutSeat:null,
    foldedSeats:new Set(), street:2, upCards:{}
  }, over || {}));
}

console.log('=== A round cannot open on an uncontested pot ===');
{
  const r = round({ foldedSeats: new Set([0,1,2,3,4,5]) });   // seat 6 alone
  check('the round opens already complete', r.complete === true);
  check('it is flagged uncontested', r.uncontested === true);
  check('it is flagged as ended by folds', r.endedByFolds === true);
  check('nobody is on the clock', r.current === null, String(r.current));
  check('legal actions are never requested of a survivor',
        A.activeSeats(r).length === 1, JSON.stringify(A.activeSeats(r)));

  const none = round({ foldedSeats: new Set([0,1,2,3,4,5,6]) });
  check('an empty field is also complete', none.complete === true);
  check('and uncontested', none.uncontested === true);
}

console.log('=== A contested pot is unaffected ===');
{
  const r = round({ foldedSeats: new Set([0,1,2,3,4]) });     // seats 5 and 6
  check('two contenders still open a round', r.complete === false);
  check('and it is not marked uncontested', !r.uncontested);
  check('someone is on the clock', r.current !== null);

  const full = round({});
  check('a full table opens normally', full.complete === false);
  check('and is not uncontested', !full.uncontested);
}

console.log('=== A sit-out seat is not a contender ===');
{
  // 7 seats, one sitting out, five folded -> one real contender.
  const r = round({ sitOutSeat: 6, foldedSeats: new Set([0,1,2,3,4]) });
  check('the sit-out seat does not keep the hand alive', r.uncontested === true,
        'current=' + r.current);
}

console.log('=== An all-in seat DOES keep the pot contested ===');
{
  // All-in seats cannot act but they still win at showdown.
  const r = round({ foldedSeats: new Set([0,1,2,3,4]), allInSeats: [5] });
  check('two contenders, one all-in, is still a live pot', r.complete === false,
        'complete=' + r.complete);
  check('and the seat with chips is on the clock', r.current === 6,
        String(r.current));
}

console.log('=== Folding down to one closes the round immediately ===');
{
  const r = round({});
  let guard = 20, actions = 0;
  while(!r.complete && guard-- > 0){ A.applyAction(r, r.current, A.ACTION.FOLD); actions++; }
  check('the round closes', r.complete);
  check('it took exactly six folds to leave one seat', actions === 6, String(actions));
  check('it is flagged as ended by folds', r.endedByFolds === true);
  check('one contender remains', A.activeSeats(r).length === 1);
  check('nobody is left on the clock', r.current === null);
  // A further action must be inert.
  const before = r.log.length;
  A.applyAction(r, 6, A.ACTION.BET);
  check('no action can be applied after termination', r.log.length === before);
}

/* ---------------------------------------------------------------
   TABLE LEVEL — real DOM, real controls
   --------------------------------------------------------------- */
const queue = [];
const clock = {
  set: fn => { queue.push(fn); return queue.length; },
  clear: () => {},
  drain: () => { let n = 0; while(queue.length && n < 6000){ queue.shift()(); n++; } return n; },
  size: () => queue.length,
  reset: () => { queue.length = 0; }
};
const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="tableStrip"></div><button id="soundToggle"></button>
  <div id="qaColumn"></div><div id="overlay"></div>
  <div class="poker-table" id="pokerTable">
    <div id="burnPile"></div><div id="boardRow1"></div><div id="boardRow2"></div>
    <div id="boardLabel1"></div><div id="boardLabel2"></div><div id="seatsEl"></div>
  </div></body></html>`);
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth',  { configurable:true, get(){ return 1024; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable:true, get(){ return 480; } });
const store = {};
const ls = { getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v);} };
Object.assign(dom.window, {
  RailCards: require('./cards-eval.js'), RailShowdown: require('./showdown.js'),
  RailAI: require('./ai-players.js'), RailAction: A,
  RailRhythm: require('./betting-rhythm.js'), RailModes: require('./training-modes.js'),
  RailPlayer: RailPlayerReal, RailBetting: require('./betting-engine.js'),
  RailMoney: M, RailDraw: require('./draw-engine.js'),
  RailHighlight: require('./card-highlight.js'), RailChips: require('./chip-render.js'),
  RailTasks: require('./dealer-tasks.js'), RailErrors: require('./dealer-errors.js'),
  RailCardChoice: require('./card-choice.js'),
  RailDealState, RailHandOpen
});
const appCode = [
  extract('const overlay = document.getElementById', 'const BUTTON_DEALCATS'),
  extract('const BUTTON_DEALCATS', 'function buildTable(game, isRedeal){\n'),
  extract('function buildTable(game, isRedeal){', '\nfunction startScenario'),
  extract('let cardChoiceSession = null;', '/* ---------------- Training mode & onboarding ---------------- */')
].join('\n');
const bindings = [
  'const { RANKS, SUITS, SUIT_SYMBOL, RED_SUITS, createCard, cardIsRed, cardFaceText, cardHtml } = RailCardModel;',
  'let freshDeck = RailCardModel.freshDeck;',
  'const DEAL_PATTERNS = RailDealPatterns.DEAL_PATTERNS;',
  'const { DATA, tripleDrawSteps, drawmahaCommonSteps, drawmahaScenario, superStudSteps, sevenStudSteps } = RailGameData;'
].join('\n');
const probe = `globalThis.U = {
  findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
  get buildTable(){ return buildTable; },
  get updateTableView(){ return updateTableView; },
  get startActionRound(){ return startActionRound; },
  get contendingSeats(){ return contendingSeats; },
  get currentRound(){ return currentRound; },
  get moneyState(){ return moneyState; },
  get foldedSeats(){ return foldedSeats; },
  get handEndedByFolds(){ return handEndedByFolds; },
  get sitOut(){ return sitOutSeatIndex; },
  get tableSeats(){ return tableSeats; },
  get playerSession(){ return playerSession; },
  get seatPatLocked(){ return seatPatLocked; },
  get burns(){ return burnCards; },
  get board(){ return tableBoardCards; },
  fold(s){ foldedSeats.add(s); },
  setScenario(g){ currentScenario = g; },
  setStep(i){ activeStepIndex = i; if(typeof stepIndex !== 'undefined') stepIndex = i; },
  setSeats(n){ tableSeats = n; },
  setMode(m){ currentMode = m; },
  setSession(s){ playerSession = s; }
};`;
new Function('document','window','localStorage','console','process',
  'RailCardModel','RailDealPatterns','RailGameData','clearActiveFault',
  'setTimeout','clearTimeout','renderStep','globalThis',
  bindings + '\n' + appCode + '\n' + probe
)(dom.window.document, dom.window, ls, console, process,
  RailCardModel, RailDealPatterns, RailGameData, function(){},
  clock.set, clock.clear, function(){}, globalThis);

const U = globalThis.U;
const doc = dom.window.document;
const qa = () => doc.getElementById('qaColumn');
const actionButtons = () => {
  const w = doc.getElementById('playerActions');
  return w ? Array.from(w.querySelectorAll('button')) : [];
};
function renderStepShell(){
  qa().innerHTML = '<div class="scenario-prompt">Step question</div>' +
                   '<button class="continue-hand-btn" id="continueHandBtn">Continue Hand</button>';
}
function openHand(name, seed, seats){
  Math.random = rng(seed);
  clock.reset();
  const g = U.findGame(name);
  U.setSeats(seats || 7); U.setScenario(g); U.setMode('practice');
  U.setSession(RailPlayerReal.createPlayerSession({ dealCat:g.dealCat, tableSeats:seats||7 }));
  U.buildTable(g, false); clock.drain();
  U.playerSession.humanSeat = RailPlayerReal.assignHumanSeat(seats||7, U.sitOut);
  return g;
}
function chips(){
  const ms = U.moneyState;
  return Object.keys(ms.stacks).reduce((n,k)=>n+ms.stacks[k],0) + ms.pot +
         Object.keys(ms.streetContrib).reduce((n,k)=>n+ms.streetContrib[k],0);
}

/* Folds every seat except `survivor`, then opens the street. */
function uncontestedStreet(name, seed, step, survivor, seats){
  const g = openHand(name, seed, seats);
  const total = seats || 7;
  const keep = survivor === 'human' ? U.playerSession.humanSeat : survivor;
  U.setStep(step);
  try { U.updateTableView(step); } catch(e){}
  clock.drain();
  for(let s = 0; s < total; s++){ if(s !== keep && s !== U.sitOut) U.fold(s); }
  renderStepShell();
  const before = chips();
  U.startActionRound();
  clock.drain();
  return {
    game: g, keep,
    round: U.currentRound,
    ended: U.handEndedByFolds,
    buttons: actionButtons().length,
    panel: !!qa().querySelector('.player-panel'),
    control: !!doc.getElementById('continueHandBtn'),
    pending: clock.size(),
    chipsBefore: before, chipsAfter: chips()
  };
}

console.log('=== The device failure: human alone, offered CHECK/BET ===');
{
  const r = uncontestedStreet('Drawmaha Hi', 4242, 5, 'human');
  check('the engine knows the hand is uncontested', r.ended === true);
  check('NO betting buttons are offered to the sole survivor', r.buttons === 0,
        String(r.buttons));
  check('no player panel is opened at all', r.panel === false);
  check('no betting round is left open',
        r.round === null || r.round.complete === true);
  check('no AI timer is left queued', r.pending === 0, String(r.pending));
  check('the step control still exists so the hand can finish', r.control === true);
  check('no chips moved on a street that never happened',
        r.chipsAfter === r.chipsBefore, r.chipsBefore + ' -> ' + r.chipsAfter);
}

console.log('=== The same boundary when an AI is the survivor ===');
{
  const r = uncontestedStreet('Texas Hold\'em', 5150, 2, 0);
  check('an AI survivor is never asked to act', r.pending === 0 && r.buttons === 0);
  check('the hand is flagged ended', r.ended === true);
  check('no round is open', r.round === null || r.round.complete);
}

console.log('=== Every street, and every game family ===');
{
  [['Texas Hold\'em', 7], ['Drawmaha Hi', 7], ['Big O PLO', 7],
   ['Stud Hi-Lo / 8-or-Better', 7], ['Razz', 7], ['Badugi', 7],
   ['2-7 Lowball', 6]].forEach(([name, seats], i) => {
    [1, 2, 3].forEach(step => {
      const r = uncontestedStreet(name, 6200 + i*97 + step, step, 'human', seats);
      check(name + ' step ' + step + ': no betting offered', r.buttons === 0 && !r.panel);
      check(name + ' step ' + step + ': no queued action', r.pending === 0);
      check(name + ' step ' + step + ': chips untouched', r.chipsAfter === r.chipsBefore);
    });
  });
}

console.log('=== Once uncontested, no later street can reopen betting ===');
{
  const g = openHand('Texas Hold\'em', 7777, 7);
  const human = U.playerSession.humanSeat;
  U.setStep(1);
  try { U.updateTableView(1); } catch(e){}
  clock.drain();
  for(let s = 0; s < 7; s++){ if(s !== human && s !== U.sitOut) U.fold(s); }
  renderStepShell();
  U.startActionRound(); clock.drain();
  check('the first uncontested street terminates', U.handEndedByFolds === true);

  let reopened = 0;
  for(let step = 2; step < g.scenario.length; step++){
    U.setStep(step);
    try { U.updateTableView(step); } catch(e){}
    clock.drain();
    renderStepShell();
    U.startActionRound(); clock.drain();
    if(actionButtons().length) reopened++;
    if(clock.size()) reopened++;
  }
  check('no later street reopens betting', reopened === 0, String(reopened));
  check('the flag persists across every remaining street', U.handEndedByFolds === true);
}

console.log('=== A queued AI timer cannot act after termination ===');
{
  const g = openHand('Texas Hold\'em', 8181, 7);
  U.setStep(1);
  try { U.updateTableView(1); } catch(e){}
  clock.drain();
  renderStepShell();
  U.startActionRound();                  // a real round, real queued decision
  check('a decision is genuinely queued', clock.size() > 0, String(clock.size()));
  const human = U.playerSession.humanSeat;
  for(let s = 0; s < 7; s++){ if(s !== human && s !== U.sitOut) U.fold(s); }
  U.startActionRound();                  // field emptied underneath it
  /* The harness's clearTimeout is a no-op, so the callback stays in the queue
     and this is the STRONGER test: production must neutralise it even when the
     timer really does fire. That protection is actionGeneration, which
     cancelPendingActions() bumps. Draining must therefore be inert. */
  const before = chips();
  const foldsBefore = U.foldedSeats.size;
  clock.drain();
  check('a queued decision cannot move money after termination', chips() === before,
        before + ' -> ' + chips());
  check('a queued decision cannot fold anyone after termination',
        U.foldedSeats.size === foldsBefore);
  check('and no betting controls appear', actionButtons().length === 0);
  check('and no round was reopened',
        U.currentRound === null || U.currentRound.complete === true);
}

console.log('=== A contested street still plays normally ===');
{
  const g = openHand('Texas Hold\'em', 9191, 7);
  U.setStep(1);
  try { U.updateTableView(1); } catch(e){}
  clock.drain();
  renderStepShell();
  U.startActionRound();
  check('a contested pot still opens a round', !!U.currentRound && !U.currentRound.complete);
  check('and schedules a decision', clock.size() > 0);
  check('and is not flagged ended', U.handEndedByFolds === false);
  let spins = 0;
  while(clock.size() && spins++ < 300){ clock.drain(); if(actionButtons().length) break; }
  check('the hand progresses', spins < 300);
}

console.log('=== Multi-hand reset after an uncontested hand ===');
{
  // Hand 1: terminate uncontested, leaving flags set.
  const g = openHand('Texas Hold\'em', 3131, 7);
  const human = U.playerSession.humanSeat;
  U.setStep(1);
  try { U.updateTableView(1); } catch(e){}
  clock.drain();
  for(let s = 0; s < 7; s++){ if(s !== human && s !== U.sitOut) U.fold(s); }
  renderStepShell();
  U.startActionRound(); clock.drain();
  check('hand 1 ended uncontested', U.handEndedByFolds === true);
  check('hand 1 left folds recorded', U.foldedSeats.size >= 5);

  // Hand 2 in the SAME runtime, through the real open path.
  openHand('Texas Hold\'em', 3232, 7);
  check('hand 2 clears the uncontested flag', U.handEndedByFolds === false);
  check('hand 2 clears folded seats', U.foldedSeats.size === 0,
        String(U.foldedSeats.size));
  check('hand 2 clears the Pat locks',
        (U.seatPatLocked || []).every(v => !v));
  check('hand 2 clears the board', (U.board || []).length === 0);
  check('hand 2 clears the burn pile', (U.burns || []).length === 0);
  check('hand 2 has no leftover round', U.currentRound === null || !U.currentRound.log.length);
  check('hand 2 has no queued timers', clock.size() === 0, String(clock.size()));
  check('hand 2 has no player panel from hand 1', !qa().querySelector('.player-panel'));

  // And hand 2 plays normally.
  U.setStep(1);
  try { U.updateTableView(1); } catch(e){}
  clock.drain();
  renderStepShell();
  U.startActionRound();
  check('hand 2 opens a real betting round', !!U.currentRound && !U.currentRound.complete);
  check('hand 2 is not flagged ended', U.handEndedByFolds === false);
}

console.log('=== The termination lives in the engine, not the buttons ===');
{
  check('createRound refuses to open on fewer than two contenders',
        /if\(contenders\.length <= 1\)/.test(fs.readFileSync(path.join(__dirname,'table-action.js'),'utf8')));
  check('the table asks who is still contesting',
        /function contendingSeats\(\)/.test(SRC));
  check('startActionRound terminates rather than opening a round',
        /if\(handEndedByFolds \|\| contendingSeats\(\)\.length <= 1\)/.test(SRC));
  check('runNextAction re-checks mid-round',
        /if\(contendingSeats\(\)\.length <= 1\)\{[\s\S]{0,200}cancelPendingActions\(\)/.test(SRC));
  check('termination cancels queued decisions', /cancelPendingActions\(\);   \/\/ no queued/.test(SRC));
  check('the fix is not a button-hiding special case',
        !/liveSeats\.length === 1/.test(SRC));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
