/* ============================================================
   test-betting-realism.js

   Behavioural guardrails for the AI's action model. These assert DIRECTION
   and broad RANGES over large deterministic samples, never exact rates — the
   model is meant to stay probabilistic, and a test that pins 31.5% would
   break on any future adjustment while proving nothing about realism.

   What was measured before this tuning, with every variable pinned:
     PREMIUM  100.0% raise facing any bet, 0% call, 0% check   (a script)
     WEAK       0.0% raise at every price                      (unbluffable)
     seat 6     a second copy of 'balanced'                    (6 of 7)
     heads-up P(raise) 10.0% after 0 raises, 11.2% after 20    (endless wars)
     invested  $400 committed folded MORE than $0              (no effect)
     field     3-handed and 6-handed identical                 (invisible)
   ============================================================ */
const A      = require('./table-action.js');
const Rhythm = require('./betting-rhythm.js');
const AI     = require('./ai-players.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return (s>>>0)/4294967296; };
}
function makeRound(facing){
  return {
    dealCat:'holdem', tableSeats:7, sitOutSeat:null,
    foldedSeats:new Set(), allInSeats:new Set(), street:2, current:0,
    betOutstanding:facing, raiseCapped:false,
    aggressor: facing ? 1 : null, actedSinceAggression:new Set(),
    complete:false, log: facing ? [{seat:1,action:'bet'}] : []
  };
}
/* Drives the two real production functions, in the real order. */
function sample(o, n, seed){
  const r = rng(seed);
  const out = { check:0,bet:0,call:0,raise:0,fold:0,total:0 };
  for(let i=0;i<n;i++){
    const round = makeRound(o.facing);
    const legal = A.legalActions(round);
    let a = A.chooseAction(round, { tier:o.tier, loosenessBias:0.5 });
    a = Rhythm.shapeAction(a, {
      seat:0, legal, tier:o.tier, phase:o.phase||'middle',
      personality:o.personality, rng:r,
      toCall:o.toCall, potSize:o.pot,
      invested:o.invested||0, stack:o.stack===undefined?1000:o.stack,
      playersLeft:o.playersLeft===undefined?3:o.playersLeft,
      raisesSoFar:o.raisesSoFar||0
    });
    if(out[a]!==undefined) out[a]++;
    out.total++;
  }
  out.agg = out.bet + out.raise;
  out.pct = k => 100 * out[k] / out.total;
  return out;
}
const PERS = Rhythm.PERSONALITIES;
const N = 3000;
/* Pooled across all seven personalities, so a result is about the TIER. */
function pooled(o, seedBase){
  const agg = { check:0,bet:0,call:0,raise:0,fold:0,total:0 };
  PERS.forEach((p,i)=>{
    const s = sample(Object.assign({}, o, { personality:p }), N/7|0, seedBase+i*97);
    ['check','bet','call','raise','fold'].forEach(k=>agg[k]+=s[k]);
    agg.total += s.total;
  });
  agg.agg = agg.bet + agg.raise;
  agg.pct = k => 100 * agg[k] / agg.total;
  return agg;
}

const T = AI.TIER;
const FACING = { facing:true, toCall:20, pot:60 };   // a fair price
const OPEN   = { facing:false, toCall:0, pot:200 };

console.log('=== Seven seats, seven behaviours ===');
{
  check('seven personalities are defined', PERS.length === 7, String(PERS.length));
  const ids = PERS.map(p=>p.id);
  check('every id is distinct', new Set(ids).size === 7, ids.join(','));
  PERS.forEach(p => {
    check(p.id + ' has a trap dimension', typeof p.trapBias === 'number');
    check(p.id + ' has a bluff dimension', typeof p.bluffBias === 'number');
  });
  check('personalityFor still maps seat -> profile',
        Rhythm.personalityFor(3).id === PERS[3].id);
  check('and it wraps safely', !!Rhythm.personalityFor(99));
}

console.log('=== No profile is deterministic ===');
{
  PERS.forEach((p,i) => {
    const facing = sample(Object.assign({ tier:T.MARGINAL, personality:p }, FACING), 1200, 400+i);
    const open   = sample(Object.assign({ tier:T.MARGINAL, personality:p }, OPEN),   1200, 900+i);
    const distinct = ['call','fold','raise'].filter(k => facing[k] > 0).length
                   + ['check','bet'].filter(k => open[k] > 0).length;
    check(p.id + ' produces several different actions', distinct >= 4, 'distinct=' + distinct);
    ['call','fold'].forEach(k => {
      check(p.id + ' does not always ' + k, facing.pct(k) < 97, k + '=' + facing.pct(k).toFixed(1));
    });
  });
}

console.log('=== PREMIUM is aggressive, not scripted ===');
{
  const f = pooled(Object.assign({ tier:T.PREMIUM }, FACING), 1500);
  const o = pooled(Object.assign({ tier:T.PREMIUM }, OPEN),   1600);
  check('premium raise is meaningfully below 100%', f.pct('raise') < 90, f.pct('raise').toFixed(1));
  check('premium still raises most of the time', f.pct('raise') > 50, f.pct('raise').toFixed(1));
  check('premium sometimes calls', f.pct('call') > 3, f.pct('call').toFixed(1));
  check('premium rarely folds', f.pct('fold') < 3, f.pct('fold').toFixed(1));
  check('premium sometimes checks when legal', o.pct('check') > 2, o.pct('check').toFixed(1));
  check('premium mostly bets an open street', o.pct('bet') > 60, o.pct('bet').toFixed(1));

  const strong = pooled(Object.assign({ tier:T.STRONG }, FACING), 1700);
  check('premium is clearly more aggressive than strong',
        f.pct('raise') > strong.pct('raise') + 20,
        'premium=' + f.pct('raise').toFixed(1) + ' strong=' + strong.pct('raise').toFixed(1));
}

console.log('=== WEAK can bluff, but not much ===');
{
  const f = pooled(Object.assign({ tier:T.WEAK }, FACING), 1800);
  const o = pooled(Object.assign({ tier:T.WEAK }, OPEN),   1900);
  const prem = pooled(Object.assign({ tier:T.PREMIUM }, FACING), 2000);
  check('weak raises sometimes', f.pct('raise') > 0, f.pct('raise').toFixed(2));
  check('weak bets an open street sometimes', o.pct('bet') > 1, o.pct('bet').toFixed(2));
  check('weak aggression stays far below premium',
        f.pct('raise') < prem.pct('raise') / 10,
        'weak=' + f.pct('raise').toFixed(2) + ' premium=' + prem.pct('raise').toFixed(1));
  check('weak still folds most of the time facing a bet', f.pct('fold') > 50, f.pct('fold').toFixed(1));
  check('weak checks freely when it can', o.pct('check') > 70, o.pct('check').toFixed(1));

  // Bluffing is a personality trait, not a tier trait.
  const tp = sample(Object.assign({ tier:T.WEAK, personality:PERS.find(p=>p.id==='tight-passive') }, OPEN), N, 2100);
  const tr = sample(Object.assign({ tier:T.WEAK, personality:PERS.find(p=>p.id==='tricky') }, OPEN), N, 2200);
  check('a tricky seat bluffs more than a tight-passive one',
        tr.pct('bet') > tp.pct('bet') * 2,
        'tricky=' + tr.pct('bet').toFixed(1) + ' tight-passive=' + tp.pct('bet').toFixed(1));
}

console.log('=== Price sensitivity runs the right way ===');
{
  const bands = [
    ['cheap',    { toCall:20, pot:200 }],
    ['fair',     { toCall:20, pot:60  }],
    ['steep',    { toCall:40, pot:60  }],
    ['terrible', { toCall:80, pot:60  }]
  ];
  [T.WEAK, T.MARGINAL, T.STRONG].forEach(tier => {
    const name = ['WEAK','MARGINAL','STRONG'][tier];
    const folds = bands.map(([b, px]) =>
      pooled({ tier, facing:true, toCall:px.toCall, pot:px.pot }, 2300 + tier*40 + b.length).pct('fold'));
    check(name + ': fair folds more than cheap', folds[1] > folds[0],
          folds.map(f=>f.toFixed(1)).join(' -> '));
    check(name + ': steep folds more than fair', folds[2] > folds[1],
          folds.map(f=>f.toFixed(1)).join(' -> '));
    check(name + ': terrible folds more than steep', folds[3] > folds[2],
          folds.map(f=>f.toFixed(1)).join(' -> '));
    check(name + ': terrible folds clearly more than cheap', folds[3] > folds[0] + 3,
          folds.map(f=>f.toFixed(1)).join(' -> '));
  });
}

console.log('=== Aggressive profiles attack more than passive ones ===');
{
  const aggOf = id => {
    const p = PERS.find(x=>x.id===id);
    let bet = 0, raise = 0, total = 0;
    [T.WEAK,T.MARGINAL,T.STRONG,T.PREMIUM].forEach(t => {
      const f = sample(Object.assign({ tier:t, personality:p }, FACING), 800, 2600+t*11+id.length);
      const o = sample(Object.assign({ tier:t, personality:p }, OPEN),   800, 2700+t*11+id.length);
      bet += f.bet + o.bet; raise += f.raise + o.raise; total += f.total + o.total;
    });
    return 100 * (bet + raise) / total;
  };
  const aggressive = ['aggressive','tight-aggressive','loose-aggressive'].map(aggOf);
  const passive    = ['tight-passive','loose-passive'].map(aggOf);
  check('every aggressive profile out-attacks every passive one',
        Math.min.apply(null, aggressive) > Math.max.apply(null, passive),
        'aggressive=[' + aggressive.map(n=>n.toFixed(1)) + '] passive=[' + passive.map(n=>n.toFixed(1)) + ']');
}

console.log('=== Tight profiles fold more than sticky ones ===');
{
  const foldOf = id => pooledFor(PERS.find(x=>x.id===id));
  function pooledFor(p){
    let fold = 0, total = 0;
    [T.WEAK,T.MARGINAL,T.STRONG].forEach(t => {
      const s = sample(Object.assign({ tier:t, personality:p }, FACING), 1000, 2900+t*13+p.id.length);
      fold += s.fold; total += s.total;
    });
    return 100 * fold / total;
  }
  const tight = ['tight-passive','tight-aggressive'].map(foldOf);
  const loose = ['loose-passive','loose-aggressive'].map(foldOf);
  check('every tight profile folds more than every loose one',
        Math.min.apply(null, tight) > Math.max.apply(null, loose),
        'tight=[' + tight.map(n=>n.toFixed(1)) + '] loose=[' + loose.map(n=>n.toFixed(1)) + ']');

  const sticky = foldOf('loose-passive');
  const tp = foldOf('tight-passive');
  check('the sticky seat continues noticeably more', tp > sticky + 5,
        'tight-passive=' + tp.toFixed(1) + ' loose-passive=' + sticky.toFixed(1));
}

console.log('=== A raise war runs out of steam ===');
{
  const at = n => pooled({ tier:T.STRONG, facing:true, toCall:40, pot:200+n*40,
                           playersLeft:2, raisesSoFar:n }, 3200+n*7).pct('raise');
  const r0 = at(0), r3 = at(3), r6 = at(6), r12 = at(12);
  check('an early raise is still on the table', r0 > 3, r0.toFixed(1));
  check('appetite falls once the street is capped-deep', r3 < r0,
        r0.toFixed(1) + ' -> ' + r3.toFixed(1));
  check('it keeps falling', r6 < r3, r3.toFixed(1) + ' -> ' + r6.toFixed(1));
  check('a twelve-bet street almost never gets another raise', r12 < 1,
        r12.toFixed(2));
  check('but the brake is willingness, not legality — raise stays legal',
        A.legalActions(makeRound(true)).indexOf('raise') >= 0);
  check('damping is monotonic', r0 >= r3 && r3 >= r6 && r6 >= r12);
}

console.log('=== Chips already in make a hand harder to release ===');
{
  const steep = { facing:true, toCall:40, pot:60 };
  const none = pooled(Object.assign({ tier:T.MARGINAL, invested:0,   stack:1000 }, steep), 3400).pct('fold');
  const deep = pooled(Object.assign({ tier:T.MARGINAL, invested:400, stack:600  }, steep), 3500).pct('fold');
  check('a committed seat folds less', deep < none,
        'none=' + none.toFixed(1) + ' committed=' + deep.toFixed(1));
  check('but commitment does not excuse everything — it still folds', deep > 5,
        deep.toFixed(1));

  // Price must still outweigh sunk cost.
  const cheapNone = pooled({ tier:T.MARGINAL, facing:true, toCall:20, pot:200,
                             invested:0, stack:1000 }, 3600).pct('fold');
  check('a committed seat at a terrible price still folds more than a fresh seat at a cheap one',
        pooled({ tier:T.MARGINAL, facing:true, toCall:80, pot:60,
                 invested:400, stack:600 }, 3700).pct('fold') > cheapNone,
        'cheap/fresh=' + cheapNone.toFixed(1));
}

console.log('=== Field size is visible in the action ===');
{
  const f = pl => pooled({ tier:T.MARGINAL, facing:true, toCall:20, pot:60, playersLeft:pl },
                         3800+pl*9).pct('fold');
  const hu = f(2), three = f(3), six = f(6);
  check('heads-up folds most', hu > three, hu.toFixed(1) + ' vs ' + three.toFixed(1));
  check('a big field folds least', six < three, six.toFixed(1) + ' vs ' + three.toFixed(1));
  check('three-handed and six-handed are no longer identical',
        Math.abs(three - six) > 1.5, three.toFixed(1) + ' vs ' + six.toFixed(1));
}

console.log('=== Streets are not all the same ===');
{
  const r = ph => pooled({ tier:T.STRONG, facing:true, toCall:20, pot:60, phase:ph }, 4000+ph.length).pct('fold');
  check('a late street releases marginal holdings more readily than an early one',
        r('late') > r('early'), r('early').toFixed(1) + ' -> ' + r('late').toFixed(1));
}

console.log('=== Legality is never overridden ===');
{
  // Whatever the personality wants, a capped round must not yield a raise.
  const capped = makeRound(true);
  capped.raiseCapped = true;
  const legal = A.legalActions(capped);
  const r = rng(9999);
  let sawRaise = false;
  for(let i=0;i<4000;i++){
    PERS.forEach(p => {
      const a = Rhythm.shapeAction(A.chooseAction(capped, { tier:T.PREMIUM, loosenessBias:0.5 }), {
        seat:0, legal, tier:T.PREMIUM, phase:'middle', personality:p, rng:r,
        toCall:20, potSize:60, invested:0, stack:1000, playersLeft:3, raisesSoFar:0
      });
      if(a === 'raise') sawRaise = true;
      if(legal.indexOf(a) === -1) sawRaise = true; // any illegal action fails too
    });
    if(sawRaise) break;
  }
  check('a capped street never produces a raise from any personality', !sawRaise);
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
