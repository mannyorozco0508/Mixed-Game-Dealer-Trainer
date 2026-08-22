/* ============================================================
   test-bigo-double-board.js

   Two things came out of real iPad play:

   1. The game was labelled "Double Board Omaha" and its meta said "4-5 hole
      cards". The ENGINE was never wrong — the deal pattern has always been
      hole:[0,5,5,5,5,5] and the golden opening fixture records
      holeSizes [5,5,5,5,5,5,5], captured before any of this. Only the label
      lied. It is now "Big-O Double Board", with the old name kept as a
      showdown alias so saved progress still resolves.

   2. The pot floated ABOVE the community cards with the burn pile above that.
      No dealer manages a table that way. The centre is now board -> pot ->
      burns tucked under the pot's lower edge, corners showing.

   Burn presentation is driven by the authoritative burnCards array, never by
   a decorative counter: if a legal reshuffle takes burns back into the deck,
   the table must stop showing them.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const { DATA }  = require('./game-data.js');
const PATTERNS  = require('./deal-patterns.js').DEAL_PATTERNS;
const Showdown  = require('./showdown.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const NAME   = 'Big-O Double Board';
const LEGACY = 'Double Board Omaha';

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const game = DATA.flatMap(s => s.games || []).find(g => g.name === NAME);

console.log('=== The game is Big-O, and says so ===');
{
  check('the game exists under its new name', !!game);
  check('no game is still called ' + LEGACY,
        !DATA.flatMap(s => s.games || []).some(g => g.name === LEGACY));
  check('its meta no longer claims 4-5 hole cards',
        !/4-5 hole cards/.test(game.meta || ''), game.meta);
  check('its meta says five hole cards', /5 hole cards/.test(game.meta || ''), game.meta);
  check('the roster is still 22 games',
        DATA.reduce((n,s)=>n+(s.games||[]).filter(g=>g.dealCat&&g.scenario).length,0) === 22);
}

console.log('=== Five hole cards, not four ===');
{
  const p = PATTERNS[game.dealCat];
  check('every dealt street holds five hole cards',
        p.hole.slice(1).every(h => h === 5), JSON.stringify(p.hole));
  check('no street deals four', p.hole.indexOf(4) === -1, JSON.stringify(p.hole));
  const golden = require('./fixture-opening-golden.json');
  check('the opening fixture records five per seat',
        JSON.stringify(golden[NAME].holeSizes) === JSON.stringify([5,5,5,5,5,5,5]),
        JSON.stringify(golden[NAME] && golden[NAME].holeSizes));
}

console.log('=== Two boards, and one shared burn per street ===');
{
  const p = PATTERNS[game.dealCat];
  check('board one runs 3 -> 4 -> 5', JSON.stringify(p.board) === '[0,0,3,4,5,5]',
        JSON.stringify(p.board));
  check('board two runs 3 -> 4 -> 5', JSON.stringify(p.board2) === '[0,0,3,4,5,5]',
        JSON.stringify(p.board2));
  check('exactly three burns across the hand',
        p.burns.reduce((a,b)=>a+b,0) === 3, JSON.stringify(p.burns));
  check('never two burns on one street', p.burns.every(b => b <= 1), JSON.stringify(p.burns));
  // One burn serves BOTH boards on every street that deals to them.
  p.board.forEach((b, i) => {
    if(i === 0) return;
    const dealtBoard1 = b > p.board[i-1];
    const dealtBoard2 = p.board2[i] > p.board2[i-1];
    if(dealtBoard1 || dealtBoard2){
      check('street ' + i + ': both boards advance together',
            dealtBoard1 === dealtBoard2,
            'b1=' + dealtBoard1 + ' b2=' + dealtBoard2);
      check('street ' + i + ': one burn serves both boards', p.burns[i] === 1,
            String(p.burns[i]));
    }
  });
}

console.log('=== Showdown: strict Omaha on each board, alias intact ===');
{
  const rule = Showdown.SHOWDOWN_RULES[NAME];
  check('the canonical rule key is the display name', !!rule);
  check('it needs five cards on both boards',
        rule.needsBoard === 5 && rule.needsBoard2 === 5);
  check('it is the double-board family', rule.family === 'doubleboard');
  check('the legacy name still resolves', Showdown.canonicalGameName(LEGACY) === NAME);
  check('and a legacy lookup returns the same rule',
        JSON.stringify(Showdown.ruleForGame(LEGACY)) === JSON.stringify(rule));
  check('the legacy name is not a second rule entry',
        !Showdown.SHOWDOWN_RULES[LEGACY]);
}

console.log('=== Button and blinds classification unchanged ===');
{
  check('it is still a button game',
        /BUTTON_DEALCATS[^\n]*doubleBoard/.test(SRC), 'doubleBoard missing from the button set');
}

console.log('=== The centre is laid out like a dealer\u2019s work area ===');
{
  const wa = SRC.indexOf('<div class="dealer-work-area">');
  check('a dealer work area exists', wa > -1);
  const board1 = SRC.indexOf('id="boardRow1"', wa);
  const board2 = SRC.indexOf('id="boardRow2"', wa);
  const potArea = SRC.indexOf('class="pot-area"', wa);
  const burn = SRC.indexOf('id="burnPile"', wa);
  const pot = SRC.indexOf('id="potDisplay"', wa);

  check('both boards are inside it', board1 > wa && board2 > board1);
  check('the pot area comes AFTER the boards, not above them',
        potArea > board2, 'pot@' + potArea + ' board2@' + board2);
  check('the burn pile lives inside the pot area', burn > potArea);
  check('the pot and the burns share that area', pot > burn);
  check('the pot no longer floats above the board',
        !/\.pot-display\{[^}]*top:24%/.test(SRC));
}

console.log('=== Burns are tucked under the pot, face down ===');
{
  check('the pot is layered above the burns',
        /\.pot-display\{[^}]*z-index:2/.test(SRC));
  check('the burn pile sits beneath it',
        /\.burn-pile\{[^}]*z-index:1/.test(SRC));
  check('the burn pile is anchored to the pot\u2019s lower edge',
        /\.burn-pile\{[^}]*bottom:0/.test(SRC));
  check('each burn tucks under the previous one',
        /\.burn-pile \.mini-card\{[^}]*margin-right:-/.test(SRC));
  check('the pot area leaves room for the corners to show',
        /\.pot-area\{[^}]*padding-bottom/.test(SRC));
  check('burns are rendered as face-down card backs, not text',
        /burnPileEl\.innerHTML[^\n]*mini-card face-down/.test(SRC));
  check('no burn is ever rendered face up',
        !/burnPileEl\.innerHTML[^\n]*face-up/.test(SRC));
  check('there is no "BURN x N" text counter',
        !/BURN\s*(×|x)\s*\$?\{/.test(SRC));
}

console.log('=== The burn pile is driven by authoritative state ===');
{
  check('the visual count comes from burnCards, not a tally',
        /burnPileCount\s*=\s*burnCards\.length/.test(SRC));
  check('the renderer draws burnPileCount cards',
        /Array\(Math\.min\(burnPileCount, \d+\)\)/.test(SRC));
  check('burnCards is documented as authoritative',
        /authoritative: burnPileCount is derived from it/.test(SRC));
  // Must be the RESET, not the declaration: 'let burnPileCount = 0;' would
  // satisfy a naive match even if the reset were deleted.
  check('a new hand clears the burn presentation',
        SRC.indexOf('\n  burnPileCount = 0;') > -1);
  check('a new hand clears the burn pile itself',
        /burnCards = \[\];/.test(SRC));
  // A reshuffle empties burnCards; since the count is derived, the table
  // reconciles automatically rather than showing a stale physical burn.
  check('nothing maintains a second burn count',
        (SRC.match(/burnPileCount\s*(\+\+|\+=)/g) || []).length === 0);
}

console.log('=== Drawmaha replacement still takes no burn ===');
{
  const dm = PATTERNS.drawmaha;
  const drawmaha = DATA.flatMap(s => s.games || []).find(g => g.name === 'Drawmaha Hi');
  drawmaha.scenario.forEach((st, i) => {
    if(st.requiresDraw){
      check('the replacement draw street declares no burn', dm.burns[i] === 0,
            'burn=' + dm.burns[i]);
    }
  });
  check('drawmaha still burns three times for its board streets',
        dm.burns.reduce((a,b)=>a+b,0) === 3, JSON.stringify(dm.burns));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
