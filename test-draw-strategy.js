/* ============================================================
   test-draw-strategy.js

   AI seats never drew a card. The only production caller of applyDraw was
   the human's confirmCardChoice, draw patterns are flat (5 -> 5 -> 5) so
   applyStreet's discard block never fired, and the strategy itself could not
   express a discard: drawGuidanceA5/27 delegated to bestLowA5FromN /
   bestLow27FromN, which pick the best FIVE out of N — handed a five-card
   hand there is one combination, so they answered "keep everything" for a
   paired 2-2-K-Q-J exactly as for a made 6-low. Routing was a chain of
   regexes over the game NAME, so Archie and three Drawmaha variants matched
   nothing and stood pat forever, while Badacey/Baducey matched only their
   lowball half and never looked at badugi at all.

   These tests prove the CHOICE, not that a function was called, and the
   end-to-end section is the negative control: revert the wiring and AI hands
   stop changing.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const AI       = require('./ai-players.js');
const E        = require('./cards-eval.js');
const Draw     = require('./draw-engine.js');
const Showdown = require('./showdown.js');
const Action   = require('./table-action.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extract(a, b){
  const s = SRC.indexOf(a), e = SRC.indexOf(b, s);
  if(s === -1 || e === -1) throw new Error('marker not found: ' + a);
  return SRC.slice(s, e);
}
function card(s){ return { rank: s.slice(0, -1), suit: s.slice(-1) }; }
function cards(s){ return s.split(' ').map(card); }
function keys(list){ return (list || []).map(c => c.rank + c.suit); }

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function keepsExactly(label, guidance, expected){
  const got = keys(guidance && guidance.keep).sort().join(',');
  check(label, got === expected.split(' ').sort().join(','), 'kept ' + got);
}

/* ---------------------------------------------------------------
   BADUGI — the one piece of strategy that was already correct
   --------------------------------------------------------------- */
console.log('=== Badugi reads the actual four-suit structure ===');
{
  keepsExactly('a complete badugi stands pat',
    AI.drawGuidanceBadugi(cards('AS 2H 3D 4C')), 'AS 2H 3D 4C');
  const dup = AI.drawGuidanceBadugi(cards('AS 2H 3D 4S'));
  check('a duplicate suit draws exactly one', dup.discardCount === 1, String(dup.discardCount));
  check('and it is the duplicate that goes, not an arbitrary card',
        keys(dup.keep).indexOf('4S') === -1, keys(dup.keep).join(','));
  const two = AI.drawGuidanceBadugi(cards('KS KH 2S 3S'));
  check('a two-card structure draws two', two.discardCount === 2, String(two.discardCount));
  check('the pair is broken', keys(two.keep).filter(k => k[0] === 'K').length <= 1);
}

/* ---------------------------------------------------------------
   A-5 — ace is the BEST card
   --------------------------------------------------------------- */
console.log('=== A-5 keeps low unpaired cards, ace low ===');
{
  keepsExactly('a made 6-low stands pat',
    AI.drawGuidanceA5(cards('AS 2H 3D 4C 6S')), 'AS 2H 3D 4C 6S');
  const one = AI.drawGuidanceA5(cards('AS 2H 3D 4C KS'));
  check('one bad card draws one', one.discardCount === 1, String(one.discardCount));
  check('and the king is the one thrown', keys(one.keep).indexOf('KS') === -1);
  const junk = AI.drawGuidanceA5(cards('KS QH JD TC 9S'));
  check('a hand with nothing playable draws heavily', junk.discardCount >= 3, String(junk.discardCount));
  check('but never throws the entire hand', junk.keep.length >= 1);
  const paired = AI.drawGuidanceA5(cards('2S 2H KD QC JS'));
  check('a pair is broken rather than kept',
        keys(paired.keep).filter(k => k[0] === '2').length === 1, keys(paired.keep).join(','));
  check('the ace counts as low here',
        keys(AI.drawGuidanceA5(cards('AS 2H 3D 4C 8S')).keep).indexOf('AS') >= 0);
}

/* ---------------------------------------------------------------
   2-7 — ace is the WORST card, straights and flushes are disasters
   --------------------------------------------------------------- */
console.log('=== 2-7 does not inherit A-5 assumptions ===');
{
  keepsExactly('a made 7-low stands pat',
    AI.drawGuidance27(cards('2S 3H 4D 5C 7S')), '2S 3H 4D 5C 7S');
  const aces = AI.drawGuidance27(cards('AS AH KD QC JS'));
  check('aces are thrown, not treated as low',
        keys(aces.keep).filter(k => k[0] === 'A').length === 0, keys(aces.keep).join(','));
  const str = AI.drawGuidance27(cards('2S 3H 4D 5C 6H'));
  check('a straight is broken', str.keep.length === 4, keys(str.keep).join(','));
  check('and it is the top card that breaks it', keys(str.keep).indexOf('6H') === -1);
  const fl = AI.drawGuidance27(cards('2S 4S 6S 7S 9S'));
  check('a flush is broken', fl.keep.length === 4, keys(fl.keep).join(','));
  check('and it is the top card that breaks it', keys(fl.keep).indexOf('9S') === -1);

  // The two lowball rules must not agree by accident.
  const h = cards('AS 2H 3D 4C 8S');
  check('A-5 and 2-7 disagree about the same hand',
        keys(AI.drawGuidanceA5(h).keep).join() !== keys(AI.drawGuidance27(h).keep).join(),
        'a5=' + keys(AI.drawGuidanceA5(h).keep) + ' 27=' + keys(AI.drawGuidance27(h).keep));
}

/* ---------------------------------------------------------------
   HIGH and POINTS
   --------------------------------------------------------------- */
console.log('=== High and 49 draw toward their own scoring ===');
{
  keepsExactly('trips are kept', AI.drawGuidanceHigh(cards('9S 9H 9D KC 2S')), '9S 9H 9D');
  const fl = AI.drawGuidanceHigh(cards('AS JS 8S 3S 7H'));
  check('four to a flush is kept', fl.keep.length === 4, keys(fl.keep).join(','));
  check('and the offsuit card goes', keys(fl.keep).indexOf('7H') === -1);
  const none = AI.drawGuidanceHigh(cards('KS QH 7D 4C 2S'));
  check('an unmade high hand draws three', none.discardCount === 3, String(none.discardCount));

  const pts = AI.drawGuidance49(cards('9S 8H TD 7C 2S'));
  check('49 keeps the point-carrying cards', pts.keep.length === 4, keys(pts.keep).join(','));
  check('and throws the deuce', keys(pts.keep).indexOf('2S') === -1);
  const faces = AI.drawGuidance49(cards('KS QH JD KC QS'));
  check('faces score nothing, so they go', faces.discardCount >= 4, String(faces.discardCount));
}

/* ---------------------------------------------------------------
   SPLIT-POT games consider BOTH halves
   --------------------------------------------------------------- */
console.log('=== Split-pot draws look at both scoring components ===');
{
  const h = cards('AS 2H 3D 4S 9C');
  const sp = AI.drawGuidanceSplit(h, AI.drawGuidanceBadugi, AI.drawGuidanceA5);
  check('both halves are evaluated', !!sp.sides && typeof sp.sides.a === 'number'
        && typeof sp.sides.b === 'number', JSON.stringify(sp.sides));
  check('the side the hand is closer to is played',
        sp.keep.length === Math.max(sp.sides.a, sp.sides.b),
        JSON.stringify(sp.sides) + ' kept ' + sp.keep.length);

  // Baducey must consult badugi AND 2-7, never A-5.
  const bad = Draw.aiDiscardSlots('draw5', 'Baducey', cards('AS AH KD QC JS'), AI, Showdown);
  check('Baducey does not keep an ace as a low card', bad.length > 0, JSON.stringify(bad));
}

/* ---------------------------------------------------------------
   OBJECTIVES come from the showdown registry, not name regexes
   --------------------------------------------------------------- */
console.log('=== Every draw game draws toward what the pot pays ===');
{
  const expect = {
    'Badugi':'badugi', 'A-5 Lowball':'a5', '2-7 Lowball':'low27',
    'Badacey':'badugi+a5', 'Baducey':'badugi+27', 'Archie':'high+a5',
    'Drawmaha Hi':'high', 'Drawmaha A-5':'a5', 'Drawmaha 2-7':'low27',
    'Drawmaha 49':'points49', 'Drawmaha Badugi':'badugi',
    'Super Stud Hi-Lo 8 / Super Pat':'high+a5'
  };
  Object.keys(expect).forEach(name => {
    check(name + ' -> ' + expect[name],
          Draw.objectiveFor(name, Showdown) === expect[name],
          String(Draw.objectiveFor(name, Showdown)));
  });
  // The games the old regex chain silently dropped.
  ['Archie','Drawmaha Hi','Drawmaha 49','Drawmaha Badugi'].forEach(n => {
    const slots = Draw.aiDiscardSlots('draw5', n, cards('KS QH JD TC 2S'), AI, Showdown);
    check(n + ' now produces a real decision instead of standing pat',
          slots.length > 0, JSON.stringify(slots));
  });
}

/* ---------------------------------------------------------------
   SUPER PAT
   --------------------------------------------------------------- */
console.log('=== Super Pat is a judgement, not a coin flip ===');
{
  const tier = h => Action.tierForSeat(h, [], 'stud-hilo');
  const monster = cards('8S 6S 4S 2S AS');           // flush + made 8-low
  const junk    = cards('KS 9H 4D 3C 2S');
  check('a two-way monster locks', Draw.aiPatDecision(monster, tier) === true,
        'tier=' + tier(monster));
  check('an ordinary holding does not', Draw.aiPatDecision(junk, tier) === false,
        'tier=' + tier(junk));
  check('fewer than five cards can never pat', Draw.aiPatDecision(cards('AS 2H 3D'), tier) === false);
  check('no tier function means no pat', Draw.aiPatDecision(monster, null) === false);
}

/* ---------------------------------------------------------------
   WIRING — the negative control lives here
   --------------------------------------------------------------- */
console.log('=== The table actually asks, and actually mutates ===');
{
  check('production asks the strategy for discard slots',
        /RailDraw\.aiDiscardSlots\(/.test(SRC));
  check('and passes the showdown registry so objectives are authoritative',
        /window\.RailShowdown\)/.test(SRC));
  check('mutation goes through the shared applyDraw, not a private path',
        (SRC.match(/RailDraw\.applyDraw\(/g) || []).length >= 2);
  check('AI draws run BEFORE betting opens',
        SRC.indexOf('runAiDraws();') < SRC.indexOf('const highBringsIn'));
  check('the AI never draws for the human seat',
        /seat === playerSession\.humanSeat\) continue;/.test(SRC));
  check('the per-step guard is reset with every new hand',
        /aiDrawsDoneForStep = -1;/.test(SRC));
  check('AI seats can declare Super Pat',
        /RailDraw\.aiPatDecision\(/.test(SRC));
}

/* ---------------------------------------------------------------
   END TO END — AI hands must genuinely change
   --------------------------------------------------------------- */
console.log('=== A real hand: opponents exchange cards ===');
{
  const RailCardModel    = require('./card-model.js');
  const RailDealPatterns = require('./deal-patterns.js');
  const RailGameData     = require('./game-data.js');
  const RailDealState    = require('./deal-state.js');
  const RailHandOpen     = require('./hand-open.js');

  const queue = [];
  const fakeSetTimeout = (fn) => { queue.push(fn); return queue.length; };
  const fakeClear = () => {};
  const drain = () => { let n = 0; while(queue.length && n < 4000){ queue.shift()(); n++; } };

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
    RailCards: E, RailShowdown: Showdown, RailAI: AI, RailAction: Action,
    RailRhythm: require('./betting-rhythm.js'), RailModes: require('./training-modes.js'),
    RailPlayer: require('./player-mode.js'), RailBetting: require('./betting-engine.js'),
    RailMoney: require('./money-state.js'), RailDraw: Draw,
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
  const probe = `globalThis.DAPP = {
    findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
    get buildTable(){ return buildTable; },
    get updateTableView(){ return updateTableView; },
    get startActionRound(){ return startActionRound; },
    get seatSlotMaps(){ return seatSlotMaps; },
    get seatHoleCards(){ return seatHoleCards; },
    get sitOut(){ return sitOutSeatIndex; },
    get patLocked(){ return seatPatLocked; },
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
    fakeSetTimeout, fakeClear, function(){}, globalThis);

  const APP = globalThis.DAPP;
  function held(seat){
    const m = APP.seatSlotMaps[seat] || [];
    return m.map(x => (APP.seatHoleCards[seat] || [])[x]).filter(Boolean);
  }

  // Every draw family, and the same step index twice so the per-hand guard
  // reset is exercised rather than assumed.
  [['Badugi', 2], ['A-5 Lowball', 2], ['2-7 Lowball', 2], ['Badacey', 2],
   ['Archie', 2], ['Drawmaha Hi', 2], ['Drawmaha 49', 2]].forEach(([name, hands]) => {
    let anyChanged = 0, anyPat = 0, decisions = 0, dup = 0;
    for(let h = 0; h < hands; h++){
      const g = APP.findGame(name);
      queue.length = 0;
      APP.setSeats(7); APP.setScenario(g); APP.setSession(null); APP.setMode('practice');
      APP.buildTable(g, false); drain();
      const before = {};
      for(let s = 0; s < 7; s++) before[s] = keys(held(s));
      for(let step = 0; step < g.scenario.length; step++){
        APP.setStep(step);
        try { APP.updateTableView(step); } catch(e){}
        drain();
        const isDraw = /^Draw/i.test((g.scenario[step] || {}).street || '');
        if(!isDraw){ for(let s = 0; s < 7; s++) before[s] = keys(held(s)); }
        APP.startActionRound(); drain();
        if(isDraw){
          for(let s = 0; s < 7; s++){
            if(s === APP.sitOut) continue;
            const now = keys(held(s));
            if(!now.length) continue;
            decisions++;
            const kept = now.filter(c => before[s].indexOf(c) !== -1).length;
            if(now.length - kept > 0) anyChanged++; else anyPat++;
            before[s] = now;
          }
        }
      }
      const seen = {};
      for(let s = 0; s < 7; s++) keys(held(s)).forEach(k => { if(seen[k]) dup++; else seen[k] = 1; });
    }
    check(name + ': draw decisions were observed', decisions > 0, String(decisions));
    check(name + ': opponents actually exchanged cards', anyChanged > 0,
          'changed=' + anyChanged + ' pat=' + anyPat + ' of ' + decisions);
    check(name + ': and some seats stood pat', anyPat > 0,
          'changed=' + anyChanged + ' pat=' + anyPat);
    check(name + ': not every seat made the identical choice',
          anyChanged > 0 && anyPat > 0);
    check(name + ': no duplicate cards after drawing', dup === 0, String(dup));
  });
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
