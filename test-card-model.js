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

// The real, unmodified evaluator — the whole point is proving the app's
// own card objects can be handed to this directly, with no translation.
const RailCards = require('./cards-eval.js');

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

const testBody = `
  let pass = 0, fail = 0;
  function check(label, cond){ if(cond){ pass++; } else { fail++; console.log('FAIL: ' + label); } }
  function cardKey(c){ return c.rank + c.suit; }
  function findGame(name){
    for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
    throw new Error('game not found: ' + name);
  }
  function firstActiveSeat(){
    for(let i = 0; i < tableSeats; i++) if(i !== sitOutSeatIndex) return i;
    return 0;
  }
  function resetTableDom(){
    document.getElementById('seatsEl').innerHTML = '';
    document.getElementById('boardRow1').innerHTML = '';
    document.getElementById('boardRow2').innerHTML = '';
    document.getElementById('burnPile').innerHTML = '';
  }

  // ===== 1. DECK INTEGRITY =====
  console.log('=== Deck integrity ===');
  const deck = freshDeck();
  check('Deck has exactly 52 cards (got ' + deck.length + ')', deck.length === 52);
  const keys = deck.map(cardKey);
  check('All 52 cards are unique (got ' + new Set(keys).size + ' unique)', new Set(keys).size === 52);
  const expected = [];
  ['2','3','4','5','6','7','8','9','T','J','Q','K','A'].forEach(r =>
    ['S','H','D','C'].forEach(s => expected.push(r + s)));
  check('Deck contains exactly the expected 52 rank/suit combinations',
    expected.every(k => keys.includes(k)) && keys.every(k => expected.includes(k)));

  // ===== 2 & 3. RANK / SUIT NORMALIZATION =====
  console.log('');
  console.log('=== Rank / suit normalization ===');
  check('Every rank is in the canonical set (no "10", ten is "T")',
    deck.every(c => ['2','3','4','5','6','7','8','9','T','J','Q','K','A'].includes(c.rank)));
  check('No card uses the legacy "10" rank string', deck.every(c => c.rank !== '10'));
  check('Every suit is a canonical uppercase letter', deck.every(c => ['S','H','D','C'].includes(c.suit)));
  check('No card carries a stored presentation property (no .c colour field)',
    deck.every(c => !('c' in c) && !('r' in c) && !('s' in c)));
  check('Card objects have exactly two properties: rank and suit',
    deck.every(c => Object.keys(c).length === 2 && 'rank' in c && 'suit' in c));

  // Derived presentation helpers
  check('cardIsRed() is true for hearts and diamonds only',
    cardIsRed({rank:'A',suit:'H'}) && cardIsRed({rank:'A',suit:'D'}) &&
    !cardIsRed({rank:'A',suit:'S'}) && !cardIsRed({rank:'A',suit:'C'}));
  check('cardFaceText() renders rank + suit symbol', cardFaceText({rank:'A',suit:'S'}) === 'A\\u2660');
  check('createCard() produces a canonical card', (() => {
    const c = createCard('K','H');
    return c.rank === 'K' && c.suit === 'H' && Object.keys(c).length === 2;
  })());

  // ===== 4. SHUFFLE INTEGRITY =====
  console.log('');
  console.log('=== Shuffle integrity ===');
  const d1 = freshDeck(), d2 = freshDeck();
  check('Two fresh decks both have 52 cards', d1.length === 52 && d2.length === 52);
  const s1 = d1.map(cardKey).sort().join(','), s2 = d2.map(cardKey).sort().join(',');
  check('Two independently shuffled decks contain the identical card identities', s1 === s2);
  check('Shuffling produces a different order (not a no-op)',
    d1.map(cardKey).join(',') !== d2.map(cardKey).join(','));

  // ===== 5. MAIN APP -> EVALUATOR COMPATIBILITY (the whole point) =====
  console.log('');
  console.log('=== App -> evaluator compatibility (no translation) ===');
  const appDeck = freshDeck();
  const appHand = appDeck.slice(0, 5);
  let evalOk = true, evalErr = '';
  try {
    const high = RailCards.evaluate5High(appHand);
    const a5   = RailCards.bestLowA5FromN(appHand);
    const l27  = RailCards.bestLow27FromN(appHand);
    const bad  = RailCards.bestBadugi(appDeck.slice(5, 9));
    const pts  = RailCards.pointCount49(appHand);
    if(!Array.isArray(high) || typeof pts !== 'number' || !a5.score || !l27.score || bad.size === undefined) evalOk = false;
  } catch(err){ evalOk = false; evalErr = err.message; }
  check('Evaluator accepts the app\\'s OWN dealt cards directly' + (evalErr ? ' (' + evalErr + ')' : ''), evalOk);

  // Omaha construction, using real app-dealt cards on both sides
  let omahaOk = true;
  try {
    const hole  = appDeck.slice(10, 15);
    const board = appDeck.slice(15, 20);
    const r = RailCards.bestOmahaHigh(hole, board);
    omahaOk = Array.isArray(r.score) && r.cards.length === 5;
  } catch(err){ omahaOk = false; }
  check('Omaha 2+3 evaluation works on app-dealt cards', omahaOk);

  // ===== 6-9. RENDERING PER GAME FAMILY =====
  console.log('');
  console.log('=== Rendering by game family ===');
  function renderFullHand(gameName){
    resetTableDom();
    const g = findGame(gameName);
    currentScenario = g;
    tableSeats = 7;
    buttonSeatIndex = null;
    buildTable(g, false);
    const p = DEAL_PATTERNS[g.dealCat];
    let ok = true;
    for(let step = 0; step < p.hole.length; step++){
      updateTableView(step);
      const seat = firstActiveSeat();
      const el = seatEls[seat] && seatEls[seat].querySelector('.seat-cards');
      const count = el ? el.querySelectorAll('.mini-card').length : -1;
      if(count !== p.hole[step]) ok = false;
    }
    return ok;
  }
  check('Hold\\'em renders correctly', renderFullHand("Texas Hold'em"));
  check('Omaha family (Drawmaha Hi) renders correctly', renderFullHand('Drawmaha Hi'));
  check('Omaha family (Double Board Omaha) renders correctly', renderFullHand('Double Board Omaha'));
  check('Stud family (Razz) renders correctly', renderFullHand('Razz'));
  check('Stud family (Stud Hi-Lo) renders correctly', renderFullHand('Stud Hi-Lo / 8-or-Better'));
  check('Super Stud discard case renders correctly', renderFullHand('Super Stud Hi-Lo 8 / Super Pat'));
  // Was a second check on 'Super Hi-Lo Stud'. That name is now a legacy alias
  // for the line above, so the check had become a duplicate of it. Retargeted
  // to the Big O family, which this render block never covered.
  check('Big O family (Big O Hi-Lo) renders correctly', renderFullHand('Big O Hi-Lo'));
  check('Super Baducey renders correctly', renderFullHand('Super Baducey'));
  check('Super Badacey renders correctly', renderFullHand('Super Badacey'));

  // ===== 10. NO DUPLICATE PHYSICAL CARDS DURING A FULL HAND =====
  console.log('');
  console.log('=== Physical card integrity across a full hand ===');
  let dupIssues = 0, checkedGames = 0;
  DATA.forEach(function(cat){ cat.games.forEach(function(g){
    if(!g.dealCat || !g.scenario) return;
    checkedGames++;
    resetTableDom();
    currentScenario = g;
    tableSeats = 7;
    buttonSeatIndex = null;
    buildTable(g, false);
    // every card handed out this hand must be a distinct physical card
    const all = [];
    seatHoleCards.forEach(h => h.forEach(c => all.push(cardKey(c))));
    tableBoardCards.forEach(c => all.push(cardKey(c)));
    tableBoard2Cards.forEach(c => all.push(cardKey(c)));
    if(new Set(all).size !== all.length){
      console.log('  DUPLICATE CARDS DEALT in ' + g.name);
      dupIssues++;
    }
    if(all.length > 52){
      console.log('  MORE THAN 52 CARDS DEALT in ' + g.name + ' (' + all.length + ')');
      dupIssues++;
    }
  }); });
  check('No duplicate or over-dealt physical cards in any of the ' + checkedGames + ' games', dupIssues === 0);

  // Card identity must survive a full stud hand unchanged
  resetTableDom();
  const ss = findGame('Super Stud Hi-Lo 8 / Super Pat');
  currentScenario = ss;
  tableSeats = 7;
  buttonSeatIndex = null;
  buildTable(ss, false);
  const seatIdx = firstActiveSeat();
  const identityBefore = (seatHoleCards[seatIdx] || []).map(cardKey).join(',');
  const pSS = DEAL_PATTERNS[ss.dealCat];
  for(let step = 0; step < pSS.hole.length; step++) updateTableView(step);
  const identityAfter = (seatHoleCards[seatIdx] || []).map(cardKey).join(',');
  // The hand GROWS as streets are reached — buildTable deals only the first
  // street and later streets draw from the live deck (see "DEFERRED DEALING"
  // in index.html). Super Stud pitches 9 physical cards, 5 of them upfront.
  // So the invariant is not "the array is unchanged" — that assumed the whole
  // hand was dealt at cut time — but that every card ALREADY dealt keeps its
  // identity and position. Comparing the prefix tests exactly that, and would
  // still catch a reorder, substitution, or in-place mutation.
  const beforeArr = identityBefore.split(',');
  const afterArr  = identityAfter.split(',');
  check('Already-dealt card identities and order survive a full stud hand (immutable identity)',
        afterArr.slice(0, beforeArr.length).join(',') === identityBefore);
  check('A stud hand only grows as streets are dealt, never shrinks or reorders',
        afterArr.length >= beforeArr.length);

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


new Function('document', 'window', 'localStorage', 'console', 'process', 'RailCards', 'clearActiveFault', 'RailCardModel', 'RailDealPatterns', 'RailGameData', 'setTimeout', appCode + '\n' + testBody)(
  dom.window.document, dom.window, localStorageStub, console, process, RailCards, clearActiveFaultStub, RailCardModel, RailDealPatterns, RailGameData, immediateSetTimeout
);
