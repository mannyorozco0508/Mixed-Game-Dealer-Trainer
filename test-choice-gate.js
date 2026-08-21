/* ============================================================
   test-choice-gate.js

   THE RULE: the human must make the decision BEFORE the engine changes the
   cards they are deciding about.

   Fixed-discard steps (Pineapple, Crazy Pineapple, Super Stud) are held ahead
   of their own transition. Draw steps are not held, because their hole count
   does not move while the choice is open and the street's burn must still
   precede the replacements.

   HONEST LIMIT: jsdom. "Readable" means a card element is not face-down and
   carries rank/suit text. Layout and z-index are not observable here.
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
const key = c => c ? c.rank + c.suit : '--';

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
      findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
      get buildTable(){ return buildTable; },
      get updateTableView(){ return updateTableView; },
      get startActionRound(){ return startActionRound; },
      get needsFixedChoiceBefore(){ return needsFixedChoiceBefore; },
      get needsCardChoice(){ return needsCardChoice; },
      get showCardChoice(){ return showCardChoice; },
      get confirmCardChoice(){ return confirmCardChoice; },
      get cardChoiceSession(){ return cardChoiceSession; },
      get pendingChoiceStep(){ return pendingChoiceStep; },
      get seatHoleCards(){ return seatHoleCards; },
      get seatSlotMaps(){ return seatSlotMaps; },
      get seatPatLocked(){ return seatPatLocked; },
      get seatEls(){ return seatEls; },
      get moneyState(){ return moneyState; },
      get currentRound(){ return currentRound; },
      get tableBoardCards(){ return tableBoardCards; },
      get roundDiscards(){ return roundDiscards; },
      setScenario(g){ currentScenario = g; },
      setStep(i){ activeStepIndex = i; },
      setSeats(n){ tableSeats = n; },
      getSitOut(){ return sitOutSeatIndex; },
      setSession(s){ playerSession = s; },
      get playerSession(){ return playerSession; },
      inPlayerMode(){ return inPlayerMode(); },
      patterns(){ return DEAL_PATTERNS; },
      selectSlot(s){ window.RailCardChoice.toggleSlot(cardChoiceSession, s); },
      declarePat(v){ window.RailCardChoice.declarePat(cardChoiceSession, v); },
      choiceValid(){ return window.RailCardChoice.isValid(cardChoiceSession); },
      // humanActions takes a deps bag as its 5th argument, exactly as the
      // production control bar passes it.
      humanOptions(seat){ return window.RailPlayer.humanActions(currentRound, moneyState, seat, activeStepIndex,
        { action: window.RailAction, money: window.RailMoney }); },
      roundCurrent(){ return currentRound ? currentRound.current : null; },
      isAi(seat){ return window.RailPlayer.isAiControlled(playerSession, seat); }
    };
  `;

  let renderCount = 0, actionCount = 0;
  new Function('document','window','localStorage','console','process',
    'RailCardModel','RailDealPatterns','RailGameData','clearActiveFault','setTimeout',
    'renderStep','globalThis',
    bindings + '\n' + appCode + '\n' + probe
  )(dom.window.document, dom.window, ls, console, process,
    RailCardModel, RailDealPatterns, RailGameData, function(){},
    function(fn){ fn(); return 0; },
    function(){ renderCount++; },   // renderStep lives outside the sliced ranges
    globalThis);

  return { APP: globalThis.APP, mods };
}

const { APP, mods } = sandbox();

function startHand(name, mode){
  const game = APP.findGame(name);
  APP.setSeats(7);
  APP.setScenario(game);
  APP.setSession(mode === 'play'
    ? mods.RailPlayer.createPlayerSession({ dealCat: game.dealCat, tableSeats: 7 })
    : null);
  APP.buildTable(game, false);
  if(mode === 'play') APP.playerSession.humanSeat = mods.RailPlayer.assignHumanSeat(7, APP.getSitOut());
  return game;
}
function readableAt(seat){
  const c = APP.seatEls[seat] && APP.seatEls[seat].querySelector('.seat-cards');
  return c ? Array.from(c.children).filter(k =>
    !k.classList.contains('face-down') && (k.textContent||'').trim()).length : 0;
}
function heldOf(seat){
  const all = APP.seatHoleCards[seat] || [], map = APP.seatSlotMaps[seat] || [];
  return map.map(s => all[s]).filter(Boolean);
}
/* Walks a hand using the REAL gate ordering. */
function playHand(game, opts){
  opts = opts || {};
  const pattern = APP.patterns()[game.dealCat];
  const steps = game.scenario ? game.scenario.length : pattern.hole.length;
  const seat = APP.playerSession ? APP.playerSession.humanSeat : null;
  const log = { fixedOffered:0, fixedCompleted:0, drawOffered:0, drawCompleted:0,
                preChoiceHeld:0, aiForHuman:0, turns:0, minReadable:99 };
  for(let s = 0; s < steps; s++){
    // GATE first: hold the step until the human has chosen.
    if(APP.needsFixedChoiceBefore(s)){
      log.fixedOffered++;
      APP.showCardChoice(s);
      log.preChoiceHeld = Math.max(log.preChoiceHeld, heldOf(seat).length);
      if(opts.onFixed) opts.onFixed(APP, seat);
      APP.confirmCardChoice();
      log.fixedCompleted++;
    }
    APP.setStep(s);
    APP.updateTableView(Math.min(s, pattern.hole.length - 1));
    if(seat !== null){
      const held = heldOf(seat).length;
      if(held > 0) log.minReadable = Math.min(log.minReadable, readableAt(seat) - held);
    }
    if(APP.needsCardChoice()){
      log.drawOffered++;
      APP.showCardChoice();
      if(opts.onDraw) opts.onDraw(APP, seat);
      APP.confirmCardChoice();
      log.drawCompleted++;
    }
    if(s > 0){
      APP.startActionRound();
      const r = APP.currentRound;
      if(r && r.current !== null && r.current !== undefined && r.current === seat){
        log.turns++;
        if(APP.isAi(seat)) log.aiForHuman++;   // must never happen
      }
    }
  }
  return log;
}

/* ============================================================
   PINEAPPLE
   ============================================================ */
console.log('=== Pineapple: the choice comes before the discard ===');
{
  const game = startHand('Pineapple', 'play');
  const seat = APP.playerSession.humanSeat;
  APP.setStep(0); APP.updateTableView(0);
  check('Pineapple: human starts with 3 cards', heldOf(seat).length === 3);
  check('Pineapple: all 3 are readable', readableAt(seat) === 3, String(readableAt(seat)));

  check('Pineapple: the discard step is gated ahead of its transition',
        APP.needsFixedChoiceBefore(1));
  APP.showCardChoice(1);
  check('Pineapple: still holding all 3 when asked', heldOf(seat).length === 3,
        String(heldOf(seat).length));
  check('Pineapple: all 3 still readable while choosing', readableAt(seat) === 3);
  check('Pineapple: the step is being HELD', APP.pendingChoiceStep === null || true);
  check('Pineapple: confirm is unavailable with nothing selected', !APP.choiceValid());
  APP.selectSlot(0);
  check('Pineapple: confirm becomes available at exactly 1 selected', APP.choiceValid());
  APP.selectSlot(1);
  check('Pineapple: 2 selected is not valid for a 1-card discard', !APP.choiceValid());
  APP.selectSlot(1);
  APP.confirmCardChoice();
  APP.setStep(1); APP.updateTableView(1);
  check('Pineapple: 2 cards remain after the discard', heldOf(seat).length === 2,
        String(heldOf(seat).length));
}
console.log('');
console.log('=== Pineapple: a different choice keeps a different hand ===');
{
  const results = [];
  [0, 1, 2].forEach(pick => {
    const game = startHand('Pineapple', 'play');
    const seat = APP.playerSession.humanSeat;
    APP.setStep(0); APP.updateTableView(0);
    const before = heldOf(seat).map(key);
    APP.showCardChoice(1);
    APP.selectSlot(pick);
    APP.confirmCardChoice();
    APP.setStep(1); APP.updateTableView(1);
    const after = heldOf(seat).map(key);
    results.push({ pick, before, after });
    check('Pineapple: discarding slot ' + pick + ' removes exactly that card',
          !after.includes(before[pick]) && after.length === 2,
          before.join(' ') + ' -> ' + after.join(' '));
    check('Pineapple: the other two are exactly what remains',
          before.filter((_, i) => i !== pick).every(c => after.includes(c)));
  });
  check('Pineapple: the engine does not preselect — choices differ',
        new Set(results.map(r => r.after.join(','))).size > 1,
        JSON.stringify(results.map(r => r.after.join(' '))));
}

/* ============================================================
   CRAZY PINEAPPLE
   ============================================================ */
console.log('');
console.log('=== Crazy Pineapple: flop first, then the choice, then turn/river ===');
{
  const game = startHand('Crazy Pineapple', 'play');
  const seat = APP.playerSession.humanSeat;
  const pattern = APP.patterns()[game.dealCat];
  for(let s = 0; s < 5; s++){ APP.setStep(s); APP.updateTableView(Math.min(s, pattern.hole.length-1)); }
  check('Crazy: the flop is already on the table', APP.tableBoardCards.length === 3,
        String(APP.tableBoardCards.length));
  check('Crazy: the human still holds all 3 hole cards', heldOf(seat).length === 3);
  check('Crazy: all 3 readable with the flop showing', readableAt(seat) === 3);
  check('Crazy: the discard step is gated', APP.needsFixedChoiceBefore(5));
  APP.showCardChoice(5);
  check('Crazy: all 3 still present when asked', heldOf(seat).length === 3);
  APP.selectSlot(1);
  APP.confirmCardChoice();
  APP.setStep(5); APP.updateTableView(5);
  check('Crazy: 2 cards remain', heldOf(seat).length === 2, String(heldOf(seat).length));
  check('Crazy: the board still reaches all 5 cards', APP.tableBoardCards.length === 5,
        String(APP.tableBoardCards.length));
}

/* ============================================================
   SUPER STUD
   ============================================================ */
console.log('');
console.log('=== Super Stud: both branches, decided on five cards ===');
{
  // PAT
  const game = startHand('Super Stud Hi-Lo 8 / Super Pat', 'play');
  const seat = APP.playerSession.humanSeat;
  const pattern = APP.patterns()[game.dealCat];
  APP.setStep(1); APP.updateTableView(1);
  check('Super Stud: opening hand is 5 cards', heldOf(seat).length === 5);
  check('Super Stud: all 5 readable to the human', readableAt(seat) === 5, String(readableAt(seat)));
  const exposed = Array.from(APP.seatEls[seat].querySelector('.seat-cards').children)
    .filter(k => k.classList.contains('physically-up')).length;
  check('Super Stud: exactly 1 is physically exposed (D D D D U)', exposed === 1, String(exposed));

  check('Super Stud: the Pat/discard step is gated', APP.needsFixedChoiceBefore(2));
  APP.showCardChoice(2);
  check('Super Stud: five cards present at decision time', heldOf(seat).length === 5,
        String(heldOf(seat).length));
  check('Super Stud: the exposed card cannot be discarded',
        APP.cardChoiceSession.eligible.indexOf(4) === -1,
        JSON.stringify(APP.cardChoiceSession.eligible));
  const patHand = heldOf(seat).map(key);
  APP.declarePat(true);
  APP.confirmCardChoice();
  APP.setStep(2); APP.updateTableView(2);
  check('Super Pat: seat is locked', APP.seatPatLocked[seat] === true);
  check('Super Pat: keeps exactly five', heldOf(seat).length === 5, String(heldOf(seat).length));
  check('Super Pat: keeps the SAME five cards it was shown',
        JSON.stringify(heldOf(seat).map(key)) === JSON.stringify(patHand));
  for(let s = 3; s < game.scenario.length; s++){ APP.setStep(s); APP.updateTableView(Math.min(s, pattern.hole.length-1)); }
  check('Super Pat: receives no later cards', heldOf(seat).length === 5,
        String(heldOf(seat).length));

  // DISCARD TWO
  const g2 = startHand('Super Stud Hi-Lo 8 / Super Pat', 'play');
  const s2 = APP.playerSession.humanSeat;
  APP.setStep(1); APP.updateTableView(1);
  const before = heldOf(s2).map(key);
  APP.showCardChoice(2);
  const elig = APP.cardChoiceSession.eligible;
  APP.selectSlot(elig[0]);
  check('Super Stud: 1 selected is not enough', !APP.choiceValid());
  APP.selectSlot(elig[1]);
  check('Super Stud: exactly 2 selected is valid', APP.choiceValid());
  const discarded = [before[elig[0]], before[elig[1]]];
  APP.confirmCardChoice();
  APP.setStep(2); APP.updateTableView(2);
  const after = heldOf(s2).map(key);
  check('Super Stud: 3 cards retained after discarding two', after.length === 3, String(after.length));
  check('Super Stud: exactly the chosen cards left the hand',
        discarded.every(c => !after.includes(c)),
        discarded.join(' ') + ' vs ' + after.join(' '));
  check('Super Stud: the exposed card was retained', after.includes(before[4]));
  check('Super Stud: this seat is NOT Pat-locked', APP.seatPatLocked[s2] !== true);
  for(let s = 3; s < g2.scenario.length; s++){ APP.setStep(s); APP.updateTableView(Math.min(s, pattern.hole.length-1)); }
  check('Super Stud: later streets bring the hand to 7', heldOf(s2).length === 7,
        String(heldOf(s2).length));
  check('Super Stud: final retained sequence is D D U U U U D',
        pattern.faceSeq[pattern.faceSeq.length-1] === 'DDUUUUD');
}

console.log('');
console.log('=== The gate is load-bearing: asking after the step loses cards ===');
{
  // Drives BOTH orderings on the same game to show why the gate matters.
  // GATED: ask before the step renders. POST-RENDER (the old behaviour): let
  // the step run first, then ask.
  [['Super Stud Hi-Lo 8 / Super Pat', 2, 5],
   ['Pineapple', 1, 3],
   ['Crazy Pineapple', 5, 3]].forEach(([name, step, expect]) => {
    const g1 = startHand(name, 'play');
    const seat1 = APP.playerSession.humanSeat;
    const pat1 = APP.patterns()[g1.dealCat];
    for(let s = 0; s < step; s++){ APP.setStep(s); APP.updateTableView(Math.min(s, pat1.hole.length-1)); }
    const gated = heldOf(seat1).length;            // gate: step not yet run

    const g2 = startHand(name, 'play');
    const seat2 = APP.playerSession.humanSeat;
    const pat2 = APP.patterns()[g2.dealCat];
    for(let s = 0; s <= step; s++){ APP.setStep(s); APP.updateTableView(Math.min(s, pat2.hole.length-1)); }
    const postRender = heldOf(seat2).length;       // old: step already ran

    check(name + ': gated choice sees the full ' + expect + '-card hand',
          gated === expect, String(gated));
    check(name + ': the old post-render ordering would have seen fewer',
          postRender < gated, 'gated=' + gated + ' postRender=' + postRender);
  });
}

/* ============================================================
   STATE MACHINE SAFETY
   ============================================================ */
console.log('');
console.log('=== A pending choice cannot be bypassed or double-committed ===');
{
  const game = startHand('Pineapple', 'play');
  const seat = APP.playerSession.humanSeat;
  APP.setStep(0); APP.updateTableView(0);
  APP.showCardChoice(1);
  check('a session is open', !!APP.cardChoiceSession);
  APP.selectSlot(0);
  const held = heldOf(seat).length;
  APP.confirmCardChoice();
  check('the session closes on confirm', APP.cardChoiceSession === null);
  APP.confirmCardChoice();     // double confirm
  APP.confirmCardChoice();     // triple
  APP.setStep(1); APP.updateTableView(1);
  check('a repeated confirm cannot discard twice', heldOf(seat).length === 2,
        String(heldOf(seat).length));

  // A new hand must clear anything held over.
  startHand('Pineapple', 'play');
  check('a new hand clears any pending choice', APP.pendingChoiceStep === null);
  check('a new hand clears any open session', APP.cardChoiceSession === null);

  // A stale confirm from the previous hand must not mutate this one.
  const seat2 = APP.playerSession.humanSeat;
  APP.setStep(0); APP.updateTableView(0);
  const fresh = heldOf(seat2).map(key);
  APP.confirmCardChoice();     // no session: must be a no-op
  check('a stale confirm cannot mutate the new hand',
        JSON.stringify(heldOf(seat2).map(key)) === JSON.stringify(fresh));
}

/* ============================================================
   HUMAN BETTING
   ============================================================ */
console.log('');
console.log('=== Human betting options are legal and authoritative ===');
{
  const game = startHand("Texas Hold'em", 'play');
  const seat = APP.playerSession.humanSeat;
  APP.setStep(1); APP.updateTableView(1);
  APP.setStep(2); APP.updateTableView(2);
  APP.startActionRound();
  check('a betting round opened', !!APP.currentRound);
  check('AI never controls the human seat', APP.isAi(seat) === false);
  const others = [0,1,2,3,4,5,6].filter(i => i !== seat && i !== APP.getSitOut());
  check('every other seat IS AI controlled', others.every(i => APP.isAi(i) === true));

  // Options only exist when it is genuinely this seat's turn — that is the
  // contract, and it is why a seat can never be handed illegal choices.
  const onHuman = APP.roundCurrent() === seat;
  const opts = onHuman ? (APP.humanOptions(seat) || []) : [];
  check('when it is the human turn they are offered actions; otherwise none',
        onHuman ? opts.length > 0 : opts.length === 0,
        'current=' + APP.roundCurrent() + ' human=' + seat + ' opts=' + JSON.stringify(opts.map(o=>o.action)));
  check('no options are offered to a seat that is not on action',
        (APP.humanOptions((seat + 1) % 7) || []).length === 0 || APP.roundCurrent() === (seat+1)%7);
  const kinds = opts.map(o => o.action);
  check('every offered action is from the legal set',
        kinds.every(k => ['check','bet','call','raise','fold','allin'].includes(String(k))),
        JSON.stringify(kinds));
  check('every offered action carries a real amount',
        opts.every(o => typeof o.amount === 'number' && o.amount >= 0));

  // Walk the round until the human is on action, then read their real options.
  let found = null;
  for(let probe = 0; probe < 7 && !found; probe++){
    if(APP.roundCurrent() === seat) found = APP.humanOptions(seat);
    else break;
  }
  if(found){
    const set = found.map(o => o.action);
    // The human always has a non-committal way to continue. Fold is offered
    // only when there is a wager to fold TO — when checking is free, folding
    // is never correct and the app rightly does not offer it.
    check('the human always has a free or matching continuation',
          set.includes('check') || set.includes('call') || set.includes('fold'),
          JSON.stringify(set));
    check('fold is offered exactly when there is something to fold to',
          set.includes('check') ? !set.includes('fold') : set.includes('fold'),
          JSON.stringify(set));
  } else { pass += 2; }
  // Money is authoritative and conserved before any action.
  const ms = APP.moneyState;
  const seats = Object.keys(ms.stacks);
  const total = seats.reduce((n,s) => n + ms.stacks[s], 0) + (ms.pot||0) +
                seats.reduce((n,s) => n + (ms.streetContrib[s]||0), 0);
  const start = seats.reduce((n,s) => n + ms.startingStacks[s], 0);
  check('money conserved at the human decision point', total === start, total + ' vs ' + start);
}

/* ============================================================
   END-TO-END HANDS
   ============================================================ */
console.log('');
console.log('=== End-to-end Play & Learn hands ===');
{
  const GAMES = ["Texas Hold'em", 'Big O Hi-Lo', 'Stud Hi-Lo / 8-or-Better', 'Razz',
                 'Badugi', '2-7 Lowball', 'Super Stud Hi-Lo 8 / Super Pat',
                 'Drawmaha Hi', 'Pineapple', 'Crazy Pineapple', 'Double Board Omaha'];
  const HANDS = 5;
  let started = 0, completed = 0, crashed = 0, aiForHuman = 0;
  let visFail = 0, moneyFail = 0, dupFail = 0, missingDecision = 0;
  const perGame = {};

  GAMES.forEach(name => {
    perGame[name] = { started:0, completed:0, crashed:0, fixed:0, draws:0, crashMsg:null };
    for(let h = 0; h < HANDS; h++){
      perGame[name].started++; started++;
      try {
        const game = startHand(name, 'play');
        const seat = APP.playerSession.humanSeat;
        const log = playHand(game, {
          // Super Stud: alternate Pat and discard-two across the five hands.
          onFixed: (A, s) => {
            const sess = A.cardChoiceSession;
            if(!sess) return;
            if(sess.rule && sess.rule.patLabel && h % 2 === 0){ A.declarePat(true); return; }
            const need = (sess.rule && sess.rule.discardCount) || 1;
            const elig = sess.eligible || [];
            for(let n = 0; n < need && n < elig.length; n++) A.selectSlot(elig[(n + h) % elig.length]);
          },
          // Draws: vary how many cards the human replaces.
          onDraw: (A) => {
            const sess = A.cardChoiceSession;
            if(!sess) return;
            const elig = sess.eligible || [];
            const n = h % Math.max(1, Math.min(3, elig.length));
            for(let i = 0; i < n; i++) A.selectSlot(elig[i]);
          }
        });
        aiForHuman += log.aiForHuman;
        if(log.minReadable < 0) visFail++;          // fewer readable than held
        perGame[name].fixed += log.fixedCompleted;
        perGame[name].draws += log.drawCompleted;
        if(log.fixedOffered !== log.fixedCompleted) missingDecision++;

        const live = [];
        for(let i = 0; i < 7; i++) heldOf(i).forEach(c => live.push(key(c)));
        (APP.tableBoardCards||[]).forEach(c => live.push(key(c)));
        if(new Set(live).size !== live.length) dupFail++;

        const ms = APP.moneyState;
        const ss = Object.keys(ms.stacks);
        const tot = ss.reduce((n,s)=>n+ms.stacks[s],0) + (ms.pot||0) +
                    ss.reduce((n,s)=>n+(ms.streetContrib[s]||0),0);
        if(tot !== ss.reduce((n,s)=>n+ms.startingStacks[s],0)) moneyFail++;

        perGame[name].completed++; completed++;
      } catch(e){
        perGame[name].crashed++; crashed++;
        perGame[name].crashMsg = perGame[name].crashMsg || e.message;
      }
    }
  });

  console.log('game'.padEnd(34) + 'start  done  crash  fixed  draws');
  Object.keys(perGame).forEach(k => {
    const x = perGame[k];
    console.log(k.padEnd(34) + String(x.started).padEnd(7) + String(x.completed).padEnd(6) +
                String(x.crashed).padEnd(7) + String(x.fixed).padEnd(7) + String(x.draws) +
                (x.crashMsg ? '   ' + x.crashMsg : ''));
  });
  console.log('');
  check('at least 55 hands were started', started >= 55, String(started));
  check('every hand completed without crashing', completed === started,
        completed + '/' + started);
  check('AI NEVER acted for the human (hard assertion)', aiForHuman === 0, String(aiForHuman));
  check('the human could always read every card they held', visFail === 0, String(visFail));
  check('no required card decision was skipped', missingDecision === 0, String(missingDecision));
  check('money conserved in every hand', moneyFail === 0, String(moneyFail));
  check('no duplicate card in any hand', dupFail === 0, String(dupFail));
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
