/* ============================================================
   showdown.js — Central showdown evaluation service for The Rail

   ONE entry point: evaluateShowdown({ game, players, board, board2 })

   All poker-hand logic lives in cards-eval.js (a validated dependency,
   untouched by this file). This module's only job is:
     1. pick the right evaluator(s) for the game
     2. feed each eligible player the right cards
     3. compare results and decide winners
     4. return structured data the UI can render without knowing any
        poker rules of its own

   Card model is the canonical { rank, suit } used app-wide.
   Works in Node (require) and the browser (window.RailShowdown).
   ============================================================ */
(function(exports, E){

const RANK_WORD = {
  '2':'Twos','3':'Threes','4':'Fours','5':'Fives','6':'Sixes','7':'Sevens',
  '8':'Eights','9':'Nines','T':'Tens','J':'Jacks','Q':'Queens','K':'Kings','A':'Aces'
};
const RANK_SINGULAR = {
  '2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven',
  '8':'Eight','9':'Nine','T':'Ten','J':'Jack','Q':'Queen','K':'King','A':'Ace'
};
const VALUE_TO_RANK = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A'};
const CATEGORY_NAME = [
  'High Card','One Pair','Two Pair','Three of a Kind','Straight',
  'Flush','Full House','Four of a Kind','Straight Flush'
];

/* ---------- Human-readable labels, derived from evaluator output ---------- */
function labelHigh(score){
  if(!score) return 'No hand';
  const cat = score[0];
  const r = v => RANK_WORD[VALUE_TO_RANK[v]] || '?';
  const rs = v => RANK_SINGULAR[VALUE_TO_RANK[v]] || '?';
  switch(cat){
    case 8: return score[1] === 14 ? 'Royal Flush' : 'Straight Flush, ' + rs(score[1]) + ' High';
    case 7: return 'Four of a Kind, ' + r(score[1]);
    case 6: return 'Full House, ' + r(score[1]) + ' full of ' + r(score[2]);
    case 5: return 'Flush, ' + rs(score[1]) + ' High';
    case 4: return 'Straight, ' + rs(score[1]) + ' High';
    case 3: return 'Three of a Kind, ' + r(score[1]);
    case 2: return 'Two Pair, ' + r(score[1]) + ' and ' + r(score[2]);
    case 1: return 'Pair of ' + r(score[1]);
    default: return rs(score[1]) + ' High';
  }
}
// Low hands read as their card ranks, never as "seven high" Hold'em phrasing.
function labelLowCards(cards, aceLow){
  if(!cards || !cards.length) return 'No hand';
  const val = c => (aceLow && c.rank === 'A') ? 1 : ({'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14})[c.rank];
  return cards.slice().sort((a,b) => val(b) - val(a)).map(c => c.rank).join('-');
}
function labelBadugi(result){
  if(!result || !result.size) return 'No badugi';
  const ranks = result.cards.slice()
    .sort((a,b) => (b.rank === 'A' ? 1 : 99) - (a.rank === 'A' ? 1 : 99))
    .map(c => c.rank);
  const sorted = result.cards.slice().sort((a,b) => {
    const v = c => c.rank === 'A' ? 1 : ({'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13})[c.rank];
    return v(b) - v(a);
  }).map(c => c.rank);
  return result.size + '-Card Badugi: ' + sorted.join('-');
}

/* ---------- Comparators, all delegating to cards-eval.js ---------- */
const cmpHigh   = (a,b) => E.compareArrays(a, b);
const cmpLow    = (a,b) => E.compareLow(a, b);
const cmpBadugi = (a,b) => E.compareBadugi(a, b);
const cmpPoints = (a,b) => a - b; // higher point count wins (Drawmaha 49)

/* Given [{seat, value}], return the seats sharing the best value. */
function bestSeats(entries, comparator){
  const valid = entries.filter(e => e.value !== null && e.value !== undefined);
  if(!valid.length) return [];
  let best = valid[0].value;
  valid.forEach(e => { if(comparator(e.value, best) > 0) best = e.value; });
  return valid.filter(e => comparator(e.value, best) === 0).map(e => e.seat);
}

/* ---------- Evaluation families ----------
   Each returns { sides: [{ key, label, results:[{seat,value,label,qualifies}], winners:[] }] } */

function famHoldemHigh(ctx){
  const results = ctx.players.map(p => {
    const all = p.cards.concat(ctx.board);
    const best = E.bestHighFromN(all);
    return { seat:p.seat, value:best.score, label:labelHigh(best.score), cards:best.cards };
  });
  return { sides:[{ key:'high', label:'High', results, winners:bestSeats(results, cmpHigh) }] };
}

function famOmahaHigh(ctx, board){
  const b = board || ctx.board;
  const results = ctx.players.map(p => {
    const best = E.bestOmahaHigh(p.cards, b);
    return { seat:p.seat, value:best.score, label:labelHigh(best.score), cards:best.cards };
  });
  return { results, winners:bestSeats(results, cmpHigh) };
}

function famStudHigh(ctx){
  const results = ctx.players.map(p => {
    const best = E.bestHighFromN(p.cards);
    if(!best || !best.score) return { seat:p.seat, value:null, label:'Incomplete hand', cards:[] };
    return { seat:p.seat, value:best.score, label:labelHigh(best.score), cards:best.cards };
  });
  return { sides:[{ key:'high', label:'High', results, winners:bestSeats(results, cmpHigh) }] };
}

function famLowA5(ctx, opts){
  const qualify = opts && opts.eightOrBetter;
  const results = ctx.players.map(p => {
    const best = E.bestLowA5FromN(p.cards);
    // A hand with fewer than five cards has no low at all — the evaluator
    // returns a null score, which must not be fed to the qualifier.
    if(!best || !best.score){
      return { seat:p.seat, value:null, label:'No qualifying low', qualifies:false, cards:[] };
    }
    const qualifies = qualify ? E.qualifiesEightLow(best.score) : true;
    return {
      seat:p.seat,
      value: qualifies ? best.score : null,
      label: qualifies ? labelLowCards(best.cards, true) : 'No qualifying low',
      qualifies,
      cards:best.cards
    };
  });
  return { results, winners:bestSeats(results, cmpLow) };
}

function famLow27(ctx){
  const results = ctx.players.map(p => {
    const best = E.bestLow27FromN(p.cards);
    if(!best || !best.score) return { seat:p.seat, value:null, label:'No hand', cards:[] };
    return { seat:p.seat, value:best.score, label:labelLowCards(best.cards, false), cards:best.cards };
  });
  // 2-7 is the INVERSE of high ranking: the lowest evaluate5High score wins.
  const winners = bestSeats(results, (a,b) => -E.compareArrays(a, b));
  return { results, winners };
}

function famBadugi(ctx){
  const results = ctx.players.map(p => {
    const best = E.bestBadugi(p.cards);
    return { seat:p.seat, value:best, label:labelBadugi(best), cards:best.cards };
  });
  return { results, winners:bestSeats(results, cmpBadugi) };
}

function famPoints49(ctx){
  const results = ctx.players.map(p => {
    const pts = E.pointCount49(p.cards);
    return { seat:p.seat, value:pts, label:pts + ' points', cards:p.cards };
  });
  return { results, winners:bestSeats(results, cmpPoints) };
}

/* Archie: high must be a pair of nines or better; low must be 8-or-better. */
function famArchie(ctx){
  const highResults = ctx.players.map(p => {
    const best = E.bestHighFromN(p.cards);
    const s = best.score;
    // qualifies at one pair (cat 1) of nines+ or any category above one pair
    const qualifies = s[0] > 1 || (s[0] === 1 && s[1] >= 9);
    return {
      seat:p.seat,
      value: qualifies ? s : null,
      label: qualifies ? labelHigh(s) : 'No qualifying high',
      qualifies, cards:best.cards
    };
  });
  const lowSide = famLowA5(ctx, { eightOrBetter:true });
  return {
    sides:[
      { key:'high', label:'High (pair of 9s+)', results:highResults, winners:bestSeats(highResults, cmpHigh) },
      { key:'low',  label:'Low (8-or-better)',  results:lowSide.results, winners:lowSide.winners }
    ]
  };
}

/* Omaha low using the STRICT 2-from-hole + 3-from-board rule (Big O Hi-Lo).
   Distinct from the Drawmaha low families, which score the low from hole
   cards only. Delegates to the validated bestOmahaLowA5 evaluator. */
function famOmahaLow8(ctx){
  const results = ctx.players.map(p => {
    const best = E.bestOmahaLowA5(p.cards, ctx.board);
    const qualifies = best.score ? E.qualifiesEightLow(best.score) : false;
    return {
      seat: p.seat,
      value: qualifies ? best.score : null,
      label: qualifies ? labelLowCards(best.cards, true) : 'No qualifying low',
      qualifies,
      cards: best.cards
    };
  });
  return { results, winners: bestSeats(results, cmpLow) };
}

/* ---------- Game registry ----------
   cardSource: 'hole' = player's own cards only (draw/stud)
               'holeAndBoard' = Hold'em-style best-5-of-all
               'omaha' = strict 2-from-hole + 3-from-board */
const SHOWDOWN_RULES = {
  // --- Draw, single winner ---
  'Badugi':                   { family:'badugi-only',   needsBoard:0 },
  'A-5 Lowball':              { family:'a5-only',       needsBoard:0 },
  '2-7 Lowball':              { family:'27-only',       needsBoard:0 },
  // --- Draw, split ---
  'Badacey':                  { family:'badugi+a5',     needsBoard:0 },
  'Baducey':                  { family:'badugi+27',     needsBoard:0 },
  'Archie':                   { family:'archie',        needsBoard:0 },
  // --- Stud ---
  'Stud Hi-Lo / 8-or-Better': { family:'high+low8',     needsBoard:0 },
  'Razz':                     { family:'a5-only',       needsBoard:0 },
  // Talking Stick spreads this as "Super Stud Hi/Lo 8 Super Pat" — a hi-lo
  // split with an A-to-5 eight-or-better qualifier. The old high-only mapping
  // described the generic Super Stud family, not the game this room deals.
  'Super Stud Hi-Lo 8 / Super Pat': { family:'high+low8', needsBoard:0 },
  'Super Baducey':            { family:'badugi+27',     needsBoard:0 },
  'Super Badacey':            { family:'badugi+a5',     needsBoard:0 },
  // --- Omaha board + draw-hand split ---
  'Drawmaha Hi':              { family:'omaha+drawhigh',needsBoard:5 },
  'Drawmaha A-5':             { family:'omaha+a5hole',  needsBoard:5 },
  'Drawmaha 2-7':             { family:'omaha+27hole',  needsBoard:5 },
  'Drawmaha 49':              { family:'omaha+points',  needsBoard:5 },
  'Drawmaha Badugi':          { family:'omaha+badugi',  needsBoard:5 },
  // --- Two boards ---
  'Big-O Double Board':       { family:'doubleboard',   needsBoard:5, needsBoard2:5 },
  // --- Big O (five-card Omaha), strict 2-from-hole + 3-from-board ---
  'Big O Hi-Lo':              { family:'omaha-hilo8',   needsBoard:5 },
  'Big O PLO':                { family:'omaha-high',    needsBoard:5 },
  // --- Hold'em style ---
  'Pineapple':                { family:'holdem-high',   needsBoard:5 },
  'Crazy Pineapple':          { family:'holdem-high',   needsBoard:5 },
  "Texas Hold'em":            { family:'holdem-high',   needsBoard:5 }
};

function buildSides(family, ctx){
  switch(family){
    case 'holdem-high': return famHoldemHigh(ctx).sides;
    case 'high-only':   return famStudHigh(ctx).sides;
    case 'a5-only': {
      const r = famLowA5(ctx, { eightOrBetter:false });
      return [{ key:'low', label:'Low', results:r.results, winners:r.winners }];
    }
    case '27-only': {
      const r = famLow27(ctx);
      return [{ key:'low', label:'Low', results:r.results, winners:r.winners }];
    }
    case 'badugi-only': {
      const r = famBadugi(ctx);
      return [{ key:'badugi', label:'Badugi', results:r.results, winners:r.winners }];
    }
    case 'high+low8': {
      const hi = famStudHigh(ctx).sides[0];
      const lo = famLowA5(ctx, { eightOrBetter:true });
      return [hi, { key:'low', label:'Low (8-or-better)', results:lo.results, winners:lo.winners }];
    }
    case 'badugi+a5': {
      const b = famBadugi(ctx);
      const l = famLowA5(ctx, { eightOrBetter:false });
      return [
        { key:'badugi', label:'Badugi', results:b.results, winners:b.winners },
        { key:'low',    label:'A-5 Low', results:l.results, winners:l.winners }
      ];
    }
    case 'badugi+27': {
      const b = famBadugi(ctx);
      const l = famLow27(ctx);
      return [
        { key:'badugi', label:'Badugi', results:b.results, winners:b.winners },
        { key:'low',    label:'2-7 Low', results:l.results, winners:l.winners }
      ];
    }
    case 'archie': return famArchie(ctx).sides;
    case 'omaha-high': {
      const o = famOmahaHigh(ctx);
      return [{ key:'high', label:'High', results:o.results, winners:o.winners }];
    }
    case 'omaha-hilo8': {
      const o = famOmahaHigh(ctx);
      const l = famOmahaLow8(ctx);
      return [
        { key:'high', label:'High', results:o.results, winners:o.winners },
        { key:'low',  label:'Low (8-or-better)', results:l.results, winners:l.winners }
      ];
    }
    case 'omaha+drawhigh': {
      const o = famOmahaHigh(ctx);
      const d = ctx.players.map(p => {
        const best = E.bestHighFromN(p.cards);
        return { seat:p.seat, value:best.score, label:labelHigh(best.score), cards:best.cards };
      });
      return [
        { key:'omaha', label:'Omaha High (board)', results:o.results, winners:o.winners },
        { key:'draw',  label:'Draw High (hole)',   results:d, winners:bestSeats(d, cmpHigh) }
      ];
    }
    case 'omaha+a5hole': {
      const o = famOmahaHigh(ctx);
      const l = famLowA5(ctx, { eightOrBetter:false });
      return [
        { key:'omaha', label:'Omaha High (board)', results:o.results, winners:o.winners },
        { key:'low',   label:'A-5 Low (hole)',     results:l.results, winners:l.winners }
      ];
    }
    case 'omaha+27hole': {
      const o = famOmahaHigh(ctx);
      const l = famLow27(ctx);
      return [
        { key:'omaha', label:'Omaha High (board)', results:o.results, winners:o.winners },
        { key:'low',   label:'2-7 Low (hole)',     results:l.results, winners:l.winners }
      ];
    }
    case 'omaha+points': {
      const o = famOmahaHigh(ctx);
      const p = famPoints49(ctx);
      return [
        { key:'omaha',  label:'Omaha High (board)', results:o.results, winners:o.winners },
        { key:'points', label:'Point Count (max 49)', results:p.results, winners:p.winners }
      ];
    }
    case 'omaha+badugi': {
      const o = famOmahaHigh(ctx);
      const b = famBadugi(ctx);
      return [
        { key:'omaha',  label:'Omaha High (board)', results:o.results, winners:o.winners },
        { key:'badugi', label:'Badugi (hole)',      results:b.results, winners:b.winners }
      ];
    }
    case 'doubleboard': {
      const b1 = famOmahaHigh(ctx, ctx.board);
      const b2 = famOmahaHigh(ctx, ctx.board2);
      return [
        { key:'board1', label:'Top Board', results:b1.results, winners:b1.winners },
        { key:'board2', label:'Bottom Board', results:b2.results, winners:b2.winners }
      ];
    }
    default: throw new Error('Unknown showdown family: ' + family);
  }
}

/* ---------- Legacy name compatibility ----------
   SHOWDOWN_RULES is the canonical roster: one entry per game the app
   currently spreads, and nothing else. Names we no longer deal are kept
   HERE instead, as explicit aliases pointing at the canonical game, so a
   stale reference or older saved record still resolves without inflating
   the roster or reappearing as a game in its own right.

   Super Stud consolidation: this room deals a hi-lo, 8-or-better game with
   Super Pat. The two older names described that same game (and, in one
   case, a high-only reading that was never what the room spreads), so both
   now resolve to the single canonical entry. */
const LEGACY_GAME_ALIASES = {
  'Super Stud / Super Pat':   'Super Stud Hi-Lo 8 / Super Pat',
  'Super Hi-Lo Stud':         'Super Stud Hi-Lo 8 / Super Pat',
  // The game was always dealt as five-card Omaha on two boards; only its
  // label said "Omaha". The canonical key is now the display name, and the
  // old label resolves onto it so saved progress and stats keep working.
  'Double Board Omaha':       'Big-O Double Board'
};

/* Canonical name for any game name, current or legacy. */
function canonicalGameName(name){
  return LEGACY_GAME_ALIASES[name] || name;
}

/* Rule lookup that honours the alias layer. */
function ruleForGame(name){
  return SHOWDOWN_RULES[canonicalGameName(name)];
}

/* ---------- Public entry point ---------- */
function evaluateShowdown({ game, players, board, board2 }){
  const rule = ruleForGame(game && game.name);
  if(!rule){
    return { ok:false, error:'No showdown rule configured for game: ' + (game && game.name) };
  }
  const eligible = (players || []).filter(p => p && p.cards && p.cards.length > 0);
  if(eligible.length < 1){
    return { ok:false, error:'Showdown unavailable: no eligible players with cards.' };
  }
  const b  = board || [];
  const b2 = board2 || [];
  if(rule.needsBoard && b.length < rule.needsBoard){
    return { ok:false, error:'Showdown unavailable: needs ' + rule.needsBoard + ' board cards, got ' + b.length + '.' };
  }
  if(rule.needsBoard2 && b2.length < rule.needsBoard2){
    return { ok:false, error:'Showdown unavailable: needs ' + rule.needsBoard2 + ' cards on board 2, got ' + b2.length + '.' };
  }

  let sides;
  try{
    sides = buildSides(rule.family, { players:eligible, board:b, board2:b2 });
  } catch(err){
    return { ok:false, error:'Showdown evaluation failed: ' + err.message };
  }

  // Scoop = the same single seat wins every side that has a winner.
  const sidesWithWinners = sides.filter(s => s.winners.length > 0);
  const allWinnerSets = sidesWithWinners.map(s => s.winners.join(','));
  const isScoop = sides.length > 1 &&
                  sidesWithWinners.length === sides.length &&
                  allWinnerSets.every(w => w === allWinnerSets[0]) &&
                  sidesWithWinners[0].winners.length === 1;

  const overallWinners = [...new Set(sidesWithWinners.reduce((a,s) => a.concat(s.winners), []))];

  return {
    ok: true,
    gameName: game.name,
    family: rule.family,
    sides,
    isSplit: sides.length > 1 && !isScoop && overallWinners.length > 1,
    isScoop,
    hasTie: sides.some(s => s.winners.length > 1),
    unqualifiedSides: sides.filter(s => s.winners.length === 0).map(s => s.key),
    winners: overallWinners
  };
}

exports.evaluateShowdown = evaluateShowdown;
exports.SHOWDOWN_RULES = SHOWDOWN_RULES;
exports.LEGACY_GAME_ALIASES = LEGACY_GAME_ALIASES;
exports.canonicalGameName = canonicalGameName;
exports.ruleForGame = ruleForGame;
exports.labelHigh = labelHigh;
exports.labelLowCards = labelLowCards;
exports.labelBadugi = labelBadugi;

})(
  typeof module !== 'undefined' ? module.exports : (window.RailShowdown = window.RailShowdown || {}),
  typeof module !== 'undefined' ? require('./cards-eval.js') : window.RailCards
);
