/* ============================================================
   test-correctness-fixes.js

   Covers three defects fixed in one correctness pass:
     1. the stud/razz bring-in was computed with no door cards
     2. slot maps / dealt counts were written inside animation callbacks
     3. flushPendingDeals() abandoned pending pitches instead of finishing them

   Everything here runs on REAL timers. The whole point is that the model is
   authoritative the instant a street is dealt, so nothing may depend on an
   animation having completed.
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extract(a, b){
  const s = src.indexOf(a), e = src.indexOf(b, s);
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
  <div id="tableStrip"></div><button id="soundToggle"></button>
  <div class="poker-table" id="pokerTable">
    <div id="burnPile"></div><div id="boardRow1"></div><div id="boardRow2"></div>
    <div id="boardLabel1"></div><div id="boardLabel2"></div><div id="seatsEl"></div>
  </div></body></html>`);
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth',  { configurable:true, get(){ return 760; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable:true, get(){ return 360; } });
const _s = {};
const localStorageStub = { getItem:k=>(k in _s?_s[k]:null), setItem:(k,v)=>{_s[k]=String(v);} };

const RailCards = require('./cards-eval.js'), RailShowdown = require('./showdown.js');
const RailAI = require('./ai-players.js'), RailAction = require('./table-action.js');
const RailRhythm = require('./betting-rhythm.js'), RailModes = require('./training-modes.js');
const RailPlayer = require('./player-mode.js'), RailBetting = require('./betting-engine.js');
const RailMoney = require('./money-state.js'), RailDraw = require('./draw-engine.js');
const RailHighlight = require('./card-highlight.js'), RailChips = require('./chip-render.js');
const RailTasks = require('./dealer-tasks.js'), RailErrors = require('./dealer-errors.js');
Object.assign(dom.window, { RailDealState, RailHandOpen, RailCards, RailShowdown, RailAI, RailAction, RailRhythm,
  RailModes, RailPlayer, RailBetting, RailMoney, RailDraw, RailHighlight, RailChips,
  RailTasks, RailErrors });

// Belongs to the dealer-error presentation layer; not exercised here.
const clearActiveFaultStub = function(){};

const testBody = `
  function findGame(name){
    for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
    throw new Error('game not found: ' + name);
  }
  const REAL_FRESH_DECK = freshDeck;
  globalThis.T = {
    findGame,
    fmt: c => c ? c.rank + c.suit : '--',
    get heldCards(){ return heldCards; },
    get upCardsBySeat(){ return upCardsBySeat; },
    get upCardsFromModel(){ return upCardsFromModel; },
    get updateTableView(){ return updateTableView; },
    get buildTable(){ return buildTable; },
    get startActionRound(){ return startActionRound; },
    get flushPendingDeals(){ return flushPendingDeals; },
    get cancelPendingDeals(){ return cancelPendingDeals; },
    get pendingDealTimers(){ return pendingDealTimers; },
    get seatHoleCards(){ return seatHoleCards; },
    get seatSlotMaps(){ return seatSlotMaps; },
    get seatDealtCounts(){ return seatDealtCounts; },
    get seatVisibleCardCounts(){ return seatVisibleCardCounts; },
    get seatEls(){ return seatEls; },
    get currentRound(){ return currentRound; },
    get currentBringInSeat(){ return currentBringInSeat; },
    get moneyState(){ return moneyState; },
    get patterns(){ return DEAL_PATTERNS; },
    setScenario(g){ currentScenario = g; },
    setStep(i){ activeStepIndex = i; },
    setSeats(n){ tableSeats = n; },
    setButton(v){ buttonSeatIndex = v; },
    getSitOut(){ return sitOutSeatIndex; },
    stubDeck(fn){ freshDeck = fn || REAL_FRESH_DECK; },
    get realDeck(){ return REAL_FRESH_DECK; }
  };
`;
new Function('document','window','localStorage','console','process',
  'RailCards','RailShowdown','clearActiveFault','RailCardModel','RailDealPatterns','RailGameData','globalThis',
  appCode + '\n' + testBody
)(dom.window.document, dom.window, localStorageStub, console, process,
  RailCards, RailShowdown, clearActiveFaultStub, RailCardModel, RailDealPatterns, RailGameData, globalThis);

const T = globalThis.T;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const card = t => ({ rank: t[0], suit: t[1] });
const SEATS = [0,1,2,3,4,5,6];
const fmtL = a => '[' + (a||[]).map(T.fmt).join(' ') + ']';

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}

/* Builds a stud table from an exact deck. The opening deal goes one card per
   seat per pass, so the stack is built in passes: seven first-down cards,
   seven second-down cards, then the seven doors. faceSeq 'DDU' makes the third
   pass the door. Later streets draw one per seat in seat order. Re-deals until
   nobody sits out so the stack lines up. */
function dealStud(game, doors, downs, later){
  const deck = [];
  for(let s = 0; s < 7; s++) deck.push(card(downs[s][0]));
  for(let s = 0; s < 7; s++) deck.push(card(downs[s][1]));
  for(let s = 0; s < 7; s++) deck.push(card(doors[s]));
  (later || []).forEach(t => deck.push(card(t)));
  ['TH','TD','TC','TS','JH','JD','JC','JS','9D','9C','8H','8S','7H','7D',
   'KD','KC','AH','AD','AC','2H','2S','3H','4D','4C','5D','5C','6D','6C'
  ].forEach(t => { if(!deck.some(c => c.rank === t[0] && c.suit === t[1])) deck.push(card(t)); });
  T.stubDeck(() => deck.slice());
  let guard = 0;
  do {
    T.setScenario(game); T.setSeats(7); T.setButton(null);
    T.buildTable(game, false);
  } while(T.getSitOut() !== null && ++guard < 60);
  return deck;
}

(async function(){

/* ============================================================
   1. BRING-IN
   ============================================================ */
console.log('=== Bring-in is computed from real door cards ===');

const stud = T.findGame('Stud Hi-Lo / 8-or-Better');
const razz = T.findGame('Razz');

// Stud Hi-Lo: LOW door brings in. Lowest door is the 3c at seat 5.
{
  const doors = ['KH','QD','JS','TH','9H','3C','8D'];
  const downs = [['AH','AD'],['AS','AC'],['KS','KC'],['QH','QC'],['JH','JD'],['TS','TC'],['9S','9C']];
  dealStud(stud, doors, downs);
  const ups = T.upCardsFromModel(stud, 0, 7, T.getSitOut());
  const correct = RailAction.firstActor({
    dealCat: stud.dealCat, tableSeats: 7, buttonSeat: null, sitOutSeat: T.getSitOut(),
    foldedSeats: new Set(), street: 0, upCards: ups, highBringsIn: false
  });
  console.log('  Stud doors: ' + doors.join(' ') + '  -> lowest is 3C at seat 5');
  console.log('  correct=' + correct + '  currentBringInSeat=' + T.currentBringInSeat);
  check('Stud Hi-Lo bring-in is the lowest door card', correct === 5, 'got ' + correct);
  check('Stud Hi-Lo bring-in is NOT seat 0 (guards the old fallback)', T.currentBringInSeat !== 0);
  check('currentBringInSeat matches the door-card answer', T.currentBringInSeat === correct,
        'bringIn=' + T.currentBringInSeat + ' correct=' + correct);

  // The graded task resolves against this same seat.
  check('graded task seat == money seat', T.currentBringInSeat === correct);

  const ms = T.moneyState;
  check('$5 bring-in posted from the bring-in seat', ms.streetContrib[correct] === 5,
        'contrib=' + JSON.stringify(ms.streetContrib));
  const others = SEATS.filter(s => s !== correct);
  check('no other seat posted a forced bet', others.every(s => (ms.streetContrib[s] || 0) === 0));
  // A player completes TO $20 (not on top of the bring-in); the bring-in
  // seat then owes the difference between its $5 and that $20.
  const completer = SEATS.filter(s => s !== correct)[0];
  RailMoney.completeBet(ms, completer);
  check('completion sets the bet to $20', ms.currentBet === 20, 'currentBet=' + ms.currentBet);
  check('completion TO $20 leaves the bring-in owing $15 more',
        RailMoney.callAmount(ms, correct) === 15,
        'got ' + RailMoney.callAmount(ms, correct));
  const total = SEATS.reduce((n,s) => n + ms.stacks[s], 0) + ms.pot +
                SEATS.reduce((n,s) => n + (ms.streetContrib[s] || 0), 0);
  const started = SEATS.reduce((n,s) => n + ms.startingStacks[s], 0);
  check('money conservation exact after the bring-in', total === started,
        'total=' + total + ' started=' + started);
}

// Razz: HIGH door brings in. Highest door is the Ks at seat 3.
{
  const doors = ['5H','4D','3S','KS','2H','6C','7D'];
  const downs = [['AH','AD'],['AS','AC'],['QS','QC'],['JH','JC'],['TH','TD'],['9S','9C'],['8H','8D']];
  dealStud(razz, doors, downs);
  const ups = T.upCardsFromModel(razz, 0, 7, T.getSitOut());
  const correct = RailAction.firstActor({
    dealCat: razz.dealCat, tableSeats: 7, buttonSeat: null, sitOutSeat: T.getSitOut(),
    foldedSeats: new Set(), street: 0, upCards: ups, highBringsIn: true
  });
  console.log('  Razz doors: ' + doors.join(' ') + '  -> highest is KS at seat 3');
  console.log('  correct=' + correct + '  currentBringInSeat=' + T.currentBringInSeat);
  check('Razz bring-in is the highest door card', correct === 3, 'got ' + correct);
  check('Razz bring-in is NOT seat 0', T.currentBringInSeat !== 0);
  check('Razz currentBringInSeat matches the door-card answer', T.currentBringInSeat === correct);
  const ms = T.moneyState;
  check('Razz $5 bring-in posted from that seat', ms.streetContrib[correct] === 5);
  const rc = SEATS.filter(s => s !== correct)[0];
  RailMoney.completeBet(ms, rc);
  check('Razz completion TO $20 leaves $15 owing', RailMoney.callAmount(ms, correct) === 15,
        'got ' + RailMoney.callAmount(ms, correct));
}

/* ============================================================
   2. MODEL STATE IS AUTHORITATIVE SYNCHRONOUSLY
   ============================================================ */
console.log('');
console.log('=== Model is complete the instant a street is dealt (real timers) ===');

function actorFor(game, street){
  return RailAction.firstActor({
    dealCat: game.dealCat, tableSeats: 7, buttonSeat: null, sitOutSeat: T.getSitOut(),
    foldedSeats: new Set(), street, upCards: T.upCardsBySeat(),
    highBringsIn: game.name.indexOf('Stud Hi-Lo') !== 0
  });
}
function tiersNow(family){
  return SEATS.map(s => RailRhythm.tierForStreet({
    cards: T.heldCards(s), board: [], family,
    fullTier: () => RailAction.tierForSeat(T.heldCards(s), [], family)
  }));
}

async function streetIsAuthoritative(game, label, street, family){
  T.setStep(street);
  T.updateTableView(street);

  const pending    = T.pendingDealTimers.length;
  const slotMid    = SEATS.map(s => (T.seatSlotMaps[s]||[]).length);
  const dealtMid   = SEATS.map(s => T.seatDealtCounts[s] || 0);
  const upsMid     = SEATS.reduce((n,s) => n + (T.upCardsBySeat()[s]||[]).length, 0);
  const heldMid    = SEATS.map(s => fmtL(T.heldCards(s)));
  const actorMid   = actorFor(game, street);
  const tiersMid   = tiersNow(family);
  const visibleMid = SEATS.map(s => T.seatVisibleCardCounts[s] || 0);

  await sleep(pending * 160 + 900);

  const slotEnd  = SEATS.map(s => (T.seatSlotMaps[s]||[]).length);
  const dealtEnd = SEATS.map(s => T.seatDealtCounts[s] || 0);
  const upsEnd   = SEATS.reduce((n,s) => n + (T.upCardsBySeat()[s]||[]).length, 0);
  const heldEnd  = SEATS.map(s => fmtL(T.heldCards(s)));
  const actorEnd = actorFor(game, street);
  const tiersEnd = tiersNow(family);

  const J = a => JSON.stringify(a);
  check(label + ': slot maps complete synchronously', J(slotMid) === J(slotEnd), J(slotMid) + ' vs ' + J(slotEnd));
  check(label + ': dealt counts complete synchronously', J(dealtMid) === J(dealtEnd), J(dealtMid) + ' vs ' + J(dealtEnd));
  check(label + ': upCardsBySeat complete before animation finishes', upsMid === upsEnd, upsMid + ' vs ' + upsEnd);
  check(label + ': heldCards identical mid-animation and settled', J(heldMid) === J(heldEnd));
  check(label + ': firstActor identical mid-animation and settled', actorMid === actorEnd, actorMid + ' vs ' + actorEnd);
  check(label + ': AI tier identical for every seat', J(tiersMid) === J(tiersEnd), J(tiersMid) + ' vs ' + J(tiersEnd));
  // The visual side is still allowed to lag — that is the point of animating.
  check(label + ': DOM was genuinely still catching up (animation preserved)',
        pending > 0 && visibleMid.reduce((a,b)=>a+b,0) < slotEnd.reduce((a,b)=>a+b,0),
        'pending=' + pending);
  return { actorMid, actorEnd };
}

{
  const doors = ['9H','KH','7C','3C','4H','5H','6S'];
  const downs = [['7D','5S'],['7H','5D'],['QH','QD'],['6H','4D'],['8D','2C'],['8S','6D'],['9S','7S']];
  dealStud(stud, doors, downs, ['8H','2C','QS','3D','3S','4C','2D']);
  for(const st of [0,1,2]){ T.setStep(st); T.updateTableView(st); await sleep(T.pendingDealTimers.length*160+600); }
  await streetIsAuthoritative(stud, 'Stud Hi-Lo 4th street', 3, 'stud');
  await streetIsAuthoritative(stud, 'Stud Hi-Lo 6th street', 4, 'stud');
}
{
  const doors = ['5H','4D','3S','KS','2H','6C','7D'];
  const downs = [['AH','AD'],['AS','AC'],['QS','QC'],['JH','JC'],['TH','TD'],['9S','9C'],['8H','8D']];
  dealStud(razz, doors, downs);
  for(const st of [0,1,2]){ T.setStep(st); T.updateTableView(st); await sleep(T.pendingDealTimers.length*160+600); }
  await streetIsAuthoritative(razz, 'Razz 4th street', 3, 'stud');
}
{
  const sstud = T.findGame('Super Stud Hi-Lo 8 / Super Pat');
  T.stubDeck(null);
  T.setScenario(sstud); T.setSeats(7); T.setButton(null);
  let guard = 0;
  do { T.buildTable(sstud, false); } while(T.getSitOut() !== null && ++guard < 60);
  T.setStep(0); T.updateTableView(0);
  await sleep(T.pendingDealTimers.length*160+600);
  await streetIsAuthoritative(sstud, 'Super Stud later street', 2, 'stud');
}
{
  // A draw game shares the same pitch mechanism for replacement cards.
  const draw = T.findGame('2-7 Lowball');
  T.setScenario(draw); T.setSeats(7); T.setButton(3);
  let guard = 0;
  do { T.buildTable(draw, false); } while(T.getSitOut() !== null && ++guard < 60);
  T.setStep(0); T.updateTableView(0);
  await sleep(T.pendingDealTimers.length*160+600);
  await streetIsAuthoritative(draw, '2-7 Lowball draw street', 1, 'draw');
}

/* startActionRound must never see a truncated hand. */
{
  const doors = ['9H','KH','7C','3C','4H','5H','6S'];
  const downs = [['7D','5S'],['7H','5D'],['QH','QD'],['6H','4D'],['8D','2C'],['8S','6D'],['9S','7S']];
  dealStud(stud, doors, downs, ['8H','2C','QS','3D','3S','4C','2D']);
  for(const st of [0,1,2]){ T.setStep(st); T.updateTableView(st); await sleep(T.pendingDealTimers.length*160+600); }
  T.setStep(3); T.updateTableView(3);       // pitches now in flight
  T.startActionRound();                      // exactly what the advance path does
  const opened = T.currentRound ? T.currentRound.current : null;
  await sleep(T.pendingDealTimers.length * 160 + 900);
  const settled = actorFor(stud, 3);
  check('startActionRound cannot observe a truncated hand', opened === settled,
        'opened=' + opened + ' settled=' + settled);
}

/* ============================================================
   3. FLUSH SYNCHRONISES THE VISUAL TABLE
   ============================================================ */
console.log('');
console.log('=== flushPendingDeals() finishes the deal instead of abandoning it ===');
{
  const doors = ['9H','KH','7C','3C','4H','5H','6S'];
  const downs = [['7D','5S'],['7H','5D'],['QH','QD'],['6H','4D'],['8D','2C'],['8S','6D'],['9S','7S']];
  dealStud(stud, doors, downs);
  T.setStep(0); T.updateTableView(0);

  const pendingBefore = T.pendingDealTimers.length;
  const slotBefore  = SEATS.map(s => (T.seatSlotMaps[s]||[]).length);
  const heldBefore  = SEATS.map(s => fmtL(T.heldCards(s)));
  const visBefore   = SEATS.reduce((n,s) => n + (T.seatVisibleCardCounts[s]||0), 0);
  check('some pitch callbacks were still pending before the flush', pendingBefore > 0);
  check('the table was genuinely behind the model before the flush',
        visBefore < slotBefore.reduce((a,b)=>a+b,0));

  T.flushPendingDeals();

  const domCounts = SEATS.map(s => {
    const c = T.seatEls[s] && T.seatEls[s].querySelector('.seat-cards');
    return c ? c.children.length : 0;
  });
  const slotAfter = SEATS.map(s => (T.seatSlotMaps[s]||[]).length);
  const heldAfter = SEATS.map(s => fmtL(T.heldCards(s)));
  const J = a => JSON.stringify(a);

  check('no pending pitch timers remain', T.pendingDealTimers.length === 0);
  check('every authoritative card is now visible', J(domCounts) === J(slotAfter),
        'dom=' + J(domCounts) + ' slots=' + J(slotAfter));
  check('visible counts match authoritative dealt counts',
        J(SEATS.map(s => T.seatVisibleCardCounts[s]||0)) === J(slotAfter));
  check('slot maps unchanged by the flush', J(slotBefore) === J(slotAfter));
  check('canonical hands unchanged by the flush', J(heldBefore) === J(heldAfter));
  check('no duplicate DOM cards', domCounts.every((n,i) => n === slotAfter[i]));

  // A late timer must not double-place after a flush.
  await sleep(pendingBefore * 160 + 900);
  const domLater = SEATS.map(s => {
    const c = T.seatEls[s] && T.seatEls[s].querySelector('.seat-cards');
    return c ? c.children.length : 0;
  });
  check('a stale timer cannot add duplicate cards after a flush', J(domLater) === J(domCounts),
        J(domLater) + ' vs ' + J(domCounts));
}

/* ============================================================
   4. ASYNC SAFETY
   ============================================================ */
console.log('');
console.log('=== Async safety ===');
{
  // A new hand starting mid-pitch must not inherit the old hand's cards.
  const doors = ['9H','KH','7C','3C','4H','5H','6S'];
  const downs = [['7D','5S'],['7H','5D'],['QH','QD'],['6H','4D'],['8D','2C'],['8S','6D'],['9S','7S']];
  dealStud(stud, doors, downs);
  T.setStep(0); T.updateTableView(0);
  const midPending = T.pendingDealTimers.length;
  dealStud(stud, doors, downs);            // buildTable cancels pending deals
  const slotFresh = SEATS.map(s => (T.seatSlotMaps[s]||[]).length);
  await sleep(midPending * 160 + 900);
  const slotAfterWait = SEATS.map(s => (T.seatSlotMaps[s]||[]).length);
  check('a new hand during pending pitches starts from clean slot maps',
        slotFresh.every(n => n === 0));
  check('stale pitches from the previous hand never land',
        JSON.stringify(slotFresh) === JSON.stringify(slotAfterWait));

  // Teardown mid-pitch.
  T.setStep(0); T.updateTableView(0);
  const beforeCancel = T.pendingDealTimers.length;
  T.cancelPendingDeals();
  check('cancelPendingDeals clears outstanding timers', T.pendingDealTimers.length === 0 && beforeCancel > 0);
  const domAtCancel = SEATS.map(s => {
    const c = T.seatEls[s] && T.seatEls[s].querySelector('.seat-cards');
    return c ? c.children.length : 0;
  });
  await sleep(beforeCancel * 160 + 900);
  const domAfterCancel = SEATS.map(s => {
    const c = T.seatEls[s] && T.seatEls[s].querySelector('.seat-cards');
    return c ? c.children.length : 0;
  });
  check('cancelled pitches do not land later',
        JSON.stringify(domAtCancel) === JSON.stringify(domAfterCancel));
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
})();
