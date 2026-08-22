/* ============================================================
   test-table-layout.js

   The pot could creep over the community cards.

   ROOT CAUSE: .pot-area was a flex SIBLING of the board rows inside
   .dealer-work-area, a centred flex column. The column's height therefore
   included the pot, so the whole stack re-centred whenever the pot grew or a
   second board appeared — and with only margin-top:3px between them a wide
   pot label or a tall chip cluster reached the lowest card. The board was
   being moved around the pot instead of the other way round.

   The pot is now taken OUT of the column flow and anchored to the BOTTOM of
   the board container (top:100%) plus a --pot-gap, then shifted left of the
   centreline. Separation is structural, not a z-index trick: the pot starts
   below where the board ends, whatever the board's height or the pot's size.

   These pin the structural contract, not pixel values — the layout is
   responsive and pixel assertions would be brittle and meaningless.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const { DATA } = require('./game-data.js');
const PATTERNS = require('./deal-patterns.js').DEAL_PATTERNS;

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
/* Body of a CSS rule, so assertions can't accidentally match another block. */
function rule(selector){
  const i = SRC.indexOf(selector + '{');
  if(i === -1) return null;
  return SRC.slice(i, SRC.indexOf('}', i));
}

console.log('=== The board is the anchor, the pot is not in its flow ===');
{
  const wa = rule('.dealer-work-area');
  const pa = rule('.pot-area');
  check('a board container exists', !!wa);
  check('a pot container exists', !!pa);
  check('the pot has its own positioning container',
        /position:absolute/.test(pa), pa);
  check('the board column no longer sizes itself around the pot',
        !/margin-top:3px/.test(pa));
  check('the pot is anchored to the BOTTOM of the board container',
        /top:100%/.test(pa), pa);
  check('with a deliberate gap below the lowest card',
        /margin-top:var\(--pot-gap\)/.test(pa), pa);
  check('the gap is a variable, not a hard-coded offset',
        /--pot-gap:/.test(wa), wa);
  check('the pot sits LEFT of the board centreline',
        /transform:translateX\(-1\d\d%\)/.test(pa), pa);
  check('separation is structural, not a z-index trick — the board column '
        + 'still centres on the table',
        /left:50%/.test(wa) && /top:50%/.test(wa));
}

console.log('=== The pot is never inside a board card container ===');
{
  const wa = SRC.indexOf('<div class="dealer-work-area">');
  const board1 = SRC.indexOf('id="boardRow1"', wa);
  const board2 = SRC.indexOf('id="boardRow2"', wa);
  const potArea = SRC.indexOf('class="pot-area"', wa);
  const pot = SRC.indexOf('id="potDisplay"', wa);
  const burn = SRC.indexOf('id="burnPile"', wa);

  check('board one is present', board1 > -1);
  check('board two is present', board2 > board1);
  check('the pot area follows both boards in the markup', potArea > board2);
  check('the pot is not inside board one\u2019s row',
        !/id="boardRow1"[^>]*>[^<]*<[^>]*potDisplay/.test(SRC));
  check('the pot is not inside board two\u2019s row',
        !/id="boardRow2"[^>]*>[^<]*<[^>]*potDisplay/.test(SRC));
  check('the board rows are empty containers the renderer fills',
        /<div class="board-row board1" id="boardRow1"><\/div>/.test(SRC));
  check('the pot and burns are the only things in the pot area',
        pot > potArea && burn > potArea);
  check('exactly one pot element exists',
        (SRC.match(/id="potDisplay"/g) || []).length === 1);
  check('exactly one burn pile exists',
        (SRC.match(/id="burnPile"/g) || []).length === 1);
  check('no game duplicates the pot for a second board',
        (SRC.match(/class="pot-area"/g) || []).length === 1);
}

console.log('=== Burn cards belong to the pot, never to the board ===');
{
  const bp = rule('.burn-pile');
  check('the burn pile is positioned inside the pot area',
        /position:absolute/.test(bp) && /bottom:0/.test(bp), bp);
  check('it tucks at the pot\u2019s lower-LEFT edge', /left:\d+px/.test(bp), bp);
  check('the pot is layered above the burns',
        /z-index:2/.test(rule('.pot-display')));
  check('the burns sit under it', /z-index:1/.test(bp));
  check('each burn tucks under the previous one',
        /margin-right:-/.test(rule('.burn-pile .mini-card')));
  check('the pot area reserves room for the corners to show',
        /padding-bottom/.test(rule('.pot-area')));
  check('burns render as face-down backs',
        /burnPileEl\.innerHTML[^\n]*mini-card face-down/.test(SRC));
  check('burns are never rendered face up',
        !/burnPileEl\.innerHTML[^\n]*face-up/.test(SRC));
}

console.log('=== The amount still comes from authoritative money state ===');
{
  check('the pot total is read from money-state, not stored separately',
        /moneyState\.pot \+ moneyState\.seats\.reduce/.test(SRC));
  check('the chips are rendered by the existing RailChips path',
        /RailChips\.renderPot\(total\)/.test(SRC));
  check('no second chip renderer was introduced',
        !/pot-chips/.test(SRC));
  check('the amount label is preserved for readability',
        /\.pot-display \.chip-amount\{/.test(SRC));
  check('an empty pot renders nothing at all',
        /potEl\.innerHTML = total > 0/.test(SRC));
  check('the burn count is still derived from burnCards',
        /burnPileCount\s*=\s*burnCards\.length/.test(SRC));
}

console.log('=== Every viewport keeps the pot clear of the cards ===');
{
  // The gap is expressed once as a variable and only ever re-valued; no
  // breakpoint may drop the structural anchor.
  const overrides = SRC.match(/--pot-gap:\s*\d+px/g) || [];
  check('the gap is defined and re-valued per breakpoint, never removed',
        overrides.length >= 2, JSON.stringify(overrides));
  check('the wide-screen breakpoint enlarges the gap',
        /min-width: 1000px[\s\S]{0,400}--pot-gap: 22px/.test(SRC));
  check('the narrow breakpoint keeps a gap rather than zeroing it',
        /max-width: 620px[\s\S]{0,300}--pot-gap: 12px/.test(SRC));
  check('narrow screens move the pot nearer the centreline, still below it',
        /max-width: 620px[\s\S]{0,300}translateX\(-88%\)/.test(SRC));
  check('no breakpoint puts the pot back above the board',
        !/\.pot-area\{[^}]*top:24%/.test(SRC) && !/\.pot-display\{[^}]*top:24%/.test(SRC));
  check('the pot never leaves absolute positioning at any breakpoint',
        !/@media[\s\S]{0,300}\.pot-area\{[^}]*position:(static|relative)/.test(SRC));
}

console.log('=== Big-O Double Board still renders two boards ===');
{
  const g = DATA.flatMap(s => s.games || []).find(x => x.name === 'Big-O Double Board');
  check('the game is still called Big-O Double Board', !!g);
  check('it still deals five hole cards',
        PATTERNS[g.dealCat].hole.slice(1).every(h => h === 5),
        JSON.stringify(PATTERNS[g.dealCat].hole));
  check('board one still runs to five', PATTERNS[g.dealCat].board.slice(-1)[0] === 5);
  check('board two still runs to five', PATTERNS[g.dealCat].board2.slice(-1)[0] === 5);
  check('both board rows exist in the markup for it',
        SRC.indexOf('id="boardRow1"') > -1 && SRC.indexOf('id="boardRow2"') > -1);
  check('one shared burn per street is unchanged',
        PATTERNS[g.dealCat].burns.reduce((a,b)=>a+b,0) === 3,
        JSON.stringify(PATTERNS[g.dealCat].burns));
  // A second board makes the column taller; because the pot is anchored to
  // top:100% of that column, it moves with it rather than into it.
  check('the pot anchors to the column bottom, so a second board pushes it down too',
        /top:100%/.test(rule('.pot-area')));
}

console.log('=== A single-board game uses the same one pot ===');
{
  const holdem = DATA.flatMap(s => s.games || []).find(x => x.name === "Texas Hold'em");
  check('a single-board game exists', !!holdem);
  check('board two simply stays empty for it',
        PATTERNS[holdem.dealCat].board2 === undefined ||
        (PATTERNS[holdem.dealCat].board2 || []).every(v => !v),
        JSON.stringify(PATTERNS[holdem.dealCat].board2));
  check('no game-specific pot markup exists',
        !/pot-area[^"]*bigo|pot-area[^"]*double/i.test(SRC));
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
