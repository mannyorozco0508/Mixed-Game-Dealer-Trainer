/* ============================================================
   test-reshuffle-rules.js

   Talking Stick, "Reshuffling Discards":
     when not enough cards remain for all active players, reshuffle ONLY the
     muck, the burn cards and the last card off the deck — never the CURRENT
     round's player discards; and the last card off the deck is never dealt
     or used as a burn.

   These tests pin that procedure. They are deliberately written against the
   eligibility whitelist and a faithful reproduction of drawCard, so they fail
   against the previous "shuffle the whole muck, deal every card" behaviour.
   ============================================================ */
const DealState = require('./deal-state.js');
const Draw = require('./draw-engine.js');
const { RANKS, SUITS } = require('./card-model.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const c  = t => ({ rank: t[0] === '1' ? 'T' : t[0], suit: t[t.length-1] });
const fmt = x => x ? x.rank + x.suit : '--';
function fullDeck(){
  const d = []; RANKS.forEach(r => SUITS.forEach(s => d.push({ rank:r, suit:s }))); return d;
}

console.log('=== Reshuffle eligibility (whitelist) ===');
{
  const r = DealState.reshuffleEligible({
    muck: [c('2S'), c('3H')], burns: [c('4D')], stubLastCard: c('5C'),
    currentRoundDiscards: []
  });
  check('muck, burns and the last stub card are all eligible',
        r.map(fmt).sort().join(' ') === '2S 3H 4D 5C', r.map(fmt).join(' '));
}
{
  const r = DealState.reshuffleEligible({
    muck: [c('2S'), c('3H')], burns: [], stubLastCard: null,
    currentRoundDiscards: [c('3H')]
  });
  check('a current-round discard is excluded even though it sits in the muck',
        r.map(fmt).join(' ') === '2S', r.map(fmt).join(' '));
}
{
  const r = DealState.reshuffleEligible({
    muck: [], burns: [], stubLastCard: null, currentRoundDiscards: [c('9C')]
  });
  check('current-round discards are never eligible on their own', r.length === 0);
}
{
  // The withheld card joins a reshuffle; it cannot be one by itself.
  const r = DealState.reshuffleEligible({
    muck: [], burns: [], stubLastCard: c('KD'), currentRoundDiscards: []
  });
  check('the last stub card alone is not a reshuffle', r.length === 0, r.map(fmt).join(' '));
}
{
  // Cards still in play, on the board, or in a folded-but-not-mucked hand are
  // not in any eligible category, so there is no route back in.
  const r = DealState.reshuffleEligible({
    muck: [c('2S')], burns: [], stubLastCard: null, currentRoundDiscards: []
  });
  check('only named categories can return — nothing else leaks in', r.length === 1);
}
{
  const r = DealState.reshuffleEligible({
    muck: [c('2S'), c('2S')], burns: [c('2S')], stubLastCard: c('2S'),
    currentRoundDiscards: []
  });
  check('an identity cannot enter the reshuffle twice', r.length === 1, r.map(fmt).join(' '));
}

console.log('');
console.log('=== The last card off the deck is never dealt ===');

/* Faithful reproduction of production drawCard, including the rule. */
function makeDrawCard(state){
  return function drawCard(){
    if(state.deck.length <= 1){
      const eligible = DealState.reshuffleEligible({
        muck: state.muck, burns: state.burns,
        stubLastCard: state.deck.length ? state.deck[0] : null,
        currentRoundDiscards: state.roundDiscards
      });
      if(eligible.length){
        state.reshuffles++;
        state.deck = eligible;      // deterministic order: no shuffle in tests
        state.muck = []; state.burns = [];
      } else if(state.deck.length <= 1){
        return null;
      }
    }
    return state.deck.length ? state.deck.shift() : null;
  };
}
{
  const state = { deck: [c('AS'), c('KD')], muck: [], burns: [], roundDiscards: [], reshuffles: 0 };
  const draw = makeDrawCard(state);
  const first = draw();
  const second = draw();
  check('the first of two remaining cards is dealt normally', fmt(first) === 'AS', fmt(first));
  check('the LAST card of the stub is never dealt', second === null,
        'got ' + fmt(second));
  check('no reshuffle happened with nothing eligible', state.reshuffles === 0);
}
{
  // With something eligible, the withheld last card joins the new stub rather
  // than going to a player or a burn.
  const state = { deck: [c('AS'), c('KD')], muck: [c('2H'), c('3C')], burns: [],
                  roundDiscards: [], reshuffles: 0 };
  const draw = makeDrawCard(state);
  draw();                       // deals AS, leaving KD as the last card
  const next = draw();          // triggers the reshuffle
  check('a reshuffle fires while one card still remains', state.reshuffles === 1);
  const pool = [fmt(next)].concat(state.deck.map(fmt));
  check('the withheld last card is folded into the new stub, not dealt out',
        pool.includes('KD'), pool.join(' '));
  check('the muck is emptied into the new stub', state.muck.length === 0);
}

console.log('');
console.log('=== A draw round cannot return this round\'s discards ===');
{
  // Six seats dealt 5 each (30 used, 22 left), then every seat draws 5.
  // 30 replacements are needed from 22 cards, so the deck runs out mid-round.
  const deck = fullDeck();
  const hands = []; for(let i = 0; i < 6; i++) hands.push(deck.slice(i*5, (i+1)*5));
  const state = { deck: deck.slice(30), muck: [], burns: [], roundDiscards: [], reshuffles: 0 };
  const draw = makeDrawCard(state);

  const discardedBy = {}, receivedBy = {};
  for(let seat = 0; seat < 6; seat++){
    // draw-engine takes the pile that discards should land in; during a draw
    // round that is the CURRENT-round pile, not the settled muck.
    const r = Draw.applyDraw(hands[seat], [0,1,2,3,4], draw, state.roundDiscards);
    discardedBy[seat] = r.discarded.map(fmt);
    receivedBy[seat]  = r.drawn.map(fmt);
    hands[seat] = r.hand;
  }

  const violations = [];
  for(let a = 0; a < 6; a++) for(let b = 0; b < 6; b++){
    receivedBy[b].forEach(card => {
      if(discardedBy[a].includes(card)) violations.push('seat ' + b + ' got ' + card + ' discarded by seat ' + a);
    });
  }
  check('the deck really did run out during the round (test is not vacuous)',
        state.reshuffles > 0 || receivedBy[5].includes('--') || receivedBy[5].length < 5,
        'reshuffles=' + state.reshuffles);
  check('no player receives a card discarded by ANY player this round',
        violations.length === 0, violations.slice(0,3).join(' | '));

  // And no identity is ever live twice.
  const live = [];
  hands.forEach(h => h.forEach(x => live.push(fmt(x))));
  const dupes = live.filter((x, i) => live.indexOf(x) !== i);
  check('no duplicate card identity is live after the round', dupes.length === 0,
        [...new Set(dupes)].join(' '));
}

console.log('');
console.log('=== Discards from an EARLIER round remain eligible ===');
{
  // The rule excludes the current round only. Once a round closes, those
  // cards are ordinary muck and may legitimately return.
  const state = { deck: [c('AS'), c('KD')], muck: [], burns: [],
                  roundDiscards: [c('7H'), c('8S')], reshuffles: 0 };
  const draw = makeDrawCard(state);
  draw();
  check('nothing is dealt while only current-round discards exist', draw() === null);

  // Close the round: those discards become ordinary muck.
  state.muck = state.muck.concat(state.roundDiscards);
  state.roundDiscards = [];
  const after = draw();
  check('after the round closes, earlier discards can be reshuffled in',
        after !== null && ['7H','8S','KD'].includes(fmt(after)), fmt(after));
}

console.log('');
console.log('=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail > 0) process.exit(1);
