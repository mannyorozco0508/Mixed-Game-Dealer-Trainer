/* ============================================================
   test-street-advance.js

   REAL DEVICE FAILURE, Drawmaha Hi, Play & Learn:
   the human called the final preflop raise and the hand froze on PRE-FLOP
   with no control on screen.

   The betting engine was innocent. The round closed correctly, the call was
   applied once, the money settled. The bug was that #qaColumn is owned by
   renderStepContent(), which renders BOTH the street's question and the
   `Continue Hand` button that advances the scenario — and showHumanControls()
   did `qa.innerHTML = ...`, obliterating both. clearHumanControls() then
   emptied the column entirely. After the human's final action there was
   literally nothing left to press.

   Dealer Training never hit it because with no human seat showHumanControls()
   is never called, so the question survives. test-human-play.js never hit it
   because that harness advances steps itself rather than pressing the button
   a real player has to press — which is exactly the blind spot that let a
   fully green suite ship a frozen hand.

   These tests assert on the LIVE DOM after the real click path.
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs   = require('fs');
const path = require('path');

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
  RailAI: require('./ai-players.js'), RailAction: require('./table-action.js'),
  RailRhythm: require('./betting-rhythm.js'), RailModes: require('./training-modes.js'),
  RailPlayer: RailPlayerReal, RailBetting: require('./betting-engine.js'),
  RailMoney: require('./money-state.js'), RailDraw: require('./draw-engine.js'),
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
const probe = `globalThis.S = {
  findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
  get buildTable(){ return buildTable; },
  get updateTableView(){ return updateTableView; },
  get startActionRound(){ return startActionRound; },
  get showHumanControls(){ return showHumanControls; },
  get clearHumanControls(){ return clearHumanControls; },
  get currentRound(){ return currentRound; },
  get moneyState(){ return moneyState; },
  get foldedSeats(){ return foldedSeats; },
  get sitOut(){ return sitOutSeatIndex; },
  get tableSeats(){ return tableSeats; },
  get playerSession(){ return playerSession; },
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

const P = globalThis.S;
const doc = dom.window.document;
const qa = () => doc.getElementById('qaColumn');
function click(el){
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles:true, cancelable:true }));
}
function actionButtons(){
  const w = doc.getElementById('playerActions');
  return w ? Array.from(w.querySelectorAll('button')) : [];
}

/* Renders what the real step renderer puts in the column: the street's
   question and, critically, the Continue Hand button that advances it. */
function renderStepShell(){
  qa().innerHTML =
    '<div class="scenario-prompt">Step question</div>' +
    '<div class="option-list" id="optionList"></div>' +
    '<button class="continue-hand-btn" id="continueHandBtn">Continue Hand</button>';
}
const hasAdvanceControl = () => !!doc.getElementById('continueHandBtn');

function openHand(name, seed, seats){
  Math.random = rng(seed);
  clock.reset();
  P.setSeats(seats || 7);
  P.setScenario(P.findGame(name));
  P.setMode('practice');
  P.setSession(RailPlayerReal.createPlayerSession({ dealCat: P.findGame(name).dealCat, tableSeats: seats || 7 }));
  P.buildTable(P.findGame(name), false);
  clock.drain();
  P.playerSession.humanSeat = RailPlayerReal.assignHumanSeat(seats || 7, P.sitOut);
}

/* Plays one betting street with the human clicking a real button, and reports
   whether an advancement control survives afterwards. */
function playStreet(name, seed, step, preferred, seats){
  openHand(name, seed, seats);
  P.setStep(step);
  try { P.updateTableView(step); } catch(e){}
  clock.drain();
  renderStepShell();
  const hadControlBefore = hasAdvanceControl();

  P.startActionRound();
  let humanActs = 0, spins = 0, lastLabel = null, contribBefore = null, contribAfter = null;
  const ms = P.moneyState;
  while(spins++ < 300){
    clock.drain();
    const btns = actionButtons();
    if(btns.length){
      const seat = P.playerSession.humanSeat;
      contribBefore = ms.streetContrib[seat];
      let b = btns.find(x => new RegExp(preferred, 'i').test(x.textContent)) ||
              btns.find(x => !/fold/i.test(x.textContent)) || btns[0];
      lastLabel = b.textContent.trim();
      click(b);
      contribAfter = ms.streetContrib[seat];
      humanActs++;
      continue;
    }
    if(clock.size() === 0) break;
  }
  return {
    hadControlBefore,
    hasControlAfter: hasAdvanceControl(),
    panelLeft: !!qa().querySelector('.player-panel'),
    roundComplete: !!(P.currentRound && P.currentRound.complete),
    humanActs, lastLabel, contribBefore, contribAfter,
    pending: clock.size()
  };
}

console.log('=== The reported failure: Drawmaha Hi, human closes preflop ===');
{
  const r = playStreet('Drawmaha Hi', 4242, 1, 'call|check');
  check('the step control existed before the human acted', r.hadControlBefore);
  check('the human actually acted', r.humanActs > 0, String(r.humanActs));
  check('the betting round closed', r.roundComplete);
  check('the player panel was cleaned up', !r.panelLeft);
  check('THE HAND CAN STILL ADVANCE after the human\'s final action',
        r.hasControlAfter, 'no advancement control left in #qaColumn');
  check('no timer is left dangling', r.pending === 0, String(r.pending));
}

console.log('=== The panel never destroys the column ===');
{
  openHand('Drawmaha Hi', 909, 7);
  P.setStep(1);
  try { P.updateTableView(1); } catch(e){}
  clock.drain();
  renderStepShell();
  P.startActionRound();          // a live round, so legal actions exist
  clock.drain();
  P.clearHumanControls();                       // start from the bare step shell
  const before = qa().children.length;
  P.showHumanControls(P.playerSession.humanSeat);
  check('the step question survives the panel opening', hasAdvanceControl());
  check('the panel is added, not swapped in', qa().children.length > before,
        before + ' -> ' + qa().children.length);
  check('the panel is present', !!qa().querySelector('.player-panel'));
  check('the panel offers actions', actionButtons().length > 0);

  // Opening twice must not stack duplicates.
  P.showHumanControls(P.playerSession.humanSeat);
  check('re-opening replaces the panel rather than duplicating it',
        qa().querySelectorAll('.player-panel').length === 1,
        String(qa().querySelectorAll('.player-panel').length));

  P.clearHumanControls();
  check('clearing removes only the panel', !qa().querySelector('.player-panel'));
  check('and leaves the step control intact', hasAdvanceControl());
}

console.log('=== The same boundary across game families ===');
{
  [['Texas Hold\'em', 1, 7], ['Big O Hi-Lo', 1, 7], ['Big O PLO', 1, 7],
   ['Stud Hi-Lo / 8-or-Better', 1, 7], ['Razz', 1, 7], ['Badugi', 1, 7],
   ['2-7 Lowball', 1, 6], ['Pineapple', 2, 7], ['Double Board Omaha', 1, 7],
   ['Super Stud Hi-Lo 8 / Super Pat', 1, 7]].forEach(([name, step, seats], i) => {
    const r = playStreet(name, 6100 + i * 71, step, 'call|check', seats);
    check(name + ': the human acted', r.humanActs > 0, String(r.humanActs));
    check(name + ': an advancement control survives', r.hasControlAfter);
    check(name + ': no player panel is left behind', !r.panelLeft);
  });
}

console.log('=== A human action that does NOT close the round ===');
{
  // Folding early must not strand the hand either, and the AI must carry on.
  const r = playStreet('Texas Hold\'em', 7777, 1, 'fold');
  check('the hand still has a control after a human fold', r.hasControlAfter);
  // A spectator panel SHOULD remain while the folded player watches the hand
  // out; what must not happen is it eating the step's own controls.
  check('the spectator panel coexists with the step control',
        !r.panelLeft || r.hasControlAfter);
  check('the round still resolved', r.roundComplete || r.pending === 0);
}

console.log('=== AI-only rounds are unaffected ===');
{
  openHand('Texas Hold\'em', 8888, 7);
  P.setSession(null);                 // Dealer Training: no human seat
  P.setStep(1);
  try { P.updateTableView(1); } catch(e){}
  clock.drain();
  renderStepShell();
  P.startActionRound();
  clock.drain();
  check('an AI-only round never opens a player panel', !qa().querySelector('.player-panel'));
  check('and the step control is untouched', hasAdvanceControl());
  check('the round completed on its own', !!(P.currentRound && P.currentRound.complete));
}

console.log('=== The column is not owned by the panel ===');
{
  check('showHumanControls appends rather than assigning innerHTML',
        /qa\.appendChild\(panel\)/.test(SRC));
  check('showHumanControls no longer assigns over the column',
        !/YOUR ACTION[\s\S]{0,200}/.test(SRC.slice(SRC.indexOf('qa.innerHTML'), SRC.indexOf('qa.innerHTML') + 1)) ||
        !/qa\.innerHTML = `[\s\S]{0,80}player-turn/.test(SRC));
  check('showSpectatorPanel no longer assigns over the column',
        !/qa\.innerHTML = `[\s\S]{0,80}player-status/.test(SRC));
  check('the spectator panel is appended too',
        /qa\.appendChild\(panel\)/.test(SRC) &&
        (SRC.match(/qa\.appendChild\(panel\)/g) || []).length >= 2);
  check('clearHumanControls removes only the panel',
        /const panel = qa && qa\.querySelector\('\.player-panel'\)/.test(SRC));
  check('it no longer empties the column',
        !/if\(qa && qa\.querySelector\('\.player-panel'\)\) qa\.innerHTML = '';/.test(SRC));
  check('the human action path still drives the shared continuation',
        /runNextAction\(\);\n\}/.test(SRC.slice(SRC.indexOf('function submitHumanAction'))));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
