/* ============================================================
   test-big-o-button.js

   Big O is dealt from a button with blinds. index.html decides whether a hand
   GETS a button; table-action.js decides how action MOVES around one. When the
   two lists disagreed, Big O was built with buttonSeatIndex = null while the
   action engine treated it as a button game — firstActor returned null and
   every betting round closed before anyone acted. Across 80 audited hands: no
   button, no blinds, no human turn, in either Big O game.

   These tests pin both halves: the two lists must stay identical, and a real
   Big O hand must produce a button, blinds and a live action round.
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
const RailAction       = require('./table-action.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}

console.log('=== The two button lists must not drift apart ===');
{
  const grab = src => {
    const m = /BUTTON_DEALCATS = new Set\(\[([^\]]*)\]\)/.exec(src);
    if(!m) return null;
    return m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  };
  const inHtml = grab(SRC);
  const inAction = grab(fs.readFileSync(path.join(__dirname, 'table-action.js'), 'utf8'));
  check('index.html declares a button list', !!inHtml);
  check('table-action.js declares a button list', !!inAction);
  check('the two lists are identical',
        JSON.stringify(inHtml) === JSON.stringify(inAction),
        JSON.stringify(inHtml) + ' vs ' + JSON.stringify(inAction));
  check('bigO is in the list', inHtml.includes('bigO'), JSON.stringify(inHtml));
  // Every button dealCat the action engine knows must also be one the table builds.
  ['bigO','holdem','doubleBoard','drawmaha','pineapple','crazyPineapple','draw4','draw5']
    .forEach(dc => {
      check(dc + ': table and action engine agree it is a button game',
            inHtml.includes(dc) === RailAction.isButtonGame(dc),
            'html=' + inHtml.includes(dc) + ' action=' + RailAction.isButtonGame(dc));
    });
  // Stud formats must NOT be button games in either place.
  ['studSplit','superStud'].forEach(dc => {
    check(dc + ': correctly NOT a button game in either place',
          !inHtml.includes(dc) && !RailAction.isButtonGame(dc));
  });
}

/* A real hand, through the production table code. */
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
    RailAI: require('./ai-players.js'), RailAction,
    RailRhythm: require('./betting-rhythm.js'), RailModes: require('./training-modes.js'),
    RailPlayer: require('./player-mode.js'), RailBetting: require('./betting-engine.js'),
    RailMoney: require('./money-state.js'), RailDraw: require('./draw-engine.js'),
    RailHighlight: require('./card-highlight.js'), RailChips: require('./chip-render.js'),
    RailTasks: require('./dealer-tasks.js'), RailErrors: require('./dealer-errors.js'),
    RailCardChoice: require('./card-choice.js'), RailDealState, RailHandOpen
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
      findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name===n) return g; return null; },
      get buildTable(){ return buildTable; },
      get updateTableView(){ return updateTableView; },
      get startActionRound(){ return startActionRound; },
      get moneyState(){ return moneyState; },
      get currentRound(){ return currentRound; },
      get seatSlotMaps(){ return seatSlotMaps; },
      setScenario(g){ currentScenario = g; },
      setStep(i){ activeStepIndex = i; },
      setSeats(n){ tableSeats = n; },
      getButton(){ return buttonSeatIndex; },
      getSitOut(){ return sitOutSeatIndex; },
      setSession(s){ playerSession = s; },
      get playerSession(){ return playerSession; },
      patterns(){ return DEAL_PATTERNS; },
      humanOptions(seat){ return window.RailPlayer.humanActions(currentRound, moneyState, seat,
        activeStepIndex, { action: window.RailAction, money: window.RailMoney }) || []; },
      isAi(seat){ return window.RailPlayer.isAiControlled(playerSession, seat); }
    };
  `;
  new Function('document','window','localStorage','console','process',
    'RailCardModel','RailDealPatterns','RailGameData','clearActiveFault','setTimeout',
    'renderStep','globalThis',
    bindings + '\n' + appCode + '\n' + probe
  )(dom.window.document, dom.window, ls, console, process,
    RailCardModel, RailDealPatterns, RailGameData, function(){},
    function(fn){ fn(); return 0; }, function(){}, globalThis);
  return { APP: globalThis.APP, mods };
}

const { APP, mods } = sandbox();

console.log('');
console.log('=== A real Big O hand gets a button, blinds and live action ===');
['Big O Hi-Lo', 'Big O PLO'].forEach(name => {
  let buttons = 0, blinded = 0, actionRounds = 0, humanTurns = 0, hands = 0;
  for(let seed = 0; seed < 10; seed++){
    const game = APP.findGame(name);
    APP.setSeats(7);
    APP.setScenario(game);
    APP.setSession(mods.RailPlayer.createPlayerSession({ dealCat: game.dealCat, tableSeats: 7 }));
    APP.buildTable(game, seed > 0);
    APP.playerSession.humanSeat = mods.RailPlayer.assignHumanSeat(7, APP.getSitOut());
    const seat = APP.playerSession.humanSeat;
    hands++;
    if(APP.getButton() !== null && APP.getButton() !== undefined) buttons++;
    // Blinds are posted at hand build for a button game.
    const ms = APP.moneyState;
    const posted = Object.keys(ms.streetContrib).filter(k => (ms.streetContrib[k] || 0) > 0);
    if(posted.length >= 2) blinded++;

    const pattern = APP.patterns()[game.dealCat];
    for(let s = 0; s < game.scenario.length; s++){
      APP.setStep(s);
      APP.updateTableView(Math.min(s, pattern.hole.length - 1));
      if(s > 0){
        APP.startActionRound();
        const r = APP.currentRound;
        if(r && r.current !== null && r.current !== undefined){
          actionRounds++;
          if(r.current === seat && APP.humanOptions(seat).length > 0) humanTurns++;
        }
      }
    }
  }
  check(name + ': every hand has a button seat', buttons === hands, buttons + '/' + hands);
  check(name + ': every hand posts blinds', blinded === hands, blinded + '/' + hands);
  check(name + ': betting rounds actually open', actionRounds > 0, String(actionRounds));
  check(name + ': the human is given real turns', humanTurns > 0, String(humanTurns));
});

console.log('');
console.log('=== Stud formats still have no button ===');
['Stud Hi-Lo / 8-or-Better', 'Razz', 'Super Stud Hi-Lo 8 / Super Pat'].forEach(name => {
  const game = APP.findGame(name);
  APP.setSeats(7);
  APP.setScenario(game);
  APP.setSession(null);
  APP.buildTable(game, false);
  check(name + ': no button (bring-in format)', APP.getButton() === null, String(APP.getButton()));
});

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
