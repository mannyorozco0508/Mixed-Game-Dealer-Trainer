/* ============================================================
   test-player-experience.js

   Covers the three P0 failures the operations audit found in the live build:

     1. chip rendering crashed for every game capped below seven players
     2. the human could not read their own hole cards in Play & Learn
     3. needsCardChoice()/showCardChoice() existed with no call site, so every
        draw, discard and Super Pat decision was unreachable

   These drive the real production lifecycle out of index.html rather than
   calling helpers, because all three bugs were wiring, not engine logic.

   HONEST LIMIT: this is jsdom. "Readable" means the card element is not
   face-down and carries rank/suit text. Layout, z-index and off-screen
   problems cannot be detected here.
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
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

/* Builds a sandbox spanning the table layer AND the player-mode layer, so the
   card-choice lifecycle and human controls are genuinely reachable. */
function sandbox(){
  const appCode = [
    extract('const overlay = document.getElementById', 'const BUTTON_DEALCATS'),
    extract('const BUTTON_DEALCATS', 'function buildTable(game, isRedeal){\n'),
    extract('function buildTable(game, isRedeal){', '\nfunction startScenario'),
    extract('let cardChoiceSession = null;', '/* ---------------- Training mode & onboarding ---------------- */')
  ].join('\n');

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

  const mods = {
    RailCards: require('./cards-eval.js'), RailShowdown: require('./showdown.js'),
    RailAI: require('./ai-players.js'), RailAction: require('./table-action.js'),
    RailRhythm: require('./betting-rhythm.js'), RailModes: require('./training-modes.js'),
    RailPlayer: require('./player-mode.js'), RailBetting: require('./betting-engine.js'),
    RailMoney: require('./money-state.js'), RailDraw: require('./draw-engine.js'),
    RailHighlight: require('./card-highlight.js'), RailChips: require('./chip-render.js'),
    RailTasks: require('./dealer-tasks.js'), RailErrors: require('./dealer-errors.js'),
    RailCardChoice: require('./card-choice.js'),
    RailDealState, RailHandOpen
  };
  Object.assign(dom.window, mods);

  const bindings = [
    'const { RANKS, SUITS, SUIT_SYMBOL, RED_SUITS, createCard, cardIsRed, cardFaceText, cardHtml } = RailCardModel;',
    'let freshDeck = RailCardModel.freshDeck;',
    'const DEAL_PATTERNS = RailDealPatterns.DEAL_PATTERNS;',
    'const { DATA, tripleDrawSteps, drawmahaCommonSteps, drawmahaScenario, superStudSteps, sevenStudSteps } = RailGameData;'
  ].join('\n');

  const probe = `
    globalThis.APP = {
      findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
      allGames(){ const o=[]; DATA.forEach(c=>c.games.forEach(g=>{ if(g.dealCat) o.push(g); })); return o; },
      get buildTable(){ return buildTable; },
      get updateTableView(){ return updateTableView; },
      get applyFlipState(){ return applyFlipState; },
      get renderChips(){ return typeof renderChips === 'function' ? renderChips : null; },
      get needsCardChoice(){ return needsCardChoice; },
      get needsFixedChoiceBefore(){ return needsFixedChoiceBefore; },
      get pendingChoiceStep(){ return pendingChoiceStep; },
      get showCardChoice(){ return showCardChoice; },
      get confirmCardChoice(){ return confirmCardChoice; },
      get cardChoiceSession(){ return cardChoiceSession; },
      get seatHoleCards(){ return seatHoleCards; },
      get seatSlotMaps(){ return seatSlotMaps; },
      get seatEls(){ return seatEls; },
      get moneyState(){ return moneyState; },
      setScenario(g){ currentScenario = g; },
      setStep(i){ activeStepIndex = i; if(typeof stepIndex !== 'undefined') stepIndex = i; },
      setSeats(n){ tableSeats = n; },
      getSitOut(){ return sitOutSeatIndex; },
      setSession(s){ playerSession = s; },
      get playerSession(){ return playerSession; },

      inPlayerMode(){ return inPlayerMode(); },
      patterns(){ return DEAL_PATTERNS; },
      selectSlot(slot){ window.RailCardChoice.toggleSlot(cardChoiceSession, slot); },
      declarePat(v){ window.RailCardChoice.declarePat(cardChoiceSession, v); }
    };
  `;

  // renderStep and startActionRound live outside the extracted ranges. They
  // are stubbed so advanceAfterCardChoice() can complete; what is under test
  // is the card-choice mutation and the pause/resume wiring, not rendering.
  new Function('document','window','localStorage','console','process',
    'RailCardModel','RailDealPatterns','RailGameData','clearActiveFault','setTimeout',
    'renderStep','startActionRound','globalThis',
    bindings + '\n' + appCode + '\n' + probe
  )(dom.window.document, dom.window, ls, console, process,
    RailCardModel, RailDealPatterns, RailGameData, function(){},
    function(fn){ fn(); return 0; },
    function(){ globalThis.__renderSteps = (globalThis.__renderSteps || 0) + 1; },
    function(){ globalThis.__actionRounds = (globalThis.__actionRounds || 0) + 1; },
    globalThis);

  return { dom, APP: globalThis.APP, mods };
}

const { APP, mods } = sandbox();

function startHand(name, mode){
  const game = APP.findGame(name);
  APP.setSeats(7);
  APP.setScenario(game);
  // Play mode is a property of the session itself — createPlayerSession sets
  // experience: PLAY_AND_LEARN, which is what inPlayerMode() reads.
  if(mode === 'play'){
    APP.setSession(mods.RailPlayer.createPlayerSession({ dealCat: game.dealCat, tableSeats: 7 }));
  } else {
    APP.setSession(null);
  }
  APP.buildTable(game, false);
  if(mode === 'play'){
    const s = APP.playerSession;
    s.humanSeat = mods.RailPlayer.assignHumanSeat(7, APP.getSitOut());
  }
  return game;
}
function readableAt(seat){
  const el = APP.seatEls[seat];
  const c = el && el.querySelector('.seat-cards');
  if(!c) return 0;
  return Array.from(c.children).filter(k =>
    !k.classList.contains('face-down') && (k.textContent || '').trim().length > 0).length;
}
function exposedAt(seat){
  const el = APP.seatEls[seat];
  const c = el && el.querySelector('.seat-cards');
  if(!c) return 0;
  return Array.from(c.children).filter(k => k.classList.contains('physically-up')).length;
}

/* ============================================================
   1. SIT-OUT RENDER CRASH
   ============================================================ */
console.log('=== Games capped below seven players render without crashing ===');
{
  const SIX = ['A-5 Lowball','2-7 Lowball','Badacey','Baducey','Archie',
               'Drawmaha Hi','Drawmaha A-5','Drawmaha 2-7','Drawmaha 49','Drawmaha Badugi'];
  SIX.forEach(name => {
    let crashed = null;
    try {
      const game = startHand(name, 'train');
      const pattern = APP.patterns()[game.dealCat];
      for(let s = 0; s < pattern.hole.length; s++){ APP.setStep(s); APP.updateTableView(s); }
    } catch(e){ crashed = e.message; }
    check(name + ': a full hand renders with a sit-out seat', crashed === null, crashed || '');
    if(crashed) return;
    const out = APP.getSitOut();
    check(name + ': a seat really is sitting out', out !== null, String(out));
    if(out === null) return;
    // The sit-out seat takes no part in money state and shows no wager.
    check(name + ': sit-out seat is absent from money state',
          APP.moneyState.stacks[out] === undefined);
    const el = APP.seatEls[out];
    const wagerEl = el && el.querySelector('.wager-chips');
    check(name + ': sit-out seat shows no phantom wager',
          !wagerEl || (wagerEl.innerHTML || '') === '');
    check(name + ': sit-out seat holds no cards',
          (APP.seatSlotMaps[out] || []).length === 0);
    // Conservation is unaffected by the seat being absent.
    const ms = APP.moneyState;
    const seats = Object.keys(ms.stacks);
    const total = seats.reduce((n,s) => n + ms.stacks[s], 0) + (ms.pot || 0) +
                  seats.reduce((n,s) => n + (ms.streetContrib[s] || 0), 0);
    const start = seats.reduce((n,s) => n + ms.startingStacks[s], 0);
    check(name + ': money conservation exact', total === start, total + ' vs ' + start);
  });
}

/* ============================================================
   2. PLAYER VANTAGE
   ============================================================ */
console.log('');
console.log('=== In Play & Learn the human reads their own hole cards ===');
{
  const CASES = [
    ["Texas Hold'em", 2, 0], ['Big O Hi-Lo', 5, 0], ['Big O PLO', 5, 0],
    ['Double Board Omaha', 5, 0], ['Badugi', 4, 0], ['2-7 Lowball', 5, 0],
    ['A-5 Lowball', 5, 0], ['Badacey', 5, 0], ['Baducey', 5, 0], ['Archie', 5, 0],
    ['Drawmaha Hi', 5, 0], ['Pineapple', 3, 0], ['Crazy Pineapple', 3, 0],
    ['Stud Hi-Lo / 8-or-Better', 3, 1], ['Razz', 3, 1],
    ['Super Stud Hi-Lo 8 / Super Pat', 5, 1]
  ];
  CASES.forEach(([name, own, exposed]) => {
    const game = startHand(name, 'play');
    const pattern = APP.patterns()[game.dealCat];
    const openStep = pattern.hole[0] > 0 ? 0 : 1;
    APP.setStep(openStep);
    APP.updateTableView(openStep);
    const seat = APP.playerSession.humanSeat;

    check(name + ': human reads all ' + own + ' of their own cards',
          readableAt(seat) === own, readableAt(seat) + ' readable');
    check(name + ': only ' + exposed + ' of them are physically exposed',
          exposedAt(seat) === exposed, exposedAt(seat) + ' exposed');

    // Opponents keep their secrets: they show only what the table exposes.
    let leak = 0;
    for(let i = 0; i < 7; i++){
      if(i === seat || i === APP.getSitOut()) continue;
      if(readableAt(i) > exposed) leak++;
    }
    check(name + ': no opponent card is readable beyond what is exposed', leak === 0,
          leak + ' seats leaking');
  });
}

console.log('');
console.log('=== Dealer Training keeps the dealer vantage ===');
{
  [["Texas Hold'em", 0], ['Big O Hi-Lo', 0], ['Stud Hi-Lo / 8-or-Better', 1],
   ['Super Stud Hi-Lo 8 / Super Pat', 1]].forEach(([name, exposed]) => {
    const game = startHand(name, 'train');
    const pattern = APP.patterns()[game.dealCat];
    const openStep = pattern.hole[0] > 0 ? 0 : 1;
    APP.setStep(openStep);
    APP.updateTableView(openStep);
    let readable = 0;
    for(let i = 0; i < 7; i++){ if(i !== APP.getSitOut()) readable = Math.max(readable, readableAt(i)); }
    check(name + ' (training): no hole card is readable, only exposed cards',
          readable === exposed, readable + ' readable, expected ' + exposed);
  });
}

console.log('');
console.log('=== The human keeps reading their hand through later streets ===');
{
  const game = startHand('Stud Hi-Lo / 8-or-Better', 'play');
  const seat = APP.playerSession.humanSeat;
  const pattern = APP.patterns()[game.dealCat];
  let everBlind = false;
  for(let s = 0; s < pattern.hole.length; s++){
    APP.setStep(s); APP.updateTableView(s);
    const held = (APP.seatSlotMaps[seat] || []).length;
    if(held > 0 && readableAt(seat) < held) everBlind = true;
  }
  check('Stud: the human can read every card they hold on every street', !everBlind);
  check('Stud: the human ends able to read all 7 of their cards',
        readableAt(seat) === 7, String(readableAt(seat)));
}

/* ============================================================
   3. CARD-CHOICE LIFECYCLE
   ============================================================ */
console.log('');
console.log('=== Every required human card decision is reachable ===');
{
  // The lifecycle must be invoked from the real advance path, not just exist.
  check('needsCardChoice has a real call site',
        (SRC.match(/needsCardChoice\(\)/g) || []).length > 1,
        String((SRC.match(/needsCardChoice\(\)/g) || []).length));
  check('showCardChoice has a real call site',
        (SRC.match(/showCardChoice\(\)/g) || []).length > 1);
  check('the choice is checked BEFORE the action round starts',
        /needsCardChoice\(\)\)\{ showCardChoice\(\); return; \}[\s\S]{0,200}startActionRound/.test(SRC));

  const DECISION_GAMES = [
    ['Badugi', 'draw'], ['A-5 Lowball', 'draw'], ['2-7 Lowball', 'draw'],
    ['Badacey', 'draw'], ['Baducey', 'draw'], ['Archie', 'draw'],
    ['Drawmaha Hi', 'draw'], ['Drawmaha A-5', 'draw'], ['Drawmaha 2-7', 'draw'],
    ['Drawmaha 49', 'draw'], ['Drawmaha Badugi', 'draw'],
    ['Pineapple', 'discard'], ['Crazy Pineapple', 'discard'],
    ['Super Stud Hi-Lo 8 / Super Pat', 'pat'],
    ['Super Baducey', 'pat'], ['Super Badacey', 'pat']
  ];
  DECISION_GAMES.forEach(([name, kind]) => {
    const game = startHand(name, 'play');
    const pattern = APP.patterns()[game.dealCat];
    let offered = 0, opened = 0;
    for(let s = 0; s < (game.scenario ? game.scenario.length : pattern.hole.length); s++){
      if(APP.needsFixedChoiceBefore(s)){      // gated ahead of the mutation
        offered++; APP.showCardChoice(s);
        if(APP.cardChoiceSession) opened++;
        APP.confirmCardChoice();
      }
      APP.setStep(s);
      APP.updateTableView(Math.min(s, pattern.hole.length - 1));
      if(APP.needsCardChoice()){              // draws: after the street renders
        offered++; APP.showCardChoice();
        if(APP.cardChoiceSession) opened++;
      }
    }
    check(name + ' (' + kind + '): the hand asks the human at least once', offered > 0,
          'offered ' + offered);
    check(name + ': the choice UI actually opens when asked', opened === offered,
          opened + '/' + offered);
  });
}

console.log('');
console.log('=== A pending decision freezes the hand ===');
{
  const game = startHand('2-7 Lowball', 'play');
  const pattern = APP.patterns()[game.dealCat];
  const seat = APP.playerSession.humanSeat;
  let found = false;
  for(let s = 0; s < game.scenario.length && !found; s++){
    APP.setStep(s);
    APP.updateTableView(Math.min(s, pattern.hole.length - 1));
    if(APP.needsCardChoice()){ APP.showCardChoice(); found = true; }
  }
  check('a draw decision was reached', found);
  check('a choice session is open', !!APP.cardChoiceSession);
  check('the human can still read their hand while choosing',
        readableAt(seat) === (APP.seatSlotMaps[seat] || []).length,
        readableAt(seat) + ' readable of ' + (APP.seatSlotMaps[seat] || []).length);

  // Drive the REAL controller path: select through card-choice state, confirm
  // through the real confirm handler.
  const before = (APP.seatSlotMaps[seat] || []).map(i => APP.seatHoleCards[seat][i]);
  APP.selectSlot(0);
  APP.selectSlot(1);
  check('two cards are selected for replacement',
        APP.cardChoiceSession.selected.length === 2);
  APP.confirmCardChoice();
  check('the session closes after confirming', APP.cardChoiceSession === null);
  const after = (APP.seatSlotMaps[seat] || []).map(i => APP.seatHoleCards[seat][i]);
  check('the hand is still the right size after drawing', after.length === before.length,
        after.length + ' vs ' + before.length);
  const key = c => c.rank + c.suit;
  check('the replacement cards are genuinely different',
        JSON.stringify(after.map(key)) !== JSON.stringify(before.map(key)));
  check('no duplicate card in the hand after drawing',
        new Set(after.map(key)).size === after.length);
}

console.log('');
console.log('=== Super Pat: both branches through the real control path ===');
{
  // PAT branch
  const game = startHand('Super Stud Hi-Lo 8 / Super Pat', 'play');
  const pattern = APP.patterns()[game.dealCat];
  const seat = APP.playerSession.humanSeat;
  let opened = false;
  for(let s = 0; s < game.scenario.length && !opened; s++){
    // The GATE: ask before the step renders, so the step's transition has not
    // yet taken any card away.
    if(APP.needsFixedChoiceBefore(s)){ APP.showCardChoice(s); opened = true; break; }
    APP.setStep(s);
    APP.updateTableView(Math.min(s, pattern.hole.length - 1));
  }
  check('Super Stud: the Pat/discard decision is reached', opened);
  check('Super Stud: the human still holds all FIVE cards when asked',
        (APP.seatSlotMaps[seat] || []).length === 5,
        String((APP.seatSlotMaps[seat] || []).length));
  check('Super Stud: all five are readable while deciding',
        readableAt(seat) === 5, String(readableAt(seat)));
  APP.declarePat(true);
  APP.confirmCardChoice();
  check('Super Pat: the seat keeps exactly five cards',
        (APP.seatSlotMaps[seat] || []).length === 5,
        String((APP.seatSlotMaps[seat] || []).length));

  // DISCARD-TWO branch
  const g2 = startHand('Super Stud Hi-Lo 8 / Super Pat', 'play');
  const seat2 = APP.playerSession.humanSeat;
  let opened2 = false;
  for(let s = 0; s < g2.scenario.length && !opened2; s++){
    if(APP.needsFixedChoiceBefore(s)){ APP.showCardChoice(s); opened2 = true; break; }
    APP.setStep(s);
    APP.updateTableView(Math.min(s, pattern.hole.length - 1));
  }
  check('Super Stud: the discard branch is reachable too', opened2);
  const eligible = APP.cardChoiceSession.eligible;
  check('Super Stud: only down cards are eligible to discard',
        eligible.indexOf(4) === -1, JSON.stringify(eligible));
  APP.selectSlot(eligible[0]);
  APP.selectSlot(eligible[1]);
  APP.confirmCardChoice();
  check('Super Stud: the discard branch mutates the real hand',
        (APP.seatSlotMaps[seat2] || []).length > 0,
        String((APP.seatSlotMaps[seat2] || []).length));
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
