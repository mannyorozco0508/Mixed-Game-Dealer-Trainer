/* ============================================================
   test-showdown-integration.js — real dealt cards into showdown.

   This used to slice three ranges out of index.html and run them in jsdom
   purely to get an opening deal; it never touched the DOM. Now that opening a
   hand is its own seam it calls openHand() directly: no jsdom, no marker
   slicing, no index.html.
   ============================================================ */
const { openHand } = require('./hand-open.js');
const RailShowdown = require('./showdown.js');
const RailCardModel = require('./card-model.js');
const { DEAL_PATTERNS } = require('./deal-patterns.js');
const { DATA } = require('./game-data.js');

let pass = 0, fail = 0;
function check(label, cond){ if(cond){ pass++; } else { fail++; console.log('FAIL: ' + label); } }
const cardKey = c => c.rank + c.suit;

console.log('=== Real app-dealt cards -> showdown, every canonical game ===');
let evaluated = 0;
const failures = [];

DATA.forEach(function(cat){ cat.games.forEach(function(game){
  if(!game.dealCat || !game.scenario) return;

  const pattern = DEAL_PATTERNS[game.dealCat];
  const seatCount = 7;
  const hand = openHand({ pattern, seatCount, sitOutSeat: null, deck: RailCardModel.freshDeck() });

  // Boards are empty at hand open by design — they are dealt street by street
  // after their burn — so a showdown completes them from the live deck, which
  // is exactly what the app does.
  const rule = RailShowdown.ruleForGame(game.name);
  const board = hand.tableBoardCards.slice();
  const board2 = hand.tableBoard2Cards.slice();
  const deck = hand.remainingDeck;
  while(rule.needsBoard && board.length < rule.needsBoard && deck.length) board.push(deck.shift());
  while(rule.needsBoard2 && board2.length < rule.needsBoard2 && deck.length) board2.push(deck.shift());

  // Top each seat up to its final holding, the way later streets would.
  const finalCount = pattern.hole[pattern.hole.length - 1];
  const players = [];
  for(let i = 0; i < seatCount; i++){
    const cards = (hand.seatHoleCards[i] || []).slice();
    while(cards.length < finalCount && deck.length) cards.push(deck.shift());
    players.push({ seat:i, cards: cards.slice(0, finalCount) });
  }

  const r = RailShowdown.evaluateShowdown({ game, players, board, board2 });
  if(!r.ok){ failures.push(game.name + ': ' + r.error); return; }
  if(!r.winners || r.winners.length === 0){
    if(r.unqualifiedSides.length !== r.sides.length){
      failures.push(game.name + ': no winners but sides qualified');
    }
  }
  evaluated++;

  const all = [];
  players.forEach(p => p.cards.forEach(c => all.push(cardKey(c))));
  board.forEach(c => all.push(cardKey(c)));
  board2.forEach(c => all.push(cardKey(c)));
  if(new Set(all).size !== all.length) failures.push(game.name + ': DUPLICATE CARD at showdown');
  if(all.length > 52) failures.push(game.name + ': more than 52 cards in play');
}); });

let expected = 0;
DATA.forEach(function(cat){ cat.games.forEach(function(g){ if(g.dealCat && g.scenario) expected++; }); });
check('Every canonical game produced a valid showdown from real dealt cards (' + evaluated + '/' + expected + ')',
      evaluated === expected && expected > 0);
check('No failures across any game (' + (failures.join(' | ') || 'none') + ')', failures.length === 0);

console.log('');
console.log('=== Board completion for short-pattern games ===');
['Pineapple', 'Crazy Pineapple'].forEach(function(name){
  let game = null;
  DATA.forEach(c => c.games.forEach(x => { if(x.name === name) game = x; }));
  const pattern = DEAL_PATTERNS[game.dealCat];
  const hand = openHand({ pattern, seatCount: 7, sitOutSeat: null, deck: RailCardModel.freshDeck() });
  const rule = RailShowdown.ruleForGame(game.name);
  const board = hand.tableBoardCards.slice();
  const deck = hand.remainingDeck;
  check(name + ': board starts empty at hand open', board.length === 0);
  while(rule.needsBoard && board.length < rule.needsBoard && deck.length) board.push(deck.shift());
  check(name + ': board completes to ' + rule.needsBoard + ' for evaluation',
        board.length === rule.needsBoard);
  check(name + ': completed board has no duplicates',
        new Set(board.map(cardKey)).size === board.length);
});

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
