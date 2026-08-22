/* ============================================================
   test-drawmaha-board.js

   DRAWMAHA HI NEVER DEALT A RIVER.

   Scenario steps index the deal pattern 1:1. The drawmaha pattern has EIGHT
   entries — board [0,0,3,3,3,4,5,5], burns [0,0,1,0,0,1,1,0] — and the other
   four variants have eight scenario steps, so they line up. Drawmaha Hi
   carried its own inline copy of the shared steps that was two short, so:

     Hi step 4 "Turn"     -> board target 3  (nothing dealt)
     Hi step 5 "Showdown" -> board target 4  (the TURN arrives at showdown)

   Every Drawmaha Hi hand finished on a four-card board, while its own flow
   text and its own showdown prompt both say "River's out".

   These tests exercise PHYSICAL STATE, not scenario strings: a real hand is
   dealt through the production path and the board and burn pile are counted
   after each street.
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

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return (s>>>0)/4294967296; };
}

/* ---------- sandbox driving the real dealing machinery ---------- */
const queue = [];
const fakeSetTimeout = fn => { queue.push(fn); return queue.length; };
const drain = () => { let n = 0; while(queue.length && n < 5000){ queue.shift()(); n++; } };

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
  RailPlayer: require('./player-mode.js'), RailBetting: require('./betting-engine.js'),
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
const probe = `globalThis.BAPP = {
  findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
  get buildTable(){ return buildTable; },
  get updateTableView(){ return updateTableView; },
  get startActionRound(){ return startActionRound; },
  get board(){ return tableBoardCards; },
  get burns(){ return burnCards; },
  get muck(){ return typeof muckPile !== 'undefined' ? muckPile : []; },
  get roundDiscards(){ return roundDiscards; },
  get seatSlotMaps(){ return seatSlotMaps; },
  get seatHoleCards(){ return seatHoleCards; },
  get sitOut(){ return sitOutSeatIndex; },
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
  fakeSetTimeout, function(){}, function(){}, globalThis);

const APP = globalThis.BAPP;
const PATTERN = RailDealPatterns.DEAL_PATTERNS.drawmaha;
const VARIANTS = ['Drawmaha Hi','Drawmaha A-5','Drawmaha 2-7','Drawmaha 49','Drawmaha Badugi'];

/* Deals one full hand and records physical state after every step. */
function playHand(name, seed){
  const g = APP.findGame(name);
  Math.random = rng(seed);
  queue.length = 0;
  APP.setSeats(7); APP.setScenario(g); APP.setSession(null); APP.setMode('practice');
  APP.buildTable(g, false); drain();
  const trace = [];
  for(let step = 0; step < g.scenario.length; step++){
    APP.setStep(step);
    try { APP.updateTableView(step); } catch(e){}
    drain();
    APP.startActionRound();
    drain();
    trace.push({
      step, street: g.scenario[step].street,
      physicalDraw: !!g.scenario[step].requiresDraw,
      board: (APP.board || []).length,
      burns: (APP.burns || []).length,
      boardKeys: (APP.board || []).map(c => c.rank + c.suit),
      burnKeys:  (APP.burns || []).map(c => c.rank + c.suit)
    });
  }
  return { game: g, trace };
}

console.log('=== The pattern is eight streets, and every variant matches it ===');
{
  check('the drawmaha pattern declares eight steps', PATTERN.board.length === 8,
        String(PATTERN.board.length));
  check('its board targets end at five', PATTERN.board[PATTERN.board.length - 1] === 5,
        JSON.stringify(PATTERN.board));
  VARIANTS.forEach(name => {
    const g = APP.findGame(name);
    check(name + ': scenario is long enough to reach the river',
          g.scenario.length >= 7, 'steps=' + g.scenario.length);
    check(name + ': its final step reaches a five-card board target',
          PATTERN.board[g.scenario.length - 1] === 5,
          'target=' + PATTERN.board[g.scenario.length - 1]);
  });
}

console.log('=== Every variant physically reaches a five-card board ===');
{
  VARIANTS.forEach((name, i) => {
    const { trace } = playHand(name, 8100 + i * 37);
    const last = trace[trace.length - 1];
    const flop  = trace.find(t => t.board === 3);
    const turn  = trace.find(t => t.board === 4);
    const river = trace.find(t => t.board === 5);

    check(name + ': the flop arrives', !!flop);
    check(name + ': the turn arrives', !!turn, 'boards=' + trace.map(t=>t.board).join(','));
    check(name + ': the RIVER arrives', !!river, 'boards=' + trace.map(t=>t.board).join(','));
    check(name + ': the hand ends on exactly five board cards', last.board === 5,
          'ended on ' + last.board);
    check(name + ': never a sixth board card', trace.every(t => t.board <= 5),
          'max=' + Math.max.apply(null, trace.map(t=>t.board)));

    check(name + ': exactly one physical draw', trace.filter(t => t.physicalDraw).length === 1,
          String(trace.filter(t => t.physicalDraw).length));
    const drawStep = trace.find(t => t.physicalDraw);
    const prior = trace[drawStep.step - 1];
    check(name + ': the replacement draw takes NO burn of its own',
          drawStep.burns === prior.burns,
          prior.burns + ' -> ' + drawStep.burns);

    check(name + ': three board burns in total', last.burns === 3, String(last.burns));
    check(name + ': burns only ever increase', trace.every((t, k) => k === 0 || t.burns >= trace[k-1].burns));
  });
}

console.log('=== Burn identities never reach the board ===');
{
  VARIANTS.forEach((name, i) => {
    const { trace } = playHand(name, 8600 + i * 53);
    const last = trace[trace.length - 1];
    const overlap = last.boardKeys.filter(k => last.burnKeys.indexOf(k) !== -1);
    check(name + ': no burned card appears on the board', overlap.length === 0, overlap.join(','));
    check(name + ': the board holds five distinct cards',
          new Set(last.boardKeys).size === 5, last.boardKeys.join(','));
    check(name + ': burns are distinct from each other',
          new Set(last.burnKeys).size === last.burnKeys.length);

    // Nothing a player holds may also be on the board or in the burn pile.
    const held = [];
    for(let s = 0; s < 7; s++){
      const m = APP.seatSlotMaps[s] || [];
      m.map(x => (APP.seatHoleCards[s] || [])[x]).filter(Boolean)
       .forEach(c => held.push(c.rank + c.suit));
    }
    const all = held.concat(last.boardKeys).concat(last.burnKeys);
    check(name + ': no duplicate identity anywhere in play',
          new Set(all).size === all.length,
          String(all.length - new Set(all).size) + ' duplicate(s)');
  });
}

console.log('=== The river comes after its own burn, in order ===');
{
  VARIANTS.forEach((name, i) => {
    const { trace } = playHand(name, 9100 + i * 71);
    let turnIdx = -1, riverIdx = -1;
    trace.forEach((t, k) => {
      if(t.board === 4 && turnIdx === -1) turnIdx = k;
      if(t.board === 5 && riverIdx === -1) riverIdx = k;
    });
    check(name + ': the river street comes after the turn street', riverIdx > turnIdx,
          'turn@' + turnIdx + ' river@' + riverIdx);
    check(name + ': the river street adds exactly one board card',
          trace[riverIdx].board - trace[riverIdx - 1].board === 1);
    check(name + ': and exactly one burn',
          trace[riverIdx].burns - trace[riverIdx - 1].burns === 1,
          trace[riverIdx - 1].burns + ' -> ' + trace[riverIdx].burns);
    // The flop/turn/river cards are each new identities.
    check(name + ': the river card was not already on the board',
          trace[riverIdx].boardKeys.slice(0, 4).join(',') === trace[riverIdx - 1].boardKeys.join(','),
          trace[riverIdx - 1].boardKeys.join(',') + ' -> ' + trace[riverIdx].boardKeys.join(','));
  });
}

console.log('=== Two consecutive hands both reach the river ===');
{
  VARIANTS.forEach((name, i) => {
    const a = playHand(name, 9600 + i * 29);
    const b = playHand(name, 9700 + i * 29);
    check(name + ': hand 1 reaches five board cards',
          a.trace[a.trace.length - 1].board === 5);
    check(name + ': hand 2 also reaches five board cards',
          b.trace[b.trace.length - 1].board === 5);
    check(name + ': hand 2 still runs exactly one physical draw',
          b.trace.filter(t => t.physicalDraw).length === 1);
    check(name + ': the two hands are genuinely different deals',
          a.trace[a.trace.length - 1].boardKeys.join(',') !==
          b.trace[b.trace.length - 1].boardKeys.join(','));
  });
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
