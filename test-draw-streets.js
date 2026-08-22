/* ============================================================
   test-draw-streets.js

   A TRAINING LABEL CONTAINING "DRAW" MUST NEVER DEAL CARDS.

   Both the AI path and the human path decided "this step causes a physical
   draw" by testing /^Draw/i against the human-readable street label. That
   made the label the poker engine's trigger, and the scenarios are full of
   teaching steps whose labels legitimately start with "Draw":

     - every triple-draw game carries a difficulty-3 question labelled
       "Draw 2" about which cards may be reshuffled mid-hand
     - four Drawmaha variants carry a "Draw Declared" dispute question about
       a player demanding a second burn
     - those same four carry a variant-specific strategy quiz labelled "Draw"

   None of those move a card. All of them matched. AI seats drew four times in
   a three-draw game and three times in a one-draw game.

   The trigger is now requiresDraw, set in game-data on the streets that
   genuinely replace cards. These tests pin the count per game, pin that the
   flag and the label disagree (which is the whole point), and pin that no
   step carrying a difficulty rating is ever treated as physical.
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const { DATA } = require('./game-data.js');
const Draw = require('./draw-engine.js');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const games = DATA.flatMap(s => s.games || []).filter(g => g.scenario && g.dealCat);
const byName = n => games.find(g => g.name === n);

let pass = 0, fail = 0;
function check(label, cond, note){
  if(cond) pass++; else { fail++; console.log('FAIL: ' + label + (note ? ' — ' + note : '')); }
}
const physical = g => g.scenario.filter(s => s.requiresDraw);
const labelled = g => g.scenario.filter(s => /^Draw/i.test(s.street || ''));

console.log('=== Physical draws match the rules, not the labels ===');
{
  const expected = {
    'Badugi':3, 'A-5 Lowball':3, '2-7 Lowball':3, 'Badacey':3, 'Baducey':3, 'Archie':3,
    'Drawmaha Hi':1, 'Drawmaha A-5':1, 'Drawmaha 2-7':1, 'Drawmaha 49':1, 'Drawmaha Badugi':1
  };
  Object.keys(expected).forEach(name => {
    const g = byName(name);
    check(name + ' exists', !!g);
    if(!g) return;
    check(name + ': exactly ' + expected[name] + ' physical draw street(s)',
          physical(g).length === expected[name],
          'got ' + physical(g).length);
    check(name + ': matches its own drawRounds',
          physical(g).length === Draw.drawRoundCount(g.dealCat),
          physical(g).length + ' vs drawRounds ' + Draw.drawRoundCount(g.dealCat));
  });
}

console.log('=== The label and the trigger genuinely disagree ===');
{
  // If these ever became equal the bug would be back and invisible.
  // Drawmaha Hi joined this list once it stopped carrying its own short
  // inline scenario and started using the shared generator like the others.
  ['Badugi','A-5 Lowball','2-7 Lowball','Badacey','Baducey','Archie',
   'Drawmaha Hi','Drawmaha A-5','Drawmaha 2-7','Drawmaha 49','Drawmaha Badugi'].forEach(name => {
    const g = byName(name);
    check(name + ': more Draw-labelled steps than physical ones',
          labelled(g).length > physical(g).length,
          'labelled=' + labelled(g).length + ' physical=' + physical(g).length);
  });
  // Every Drawmaha variant must now share one physical shape.
  const shapes = ['Drawmaha Hi','Drawmaha A-5','Drawmaha 2-7','Drawmaha 49','Drawmaha Badugi']
    .map(n => physical(byName(n)).length);
  check('all five Drawmaha variants declare exactly one physical draw',
        shapes.every(v => v === 1), JSON.stringify(shapes));
  const lens = ['Drawmaha A-5','Drawmaha 2-7','Drawmaha 49','Drawmaha Badugi']
    .map(n => byName(n).scenario.length);
  check('Drawmaha Hi is no longer shorter than its own physical flow',
        byName('Drawmaha Hi').scenario.length >= 7,
        byName('Drawmaha Hi').scenario.length + ' vs ' + JSON.stringify(lens));
}

console.log('=== Teaching steps are never physical ===');
{
  games.forEach(g => {
    g.scenario.forEach((s, i) => {
      if(!s.requiresDraw) return;
      check(g.name + ' step ' + i + ': a physical draw is not a difficulty quiz',
            !s.difficulty || s.difficulty <= 1,
            'difficulty=' + s.difficulty);
    });
  });
  // The specific teaching prompts that used to fire a draw.
  const reshuffleQ = byName('Badugi').scenario.find(s => /reshuffled back in/.test(s.prompt || ''));
  check('the mid-hand reshuffle question exists', !!reshuffleQ);
  check('and it is labelled like a draw', /^Draw/i.test(reshuffleQ.street), reshuffleQ.street);
  check('but it does NOT cause a draw', !reshuffleQ.requiresDraw);

  const disputeQ = byName('Drawmaha A-5').scenario.find(s => /owe a second burn/.test(s.prompt || ''));
  check('the second-burn dispute question exists', !!disputeQ);
  check('and it is labelled like a draw', /^Draw/i.test(disputeQ.street), disputeQ.street);
  check('but it does NOT cause a draw', !disputeQ.requiresDraw);
}

console.log('=== Non-draw games declare no physical draws ===');
{
  games.filter(g => !Draw.isDrawGame(g.dealCat)).forEach(g => {
    check(g.name + ': declares no draw streets', physical(g).length === 0,
          String(physical(g).length));
  });
}

console.log('=== The engine reads the flag, not the label ===');
{
  check('the AI draw trigger uses requiresDraw',
        /function isAiDrawStep\(\)[\s\S]{0,320}step\.requiresDraw/.test(SRC));
  check('the human draw trigger uses requiresDraw',
        /function isDrawStep\(\)[\s\S]{0,320}step\.requiresDraw/.test(SRC));
  check('neither trigger still tests the street label',
        !/\/\^Draw\/i\.test\(step\.street\)/.test(SRC));
  check('the draw NUMBER shown counts physical draws',
        /function drawStepIndex\(\)[\s\S]{0,420}s\.requiresDraw/.test(SRC));
  // The only surviving mention is the comment explaining the old bug.
  const live = SRC.split('\n').filter(l => /\/\^Draw\/i/.test(l) && !/^\s*(\/\*|\*|\/\/)/.test(l) && /\.test\(/.test(l));
  check('no live code still tests the street label', live.length === 0, live.join(' | '));
}

console.log('=== A new teaching step cannot start dealing by accident ===');
{
  // Simulate someone adding a prompt called "Draw Procedure" tomorrow.
  const g = JSON.parse(JSON.stringify(byName('Drawmaha Hi')));
  const before = physical(g).length;
  g.scenario.splice(2, 0, { street:'Draw Procedure', difficulty:2,
                            prompt:'A player asks how the draw works. What do you tell them?', options:[] });
  check('adding a Draw-labelled teaching step changes nothing',
        physical(g).length === before, physical(g).length + ' vs ' + before);
  check('but it does add a label match',
        labelled(g).length > before);
}

console.log('\n=== RESULTS: ' + pass + ' passed, ' + fail + ' failed ===');
if(fail) process.exit(1);
