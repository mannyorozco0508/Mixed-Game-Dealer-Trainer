const { JSDOM } = require('jsdom');
const fs = require('fs');

const path = require('path');
// Reads the repository's real index.html, resolved relative to THIS file so
// the suite runs from a fresh clone in any working directory. It previously
// read a /tmp scratch copy a developer had to create by hand, which meant a
// clean clone crashed with ENOENT — and, worse, that a stale scratch file
// left on one machine could make the suite look greener than the repo was.
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extract(a, b){
  const s = src.indexOf(a);
  const e = src.indexOf(b, s);
  if(s === -1 || e === -1) throw new Error('marker not found: ' + a);
  return src.slice(s, e);
}

// Pull the real shipped code straight out of index.html's script block.
// The rendering block is taken as ONE contiguous chunk (buildTable through
// updateTableView) because the sound-effects code legitimately sits between
// those functions in source order — excising it is what broke earlier attempts.
// Three of the seven slices this harness used to take from index.html are
// gone: the card model, DEAL_PATTERNS and the game roster are real modules
// now, so they are required directly instead of being cut out by string
// marker. The remaining slices cover stateful table orchestration
// (buildTable/updateTableView and friends), which is not extractable yet.
const RailCardModel    = require('./card-model.js');
const RailDealPatterns = require('./deal-patterns.js');
const RailGameData     = require('./game-data.js');
const RailDealState    = require('./deal-state.js');
const RailHandOpen     = require('./hand-open.js');
// updateTableView delegates the street transition to this module.


const appCode = [
  // Bindings the extracted modules used to provide inline.
  'const { RANKS, SUITS, SUIT_SYMBOL, RED_SUITS, createCard, cardIsRed, cardFaceText, cardHtml } = RailCardModel;',
  'let freshDeck = RailCardModel.freshDeck;',
  'const DEAL_PATTERNS = RailDealPatterns.DEAL_PATTERNS;',
  'const { DATA, tripleDrawSteps, drawmahaCommonSteps, drawmahaScenario, superStudSteps, sevenStudSteps } = RailGameData;',

  extract('const overlay = document.getElementById', 'const BUTTON_DEALCATS'),
  extract('const BUTTON_DEALCATS', 'function buildTable(game, isRedeal){\n'),
  extract('function buildTable(game, isRedeal){', '\nfunction startScenario')
].join('\n');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="tableStrip"></div>
  <button id="soundToggle"></button>
  <div class="poker-table" id="pokerTable">
    <div id="burnPile"></div>
    <div id="boardRow1"></div>
    <div id="boardRow2"></div>
    <div id="seatsEl"></div>
  </div>
</body></html>`);
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth',  { configurable:true, get(){ return 760; } });
dom.window.RailDealState = RailDealState;
dom.window.RailHandOpen = RailHandOpen;
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable:true, get(){ return 360; } });
const _store = {};
const localStorageStub = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); }
};

// The test body runs in the SAME scope as the app code, so it can see
// DATA, DEAL_PATTERNS, seatEls, currentScenario, etc.
const testBody = `
  let pass = 0, fail = 0;
  function check(label, cond){ if(cond){ pass++; } else { fail++; console.log('FAIL: ' + label); } }

  function findGame(name){
    for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
    throw new Error('game not found: ' + name);
  }
  function firstActiveSeat(){
    for(let i = 0; i < tableSeats; i++) if(i !== sitOutSeatIndex) return i;
    return 0;
  }
  function seatCardCount(i){
    const el = seatEls[i] && seatEls[i].querySelector('.seat-cards');
    return el ? el.querySelectorAll('.mini-card').length : -1;
  }
  function seatUpCount(i){
    const el = seatEls[i] && seatEls[i].querySelector('.seat-cards');
    return el ? el.querySelectorAll('.mini-card:not(.face-down)').length : -1;
  }
  function resetTableDom(){
    document.getElementById('seatsEl').innerHTML = '';
    document.getElementById('boardRow1').innerHTML = '';
    document.getElementById('boardRow2').innerHTML = '';
    document.getElementById('burnPile').innerHTML = '';
  }

  // ===== TEST 1: Super Stud — the hardest case, includes a real DISCARD =====
  console.log('=== Super Stud Hi-Lo 8 / Super Pat: full hand incl. mid-hand discard ===');
  resetTableDom();
  const superStud = findGame('Super Stud Hi-Lo 8 / Super Pat');
  currentScenario = superStud;
  tableSeats = 7;
  buttonSeatIndex = null;
  buildTable(superStud, false);
  const p1 = DEAL_PATTERNS[superStud.dealCat];
  console.log('  pattern hole: ' + JSON.stringify(p1.hole) + ' upCount: ' + JSON.stringify(p1.upCount));
  for(let step = 0; step < p1.hole.length; step++){
    updateTableView(step);
    const seat = firstActiveSeat();
    check('Step ' + step + ': total cards = ' + p1.hole[step] + ' (got ' + seatCardCount(seat) + ')', seatCardCount(seat) === p1.hole[step]);
    check('Step ' + step + ': face-up = ' + p1.upCount[step] + ' (got ' + seatUpCount(seat) + ')', seatUpCount(seat) === p1.upCount[step]);
  }
  check('Sit-out seat received zero cards all hand', sitOutSeatIndex === null || seatCardCount(sitOutSeatIndex) === 0);

  // ===== TEST 2: Big-O Double Board — two boards advancing independently =====
  console.log('');
  console.log('=== Big-O Double Board: two boards ===');
  resetTableDom();
  const db = findGame('Big-O Double Board');
  currentScenario = db;
  buttonSeatIndex = null;
  buildTable(db, false);
  const p2 = DEAL_PATTERNS[db.dealCat];
  for(let step = 0; step < p2.hole.length; step++){
    updateTableView(step);
    const b1 = document.getElementById('boardRow1').querySelectorAll('.board-card').length;
    const b2 = document.getElementById('boardRow2').querySelectorAll('.board-card').length;
    check('Step ' + step + ': board 1 = ' + p2.board[step] + ' (got ' + b1 + ')', b1 === p2.board[step]);
    check('Step ' + step + ': board 2 = ' + p2.board2[step] + ' (got ' + b2 + ')', b2 === p2.board2[step]);
  }

  // ===== TEST 3: THE CORE FIX — already-dealt cards are never destroyed =====
  console.log('');
  console.log('=== No-redeal check: same DOM nodes persist across streets ===');
  resetTableDom();
  const dm = findGame('Drawmaha Hi');
  currentScenario = dm;
  buttonSeatIndex = null;
  buildTable(dm, false);
  updateTableView(1);
  const seat3 = firstActiveSeat();
  const container = seatEls[seat3].querySelector('.seat-cards');
  check('Hole cards actually rendered at step 1', container.children.length > 0);
  container.children[0].setAttribute('data-marker', 'original');
  const countAfterDeal = container.children.length;
  updateTableView(2);
  const stillSame = seatEls[seat3].querySelector('.seat-cards').children[0];
  check('The exact same card DOM node survives into the next street (no redeal)', !!stillSame && stillSame.getAttribute('data-marker') === 'original');
  check('Hole card count unchanged when only the board advances', seatEls[seat3].querySelector('.seat-cards').children.length === countAfterDeal);
  check('Flop actually appeared on the board', document.getElementById('boardRow1').querySelectorAll('.board-card').length === 3);

  // ===== TEST 4: every game renders its full hand without error =====
  console.log('');
  console.log('=== All 21 games: full hand renders cleanly ===');
  let gamesOk = 0, gamesTotal = 0;
  DATA.forEach(function(cat){ cat.games.forEach(function(g){
    if(!g.dealCat || !g.scenario) return;
    gamesTotal++;
    resetTableDom();
    currentScenario = g;
    buttonSeatIndex = null;
    buildTable(g, false);
    const p = DEAL_PATTERNS[g.dealCat];
    let ok = true;
    for(let step = 0; step < p.hole.length; step++){
      updateTableView(step);
      const s = firstActiveSeat();
      if(seatCardCount(s) !== p.hole[step]) ok = false;
    }
    if(ok) gamesOk++;
    else console.log('  FAIL: ' + g.name + ' did not render correct card counts');
  }); });
  check('All games render correct card counts across every street (' + gamesOk + '/' + gamesTotal + ')', gamesOk === gamesTotal);

  console.log('');
  console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
  if(fail > 0) process.exit(1);
`;

// `clearActiveFault` belongs to the dealer-error PRESENTATION layer, which is
// defined far below the last extraction marker and is not what this suite
// exercises — these tests verify card/table behaviour. buildTable() calls it
// to restore a coherent table, and with no fault ever injected here that call
// is a no-op in production too, so stubbing it changes nothing under test.
// Injected the same way the sandbox already supplies document/window/
// localStorage rather than widening extraction to drag in the whole stateful
// error/UI layer.
const clearActiveFaultStub = function(){};

// The deal pitches cards one at a time via setTimeout so a street animates
// rather than appearing at once; only the first card lands synchronously.
// These tests assert the SETTLED state of each street, so the sandbox gets a
// setTimeout that runs its callback immediately. That collapses the animation
// without altering what is dealt, in what order, or which cards face up —
// placePitchedCard and applyFlipState still run exactly as in production.
const immediateSetTimeout = function(fn){ fn(); return 0; };


new Function('document', 'window', 'localStorage', 'console', 'process', 'clearActiveFault', 'RailCardModel', 'RailDealPatterns', 'RailGameData', 'setTimeout', appCode + '\n' + testBody)(
  dom.window.document, dom.window, localStorageStub, console, process, clearActiveFaultStub, RailCardModel, RailDealPatterns, RailGameData, immediateSetTimeout
);
