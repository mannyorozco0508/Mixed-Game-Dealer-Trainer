/* ============================================================
   diag-race2.js — DIAGNOSTIC ONLY. No production code changed.

   Targets a LATER stud street, where startActionRound() is provably called
   on the line after renderStep(), and where firstActor() picks the seat with
   the highest visible door card. The deck is stacked so the newest up cards
   REVERSE the running order — if the action system reads the hand before the
   pitches land, it must pick the wrong seat.

   Nothing is mutated after the fact; the same functions the production flow
   calls are driven directly.
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
const appCode = [
  extract('function tripleDrawSteps', 'const DATA = ['),
  extract('const DATA = [', 'const potClass'),
  extract('const RANKS = ', 'const DEAL_PATTERNS'),
  extract('const DEAL_PATTERNS', 'let currentScenario = null;'),
  extract('let currentScenario = null;', 'const BUTTON_DEALCATS'),
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
Object.assign(dom.window, { RailCards, RailShowdown, RailAI, RailAction, RailRhythm,
  RailModes, RailPlayer, RailBetting, RailMoney, RailDraw, RailHighlight, RailChips,
  RailTasks, RailErrors });

/* ---------- Stacked deck ----------
   3rd street: buildTable gives each seat 3 CONSECUTIVE cards, so seat s takes
   deck[s*3 .. s*3+2]; faceSeq 'DDU' makes index 2 the door.
   4th street: updateTableView loops seats in order, drawing one card each, so
   deck[21+s] is seat s's new up card. faceSeq 'DDUU' makes that the NEWEST
   door, which is what firstActor() compares on later streets.

   Running order is deliberately reversed between the two streets:
     3rd-street doors : seat1 K (high)  seat2 Q      seat0 9
     4th-street cards : seat1 2 (low)   seat2 A(high) seat0 8
   So the correct actor on 4th street is seat 2, but a reader that cannot yet
   see the new cards would still be looking at the 3rd-street doors and pick
   seat 1. Seat 0 is given a middling card because it receives the one pitch
   that fires synchronously. */
const STREET3 = { 0:['7D','5S','9H'], 1:['7H','5D','KH'], 2:['QH','QD','7C'],
                  3:['6H','4D','3C'], 4:['8D','5C','4H'], 5:['8S','6D','5H'],
                  6:['9S','7S','6S'] };
const STREET4 = ['8H','2C','QS','3D','3S','4C','2D'];
// step 4 raises every seat from 4 to 6 cards, two each, in seat order
const STEP4 = ['TH','TD','TC','TS','2H','9D','JH','JD','JC','JS','KD','KC','KS','AH'];
function card(t){ return { rank: t[0], suit: t[1] }; }
function stackedDeck(){
  const d = [];
  for(let s = 0; s < 7; s++) STREET3[s].forEach(t => d.push(card(t)));
  STREET4.forEach(t => d.push(card(t)));
  STEP4.forEach(t => d.push(card(t)));
  ['AD','AC','2S','3H','9C','6C','4S','QC','TH'].forEach(t => d.push(card(t)));
  return d;
}

const clearActiveFaultStub = function(){};
const testBody = `
  function findGame(name){
    for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
    throw new Error('game not found: ' + name);
  }
  globalThis.D = {
    findGame,
    fmt: c => c ? c.rank + c.suit : '--',
    get heldCards(){ return heldCards; },
    get upCardsBySeat(){ return upCardsBySeat; },
    get updateTableView(){ return updateTableView; },
    get buildTable(){ return buildTable; },
    get startActionRound(){ return startActionRound; },
    get flushPendingDeals(){ return flushPendingDeals; },
    get pendingDealTimers(){ return pendingDealTimers; },
    get seatHoleCards(){ return seatHoleCards; },
    get seatSlotMaps(){ return seatSlotMaps; },
    get currentRound(){ return currentRound; },
    setScenario(g){ currentScenario = g; },
    setStep(i){ activeStepIndex = i; },
    setSeats(n){ tableSeats = n; },
    setButton(v){ buttonSeatIndex = v; },
    getSitOut(){ return sitOutSeatIndex; },
    patterns(){ return DEAL_PATTERNS; },
    stubDeck(fn){ freshDeck = fn; }
  };
`;
new Function('document','window','localStorage','console','process',
  'RailCards','RailShowdown','clearActiveFault','globalThis',
  appCode + '\n' + testBody
)(dom.window.document, dom.window, localStorageStub, console, process,
  RailCards, RailShowdown, clearActiveFaultStub, globalThis);

const D = globalThis.D;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEATS = [0,1,2,3,4,5,6];
// exactly what runNextAction() computes
function prodTier(held){
  return RailRhythm.tierForStreet({ cards: held, board: [], family: 'stud',
    fullTier: () => RailAction.tierForSeat(held, [], 'stud') });
}
const fmtL = a => '[' + (a||[]).map(D.fmt).join(' ') + ']';

function actorNow(game, street){
  return RailAction.firstActor({
    dealCat: game.dealCat, tableSeats: 7, buttonSeat: null,
    sitOutSeat: D.getSitOut(), foldedSeats: new Set(), street,
    upCards: D.upCardsBySeat(),
    highBringsIn: game.name.indexOf('Stud Hi-Lo') !== 0
  });
}
function report(label){
  const ups = D.upCardsBySeat();
  console.log('  ' + label);
  SEATS.forEach(s => {
    const door = (ups[s]||[]).length ? ups[s][ups[s].length-1] : null;
    console.log('    seat ' + s +
      ': logical=' + (D.seatHoleCards[s]||[]).length +
      ' slotMap=' + (D.seatSlotMaps[s]||[]).length +
      ' held=' + fmtL(D.heldCards(s)) +
      ' ups=' + fmtL(ups[s]) +
      ' door=' + (door ? D.fmt(door) : '--'));
  });
  return ups;
}

(async function(){
console.log('================================================================');
console.log('STUD HI-LO — 4th street. Does the action system pick the wrong');
console.log('seat because the newest up cards have not been pitched yet?');
console.log('================================================================\n');

const stud = D.findGame('Stud Hi-Lo / 8-or-Better');
D.stubDeck(stackedDeck);

// Deal until no seat sits out, so all seven stacked hands are live.
let guard = 0;
do { D.setScenario(stud); D.setSeats(7); D.setButton(null); D.buildTable(stud, false); }
while(D.getSitOut() !== null && ++guard < 50);
console.log('sit-out seat: ' + D.getSitOut() + '  (all 7 seats live)\n');

const pat = D.patterns()[stud.dealCat];
console.log('hole=' + JSON.stringify(pat.hole) + '  upCount=' + JSON.stringify(pat.upCount));
console.log('faceSeq[0]=' + pat.faceSeq[0] + '  faceSeq[3]=' + pat.faceSeq[3] + '\n');

// --- advance through 3rd street and let it settle ---
for(const step of [0,1,2,3]){
  D.setStep(step); D.updateTableView(step);
  await sleep(D.pendingDealTimers.length * 140 + 600);
}
console.log('--- 3rd street settled (before 4th street is dealt) ---');
report('');
const actor3 = actorNow(stud, 4);
console.log('    running order by 3rd-street doors -> seat ' + actor3 + '\n');

// --- 4th street: the exact production sequence ---
// renderStep() -> updateTableView(step)   [schedules pitches]
// then the advance handler calls startActionRound() on the NEXT line.
D.setStep(4);
D.updateTableView(4);
const pending = D.pendingDealTimers.length;
console.log('--- POINT B: immediately after updateTableView(4), pitches in flight ---');
const upsB = report('');
const actorB = actorNow(stud, 4);
const tiersB = SEATS.map(s2 => prodTier(D.heldCards(s2)));
console.log('    pending pitch timers: ' + pending);
console.log('    >>> firstActor() = seat ' + actorB);

D.startActionRound();
const roundActor = D.currentRound ? D.currentRound.current : null;
console.log('    >>> startActionRound() -> round.current = seat ' + roundActor + '\n');

await sleep(pending * 160 + 1200);
console.log('--- POINT C: all pitches settled ---');
const upsC = report('');
const actorC = actorNow(stud, 4);
console.log('    >>> firstActor() = seat ' + actorC + '\n');

console.log('================================================================');
console.log('FINDINGS');
console.log('================================================================');
const upsBn = SEATS.reduce((n,s)=>n+(upsB[s]||[]).length,0);
const upsCn = SEATS.reduce((n,s)=>n+(upsC[s]||[]).length,0);
console.log('exposed cards visible to upCardsBySeat(): mid-pitch=' + upsBn + '  settled=' + upsCn);
console.log('firstActor(): mid-pitch=seat ' + actorB + '  settled=seat ' + actorC);
console.log('round actually started on: seat ' + roundActor);
console.log('');
if(actorB !== actorC){
  console.log('*** REPRODUCED: the action round began on seat ' + roundActor +
              ', but the correct actor once the deal completes is seat ' + actorC + '. ***');
} else {
  console.log('No actor divergence in this configuration.');
}

// AI tier, mid-pitch vs settled, every seat
console.log('');
console.log('--- AI tier classification (RailAction.tierForSeat) ---');
const tiersC = SEATS.map(s2 => prodTier(D.heldCards(s2)));
let tierDiffs = 0;
SEATS.forEach(s2 => {
  const d = tiersB[s2] !== tiersC[s2];
  if(d) tierDiffs++;
  console.log('  seat ' + s2 + ': mid-pitch tier=' + tiersB[s2] + '  settled tier=' + tiersC[s2] + (d ? '   <-- DIFFERS' : ''));
});
console.log('  seats whose tier differs mid-pitch: ' + tierDiffs);

/* ============================================================
   DIAGNOSTIC 2 — flushPendingDeals()
   The call site before showdown comments that mid-pitch cards "are finished
   instantly". This checks whether they are finished, or abandoned.
   ============================================================ */
console.log('');
console.log('================================================================');
console.log('DIAGNOSTIC 2 — flushPendingDeals(): finished, or abandoned?');
console.log('================================================================');
do { D.setScenario(stud); D.setSeats(7); D.setButton(null); D.buildTable(stud, false); }
while(D.getSitOut() !== null);
D.setStep(0); D.updateTableView(0);
const pendBefore = D.pendingDealTimers.length;
const slotBefore = SEATS.map(s2 => (D.seatSlotMaps[s2]||[]).length);
console.log('  pending pitch timers before flush : ' + pendBefore);
console.log('  slot map lengths before flush     : [' + slotBefore.join(' ') + ']');
D.flushPendingDeals();
console.log('  pending pitch timers after flush  : ' + D.pendingDealTimers.length);
await sleep(pendBefore * 160 + 1200);
const slotAfter = SEATS.map(s2 => (D.seatSlotMaps[s2]||[]).length);
const logAfter  = SEATS.map(s2 => (D.seatHoleCards[s2]||[]).length);
console.log('  slot map lengths after flush+wait : [' + slotAfter.join(' ') + ']');
console.log('  logical hand lengths              : [' + logAfter.join(' ') + ']');
const finished = slotAfter.every((n,i) => n === logAfter[i]);
console.log('  pitch callbacks executed?         : ' + (finished ? 'YES' : 'NO — abandoned'));
console.log('  logical hand intact?              : ' +
  (logAfter.every(n => n === pat.hole[0]) ? 'YES (showdown source unaffected)' : 'NO'));

console.log('');
console.log('--- mode reachability (firstActor is computed at 0ms, synchronously) ---');
const stagger = pending + 1 > 14 ? Math.max(70, 130 - ((pending+1) - 14) * 3) : 130;
console.log('6th street pitch window: ' + (pending+1) + ' cards @ ' + stagger + 'ms = ' + pending*stagger + 'ms');
RailModes.modeIds().forEach(id => {
  console.log('  ' + id.padEnd(12) + ' AI action delay=' + RailModes.actionDelay(id) + 'ms');
});
})();
