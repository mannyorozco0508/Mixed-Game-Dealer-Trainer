/* ============================================================
   test-hand-open.js — opening a hand, with no DOM at all.

   No jsdom, no marker slicing, no index.html. openHand() is called directly
   with an injected deck, which is the point of the seam: what hand this is
   can be answered without rendering anything.

   The second half proves the extracted seam produces the SAME opening model
   as the buildTable code it replaced, against a golden master captured from
   that code before the extraction.
   ============================================================ */
const { openHand, openingStepFor } = require('./hand-open.js');
const { DEAL_PATTERNS } = require('./deal-patterns.js');
const { DATA } = require('./game-data.js');
const { RANKS, SUITS } = require('./card-model.js');
const golden = require('./fixture-opening-golden.json');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const fmt = c => c ? c.rank + c.suit : '--';
function fullDeck(){
  const d = []; RANKS.forEach(r => SUITS.forEach(s => d.push({ rank:r, suit:s }))); return d;
}
function seededDeck(seed){
  const cards = fullDeck();
  let x = (seed * 2654435761) >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  for(let i = cards.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function findGame(name){
  for(const cat of DATA) for(const g of cat.games) if(g.name === name) return g;
  throw new Error('game not found: ' + name);
}
function open(name, seatCount, sitOutSeat, deck){
  const game = findGame(name);
  return {
    game,
    pattern: DEAL_PATTERNS[game.dealCat],
    hand: openHand({
      pattern: DEAL_PATTERNS[game.dealCat],
      seatCount, sitOutSeat: sitOutSeat === undefined ? null : sitOutSeat,
      deck: deck || fullDeck()
    })
  };
}

console.log('=== Opening card counts, every family ===');
[
  ["Texas Hold'em", 2], ['Big O Hi-Lo', 5], ['Big O PLO', 5],
  ['Stud Hi-Lo / 8-or-Better', 3], ['Razz', 3],
  ['Super Stud Hi-Lo 8 / Super Pat', 5],
  ['Badugi', 4], ['A-5 Lowball', 5], ['2-7 Lowball', 5],
  ['Badacey', 5], ['Baducey', 5], ['Archie', 5],
  ['Drawmaha Hi', 5], ['Big-O Double Board', 5],
  ['Pineapple', 3], ['Crazy Pineapple', 3]
].forEach(([name, expected]) => {
  const o = open(name, 7);
  const sizes = o.hand.seatHoleCards.map(h => h.length);
  check(name + ': every seat opens with ' + expected + ' cards',
        sizes.every(n => n === expected), JSON.stringify(sizes));
  check(name + ': boards are empty at hand open',
        o.hand.tableBoardCards.length === 0 && o.hand.tableBoard2Cards.length === 0,
        'board=' + o.hand.tableBoardCards.length + ' board2=' + o.hand.tableBoard2Cards.length);
  check(name + ': remaining deck excludes the opening cards',
        o.hand.remainingDeck.length === 52 - (expected * 7),
        String(o.hand.remainingDeck.length));
  const all = [];
  o.hand.seatHoleCards.forEach(h => h.forEach(c => all.push(fmt(c))));
  check(name + ': no duplicate opening cards', new Set(all).size === all.length);
  check(name + ': no opening card is still in the deck',
        !o.hand.remainingDeck.map(fmt).some(c => all.includes(c)));
  check(name + ': piles start clean',
        o.hand.muckPile.length === 0 && o.hand.burnCards.length === 0 &&
        o.hand.roundDiscards.length === 0);
});

console.log('');
console.log('=== Every family deals in passes, not blocks ===');
{
  // A tagged deck makes the pass structure unambiguous: card N is the Nth
  // card off the top, so seat s on pass p must hold card p*activeSeats + s.
  function taggedDeck(){
    const d = [];
    for(let i = 0; i < 52; i++) d.push({ rank:'X', suit:'Y', n:i });
    return d;
  }
  [
    ["Texas Hold'em", 2], ['Big O Hi-Lo', 5], ['Big O PLO', 5],
    ['Stud Hi-Lo / 8-or-Better', 3], ['Razz', 3],
    ['Super Stud Hi-Lo 8 / Super Pat', 5],
    ['Badugi', 4], ['A-5 Lowball', 5], ['2-7 Lowball', 5],
    ['Badacey', 5], ['Baducey', 5], ['Archie', 5],
    ['Drawmaha Hi', 5], ['Big-O Double Board', 5],
    ['Pineapple', 3], ['Crazy Pineapple', 3]
  ].forEach(([name, passes]) => {
    const SEATS = 7;
    const o = open(name, SEATS, null, taggedDeck());
    let ok = true;
    for(let p = 0; p < passes; p++){
      for(let s = 0; s < SEATS; s++){
        if(o.hand.seatHoleCards[s][p].n !== p * SEATS + s) ok = false;
      }
    }
    check(name + ': ' + passes + ' passes, one card per seat per pass', ok,
          'seat0=' + o.hand.seatHoleCards[0].map(c => c.n).join(',') +
          ' seat1=' + o.hand.seatHoleCards[1].map(c => c.n).join(','));
    check(name + ': remaining deck resumes exactly where the deal stopped',
          o.hand.remainingDeck[0].n === passes * SEATS,
          String(o.hand.remainingDeck[0].n));
    check(name + ': openingPitch is the deck-removal order',
          o.hand.openingPitch.map(x => x.card.n).join(',') ===
          Array.from({length: passes * SEATS}, (_, i) => i).join(','));
    check(name + ': pass numbers are recorded and ascending',
          o.hand.openingPitch.every((x, i) => x.pass === Math.floor(i / SEATS)));
  });

  // Face state follows the PASS, not the seat.
  const stud = open('Stud Hi-Lo / 8-or-Better', 7, null, taggedDeck());
  check('Stud: passes 1 and 2 are down, pass 3 is up',
        stud.hand.openingPitch.every(p => p.faceUp === (p.pass === 2)),
        stud.hand.openingPitch.map(p => p.pass + (p.faceUp ? 'U' : 'D')).join(' '));
  const ss = open('Super Stud Hi-Lo 8 / Super Pat', 7, null, taggedDeck());
  check('Super Stud: passes 1-4 down, pass 5 up',
        ss.hand.openingPitch.every(p => p.faceUp === (p.pass === 4)));
  const bo = open('Big O Hi-Lo', 7, null, taggedDeck());
  check('Big O: every pass is face down', bo.hand.openingPitch.every(p => !p.faceUp));

  // A sitting-out seat is skipped on EVERY pass and consumes nothing.
  const so = open('Big O Hi-Lo', 7, 3, taggedDeck());
  const active = [0,1,2,4,5,6];
  let skipOk = true;
  for(let p = 0; p < 5; p++){
    active.forEach((s, idx) => {
      if(so.hand.seatHoleCards[s][p].n !== p * 6 + idx) skipOk = false;
    });
  }
  check('sit-out: active seats keep their order across every pass', skipOk,
        'seat0=' + so.hand.seatHoleCards[0].map(c => c.n).join(','));
  check('sit-out: the empty seat consumed no cards',
        so.hand.seatHoleCards[3].length === 0 &&
        so.hand.remainingDeck[0].n === 30, String(so.hand.remainingDeck[0].n));
  check('sit-out: it never appears in the pitch plan',
        !so.hand.openingPitch.some(p => p.seat === 3));
}

console.log('');
console.log('=== Opening face targets ===');
{
  const stud = open('Stud Hi-Lo / 8-or-Better', 7);
  const seat0 = stud.hand.openingPitch.filter(p => p.seat === 0);
  check('Stud opens D D U', seat0.length === 3 && !seat0[0].faceUp && !seat0[1].faceUp && seat0[2].faceUp,
        seat0.map(p => p.faceUp ? 'U' : 'D').join(''));
  const razz = open('Razz', 7);
  const r0 = razz.hand.openingPitch.filter(p => p.seat === 0);
  check('Razz opens D D U', r0.length === 3 && !r0[0].faceUp && !r0[1].faceUp && r0[2].faceUp,
        r0.map(p => p.faceUp ? 'U' : 'D').join(''));
  const ss = open('Super Stud Hi-Lo 8 / Super Pat', 7);
  const s0 = ss.hand.openingPitch.filter(p => p.seat === 0);
  check('Super Stud opens D D D D U',
        s0.length === 5 && s0.slice(0,4).every(p => !p.faceUp) && s0[4].faceUp,
        s0.map(p => p.faceUp ? 'U' : 'D').join(''));
  const he = open("Texas Hold'em", 7);
  check("Hold'em opens both cards down",
        he.hand.openingPitch.every(p => !p.faceUp));
  const bo = open('Big O Hi-Lo', 7);
  check('Big O opens five down',
        bo.hand.openingPitch.filter(p => p.seat === 0).length === 5 &&
        bo.hand.openingPitch.every(p => !p.faceUp));
  const dm = open('Drawmaha Hi', 7);
  check('Drawmaha opens five down',
        dm.hand.openingPitch.filter(p => p.seat === 0).length === 5 &&
        dm.hand.openingPitch.every(p => !p.faceUp));
}

console.log('');
console.log('=== The opening pitch plan is one card at a time, round by round ===');
{
  const o = open('Stud Hi-Lo / 8-or-Better', 4);
  const order = o.hand.openingPitch.map(p => p.seat + ':' + p.handPos);
  check('cards go round the table, not seat by seat',
        order.join(' ') === '0:0 1:0 2:0 3:0 0:1 1:1 2:1 3:1 0:2 1:2 2:2 3:2',
        order.join(' '));
  check('the plan matches the cards actually held', (() => {
    for(const p of o.hand.openingPitch){
      if(fmt(o.hand.seatHoleCards[p.seat][p.handPos]) !== fmt(p.card)) return false;
    }
    return true;
  })());
  check('slot index equals hand position on the opening street',
        o.hand.openingPitch.every(p => p.slotIndex === p.handPos));
}

console.log('');
console.log('=== A sitting-out seat gets nothing ===');
{
  const o = open("Texas Hold'em", 7, 4);
  check('the sit-out seat has no cards', o.hand.seatHoleCards[4].length === 0);
  check('every other seat has two',
        [0,1,2,3,5,6].every(i => o.hand.seatHoleCards[i].length === 2));
  check('the sit-out seat is absent from the opening pitch plan',
        !o.hand.openingPitch.some(p => p.seat === 4));
  check('the deck only lost cards for six seats',
        o.hand.remainingDeck.length === 52 - 12, String(o.hand.remainingDeck.length));
}

console.log('');
console.log('=== Nobody is locked Pat at hand open ===');
{
  const o = open('Super Stud Hi-Lo 8 / Super Pat', 7);
  check('no seat starts Pat-locked', o.hand.seatPatLocked.every(v => v === false),
        JSON.stringify(o.hand.seatPatLocked));
  check('the lock array covers every seat', o.hand.seatPatLocked.length === 7);
}

console.log('');
console.log('=== Two consecutive hands share no state ===');
{
  const a = open('Super Stud Hi-Lo 8 / Super Pat', 7, null, seededDeck(1));
  // Simulate hand 1 dirtying everything a player could dirty.
  a.hand.seatPatLocked[2] = true;
  a.hand.muckPile.push({ rank:'A', suit:'S' });
  a.hand.roundDiscards.push({ rank:'K', suit:'D' });
  a.hand.burnCards.push({ rank:'Q', suit:'H' });
  a.hand.tableBoardCards.push({ rank:'J', suit:'C' });

  const b = open('Super Stud Hi-Lo 8 / Super Pat', 7, null, seededDeck(2));
  check('hand 2 starts with no Pat locks', b.hand.seatPatLocked.every(v => v === false));
  check('hand 2 starts with an empty muck', b.hand.muckPile.length === 0);
  check('hand 2 starts with no current-round discards', b.hand.roundDiscards.length === 0);
  check('hand 2 starts with no burns', b.hand.burnCards.length === 0);
  check('hand 2 starts with an empty board', b.hand.tableBoardCards.length === 0);
  check('hand 2 starts with zeroed dealt counts', b.hand.seatDealtCounts.every(n => n === 0));
  check('hand 2 dealt a different hand from a different deck',
        JSON.stringify(a.hand.seatHoleCards[0].map(fmt)) !==
        JSON.stringify(b.hand.seatHoleCards[0].map(fmt)));
  check('hand 1 arrays were not aliased into hand 2',
        a.hand.muckPile !== b.hand.muckPile &&
        a.hand.seatPatLocked !== b.hand.seatPatLocked &&
        a.hand.tableBoardCards !== b.hand.tableBoardCards);
}

console.log('');
console.log('=== The deck is injected, so the hand is deterministic ===');
{
  const stacked = fullDeck();
  const a = open("Texas Hold'em", 6, null, stacked);
  const b = open("Texas Hold'em", 6, null, stacked);
  check('the same deck produces the same hand twice',
        JSON.stringify(a.hand.seatHoleCards.map(h => h.map(fmt))) ===
        JSON.stringify(b.hand.seatHoleCards.map(h => h.map(fmt))));
  check('the injected deck is not mutated by openHand', stacked.length === 52);
  // ONE CARD PER SEAT PER PASS. Six-handed Hold'em: seat 0 takes the 1st and
  // 7th cards off the deck, not the 1st and 2nd.
  check('seat 0 takes the 1st and 7th cards off the deck',
        fmt(a.hand.seatHoleCards[0][0]) === fmt(stacked[0]) &&
        fmt(a.hand.seatHoleCards[0][1]) === fmt(stacked[6]),
        a.hand.seatHoleCards[0].map(fmt).join(' '));
  check('seat 1 takes the 2nd and 8th',
        fmt(a.hand.seatHoleCards[1][0]) === fmt(stacked[1]) &&
        fmt(a.hand.seatHoleCards[1][1]) === fmt(stacked[7]),
        a.hand.seatHoleCards[1].map(fmt).join(' '));
  check('the first pass reaches every seat before the second begins',
        a.hand.openingPitch.slice(0, 6).map(p => p.seat).join('') === '012345' &&
        a.hand.openingPitch.slice(6, 12).map(p => p.seat).join('') === '012345',
        a.hand.openingPitch.map(p => p.seat).join(''));
  check('the pitch plan IS the deck-removal order',
        a.hand.openingPitch.map(p => fmt(p.card)).join(' ') ===
        stacked.slice(0, 12).map(fmt).join(' '),
        a.hand.openingPitch.map(p => fmt(p.card)).join(' '));
  check('the card left the deck at the moment it was pitched',
        !a.hand.openingPitch.some(p => a.hand.remainingDeck.map(fmt).includes(fmt(p.card))));
}

console.log('');
console.log('=== Stud and Razz bring-ins are computable with zero animation ===');
{
  // upCardsFromModel reads seatHoleCards and faceSeq — never the slot maps or
  // the DOM — so the bring-in is knowable the instant openHand returns.
  const Action = require('./table-action.js');
  function upsFromModel(hand, pattern, seatCount, sitOutSeat){
    const faceSeq = pattern.faceSeq[openingStepFor(pattern).step] || '';
    const out = {};
    for(let i = 0; i < seatCount; i++){
      if(i === sitOutSeat) continue;
      const held = hand.seatHoleCards[i] || [];
      const ups = [];
      for(let k = 0; k < held.length; k++) if(faceSeq.charAt(k) === 'U') ups.push(held[k]);
      out[i] = ups;
    }
    return out;
  }
  // Stack the doors so the answer is unambiguous: seat 5 holds the 3c.
  function stackStudUnused(doors){
    const downs = [['AH','AD'],['AS','AC'],['KS','KC'],['QH','QC'],['JH','JD'],['TS','TC'],['9S','9C']];
    const deck = [];
    for(let r = 0; r < 3; r++){
      for(let s = 0; s < 7; s++){
        const t = r < 2 ? downs[s][r] : doors[s];
        deck.push({ rank: t[0], suit: t[1] });
      }
    }
    fullDeck().forEach(c => { if(!deck.some(x => fmt(x) === fmt(c))) deck.push(c); });
    return deck;
  }
  // The deal goes one card per seat per pass, so the stack is built in passes:
  // seven first-down cards, seven second-down cards, then the seven doors.
  function stackRoundRobin(doors){
    const downs = [['AH','AD'],['AS','AC'],['KS','KC'],['QH','QC'],['JH','JD'],['TS','TC'],['9S','9C']];
    const deck = [];
    for(let s = 0; s < 7; s++) deck.push({rank:downs[s][0][0], suit:downs[s][0][1]});
    for(let s = 0; s < 7; s++) deck.push({rank:downs[s][1][0], suit:downs[s][1][1]});
    for(let s = 0; s < 7; s++) deck.push({rank:doors[s][0],    suit:doors[s][1]});
    fullDeck().forEach(c => { if(!deck.some(x => fmt(x) === fmt(c))) deck.push(c); });
    return deck;
  }

  const studDoors = ['KH','QD','JS','TH','9H','3C','8D'];   // lowest is 3C at seat 5
  const s = open('Stud Hi-Lo / 8-or-Better', 7, null, stackRoundRobin(studDoors));
  const studUps = upsFromModel(s.hand, s.pattern, 7, null);
  check('Stud door cards are readable straight from the model',
        [0,1,2,3,4,5,6].every(i => studUps[i].length === 1),
        JSON.stringify(Object.keys(studUps).map(k => fmt(studUps[k][0]))));
  const studBringIn = Action.firstActor({
    dealCat: 'studSplit', tableSeats: 7, buttonSeat: null, sitOutSeat: null,
    foldedSeats: new Set(), street: 0, upCards: studUps, highBringsIn: false
  });
  check('Stud Hi-Lo bring-in is the lowest door, seat 5', studBringIn === 5, String(studBringIn));

  const razzDoors = ['5H','4D','3S','KS','2H','6C','7D'];   // highest is KS at seat 3
  const r = open('Razz', 7, null, stackRoundRobin(razzDoors));
  const razzUps = upsFromModel(r.hand, r.pattern, 7, null);
  const razzBringIn = Action.firstActor({
    dealCat: 'studSplit', tableSeats: 7, buttonSeat: null, sitOutSeat: null,
    foldedSeats: new Set(), street: 0, upCards: razzUps, highBringsIn: true
  });
  check('Razz bring-in is the highest door, seat 3', razzBringIn === 3, String(razzBringIn));
  check('neither bring-in needed a slot map',
        s.hand.seatSlotMaps.every(m => m.length === 0) &&
        r.hand.seatSlotMaps.every(m => m.length === 0));
}

console.log('');
console.log('=== EQUIVALENCE: openHand matches the buildTable code it replaced ===');
{
  // The golden master was captured from buildTable BEFORE the openHand
  // extraction. Its card-IDENTITY columns encoded the old block-per-seat deal
  // and have been stripped, because a fixture whose job is preserving a
  // known-wrong physical order is worse than no fixture. What remains is
  // genuinely order-independent and still proves the extraction faithful:
  // hand sizes, slot maps, dealt counts, deck accounting and sit-out.
  // Card identity truth now lives in the round-robin tests above.
  Object.keys(golden).forEach(name => {
    const g = golden[name];
    const deck = seededDeck(g.seed);
    const o = open(name, 7, g.sitOut, deck);
    const sizes = o.hand.seatHoleCards.map(h => h.length);
    check(name + ': hand sizes identical',
          JSON.stringify(sizes) === JSON.stringify(g.holeSizes),
          JSON.stringify(sizes) + ' vs ' + JSON.stringify(g.holeSizes));
    check(name + ': slot maps identical',
          JSON.stringify(o.hand.seatSlotMaps) === JSON.stringify(g.slotMaps));
    check(name + ': dealt counts identical',
          JSON.stringify(o.hand.seatDealtCounts) === JSON.stringify(g.dealtCounts));
    check(name + ': remaining deck size identical',
          o.hand.remainingDeck.length === g.remainingCount,
          o.hand.remainingDeck.length + ' vs ' + g.remainingCount);

    check(name + ': sit-out participation identical',
          (g.sitOut === null) || o.hand.seatHoleCards[g.sitOut].length === 0);
  });
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
