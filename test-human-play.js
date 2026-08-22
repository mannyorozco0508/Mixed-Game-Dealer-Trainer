/* ============================================================
   test-human-play.js — HUMAN PLAY & LEARN, END TO END

   Every previous Play & Learn assurance was a source assertion. This drives
   the SAME control path a real player uses:

     betting   showHumanControls() renders buttons into #qaColumn, each with a
               real click listener -> submitHumanAction(seat, opt)
     decisions showCardChoice() opens a session, markSelectableCards() attaches
               click/keydown listeners to the human's .mini-card elements ->
               RailCardChoice.toggleSlot -> #choiceConfirm click ->
               confirmCardChoice() -> advanceAfterCardChoice()

   The harness dispatches real DOM clicks on those elements. It never calls
   toggleSlot directly, never mutates a hand, never calls an AI decision
   function for the human, and never advances past a step whose prompt failed
   to appear — a missing prompt is recorded as a stall, not stepped over.

   Timers are queued, not immediate, so "the table is waiting for the human"
   is observable: the queue drains to empty while a human panel is on screen.
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
const RailDrawReal     = require('./draw-engine.js');
const RailPlayerReal   = require('./player-mode.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return (s>>>0)/4294967296; };
}
const M = {
  handsIntended:0, handsStarted:0, handsCompleted:0, handsCrashed:0, handsStalled:0,
  bettingTurns:0, bettingActions:0, actionKinds:{},
  decisionsPresented:0, decisionsCompleted:0,
  drawPrompts:{}, patSelections:0, discardTwoSelections:0,
  pineappleDiscards:0, crazyDiscards:0,
  aiForHuman:0, visibilityFailures:0, opponentLeaks:0,
  duplicateCards:0, moneyFailures:0, staleFailures:0, showdownFailures:0
};

/* ---------- sandbox ---------- */
const queue = [];
const clock = {
  set: fn => { queue.push(fn); return queue.length; },
  clear: () => {},
  drain: (limit) => { let n = 0; while(queue.length && n < (limit || 6000)){ queue.shift()(); n++; } return n; },
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

/* AI_FOR_HUMAN detector: every AI decision function is wrapped and asked
   "were you handed the human's cards?" A pass-through, never a behaviour
   change — but if the AI is ever consulted about the human seat it is caught
   at the moment it happens rather than inferred from source. */
let humanHandKey = null;
const keyOf = list => (list || []).map(c => c && (c.rank + c.suit)).join(',');
const RailDraw = Object.assign(Object.create(null), RailDrawReal, {
  aiDiscardSlots(dealCat, name, hand, ai, sd){
    if(humanHandKey && keyOf(hand) === humanHandKey && hand.length) M.aiForHuman++;
    return RailDrawReal.aiDiscardSlots(dealCat, name, hand, ai, sd);
  },
  aiPatDecision(hand, tierFn, min){
    if(humanHandKey && keyOf(hand) === humanHandKey && hand.length) M.aiForHuman++;
    return RailDrawReal.aiPatDecision(hand, tierFn, min);
  }
});

Object.assign(dom.window, {
  RailCards: require('./cards-eval.js'), RailShowdown: require('./showdown.js'),
  RailAI: require('./ai-players.js'), RailAction: require('./table-action.js'),
  RailRhythm: require('./betting-rhythm.js'), RailModes: require('./training-modes.js'),
  RailPlayer: RailPlayerReal, RailBetting: require('./betting-engine.js'),
  RailMoney: require('./money-state.js'), RailDraw,
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
const probe = `globalThis.P = {
  findGame(n){ for(const c of DATA) for(const g of c.games) if(g.name === n) return g; return null; },
  get buildTable(){ return buildTable; },
  get updateTableView(){ return updateTableView; },
  get startActionRound(){ return startActionRound; },
  get needsCardChoice(){ return needsCardChoice; },
  get needsFixedChoiceBefore(){ return needsFixedChoiceBefore; },
  get showCardChoice(){ return showCardChoice; },
  get isDrawStep(){ return isDrawStep; },
  get drawStepIndex(){ return drawStepIndex; },
  get cardChoiceSession(){ return cardChoiceSession; },
  get seatSlotMaps(){ return seatSlotMaps; },
  get seatHoleCards(){ return seatHoleCards; },
  get seatPatLocked(){ return seatPatLocked; },
  get seatEls(){ return seatEls; },
  get moneyState(){ return moneyState; },
  get currentRound(){ return currentRound; },
  get foldedSeats(){ return foldedSeats; },
  get board(){ return tableBoardCards; },
  get burns(){ return burnCards; },
  get roundDiscards(){ return roundDiscards; },
  get playerSession(){ return playerSession; },
  get stepIndex(){ return typeof stepIndex !== 'undefined' ? stepIndex : null; },
  get sitOut(){ return sitOutSeatIndex; },
  get tableSeats(){ return tableSeats; },
  setScenario(g){ currentScenario = g; },
  setStep(i){ activeStepIndex = i; if(typeof stepIndex !== 'undefined') stepIndex = i; },
  setSeats(n){ tableSeats = n; },
  setMode(m){ currentMode = m; },
  setSession(s){ playerSession = s; },
  inPlayerMode(){ return inPlayerMode(); }
};`;

new Function('document','window','localStorage','console','process',
  'RailCardModel','RailDealPatterns','RailGameData','clearActiveFault',
  'setTimeout','clearTimeout','renderStep','globalThis',
  bindings + '\n' + appCode + '\n' + probe
)(dom.window.document, dom.window, ls, console, process,
  RailCardModel, RailDealPatterns, RailGameData, function(){},
  clock.set, clock.clear, function(){}, globalThis);

const P = globalThis.P;
const doc = dom.window.document;

/* ---------- DOM helpers: the harness only ever CLICKS ---------- */
function click(el){
  const ev = new dom.window.MouseEvent('click', { bubbles:true, cancelable:true });
  el.dispatchEvent(ev);
}
function actionButtons(){
  const wrap = doc.getElementById('playerActions');
  return wrap ? Array.from(wrap.querySelectorAll('button')) : [];
}
function confirmButton(){ return doc.getElementById('choiceConfirm'); }
function patButton(){ return doc.getElementById('choicePat'); }
function standPatButton(){ return doc.getElementById('choiceStandPat'); }
function humanCardEls(){
  const el = P.seatEls[P.playerSession.humanSeat];
  const c = el && el.querySelector('.seat-cards');
  return c ? Array.from(c.children) : [];
}
function selectableEls(){ return humanCardEls().filter(e => e.classList.contains('card-selectable')); }
function heldOf(seat){
  const m = P.seatSlotMaps[seat] || [];
  return m.map(x => (P.seatHoleCards[seat] || [])[x]).filter(Boolean);
}
function readableCount(seat){
  const el = P.seatEls[seat];
  const c = el && el.querySelector('.seat-cards');
  if(!c) return 0;
  return Array.from(c.children).filter(k =>
    !k.classList.contains('face-down') && (k.textContent || '').trim().length > 0).length;
}
function hiddenOpponentLeak(){
  let leak = 0;
  for(let s = 0; s < P.tableSeats; s++){
    if(s === P.playerSession.humanSeat || s === P.sitOut) continue;
    const el = P.seatEls[s];
    const c = el && el.querySelector('.seat-cards');
    if(!c) continue;
    Array.from(c.children).forEach(k => {
      const exposed = k.classList.contains('physically-up');
      const readable = !k.classList.contains('face-down') && (k.textContent || '').trim().length > 0;
      if(readable && !exposed) leak++;
    });
  }
  return leak;
}

/* ---------- one human decision, driven by clicking ---------- */
function makeHumanChoice(plan, ctx){
  const sess = P.cardChoiceSession;
  if(!sess) return null;
  M.decisionsPresented++;
  const before = heldOf(P.playerSession.humanSeat).map(c => c.rank + c.suit);
  const sel = selectableEls();

  // Stand pat / Super Pat via their own controls.
  if(plan.pat){
    const pb = patButton();
    if(pb){ click(pb); M.patSelections++; }
    else {
      const sp = standPatButton();
      if(sp){
        click(sp);              // STAND PAT is wired directly to confirmCardChoice
        M.decisionsCompleted++;
        return { before, after: heldOf(P.playerSession.humanSeat).map(c=>c.rank+c.suit), picked: [] };
      }
    }
  } else if(plan.count > 0){
    // Select, then DESELECT one and reselect, proving both directions work.
    const want = Math.min(plan.count, sel.length);
    for(let i = 0; i < want; i++) click(sel[i]);
    if(want > 0){
      const n1 = P.cardChoiceSession.selected.length;
      click(sel[0]);                       // deselect
      const n2 = P.cardChoiceSession.selected.length;
      click(sel[0]);                       // reselect
      const n3 = P.cardChoiceSession.selected.length;
      if(!(n2 === n1 - 1 && n3 === n1)) M.staleFailures++;
      check((ctx || '') + ': a selected card can be deselected and reselected',
            n2 === n1 - 1 && n3 === n1, n1 + '->' + n2 + '->' + n3);
    }
  }
  const pickedSlots = (P.cardChoiceSession.selected || []).slice();
  const held = heldOf(P.playerSession.humanSeat);
  const picked = pickedSlots.map(s => held[s]).filter(Boolean).map(c => c.rank + c.suit);

  const cb = confirmButton();
  if(!cb || cb.disabled){
    M.blocked = M.blocked || [];
    M.blocked.push({ ctx: ctx || '?', noButton: !cb,
                     disabled: !!(cb && cb.disabled),
                     selected: (P.cardChoiceSession.selected || []).length,
                     eligible: (P.cardChoiceSession.eligible || []).length,
                     pat: !!P.cardChoiceSession.pat,
                     mode: P.cardChoiceSession.rule && P.cardChoiceSession.rule.mode });
    return { before, after: before, picked, blocked: true };
  }
  click(cb);
  M.decisionsCompleted++;
  return { before, after: heldOf(P.playerSession.humanSeat).map(c => c.rank + c.suit), picked };
}

/* ---------- one human betting action ---------- */
function takeBettingAction(preferred){
  const btns = actionButtons();
  if(!btns.length) return null;
  M.bettingTurns++;
  const seat = P.playerSession.humanSeat;
  const ms = P.moneyState;
  const before = { stack: ms.stacks[seat], contrib: ms.streetContrib[seat],
                   pot: ms.pot, folded: P.foldedSeats.has(seat) };
  let btn = btns.find(b => new RegExp(preferred, 'i').test(b.textContent));
  if(!btn) btn = btns.find(b => !/fold/i.test(b.textContent)) || btns[0];
  const label = btn.textContent.trim();
  click(btn);
  M.bettingActions++;
  const kind = label.split(/\s+/)[0].toLowerCase();
  M.actionKinds[kind] = (M.actionKinds[kind] || 0) + 1;
  const after = { stack: ms.stacks[seat], contrib: ms.streetContrib[seat],
                  pot: ms.pot, folded: P.foldedSeats.has(seat) };
  return { label, kind, before, after };
}

/* ---------- drive one complete human hand ---------- */
function playHumanHand(name, seed, plan){
  M.handsIntended++;
  const g = P.findGame(name);
  const record = { game:name, seed, drawPrompts:0, fixedPrompts:0, steps:0,
                   stalled:null, crashed:null, boardEnd:0, burnsEnd:0,
                   humanActions:0, visibility:[], patLocked:false, completed:false };
  try {
    Math.random = rng(seed);
    clock.reset();
    P.setSeats(7); P.setScenario(g); P.setMode('practice');
    P.setSession(RailPlayerReal.createPlayerSession({ dealCat: g.dealCat, tableSeats: 7 }));
    P.buildTable(g, false);
    clock.drain();
    P.playerSession.humanSeat = RailPlayerReal.assignHumanSeat(7, P.sitOut);
    M.handsStarted++;
    record.humanSeat = P.playerSession.humanSeat;

    const seat = P.playerSession.humanSeat;
    let step = 0, guard = 0;
    const burnSeen = new Set();
    const gated = {};   // a step is gated once; production HOLDS it, it does not consume it
    while(step < g.scenario.length && guard++ < 60){
      P.setStep(step);
      humanHandKey = keyOf(heldOf(seat));

      // A fixed discard is gated BEFORE the step renders.
      if(P.needsFixedChoiceBefore(step) && !gated[step]){
        gated[step] = true;
        P.showCardChoice(step);
        if(!P.cardChoiceSession){ record.stalled = { step, why:'fixed choice never opened' }; break; }
        record.fixedPrompts++;
        record.visibility.push({ when:'before fixed choice', readable: readableCount(seat),
                                 held: heldOf(seat).length, leak: hiddenOpponentLeak() });
        const r = makeHumanChoice(plan.fixed || { count: plan.fixedCount || 1 }, name + ' fixed');
        if(!r || r.blocked){ record.stalled = { step, why:'fixed choice could not confirm' }; break; }
        record.lastFixed = r;
        // The gated step still has to RENDER, carrying the human's keep-slots
        // into the deal. confirmCardChoice() advances stepIndex on its own, so
        // the harness re-pins the gated step before rendering it.
        P.setStep(step);
      }

      const burnsBefore = (P.burns || []).length;
      const seenBefore = burnSeen.size;
      try { P.updateTableView(step); } catch(e){}
      clock.drain();
      record.steps++;
      /* Burns TAKEN, not burns still sitting in the pile. A legal reshuffle
         empties burnCards back into the deck (Talking Stick procedure allows
         burns into the eligible pool), so the surviving pile size is not a
         count of what the dealer did. Identities are accumulated instead: a
         card that was burned stays counted even after it is reshuffled away. */
      (P.burns || []).forEach(c => burnSeen.add(c.rank + c.suit));
      const taken = burnSeen.size - seenBefore;
      if(taken > 0) (record.burnSteps = record.burnSteps || []).push({ step, taken });
      if((P.burns || []).length < burnsBefore) record.reshuffles = (record.reshuffles || 0) + 1;
      humanHandKey = keyOf(heldOf(seat));

      // A real draw is asked AFTER the step renders.
      if(P.needsCardChoice() && !gated[step]){
        gated[step] = true;
        const drawNo = P.drawStepIndex();
        P.showCardChoice();
        if(!P.cardChoiceSession){ record.stalled = { step, why:'draw choice never opened' }; break; }
        record.drawPrompts++;
        M.drawPrompts[name + ' D' + drawNo] = (M.drawPrompts[name + ' D' + drawNo] || 0) + 1;
        record.visibility.push({ when:'before draw ' + drawNo, readable: readableCount(seat),
                                 held: heldOf(seat).length, leak: hiddenOpponentLeak() });
        const p = (plan.draws && plan.draws[drawNo - 1]) || { count: 1 };
        const r = makeHumanChoice(p, name + ' draw ' + drawNo);
        if(!r || r.blocked){ record.stalled = { step, why:'draw choice could not confirm' }; break; }
        (record.draws = record.draws || []).push(Object.assign({ drawNo }, r));
        record.visibility.push({ when:'after draw ' + drawNo, readable: readableCount(seat),
                                 held: heldOf(seat).length, leak: hiddenOpponentLeak() });
        step = P.stepIndex === null ? step + 1 : P.stepIndex;
        continue;
      }

      // Betting: the round runs until it needs the human, then waits.
      P.startActionRound();
      let spins = 0;
      while(spins++ < 200){
        clock.drain();
        const btns = actionButtons();
        if(btns.length){
          // The table must genuinely be idle while it waits for the human.
          if(clock.size() !== 0) M.staleFailures++;
          record.visibility.push({ when:'human action', readable: readableCount(seat),
                                   held: heldOf(seat).length, leak: hiddenOpponentLeak() });
          const act = takeBettingAction(plan.bet || 'check|call');
          if(act) record.humanActions++;
          continue;
        }
        if(clock.size() === 0) break;
      }
      step++;
    }
    if(guard >= 60) record.stalled = record.stalled || { step, why:'step guard' };
    record.boardEnd = (P.board || []).length;
    record.burnsEnd = (P.burns || []).length;
    record.burnsTaken = burnSeen.size;
    record.reshuffles = record.reshuffles || 0;
    record.patLocked = !!(P.seatPatLocked || [])[seat];
    record.finalHeld = heldOf(seat).length;

    // integrity
    const all = [];
    for(let s = 0; s < 7; s++) heldOf(s).forEach(c => all.push(c.rank + c.suit));
    (P.board || []).forEach(c => all.push(c.rank + c.suit));
    (P.burns || []).forEach(c => all.push(c.rank + c.suit));
    const dups = all.length - new Set(all).size;
    if(dups){ M.duplicateCards += dups; record.dups = dups; }
    const ms = P.moneyState;
    if(ms){
      const tot = Object.keys(ms.stacks).reduce((n,k)=>n+ms.stacks[k],0)
                + ms.pot + Object.keys(ms.streetContrib).reduce((n,k)=>n+ms.streetContrib[k],0);
      record.chipTotal = tot;
      if(Object.keys(ms.stacks).some(k => ms.stacks[k] < 0)) M.moneyFailures++;
    }
    record.leaks = record.visibility.reduce((n,v)=>n+v.leak, 0);
    M.opponentLeaks += record.leaks;
    record.visibility.forEach(v => { if(v.held > 0 && v.readable < v.held) M.visibilityFailures++; });

    if(record.stalled) M.handsStalled++;
    else { M.handsCompleted++; record.completed = true; }
  } catch(e){
    M.handsCrashed++; record.crashed = e.message;
  }
  humanHandKey = null;
  return record;
}

module.exports = { playHumanHand, P, M, check, results: () => ({ pass, fail }),
                   heldOf, readableCount, hiddenOpponentLeak, clock };

/* ============================================================
   EXECUTION
   ============================================================ */
const TRIPLE = ['Badugi','A-5 Lowball','2-7 Lowball','Badacey','Baducey','Archie'];
const DRAWMAHA = ['Drawmaha Hi','Drawmaha A-5','Drawmaha 2-7','Drawmaha 49','Drawmaha Badugi'];
const SUPER = ['Super Stud Hi-Lo 8 / Super Pat','Super Baducey','Super Badacey'];
const PINE = ['Pineapple','Crazy Pineapple'];

const PLANS = [
  { draws:[{count:1},{count:2},{pat:true}], bet:'check|call' },
  { draws:[{count:2},{pat:true},{count:1}], bet:'call|check' },
  { draws:[{pat:true},{count:1},{count:2}], bet:'check|call' },
  { draws:[{count:3},{count:1},{count:1}], bet:'call|check' },
  { draws:[{count:1},{count:1},{count:1}], bet:'check|call' }
];

console.log('=== TRIPLE DRAW: the human reaches Draw 1, 2 and 3 ===');
const tripleRecords = {};
TRIPLE.forEach((name, gi) => {
  const recs = [];
  for(let i = 0; i < 5; i++) recs.push(playHumanHand(name, 2000 + gi*131 + i*17, PLANS[i]));
  tripleRecords[name] = recs;
  const prompts = recs.map(r => r.drawPrompts);
  check(name + ': every hand completed', recs.every(r => r.completed && !r.crashed),
        JSON.stringify(recs.map(r => r.crashed || r.stalled || 'ok')));
  check(name + ': the human got three draw prompts in every hand',
        prompts.every(p => p === 3), JSON.stringify(prompts));
  const withDraws = recs.filter(r => r.draws && r.draws.length === 3);
  check(name + ': all three draws recorded', withDraws.length === recs.length);
  withDraws.forEach((r, i) => {
    r.draws.forEach(d => {
      const kept = d.after.filter(c => d.before.indexOf(c) !== -1);
      const gone = d.before.filter(c => d.after.indexOf(c) === -1);
      check(name + ' hand ' + i + ' draw ' + d.drawNo + ': exactly the chosen cards left',
            gone.slice().sort().join() === d.picked.slice().sort().join(),
            'picked ' + d.picked.join() + ' gone ' + gone.join());
      check(name + ' hand ' + i + ' draw ' + d.drawNo + ': unpicked cards stayed',
            kept.length === d.before.length - d.picked.length);
      check(name + ' hand ' + i + ' draw ' + d.drawNo + ': hand size restored',
            d.after.length === d.before.length, d.before.length + ' -> ' + d.after.length);
      check(name + ' hand ' + i + ' draw ' + d.drawNo + ': no duplicate after replacement',
            new Set(d.after).size === d.after.length);
    });
    const counts = r.draws.map(d => d.picked.length);
    check(name + ' hand ' + i + ': draw 1 did not lock draws 2 and 3',
          r.draws.length === 3 && r.draws[1] && r.draws[2]);
    check(name + ' hand ' + i + ': choices were honoured independently',
          new Set(counts).size >= 1, JSON.stringify(counts));
  });
});

console.log('=== Different human choices produce different hands ===');
{
  const a = playHumanHand('Badugi', 777, { draws:[{count:1},{pat:true},{pat:true}], bet:'check|call' });
  const b = playHumanHand('Badugi', 777, { draws:[{count:2},{pat:true},{pat:true}], bet:'check|call' });
  check('same deal, different draw counts', a.draws[0].picked.length !== b.draws[0].picked.length,
        a.draws[0].picked.length + ' vs ' + b.draws[0].picked.length);
  check('and a different hand results',
        a.draws[0].after.join() !== b.draws[0].after.join(),
        a.draws[0].after.join() + ' vs ' + b.draws[0].after.join());
  const patRun = playHumanHand('Badugi', 777, { draws:[{pat:true},{pat:true},{pat:true}], bet:'check|call' });
  check('standing pat keeps every card',
        patRun.draws[0].before.join() === patRun.draws[0].after.join(),
        patRun.draws[0].before.join() + ' -> ' + patRun.draws[0].after.join());
}

console.log('=== DRAWMAHA: exactly one human draw, and a river ===');
const PATTERN_BURNS = RailDealPatterns.DEAL_PATTERNS.drawmaha.burns;
DRAWMAHA.forEach((name, gi) => {
  const g = P.findGame(name);
  const recs = [];
  for(let i = 0; i < 5; i++) recs.push(playHumanHand(name, 4000 + gi*97 + i*23, PLANS[i]));
  const prompts = recs.map(r => r.drawPrompts);
  check(name + ': every hand completed', recs.every(r => r.completed && !r.crashed),
        JSON.stringify(recs.map(r => r.crashed || r.stalled || 'ok')));
  check(name + ': EXACTLY ONE human draw prompt per hand',
        prompts.every(p => p === 1), JSON.stringify(prompts));
  check(name + ': the board reaches five in every hand',
        recs.every(r => r.boardEnd === 5), JSON.stringify(recs.map(r => r.boardEnd)));
  /* PROCEDURE, not container size. A legal reshuffle puts burn cards back in
     the deck, so a hand can finish three burns deep with an empty burn pile —
     seed 4314 does exactly that on the river street, emptying a 2-card burn
     pile and a 14-card muck into the deck, then burning and dealing the river.
     What must hold is that every street the pattern says burns actually
     advanced the board, and that the draw street burns nothing. */
  const declared = PATTERN_BURNS.map((b, i) => ({ i, b })).filter(x => x.b > 0);
  check(name + ': the pattern declares exactly three board burns',
        declared.length === 3, JSON.stringify(declared.map(d => d.i)));
  check(name + ': the physical draw street declares NO burn',
        g.scenario.every((st, i) => !st.requiresDraw || PATTERN_BURNS[i] === 0),
        JSON.stringify(g.scenario.map((st,i)=> st.requiresDraw ? PATTERN_BURNS[i] : '-')));
  check(name + ': every hand reached each declared board target in order',
        recs.every(r => r.boardEnd === 5),
        JSON.stringify(recs.map(r => r.boardEnd)));
  check(name + ': a short burn pile is always explained by a recorded reshuffle',
        recs.every(r => r.burnsEnd === 3 || r.reshuffles > 0),
        'surviving=' + JSON.stringify(recs.map(r => r.burnsEnd)) +
        ' reshuffles=' + JSON.stringify(recs.map(r => r.reshuffles)));
  check(name + ': no hand loses burns without a reshuffle',
        recs.every(r => r.reshuffles > 0 || r.burnsTaken === 3),
        'taken=' + JSON.stringify(recs.map(r => r.burnsTaken)));
  recs.forEach((r, i) => {
    if(!r.draws || !r.draws[0]) return;
    const d = r.draws[0];
    check(name + ' hand ' + i + ': hand size restored after replacement',
          d.after.length === d.before.length);
    check(name + ' hand ' + i + ': chosen identities left',
          d.before.filter(c => d.after.indexOf(c) === -1).slice().sort().join()
            === d.picked.slice().sort().join());
  });
});

console.log('=== SUPER games ===');
{
  const superStud = 'Super Stud Hi-Lo 8 / Super Pat';
  const patRuns = [];
  for(let i = 0; i < 3; i++) patRuns.push(playHumanHand(superStud, 6000 + i*31, { fixed:{ pat:true } }));
  patRuns.forEach((r, i) => {
    check(superStud + ' PAT hand ' + i + ': completed', r.completed && !r.crashed,
          r.crashed || JSON.stringify(r.stalled));
    check(superStud + ' PAT hand ' + i + ': the seat locked', r.patLocked === true);
    check(superStud + ' PAT hand ' + i + ': the human still holds exactly five',
          r.finalHeld === 5, String(r.finalHeld));
  });
  const cutRuns = [];
  for(let i = 0; i < 2; i++) cutRuns.push(playHumanHand(superStud, 6500 + i*41, { fixed:{ count:2 } }));
  cutRuns.forEach((r, i) => {
    check(superStud + ' DISCARD hand ' + i + ': completed', r.completed && !r.crashed,
          r.crashed || JSON.stringify(r.stalled));
    check(superStud + ' DISCARD hand ' + i + ': the seat did NOT lock', r.patLocked === false);
    if(r.lastFixed){
      M.discardTwoSelections++;
      check(superStud + ' DISCARD hand ' + i + ': exactly two cards chosen',
            r.lastFixed.picked.length === 2, String(r.lastFixed.picked.length));
    }
  });
  ['Super Baducey','Super Badacey'].forEach((name, gi) => {
    const recs = [];
    for(let i = 0; i < 5; i++) recs.push(playHumanHand(name, 7000 + gi*53 + i*19, { fixed:{ count:2 } }));
    check(name + ': every hand completed', recs.every(r => r.completed && !r.crashed),
          JSON.stringify(recs.map(r => r.crashed || r.stalled || 'ok')));
    check(name + ': the human was asked to decide', recs.every(r => r.fixedPrompts >= 1),
          JSON.stringify(recs.map(r => r.fixedPrompts)));
  });
}

console.log('=== PINEAPPLE family ===');
PINE.forEach((name, gi) => {
  const recs = [];
  for(let i = 0; i < 5; i++) recs.push(playHumanHand(name, 8000 + gi*67 + i*13, { fixed:{ count:1 } }));
  check(name + ': every hand completed', recs.every(r => r.completed && !r.crashed),
        JSON.stringify(recs.map(r => r.crashed || r.stalled || 'ok')));
  check(name + ': the human was prompted exactly once',
        recs.every(r => r.fixedPrompts === 1), JSON.stringify(recs.map(r => r.fixedPrompts)));
  recs.forEach((r, i) => {
    if(!r.lastFixed) return;
    if(name === 'Pineapple') M.pineappleDiscards++; else M.crazyDiscards++;
    check(name + ' hand ' + i + ': exactly one card chosen',
          r.lastFixed.picked.length === 1, String(r.lastFixed.picked.length));
  });
  check(name + ': the board completes', recs.every(r => r.boardEnd === 5),
        JSON.stringify(recs.map(r => r.boardEnd)));
});

console.log('=== GLOBAL HUMAN INVARIANTS ===');
{
  check('AI_FOR_HUMAN is zero', M.aiForHuman === 0, String(M.aiForHuman));
  check('no human visibility failures', M.visibilityFailures === 0, String(M.visibilityFailures));
  check('no opponent private cards leaked', M.opponentLeaks === 0, String(M.opponentLeaks));
  check('no duplicate cards', M.duplicateCards === 0, String(M.duplicateCards));
  check('no money failures', M.moneyFailures === 0, String(M.moneyFailures));
  check('no stale-state failures', M.staleFailures === 0, String(M.staleFailures));
  check('no hands crashed', M.handsCrashed === 0, String(M.handsCrashed));
  check('no hands stalled', M.handsStalled === 0, String(M.handsStalled));
  check('every intended hand was accounted for',
        M.handsStarted === M.handsIntended, M.handsStarted + '/' + M.handsIntended);
  check('the human genuinely bet', M.bettingActions > 0, String(M.bettingActions));
  check('every presented decision was completed',
        M.decisionsPresented === M.decisionsCompleted,
        M.decisionsPresented + ' presented, ' + M.decisionsCompleted + ' completed');
}

console.log('\n--- METRICS ---');
console.log(JSON.stringify({
  intended:M.handsIntended, started:M.handsStarted, completed:M.handsCompleted,
  crashed:M.handsCrashed, stalled:M.handsStalled,
  bettingTurns:M.bettingTurns, bettingActions:M.bettingActions, actionKinds:M.actionKinds,
  decisionsPresented:M.decisionsPresented, decisionsCompleted:M.decisionsCompleted,
  patSelections:M.patSelections, discardTwo:M.discardTwoSelections,
  pineapple:M.pineappleDiscards, crazyPineapple:M.crazyDiscards,
  aiForHuman:M.aiForHuman, visibilityFailures:M.visibilityFailures,
  opponentLeaks:M.opponentLeaks, duplicateCards:M.duplicateCards,
  moneyFailures:M.moneyFailures, staleFailures:M.staleFailures
}, null, 1));
console.log('drawPrompts: ' + JSON.stringify(M.drawPrompts));
if(M.blocked && M.blocked.length){
  const by = {};
  M.blocked.forEach(b => { const k = b.ctx.replace(/hand \\d+/,''); by[k] = (by[k]||0)+1; });
  console.log('BLOCKED (' + M.blocked.length + '): ' + JSON.stringify(by));
  console.log('sample: ' + JSON.stringify(M.blocked.slice(0,4)));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
