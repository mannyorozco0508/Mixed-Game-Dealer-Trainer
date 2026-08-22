/* ============================================================
   test-betting-structure.js

   Two structural rules the engine had implemented but never consulted.

   1. THE RAISE CAP. money-state carries rules.raiseCap (4 bets per street,
      null for pot-limit), counts raisesThisStreet, resets it on closeStreet,
      and exposes raiseCapReached(). It had ZERO callers. legalActions()
      offered RAISE forever: a 440-hand audit produced a single street with
      52 wagers. betting-engine documents the heads-up exemption, so the cap
      applies only while three or more players are live.

   2. THE FORCED BET. createRound() opened every street with
      betOutstanding:false, including the street where blinds or the bring-in
      were already posted, so legalActions() offered CHECK to a seat that owed
      the big blind — 305 illegal checks across the same 440 hands, all of
      them on the opening street.

   Blinds and the bring-in are NOT the same shape. The big blind is a standing
   wager that still holds its option; the bring-in seat's forced post is that
   seat's action for the street.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const A     = require('./table-action.js');
const Money = require('./money-state.js');

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

console.log('=== The cap closes RAISE, and only RAISE ===');
{
  const r = round({});
  A.applyAction(r, r.current, A.ACTION.BET);
  check('an open street offers check and bet',
        A.legalActions(round({})).join() === 'check,bet');
  check('facing a bet, raise is available', A.legalActions(r).indexOf('raise') >= 0);

  r.raiseCapped = true;
  const legal = A.legalActions(r);
  check('capped: raise is gone', legal.indexOf('raise') === -1, legal.join());
  check('capped: fold survives', legal.indexOf('fold') >= 0);
  check('capped: call survives', legal.indexOf('call') >= 0);
  check('capped: check is NOT introduced', legal.indexOf('check') === -1, legal.join());

  const open = round({});
  open.raiseCapped = true;
  check('a cap on an unbet street changes nothing',
        A.legalActions(open).join() === 'check,bet');
}

console.log('=== A capped raise becomes a call, never a fold ===');
{
  const r = round({});
  A.applyAction(r, r.current, A.ACTION.BET);
  r.raiseCapped = true;
  // PREMIUM wants to raise; the cap forbids it.
  const chosen = A.chooseAction(r, { tier: 3, loosenessBias: 0.5 });
  check('the hand still continues', chosen !== A.ACTION.FOLD, 'got ' + chosen);
  check('and it is legal', A.legalActions(r).indexOf(chosen) >= 0, chosen);
  check('a premium hand calls when it cannot raise', chosen === A.ACTION.CALL, chosen);
}

console.log('=== money-state owns the count, the round owns the answer ===');
{
  const ms = Money.createMoneyState
    ? Money.createMoneyState({ dealCat:'holdem', seats:[0,1,2,3,4,5,6], sitOutSeat:null, startingStack:1000 })
    : null;
  if(ms){
    check('a fresh street has no raises', ms.raisesThisStreet === 0);
    check('the cap is not reached yet', !Money.raiseCapReached(ms));
    ms.raisesThisStreet = 4;
    check('four wagers reaches the cap', Money.raiseCapReached(ms));
    ms.raisesThisStreet = 3;
    check('three does not', !Money.raiseCapReached(ms));
  } else {
    check('money-state exposes raiseCapReached', typeof Money.raiseCapReached === 'function');
  }
  check('pot-limit is uncapped by configuration',
        Money.raiseCapReached({ rules:{ raiseCap:null }, raisesThisStreet: 99 }) === false);
}

console.log('=== Blinds: the big blind is the standing wager and keeps its option ===');
{
  const r = round({ street: 0, forcedBet: 'blinds', forcedBetSeat: 2 });
  check('the street opens with a wager outstanding', r.betOutstanding);
  check('checking is not offered', A.legalActions(r).indexOf('check') === -1,
        A.legalActions(r).join());
  check('the big blind is the aggressor', r.aggressor === 2);
  check('nobody has acted since the blind yet', r.actedSinceAggression.size === 0);
  check('first to act is UTG, not the blind', r.current === 3, 'current=' + r.current);

  // Everyone calls round to the blind; the blind must still get to act.
  let guard = 20, sawBlind = false;
  while(!r.complete && guard-- > 0){
    if(r.current === 2) sawBlind = true;
    A.applyAction(r, r.current, A.ACTION.CALL);
  }
  check('the round closes', r.complete);
  check('the big blind got its option', sawBlind);
}

console.log('=== Bring-in: the forced post IS that seat\u2019s action ===');
{
  const r = A.createRound({
    dealCat: 'studSplit', tableSeats: 7, buttonSeat: null,
    sitOutSeat: null, foldedSeats: new Set(), street: 0,
    upCards: {}, forcedBet: 'bring-in', forcedBetSeat: 4
  });
  check('the street opens with a wager outstanding', r.betOutstanding);
  check('checking is not offered', A.legalActions(r).indexOf('check') === -1);
  check('the bring-in seat is the aggressor', r.aggressor === 4);
  check('it counts as having acted', r.actedSinceAggression.has(4));
  check('the turn has moved past it', r.current !== 4, 'current=' + r.current);

  // If everyone calls, the bring-in does NOT act again.
  let guard = 20, actedTwice = false;
  while(!r.complete && guard-- > 0){
    if(r.current === 4) actedTwice = true;
    A.applyAction(r, r.current, A.ACTION.CALL);
  }
  check('the round closes', r.complete);
  check('a called bring-in does not act again', !actedTwice);
}

console.log('=== Streets without a forced bet are unchanged ===');
{
  const r = round({ street: 2 });
  check('a later street opens unbet', !r.betOutstanding);
  check('and offers check', A.legalActions(r).indexOf('check') >= 0);
  check('with no aggressor', r.aggressor === null);
  check('raiseCapped defaults to false', r.raiseCapped === false);

  const noForce = round({ street: 0 });
  check('street 0 with no forced bet still opens unbet', !noForce.betOutstanding);
}

console.log('=== The table wires both rules ===');
{
  check('the round is told when the cap is reached',
        /currentRound\.raiseCapped\s*=/.test(SRC));
  check('the answer comes from money-state, not a local count',
        /RailMoney\.raiseCapReached\(moneyState\)/.test(SRC));
  check('heads-up lifts the cap, as betting-engine documents',
        /live > 2 && window\.RailMoney\.raiseCapReached/.test(SRC));
  check('the cap is refreshed before every decision, not once per street',
        SRC.indexOf('refreshRaiseCap();') > SRC.indexOf('function runNextAction'));
  check('the refresh runs before the human control branch',
        SRC.indexOf('refreshRaiseCap();') < SRC.indexOf('showHumanControls(seat)'));
  check('forced bets are passed into the round', /forcedBet:\s*forcedBet/.test(SRC));
  check('a forced bet is only claimed when money-state shows one standing',
        /moneyState\.currentBet > 0/.test(SRC));
  check('button games report blinds', /forcedBet = 'blinds'/.test(SRC));
  check('stud games report the bring-in', /forcedBet = 'bring-in'/.test(SRC));
  check('the blind seat is derived, not assumed', /function bigBlindSeatFrom/.test(SRC));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
