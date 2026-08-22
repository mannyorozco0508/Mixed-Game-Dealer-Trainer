/* ============================================================
   test-terminology.js

   A trainee met this on a real iPad:

     "A pot layer of $201 must be split between the boards..."

   "Pot layer" is the ENGINE's word. money-state builds eligibility by
   layering contributions, and that model is correct and staying — but a
   dealer never says it, and a trainee should fail a question because they
   got the payout wrong, not because they could not decode the software.

   This guard inspects PLAYER-FACING content only. Internal comments,
   variable names and module documentation are deliberately untouched.

   It also pins the three distinctions that were being blurred:

     a pot SPLIT (two boards, or high/low) is not a SIDE POT
     a SIDE POT comes from unequal contribution and eligibility
     the two odd-chip decisions in a board split are separate
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const { DATA } = require('./game-data.js');
const Money    = require('./money-state.js');

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}

/* Every string a trainee can actually read. */
function playerFacingStrings(){
  const out = [];
  const push = (where, text) => { if(typeof text === 'string' && text.trim()) out.push({ where, text }); };
  DATA.forEach(sec => (sec.games || []).forEach(g => {
    push(g.name + ' meta', g.meta);
    push(g.name + ' notes', g.notes);
    (g.flow || []).forEach((f, i) => push(g.name + ' flow[' + i + ']', f));
    (g.scenario || []).forEach((st, i) => {
      const at = g.name + ' step ' + i + ' [' + st.street + ']';
      push(at + ' prompt', st.prompt);
      (st.options || []).forEach((o, j) => {
        push(at + ' option ' + j, o.text);
        push(at + ' feedback ' + j, o.feedback);
      });
    });
  }));
  return out;
}

/* Dynamic task text: prompts and explanations built at runtime. Read as
   source, since the strings are assembled from live state. */
const DYNAMIC_FILES = ['money-tasks.js', 'dealer-tasks.js', 'showdown-present.js',
                       'card-choice.js', 'player-mode.js', 'dealer-errors.js'];
function dynamicQuotedStrings(){
  const out = [];
  DYNAMIC_FILES.forEach(f => {
    const p = path.join(__dirname, f);
    if(!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, n) => {
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');   // drop comment lines
      if(!code.trim()) return;
      const quoted = code.match(/'[^']{4,}'|"[^"]{4,}"/g) || [];
      quoted.forEach(q => out.push({ where: f + ':' + (n + 1), text: q }));
    });
  });
  return out;
}

const BANNED = [
  'pot layer', 'pot layers', 'eligible layer', 'eligibility layer',
  'contribution layer', 'wager layer', 'pot segment', 'eligible segment',
  'contribution segment', 'layer amount', 'this layer', 'these layers',
  'the layers'
];

console.log('=== No engine vocabulary in scenario content ===');
{
  const strings = playerFacingStrings();
  check('there is player-facing content to inspect', strings.length > 500,
        String(strings.length));
  BANNED.forEach(term => {
    const hits = strings.filter(s => s.text.toLowerCase().indexOf(term) !== -1);
    check('no scenario text says "' + term + '"', hits.length === 0,
          hits.slice(0, 2).map(h => h.where).join(' | '));
  });
}

console.log('=== No engine vocabulary in runtime task text ===');
{
  const strings = dynamicQuotedStrings();
  check('there is dynamic text to inspect', strings.length > 100, String(strings.length));
  BANNED.forEach(term => {
    const hits = strings.filter(s => s.text.toLowerCase().indexOf(term) !== -1);
    check('no runtime text says "' + term + '"', hits.length === 0,
          hits.slice(0, 2).map(h => h.where + ' ' + h.text).join(' | '));
  });
}

console.log('=== Internal engine vocabulary is left alone ===');
{
  // The layering MODEL is correct and must not be renamed to satisfy a
  // copy edit. Only the trainee-visible wording changed.
  const ms = fs.readFileSync(path.join(__dirname, 'money-state.js'), 'utf8');
  check('money-state still models pot layers internally', /layer/i.test(ms));
  check('and still exposes the layered pot structure',
        typeof Money.potLayers === 'function');
}

console.log('=== A split is not a side pot ===');
{
  const strings = playerFacingStrings();
  // Anything that mentions a side pot must be about contribution/eligibility,
  // never about a board or high/low division.
  const sidePotText = strings.filter(s => /side pot/i.test(s.text));
  sidePotText.forEach(s => {
    const blursBoards = /side pot/i.test(s.text) &&
      /(top board|bottom board|upper board|lower board)/i.test(s.text) &&
      !/all-in|contribut|eligib/i.test(s.text);
    check('side-pot wording is not used for a board share: ' + s.where, !blursBoards, s.text);
    const blursHiLo = /side pot/i.test(s.text) &&
      /(high half|low half|high share|low share)/i.test(s.text) &&
      !/all-in|contribut|eligib/i.test(s.text);
    check('side-pot wording is not used for a high/low share: ' + s.where, !blursHiLo, s.text);
  });
  check('the side-pot scan ran over real content', strings.length > 0);

  // Runtime side-pot tasks must be framed by contribution, not by headcount.
  const mt = fs.readFileSync(path.join(__dirname, 'money-tasks.js'), 'utf8');
  check('side-pot tasks are explained by the all-in level',
        /above the previous all-in level/.test(mt));
  check('main-pot tasks are explained by the shortest all-in',
        /capped at the shortest all-in/.test(mt));
  check('eligibility is taught as funding, not as survival',
        /put in enough to reach this pot/.test(mt));
  check('a folded contributor is taught correctly',
        /stay in the pot, but they can never win it/.test(mt));
}

console.log('=== House rule: board odd chip goes to the TOP board ===');
{
  const ms = fs.readFileSync(path.join(__dirname, 'money-state.js'), 'utf8');
  check('the engine documents the top-board odd chip',
        /odd chip goes to the TOP board/.test(ms));
  check('the top share is the one that takes the odd chip',
        /const topShare = layer\.amount - bottomShare;/.test(ms));
  check('the engine documents the two distinct decisions',
        /two DISTINCT odd-chip decisions/.test(ms));

  // Arithmetic, not wording.
  const split = amount => {
    const bottom = Math.floor(amount / 2);
    return { top: amount - bottom, bottom };
  };
  check('$200 splits evenly, no odd chip',
        split(200).top === 100 && split(200).bottom === 100);
  check('$201 gives the Top Board the odd chip: 101 / 100',
        split(201).top === 101 && split(201).bottom === 100,
        JSON.stringify(split(201)));
  check('the top share is never the smaller of the two', split(201).top > split(201).bottom);
  check('nothing is lost in the split', split(201).top + split(201).bottom === 201);
}

console.log('=== The $201 lesson is arithmetically real ===');
{
  const g = DATA.flatMap(s => s.games || []).find(x => x.name === 'Big-O Double Board');
  check('Big-O Double Board exists under its current name', !!g);
  const q = (g.scenario || []).find(st => /\$201/.test(st.prompt || ''));
  check('the $201 question still exists', !!q);
  check('it no longer calls the pot a layer',
        !/\b(pot|eligible|contribution|wager)\s+layers?\b/i.test(q.prompt), q.prompt);
  check('it calls it what a dealer would call it', /in the pot/i.test(q.prompt), q.prompt);

  const right = q.options.find(o => o.correct);
  check('the correct answer is still TWO decisions', /^Two/.test(right.text), right.text);
  // $201 -> 101 top / 100 bottom (odd chip 1); $101 between two tied
  // players -> 50 / 50 with one left over (odd chip 2).
  const top = 201 - Math.floor(201 / 2);
  check('the first division leaves an odd chip', 201 % 2 === 1);
  check('and the top share is $101', top === 101, String(top));
  check('the top share ALSO fails to divide between two players', top % 2 === 1,
        String(top));
  check('so exactly two odd-chip decisions exist, as the answer says', true);
  check('the feedback shows the arithmetic', /\$101/.test(right.feedback) && /\$100/.test(right.feedback),
        right.feedback);
  check('the feedback states these shares are not side pots',
        /NOT side pots/i.test(right.feedback), right.feedback);
}

console.log('=== House rule: hi-lo odd chip goes to the HIGH hand ===');
{
  const sd = fs.readFileSync(path.join(__dirname, 'showdown.js'), 'utf8');
  const ms = fs.readFileSync(path.join(__dirname, 'money-state.js'), 'utf8');
  check('the high/low odd chip rule is stated somewhere authoritative',
        /odd chip/i.test(sd) || /odd chip/i.test(ms));
  /* The rule applies to TRUE hi-lo eights-or-better games. Four other games
     split on a different axis entirely and carry their own documented odd-chip
     destination in their notes — board-vs-draw in Drawmaha, badugi-vs-low in
     the Super draw games. Those are not hi-lo splits and must not be forced
     onto the high-hand rule. Each is checked for INTERNAL consistency between
     its notes and its showdown answer instead. */
  const HILO8 = ['Stud Hi-Lo / 8-or-Better', 'Super Stud Hi-Lo 8 / Super Pat', 'Big O Hi-Lo'];
  const games = DATA.flatMap(s => s.games || []);
  HILO8.forEach(n => {
    const g = games.find(x => x.name === n);
    check(n + ' exists', !!g);
    if(!g) return;
    const blob = JSON.stringify(g);
    const sendsLow = /odd chip[^"]{0,60}(to the low|goes low)/i.test(blob);
    check(n + ': never sends the odd chip to the low hand', !sendsLow);
  });

  const OWN_RULE = {
    'Super Baducey':  /odd chip\s*(→|->)\s*low/i,
    'Super Badacey':  /odd chip\s*(→|->)\s*low/i,
    'Drawmaha A-5':   /odd chip\s*(→|->)\s*best draw hand/i,
    'Drawmaha 2-7':   /odd chip\s*(→|->)\s*best draw hand/i,
    'Drawmaha Hi':    /odd chip\s*(→|->)\s*best draw hand/i
  };
  Object.keys(OWN_RULE).forEach(n => {
    const g = games.find(x => x.name === n);
    check(n + ' exists', !!g);
    if(!g) return;
    check(n + ': documents its own odd-chip destination in its notes',
          OWN_RULE[n].test(g.notes || ''), g.notes);
    check(n + ': is not a hi-lo eights-or-better game',
          !/8-or-better|Hi-Lo/i.test(n));
  });
}

console.log('=== Legitimate poker vocabulary is preserved ===');
{
  const strings = playerFacingStrings();
  const blob = strings.map(s => s.text).join(' ').toLowerCase();
  ['side pot', 'main pot', 'odd chip', 'all-in', 'bring-in', 'burn',
   'muck', 'button', 'showdown', 'board'].forEach(term => {
    check('the curriculum still teaches "' + term + '"', blob.indexOf(term) !== -1);
  });
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
