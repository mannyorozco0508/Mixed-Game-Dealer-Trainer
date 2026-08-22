/* ============================================================
   test-sizing-timing.js

   Two production behaviours that were written, validated and then never
   called. Both were wired in the final readiness wave and neither had a
   permanent guard until now.

   1. POT-LIMIT SIZING. money-state.applyMoneyAction has always accepted
      opts.desiredTo and clamped it between the minimum legal raise and the
      pot maximum. It had ZERO callers, so every Big O PLO wager resolved to
      maxRaiseTo — the AI potted every single time.

   2. ACTION TIMING. RailRhythm.actionDelay(action, baseDelay) scales a pause
      by what the seat decided. It had ZERO callers; the action loop used the
      mode's flat base only, so a fold and a three-bet both took ~500ms.

   Sizing is intent only: legality stays entirely money-state's business, and
   these tests prove intent can never produce an illegal wager.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const R  = require('./betting-rhythm.js');
const M  = require('./money-state.js');
const BE = require('./betting-engine.js');
const AI = require('./ai-players.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return (s>>>0)/4294967296; };
}
const T = AI.TIER;
const PERS = R.PERSONALITIES;
const byId = id => PERS.find(p => p.id === id);

/* Mean size for a tier/personality over a legal range, seeded. */
function meanSize(tier, personality, minTo, maxTo, seed, phase){
  const r = rng(seed);
  let sum = 0, n = 600;
  for(let i = 0; i < n; i++){
    sum += R.potLimitSizing({ tier, personality, minTo, maxTo, rng:r, phase: phase || 'middle' });
  }
  return sum / n;
}
function spread(tier, personality, minTo, maxTo, seed){
  const r = rng(seed), seen = new Set();
  let min = Infinity, max = -Infinity;
  for(let i = 0; i < 600; i++){
    const v = R.potLimitSizing({ tier, personality, minTo, maxTo, rng:r });
    seen.add(v); if(v < min) min = v; if(v > max) max = v;
  }
  return { distinct: seen.size, min, max };
}

console.log('=== Sizing always lands inside the legal range ===');
{
  const r = rng(4242);
  let outOfRange = 0, atMax = 0, atMin = 0, total = 0;
  [T.WEAK, T.MARGINAL, T.STRONG, T.PREMIUM].forEach(tier => {
    PERS.forEach(p => {
      [[40,240],[20,70],[120,170],[270,370],[100,1000]].forEach(([lo,hi]) => {
        for(let i = 0; i < 60; i++){
          const v = R.potLimitSizing({ tier, personality:p, minTo:lo, maxTo:hi, rng:r });
          total++;
          if(v < lo || v > hi) outOfRange++;
          if(v === hi) atMax++;
          if(v === lo) atMin++;
        }
      });
    });
  });
  check('no sizing ever falls outside the legal range', outOfRange === 0, String(outOfRange));
  check('sizing is not always the maximum', atMax < total * 0.5,
        atMax + '/' + total + ' at max');
  check('sizing is not always the minimum', atMin < total * 0.5,
        atMin + '/' + total + ' at min');
  check('pot remains reachable as a choice', atMax > 0, String(atMax));
}

console.log('=== A legal range produces genuinely different amounts ===');
{
  PERS.forEach((p, i) => {
    const s = spread(T.STRONG, p, 40, 240, 5100 + i);
    check(p.id + ': chooses several different sizes', s.distinct >= 8,
          s.distinct + ' distinct, ' + s.min + '-' + s.max);
    check(p.id + ': does not sit on one amount', s.max > s.min);
  });
}

console.log('=== Stronger hands size larger ===');
{
  const p = byId('balanced');
  const w = meanSize(T.WEAK,     p, 40, 240, 6001);
  const m = meanSize(T.MARGINAL, p, 40, 240, 6002);
  const s = meanSize(T.STRONG,   p, 40, 240, 6003);
  const q = meanSize(T.PREMIUM,  p, 40, 240, 6004);
  check('PREMIUM sizes larger than STRONG',   q > s, q.toFixed(0) + ' vs ' + s.toFixed(0));
  check('STRONG sizes larger than MARGINAL',  s > m, s.toFixed(0) + ' vs ' + m.toFixed(0));
  check('PREMIUM sizes clearly larger than MARGINAL', q > m + 20,
        q.toFixed(0) + ' vs ' + m.toFixed(0));
  check('a bluff is not sized like a monster', w < q, w.toFixed(0) + ' vs ' + q.toFixed(0));
}

console.log('=== Aggressive personalities size larger than passive ===');
{
  const sizeOf = id => meanSize(T.STRONG, byId(id), 40, 240, 7000 + id.length);
  const aggressive = ['aggressive','tight-aggressive','loose-aggressive'].map(sizeOf);
  const passive    = ['tight-passive','loose-passive'].map(sizeOf);
  check('every aggressive profile sizes above every passive one',
        Math.min.apply(null, aggressive) > Math.max.apply(null, passive),
        'agg=[' + aggressive.map(n=>n.toFixed(0)) + '] pas=[' + passive.map(n=>n.toFixed(0)) + ']');
  // A trapper underplays a monster.
  const tricky = meanSize(T.PREMIUM, byId('tricky'), 40, 240, 7100);
  const loud   = meanSize(T.PREMIUM, byId('loose-aggressive'), 40, 240, 7101);
  check('the high-trap profile underplays a premium hand', tricky < loud,
        tricky.toFixed(0) + ' vs ' + loud.toFixed(0));
}

console.log('=== Degenerate ranges resolve safely ===');
{
  check('a collapsed range returns that single amount',
        R.potLimitSizing({ tier:T.PREMIUM, personality:byId('balanced'), minTo:200, maxTo:200 }) === 200);
  check('an inverted range returns the maximum, never something illegal',
        R.potLimitSizing({ tier:T.PREMIUM, personality:byId('balanced'), minTo:300, maxTo:200 }) === 200);
  check('missing bounds return null rather than a guess',
        R.potLimitSizing({ tier:T.PREMIUM, personality:byId('balanced') }) === null);
  check('a one-dollar range is still legal',
        R.potLimitSizing({ tier:T.WEAK, personality:byId('balanced'), minTo:99, maxTo:100 }) >= 99);
}

/* ---------------------------------------------------------------
   PRODUCTION INTEGRATION — intent can never beat money-state
   --------------------------------------------------------------- */
function plo(){ return M.createMoneyState({ dealCat:'bigOPLO', seats:[0,1,2,3,4,5,6],
                                            sitOutSeat:null, startingStack:1000 }); }
function legalBounds(ms, seat, step){
  const pot = ms.pot + ms.seats.reduce((n,s)=>n+ms.streetContrib[s],0);
  const toCall = M.callAmount(ms, seat);
  const indepMax = Math.min(ms.streetContrib[seat] + toCall + (pot + toCall),
                            ms.streetContrib[seat] + ms.stacks[seat]);
  return { minTo: M.minRaiseTo(ms, step), maxTo: M.maxRaiseTo(ms, seat, step), indepMax, pot, toCall };
}

console.log('=== The seven pot-limit arithmetic cases still hold ===');
{
  const cases = [];
  let ms = plo(); M.postBlinds(ms,0,7); cases.push(['unopened', ms, 3, 1]);
  ms = plo(); M.postBlinds(ms,0,7); M.applyMoneyAction(ms,3,'raise',1); cases.push(['facing a raise', ms, 4, 1]);
  ms = plo(); M.postBlinds(ms,0,7); M.applyMoneyAction(ms,3,'raise',1); M.applyMoneyAction(ms,4,'call',1); cases.push(['bet + call faced', ms, 5, 1]);
  ms = plo(); M.postBlinds(ms,0,7); [3,4,5,6].forEach(s=>M.applyMoneyAction(ms,s,'call',1)); cases.push(['multiway limped', ms, 0, 1]);
  ms = plo(); M.postBlinds(ms,0,7); M.applyMoneyAction(ms,3,'raise',1); M.applyMoneyAction(ms,4,'raise',1); cases.push(['raise after raise', ms, 5, 1]);
  ms = plo(); ms.stacks[5]=45; M.postBlinds(ms,0,7); M.applyMoneyAction(ms,3,'raise',1); cases.push(['short stack', ms, 5, 1]);
  ms = plo(); M.postBlinds(ms,0,7); [3,4].forEach(s=>M.applyMoneyAction(ms,s,'call',1)); M.closeStreet(ms); cases.push(['postflop unopened', ms, 1, 2]);

  cases.forEach(([label, state, seat, step]) => {
    const b = legalBounds(state, seat, step);
    check('arithmetic unchanged: ' + label, b.maxTo === b.indepMax,
          'app=' + b.maxTo + ' independent=' + b.indepMax);
  });
  check('the engine formula is untouched',
        BE.potLimitMaxTotalWager(100,20) === 140 && BE.potLimitMaxRaise(100,20) === 120);
}

console.log('=== Intent flows through money-state and is clamped ===');
{
  const r = rng(8080);
  let illegal = 0, overStack = 0, belowMin = 0, runs = 0;
  [T.WEAK, T.MARGINAL, T.STRONG, T.PREMIUM].forEach(tier => {
    PERS.forEach(p => {
      // unopened, facing a raise, and a short stack
      [[3,1,ms=>{M.postBlinds(ms,0,7);}],
       [4,1,ms=>{M.postBlinds(ms,0,7);M.applyMoneyAction(ms,3,'raise',1);}],
       [5,1,ms=>{ms.stacks[5]=45;M.postBlinds(ms,0,7);M.applyMoneyAction(ms,3,'raise',1);}]
      ].forEach(([seat, step, setup]) => {
        const ms = plo(); setup(ms);
        const b = legalBounds(ms, seat, step);
        const before = ms.stacks[seat];
        const to = R.potLimitSizing({ tier, personality:p, minTo:b.minTo, maxTo:b.maxTo, rng:r });
        const amt = M.applyMoneyAction(ms, seat, 'raise', step, { desiredTo: to });
        const finalTo = ms.streetContrib[seat];
        runs++;
        if(finalTo > b.indepMax) illegal++;
        if(amt > before) overStack++;
        if(finalTo < Math.min(b.minTo, before + 0) && ms.stacks[seat] > 0) belowMin++;
        if(ms.stacks[seat] < 0) illegal++;
      });
    });
  });
  check('no wager ever exceeds the legal pot maximum', illegal === 0, String(illegal));
  check('no wager ever exceeds the stack', overStack === 0, String(overStack));
  check('no wager falls below the legal minimum', belowMin === 0, String(belowMin));
  check('the integration was actually exercised', runs === 4 * PERS.length * 3, String(runs));
}

console.log('=== Fixed-limit games never use pot-limit sizing ===');
{
  const ms = M.createMoneyState({ dealCat:'holdem', seats:[0,1,2,3,4,5,6],
                                  sitOutSeat:null, startingStack:1000 });
  M.postBlinds(ms, 0, 7);
  check('a limit game is not pot-limit', ms.rules.type === 'limit', ms.rules.type);
  // Even handed a desiredTo, a fixed-limit raise stays the fixed increment.
  const before = ms.streetContrib[3];
  M.applyMoneyAction(ms, 3, 'raise', 1, { desiredTo: 999 });
  check('a fixed-limit raise ignores desiredTo entirely',
        ms.streetContrib[3] === M.minRaiseTo(ms, 1) || ms.streetContrib[3] - before <= 40,
        'contrib ' + before + ' -> ' + ms.streetContrib[3]);
  check('production only asks for sizing in pot-limit games',
        /rules\.type === 'potlimit'/.test(SRC));
  // The call site itself must be live. Guarding the block off is exactly how
  // desiredTo came to have zero callers in the first place.
  check('the sizing result is passed to money-state as desiredTo',
        /moneyOpts = \{ desiredTo: to \}/.test(SRC));
  check('applyMoneyAction receives those options',
        /applyMoneyAction\(moneyState, seat, action, activeStepIndex, moneyOpts\)/.test(SRC));
  check('the pot-limit branch is not disabled by a falsy guard',
        /if\(moneyState\.rules && moneyState\.rules\.type === 'potlimit'/.test(SRC));
  check('the range comes from money-state, not from the sizer',
        /RailMoney\.minRaiseTo\(moneyState/.test(SRC) &&
        /RailMoney\.maxRaiseTo\(moneyState/.test(SRC));
}

/* ---------------------------------------------------------------
   ACTION TIMING
   --------------------------------------------------------------- */
console.log('=== A decision takes as long as it deserves ===');
{
  const B = 500;
  const d = a => R.actionDelay(a, B);
  check('check is faster than call',  d('check') < d('call'),  d('check') + ' vs ' + d('call'));
  check('fold is faster than call',   d('fold')  < d('call'),  d('fold')  + ' vs ' + d('call'));
  check('fold is distinguishable from check', d('fold') !== d('check'));
  check('bet is slower than call',    d('bet')   > d('call'),  d('bet')   + ' vs ' + d('call'));
  check('raise is slower than bet',   d('raise') > d('bet'),   d('raise') + ' vs ' + d('bet'));
  check('raise is the longest decision',
        d('raise') === Math.max(d('check'),d('fold'),d('call'),d('bet'),d('raise')));
  ['check','fold','call','bet','raise'].forEach(a => {
    check(a + ': delay is positive', d(a) > 0, String(d(a)));
    check(a + ': delay is not an absurd stall', d(a) < 3000, String(d(a)));
  });
  check('an unknown action falls back to the base', d('something-else') === B);
  check('a missing base still yields a sane delay', R.actionDelay('call') > 0);
}

console.log('=== Mode sets pace, action sets rhythm ===');
{
  const Modes = require('./training-modes.js');
  const ids = Object.keys(Modes.MODES);
  check('all four modes exist', ids.length >= 4, ids.join(','));
  ids.forEach(m => {
    const lo = Modes.MODES[m].actionPaceMs[0];
    check(m + ': raise reads slower than check',
          R.actionDelay('raise', lo) > R.actionDelay('check', lo),
          R.actionDelay('check', lo) + ' -> ' + R.actionDelay('raise', lo));
    check(m + ': the rhythm ratio is meaningful',
          R.actionDelay('raise', lo) / R.actionDelay('check', lo) > 1.3);
  });
  // Mode still controls overall pacing.
  const learnLo = Modes.MODES.learn.actionPaceMs[0];
  const readyLo = Modes.MODES.tableReady.actionPaceMs[0];
  check('Table Ready is brisker than Learn for the same action',
        R.actionDelay('call', readyLo) < R.actionDelay('call', learnLo),
        R.actionDelay('call', readyLo) + ' vs ' + R.actionDelay('call', learnLo));
}

console.log('=== The decision is made BEFORE the pause, not after ===');
{
  // The action loop computes the decision synchronously, then scales the
  // visible pause by what was decided. If the pause came first the delay
  // could not depend on the action at all.
  check('a standalone decision function exists',
        /function decideActionForSeat\(seat\)/.test(SRC));
  check('it is called before the timer is scheduled',
        SRC.indexOf('const decided = decideActionForSeat(seat);') <
        SRC.indexOf('pendingActionTimers.push(setTimeout'));
  check('the delay is derived from the decided action',
        /actionDelay\(decided\.action, baseDelay\)/.test(SRC));
  check('the timer applies the SAME action it computed',
        /const action = decided\.action;/.test(SRC));
  check('the tier is carried through rather than recomputed',
        /const tier   = decided\.tier;/.test(SRC));
  check('only one decision is made per turn',
        (SRC.match(/RailAction\.chooseAction\(/g) || []).length === 1,
        String((SRC.match(/RailAction\.chooseAction\(/g) || []).length));
  check('the stale-hand guard still wraps the timer',
        /if\(generation !== actionGeneration\) return;/.test(SRC));
  check('the guard is captured before the decision',
        SRC.indexOf('const generation = actionGeneration;') <
        SRC.indexOf('const decided = decideActionForSeat(seat);'));
  check('the human branch still returns before any AI decision',
        SRC.indexOf('showHumanControls(seat);') <
        SRC.indexOf('const decided = decideActionForSeat(seat);'));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
