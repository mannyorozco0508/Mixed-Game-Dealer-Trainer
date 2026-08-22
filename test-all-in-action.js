/* ============================================================
   test-all-in-action.js

   A seat with no chips behind is still IN the hand — it contests the pot at
   showdown — but it can never act again. The round had no notion of this:
   activeSeats() and nextActor() filtered only folded and sat-out seats, so a
   $0 seat kept receiving the turn. Because a RAISE resets
   actedSinceAggression, two all-in seats "raising" nothing ping-ponged
   forever and the street never closed. In a 44-hand audit sample this stalled
   5 hands outright (Super Baducey, Super Badacey, Big O PLO, Drawmaha A-5,
   Drawmaha Badugi).

   These tests pin the closure rules, and that the table tells the round about
   all-in seats at both boundaries: at street start via createRound, and
   mid-street via markAllIn.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const A    = require('./table-action.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}

function round(over){
  return A.createRound(Object.assign({
    dealCat: 'holdem', tableSeats: 7, buttonSeat: 0,
    sitOutSeat: null, foldedSeats: new Set(), street: 1, upCards: {}
  }, over || {}));
}

console.log('=== An all-in seat never receives the turn ===');
{
  const r = round({ allInSeats: [3] });
  check('createRound accepts all-in seats', r.allInSeats instanceof Set);
  check('an all-in seat is recorded', r.allInSeats.has(3));
  check('the first actor is not the all-in seat', r.current !== 3, 'current=' + r.current);

  check('nextActor skips it', A.nextActor(r, 2) !== 3, String(A.nextActor(r, 2)));
  check('it is still IN the hand', A.activeSeats(r).indexOf(3) >= 0);
  check('but it is not among the seats yet to act', A.seatsYetToAct(r).indexOf(3) === -1);
}

console.log('=== Two all-in seats can no longer ping-pong ===');
{
  // The exact shape that hung: everyone else folds, two $0 seats remain.
  const r = round({ street: 1 });
  let guard = 200, acted = 0;
  while(!r.complete && guard-- > 0){
    const seat = r.current;
    if(seat === null) break;
    acted++;
    if(seat === 5 || seat === 6){
      A.applyAction(r, seat, A.ACTION.RAISE);
      A.markAllIn(r, seat);            // money-state says they are out of chips
    } else {
      A.applyAction(r, seat, A.ACTION.FOLD);
    }
  }
  check('the round terminates', r.complete, 'guard left=' + guard);
  check('it terminates in a sane number of actions', acted < 30, 'actions=' + acted);
  check('both all-in seats survive to showdown',
        A.activeSeats(r).indexOf(5) >= 0 && A.activeSeats(r).indexOf(6) >= 0,
        JSON.stringify(A.activeSeats(r)));
  check('nobody is left to act', A.seatsYetToAct(r).length === 0,
        JSON.stringify(A.seatsYetToAct(r)));
}

console.log('=== markAllIn closes the street when nobody can act ===');
{
  const r = round({ foldedSeats: new Set([0,1,2,3]) });
  A.applyAction(r, r.current, A.ACTION.BET);
  const better = r.log[r.log.length - 1].seat;
  A.markAllIn(r, better);
  // One opponent remains with chips: the street must NOT close yet.
  check('a live opponent still gets to act', !r.complete, 'current=' + r.current);
  check('and it is not the all-in seat', r.current !== better);

  // Take the remaining actors' chips away one at a time; the street closes
  // only when the LAST of them can no longer act.
  A.markAllIn(r, r.current);
  check('a second live opponent still gets to act', !r.complete, 'current=' + r.current);
  A.markAllIn(r, r.current);
  check('once no one can act the street closes', r.complete);
  check('closing this way is not a fold-out', !r.endedByFolds);
  check('every contender is still in the hand', A.activeSeats(r).length === 3,
        JSON.stringify(A.activeSeats(r)));
}

console.log('=== All-in is not folding ===');
{
  const r = round({ allInSeats: [2,4] });
  check('all-in seats are not in foldedSeats', !r.foldedSeats.has(2) && !r.foldedSeats.has(4));
  check('they still count as contenders', A.activeSeats(r).length === 7);
  check('only the rest may act', A.seatsYetToAct(r).length === 5,
        JSON.stringify(A.seatsYetToAct(r)));

  // Fold everyone who can still act; the two all-in seats must remain and the
  // hand must NOT be scored as ended by folds.
  let guard = 20;
  while(!r.complete && guard-- > 0) A.applyAction(r, r.current, A.ACTION.FOLD);
  check('the round ends', r.complete);
  check('two contenders remain', A.activeSeats(r).length === 2,
        JSON.stringify(A.activeSeats(r)));
  check('a pot with two all-in contenders is not an early fold-win',
        !r.endedByFolds);
}

console.log('=== Ordinary rounds are unchanged ===');
{
  const r = round({});
  check('a fresh round has an empty all-in set', r.allInSeats.size === 0);
  const seen = [];
  let guard = 30;
  while(!r.complete && guard-- > 0){ seen.push(r.current); A.applyAction(r, r.current, A.ACTION.CHECK); }
  check('a check-around closes after one orbit', r.complete);
  check('every seat acted exactly once', seen.length === 7, 'acted=' + seen.length);
  check('no seat acted twice', new Set(seen).size === seen.length);
  check('a check-around is not a fold-out', !r.endedByFolds);
}

console.log('=== A single fold-out still ends the hand ===');
{
  const r = round({ foldedSeats: new Set([0,1,2,3,4]) });
  A.applyAction(r, r.current, A.ACTION.FOLD);
  check('one contender left ends the round', r.complete);
  check('and it is flagged as ended by folds', r.endedByFolds);
}

console.log('=== The table wires both boundaries ===');
{
  check('startActionRound seeds the round with current all-in seats',
        /allInSeats:\s*allInNow/.test(SRC));
  check('all-in seats are read from money-state, not guessed',
        /moneyState\.allIn\[i\]/.test(SRC));
  check('a mid-street all-in is reported to the round',
        /RailAction\.markAllIn\(currentRound,\s*seat\)/.test(SRC));
  check('it is reported after money is applied, not before',
        SRC.indexOf('applyMoneyAction(moneyState, seat, action, activeStepIndex)')
          < SRC.indexOf('RailAction.markAllIn(currentRound, seat)'));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
