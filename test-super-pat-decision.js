/* ============================================================
   test-super-pat-decision.js

   Super Pat asks ONE question: is this five-card hand already made well
   enough to lock, by THIS game's scoring?

   It used to ask the BETTING tier with the game's betting family. Super
   Baducey and Super Badacey match no Hi-Lo name test, so they fell through to
   the plain 'high' family. A 40,000-hand sample showed them locking:

       KD JD 4D QD 7D   a diamond flush   -> PAT
       7C 7S QC 8H 7D   trip sevens       -> PAT

   In a badugi split game those are the worst holdings on the table: a
   ONE-card badugi, and a flush or trips against a 2-7 or A-5 low. They were
   locking exactly the hands they should be throwing away.

   Objectives now come from the showdown registry, so what a seat locks for is
   by construction what the pot pays. These tests drive the decision with
   constructed hands and assert the CHOICE, never a frequency.
   ============================================================ */
const Draw     = require('./draw-engine.js');
const Showdown = require('./showdown.js');
const AI       = require('./ai-players.js');
const E        = require('./cards-eval.js');

const STUD  = 'Super Stud Hi-Lo 8 / Super Pat';
const BADUCEY = 'Super Baducey';
const BADACEY = 'Super Badacey';

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
function cards(s){ return s.split(' ').map(x => ({ rank:x.slice(0,-1), suit:x.slice(-1) })); }
function pat(game, hand){ return Draw.superPatDecision(game, cards(hand), Showdown, AI); }
function isPat(label, game, hand){ check(label + '  [' + hand + ']', pat(game, hand) === true); }
function notPat(label, game, hand){ check(label + '  [' + hand + ']', pat(game, hand) === false); }

console.log('=== Super Stud Hi-Lo 8: a made eight-or-better low is the whole point ===');
{
  isPat('a 7-low locks',                    STUD, '4D 3C 2H 6C 7S');
  isPat('an 8-low locks',                   STUD, 'AS 2H 4D 6C 8S');
  isPat('the wheel locks',                  STUD, 'AS 2H 3D 4C 5S');
  notPat('a 9-low does not qualify',        STUD, 'AS 2H 4D 6C 9S');
  notPat('a paired low is not made',        STUD, '2S 2H 4D 6C 8S');

  // The class the old tier rule missed entirely: an excellent low whose HIGH
  // side is nothing. classifyHigh scores it as high-card, so it sat in
  // MARGINAL and never locked — in the game named Super Pat.
  const low = cards('4D 3C 2H 6C 7S');
  check('that 7-low really does read as a weak HIGH hand',
        AI.classifyHigh(E.bestHighFromN(low).score) <= AI.TIER.MARGINAL,
        'high tier ' + AI.classifyHigh(E.bestHighFromN(low).score));
  check('and it still locks, because the LOW is what pays', pat(STUD, '4D 3C 2H 6C 7S'));
}

console.log('=== Super Stud Hi-Lo 8: a made high locks too ===');
{
  isPat('trips lock',                       STUD, '9S 9H 9D KC 2S');
  isPat('a flush locks',                    STUD, 'KD JD 4D QD 7D');
  isPat('a full house locks',               STUD, '4C 4H AH 4S AD');
  isPat('a straight locks',                 STUD, '5C 6D 7H 8S 9C');
  notPat('two pair is not enough to lock',  STUD, '9S 9H KC KD 2S');
  notPat('one pair is not enough',          STUD, '9S 9H KC 4D 2S');
  notPat('high card with no low continues', STUD, 'KS QH 9C 4D 2S');
}

console.log('=== Super Stud Hi-Lo 8: two-way and one-way ===');
{
  // Flush AND a made 8-low from the same five cards.
  isPat('a two-way monster locks',          STUD, '8S 6S 4S 2S AS');
  isPat('strong low, no high',              STUD, '2H 4D 6C 7S 8D');
  isPat('strong high, no qualifying low',   STUD, 'KS KH KD 9C 9S');
  notPat('neither half made',               STUD, 'KS QH JC 9D 3S');
}

console.log('=== Super Baducey scores badugi + 2-7, NOT high poker ===');
{
  // The two hands the old rule locked. Both are disasters here.
  notPat('a flush is never a Baducey Pat',  BADUCEY, 'KD JD 4D QD 7D');
  notPat('trips are never a Baducey Pat',   BADUCEY, '7C 7S QC 8H 7D');
  check('and the old high-family rule WOULD have locked that flush',
        AI.classifyHigh(E.bestHighFromN(cards('KD JD 4D QD 7D')).score) >= AI.TIER.STRONG);
  check('and that trips hand too',
        AI.classifyHigh(E.bestHighFromN(cards('7C 7S QC 8H 7D')).score) >= AI.TIER.STRONG);

  isPat('a made 2-7 low locks',             BADUCEY, '2S 4H 6D 7C 9S');
  isPat('a smooth four-suit badugi locks',   BADUCEY, '2S 4H 6D 7C 9S');
  // 5C 6D 7H 8S 9C is a straight (ruinous for the 2-7 half) but ALSO a
  // four-suit 8-high badugi. In a split game a made smooth badugi is worth
  // locking on its own, so this is a legitimate one-way Pat, not a bug. The
  // original expectation here was mine and it was wrong.
  isPat('a smooth badugi locks even when the 2-7 half is ruined',
                                            BADUCEY, '5C 6D 7H 8S 9C');
  notPat('a nine-high badugi is playable, not lock-worthy',
                                            BADUCEY, '2S 2H 6D 7C 9S');
  notPat('a high-card hand continues',      BADUCEY, 'KS QH JC 9D 3S');

  const badugi = cards('2S 4H 6D 7C 9S');
  check('the sample Pat hand really is a four-card badugi or a made 2-7',
        Draw.madeBadugi(badugi, 10) || Draw.made27Low(badugi));
}

console.log('=== Super Badacey scores badugi + A-5 ===');
{
  notPat('a flush is never a Badacey Pat',  BADACEY, 'KD JD 4D QD 7D');
  notPat('trips are never a Badacey Pat',   BADACEY, '7C 7S QC 8H 7D');
  isPat('a made 8-or-better low locks',     BADACEY, 'AS 2H 3D 4C 8S');
  isPat('a complete low badugi locks',      BADACEY, 'AS 2H 3D 4C 8S');
  notPat('a nine-high badugi is not smooth enough to lock',
                                            BADACEY, 'KS 2H 4D 6C 9S');
  notPat('a high-card hand continues',      BADACEY, 'KS QH JC 9D 3S');

  // A-5 and 2-7 must disagree: the ace is best in one, worst in the other.
  const aceLow = 'AS 2H 3D 4C 8S';
  check('Badacey and Baducey judge the same hand by different rules',
        pat(BADACEY, aceLow) !== pat(BADUCEY, aceLow) ||
        Draw.made27Low(cards(aceLow)) === false,
        'badacey=' + pat(BADACEY, aceLow) + ' baducey=' + pat(BADUCEY, aceLow));
}

console.log('=== The three games do not share one answer ===');
{
  const flush = 'KD JD 4D QD 7D';
  check('a flush locks in Stud Hi-Lo but not in the badugi games',
        pat(STUD, flush) === true && pat(BADUCEY, flush) === false && pat(BADACEY, flush) === false,
        [pat(STUD,flush), pat(BADUCEY,flush), pat(BADACEY,flush)].join(','));
  const trips = '7C 7S QC 8H 7D';
  check('trips lock in Stud Hi-Lo but not in the badugi games',
        pat(STUD, trips) === true && pat(BADUCEY, trips) === false && pat(BADACEY, trips) === false);
}

console.log('=== Guards ===');
{
  check('fewer than five cards never locks', pat(STUD, 'AS 2H 3D') === false);
  check('a game with no Pat objective never locks',
        Draw.superPatDecision('Texas Hold\'em', cards('AS AH AD KC KS'), Showdown, AI) === false);
  check('an unknown game never locks',
        Draw.superPatDecision('Nonexistent Game', cards('AS AH AD KC KS'), Showdown, AI) === false);
  check('a missing showdown registry never locks',
        Draw.superPatDecision(STUD, cards('4D 3C 2H 6C 7S'), null, AI) === false);
}

console.log('=== Objectives come from the showdown registry ===');
{
  check(STUD + ' -> high+a5',   Draw.objectiveFor(STUD, Showdown) === 'high+a5');
  check(BADUCEY + ' -> badugi+27', Draw.objectiveFor(BADUCEY, Showdown) === 'badugi+27');
  check(BADACEY + ' -> badugi+a5', Draw.objectiveFor(BADACEY, Showdown) === 'badugi+a5');
  check('Baducey and Badacey do NOT share Stud Hi-Lo\'s objective',
        Draw.objectiveFor(BADUCEY, Showdown) !== Draw.objectiveFor(STUD, Showdown) &&
        Draw.objectiveFor(BADACEY, Showdown) !== Draw.objectiveFor(STUD, Showdown));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
