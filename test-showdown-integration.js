const { JSDOM } = require('jsdom');
const fs = require('fs');

const src = fs.readFileSync('/tmp/showdown_check.js', 'utf8');
function extract(a, b){
  const s = src.indexOf(a);
  const e = src.indexOf(b, s);
  if(s === -1 || e === -1) throw new Error('marker not found: ' + a);
  return src.slice(s, e);
}

const appCode = [
  extract('function tripleDrawSteps', 'const DATA = ['),
  extract('const DATA = [', 'const potClass'),
  extract('/* ============================================================\n   CANONICAL CARD MODEL', 'const DEAL_PATTERNS'),
  extract('const DEAL_PATTERNS', 'let currentScenario = null;'),
  extract('let currentScenario = null;', 'const BUTTON_DEALCATS'),
  extract('const BUTTON_DEALCATS', 'function buildTable(game, isRedeal){\n'),
  extract('function buildTable(game, isRedeal){', '\nfunction startScenario')
].join('\n');

const RailCards = require('./cards-eval.js');
const RailShowdown = require('./showdown.js');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="tableStrip"></div><button id="soundToggle"></button>
  <div class="poker-table" id="pokerTable">
    <div id="burnPile"></div><div id="boardRow1"></div><div id="boardRow2"></div><div id="seatsEl"></div>
  </div></body></html>`);
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth',  { configurable:true, get(){ return 760; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable:true, get(){ return 360; } });
dom.window.RailShowdown = RailShowdown;
const _store = {};
const localStorageStub = { getItem: k => (k in _store ? _store[k] : null), setItem: (k,v) => { _store[k] = String(v); } };

const testBody = `
  let pass = 0, fail = 0;
  function check(label, cond){ if(cond){ pass++; } else { fail++; console.log('FAIL: ' + label); } }
  function cardKey(c){ return c.rank + c.suit; }

  console.log('=== Real app-dealt cards -> showdown, all 21 games ===');
  let evaluated = 0, failures = [];
  DATA.forEach(function(cat){ cat.games.forEach(function(game){
    if(!game.dealCat || !game.scenario) return;

    currentScenario = game;
    tableSeats = 7;
    buttonSeatIndex = null;
    buildTable(game, false);

    // Complete boards exactly as the app does at showdown
    const rule = RailShowdown.SHOWDOWN_RULES[game.name];
    let board = tableBoardCards.slice();
    let board2 = tableBoard2Cards.slice();
    while(rule.needsBoard && board.length < rule.needsBoard && remainingDeck.length) board.push(remainingDeck.shift());
    while(rule.needsBoard2 && board2.length < rule.needsBoard2 && remainingDeck.length) board2.push(remainingDeck.shift());

    const pattern = DEAL_PATTERNS[game.dealCat];
    const finalCount = pattern.hole[pattern.hole.length - 1];
    const players = [];
    for(let i = 0; i < tableSeats; i++){
      if(i === sitOutSeatIndex) continue;
      players.push({ seat:i, cards: (seatHoleCards[i] || []).slice(0, finalCount) });
    }

    const r = RailShowdown.evaluateShowdown({ game, players, board, board2 });
    if(!r.ok){ failures.push(game.name + ': ' + r.error); return; }
    if(!r.winners || r.winners.length === 0){
      // legitimate only if every side genuinely had no qualifier
      if(r.unqualifiedSides.length !== r.sides.length) failures.push(game.name + ': no winners but sides qualified');
    }
    evaluated++;

    // no card may appear twice across all hands + boards
    const all = [];
    players.forEach(p => p.cards.forEach(c => all.push(cardKey(c))));
    board.forEach(c => all.push(cardKey(c)));
    board2.forEach(c => all.push(cardKey(c)));
    if(new Set(all).size !== all.length) failures.push(game.name + ': DUPLICATE CARD at showdown');
    if(all.length > 52) failures.push(game.name + ': more than 52 cards in play');
  }); });

  check('All 21 games produced a valid showdown from real dealt cards (' + evaluated + '/21)', evaluated === 21);
  check('No failures across any game (' + (failures.join(' | ') || 'none') + ')', failures.length === 0);

  // Board completion specifically for the games whose quiz pattern stops short
  console.log('');
  console.log('=== Board completion for short-pattern games ===');
  ['Pineapple', 'Crazy Pineapple'].forEach(function(name){
    let game = null;
    DATA.forEach(c => c.games.forEach(x => { if(x.name === name) game = x; }));
    currentScenario = game;
    tableSeats = 7; buttonSeatIndex = null;
    buildTable(game, false);
    const patternBoard = DEAL_PATTERNS[game.dealCat].board;
    const dealtBoard = patternBoard[patternBoard.length - 1];
    let board = tableBoardCards.slice();
    while(board.length < 5 && remainingDeck.length) board.push(remainingDeck.shift());
    check(name + ': quiz pattern deals ' + dealtBoard + ' board cards, completed to ' + board.length + ' for showdown', board.length === 5);
    const uniq = new Set(board.map(cardKey));
    check(name + ': completed board has no duplicate cards', uniq.size === board.length);
  });

  console.log('');
  console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
  if(fail > 0) process.exit(1);
`;

new Function('document','window','localStorage','console','process','RailCards','RailShowdown',
  appCode + '\n' + testBody
)(dom.window.document, dom.window, localStorageStub, console, process, RailCards, RailShowdown);
