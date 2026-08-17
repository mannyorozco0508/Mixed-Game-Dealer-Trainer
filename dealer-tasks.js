/* ============================================================
   dealer-tasks.js — Dynamic Dealer Task Framework

   THE SIMULATION IS THE SOURCE OF TRUTH. A dynamic task never carries its
   own answer key: it carries a RESOLVER that interrogates live table state
   and returns what is true right now. Change the state, the answer changes,
   with no edit to the task definition.

   Backward compatible by design: a step with no `taskType` is treated as
   legacy multiple-choice and behaves exactly as before.

   Works in Node (require) and the browser (window.RailTasks).
   ============================================================ */
(function(exports){

/* ---------- Read-only state snapshot ----------
   Built once when a task opens and never mutated afterwards, so an AI
   callback firing late cannot change the answer under the trainee.
   Only fields the simulation can actually prove are exposed — nothing
   is fabricated. */
function buildDealerTaskState(sim){
  sim = sim || {};
  const snap = {
    street:        sim.street,
    buttonSeat:    sim.buttonSeat,
    sitOutSeat:    sim.sitOutSeat,
    activeSeats:   (sim.activeSeats || []).slice(),
    foldedSeats:   Array.from(sim.foldedSeats || []),
    allInSeats:    (sim.allInSeats || []).slice(),
    currentActor:  sim.currentActor,
    bringInSeat:   sim.bringInSeat,
    pot:           sim.pot,
    streetContrib: Object.assign({}, sim.streetContrib || {}),
    currentBet:    sim.currentBet,
    stacks:        Object.assign({}, sim.stacks || {}),
    callAmounts:   Object.assign({}, sim.callAmounts || {}),
    completionTo:  sim.completionTo,
    bringInAmount: sim.bringInAmount,
    board:         (sim.board || []).slice(),
    sidePots:      (sim.sidePots || []).map(p => ({ amount:p.amount, eligiblePlayerIds:(p.eligiblePlayerIds||[]).slice() }))
  };
  return Object.freeze(snap);
}

/* ---------- Task type registry ----------
   Each type owns its own validation and answer formatting. Adding a type
   never requires touching the core engine or the other types. */
const TASK_TYPES = {
  'multiple-choice': {
    // Legacy path. Answer is the option object itself.
    validate(task, given, state){
      const correct = !!(given && given.correct);
      const expectedOpt = (task.options || []).find(o => o.correct);
      return {
        correct,
        expected: expectedOpt ? expectedOpt.text : null,
        given: given ? given.text : null,
        feedback: given ? given.feedback : ''
      };
    },
    formatAnswer(v){ return v == null ? '' : String(v); }
  },

  'select-seat': {
    // Answer is a seat index. Truth comes from the resolver, never the task.
    validate(task, given, state){
      const expected = task.resolve ? task.resolve(state) : null;
      const correct = expected !== null && expected !== undefined && given === expected;
      return {
        correct,
        expected,
        given,
        feedback: buildExplanation(task, state, given, expected, correct)
      };
    },
    formatAnswer(v){ return v === null || v === undefined ? '' : 'Player ' + (v + 1); }
  },

  'numeric-amount': {
    // Answer is an integer dollar amount resolved from live money state.
    validate(task, given, state){
      const expected = task.resolve ? task.resolve(state) : null;
      const g = (given === '' || given === null || given === undefined) ? null : parseInt(given, 10);
      const correct = expected !== null && expected !== undefined && g === expected;
      return {
        correct,
        expected,
        given: g,
        feedback: buildExplanation(task, state, g, expected, correct)
      };
    },
    formatAnswer(v){ return v === null || v === undefined ? '' : '$' + v; }
  }
};

/* Explanations may be dynamic: a function receives the snapshot and can
   describe WHY, e.g. "Player 4 already has $20 in and the wager is $60,
   so the call is $40." Falls back to a plain string. */
function buildExplanation(task, state, given, expected, correct){
  if(typeof task.explain === 'function'){
    try { return task.explain(state, given, expected, correct); }
    catch(err){ return ''; }
  }
  if(typeof task.explain === 'string') return task.explain;
  return '';
}

function typeOf(task){
  const t = (task && task.taskType) || 'multiple-choice';
  return TASK_TYPES[t] ? t : 'multiple-choice';
}
function isDynamic(task){
  return typeOf(task) !== 'multiple-choice';
}

/* ---------- Public API ---------- */

// Resolves what the correct answer is right now. READ-ONLY: resolvers are
// given a frozen snapshot, so they cannot mutate simulation state.
function resolveDealerTask(task, state){
  if(!task || typeof task.resolve !== 'function') return null;
  return task.resolve(state);
}

// Validates a submitted answer. Every task type returns the same shape, so
// the existing scoring/review system consumes them identically.
function validateDealerTask(task, given, state){
  const type = typeOf(task);
  const result = TASK_TYPES[type].validate(task, given, state);
  result.taskType = type;
  result.prompt = task && task.prompt;
  // Immutable record so a missed task stays reviewable after the hand ends
  // and the live state is gone.
  result.reviewRecord = {
    prompt: task && task.prompt,
    taskType: type,
    expectedLabel: TASK_TYPES[type].formatAnswer(result.expected),
    givenLabel: TASK_TYPES[type].formatAnswer(result.given),
    feedback: result.feedback
  };
  return result;
}

function formatAnswer(task, value){
  return TASK_TYPES[typeOf(task)].formatAnswer(value);
}

function registerTaskType(name, impl){
  TASK_TYPES[name] = impl;
}
function taskTypeNames(){ return Object.keys(TASK_TYPES); }

exports.buildDealerTaskState = buildDealerTaskState;
exports.resolveDealerTask = resolveDealerTask;
exports.validateDealerTask = validateDealerTask;
exports.formatAnswer = formatAnswer;
exports.registerTaskType = registerTaskType;
exports.taskTypeNames = taskTypeNames;
exports.isDynamic = isDynamic;
exports.typeOf = typeOf;
exports.TASK_TYPES = TASK_TYPES;

})(typeof module !== 'undefined' ? module.exports : (window.RailTasks = window.RailTasks || {}));
