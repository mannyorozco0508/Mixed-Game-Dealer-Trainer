/* ============================================================
   dealer-errors.js — Dealer Error & Recovery training layer

   ARCHITECTURAL RULE: this layer sits ABOVE the validated simulation and
   never writes to it. A training fault changes only PRESENTATION — what the
   trainee sees — while the authoritative deal order, current actor, card
   identity, stacks, contributions, pot and side pots stay exactly as the
   engines computed them.

        Correct Simulation State   (authoritative, untouched)
                  |
        Dealer Error Layer         (this file: fault description only)
                  |
        Temporary Fault Presentation
                  |
        Trainee Detection Task     (answer resolved FROM the simulation)
                  |
        Clear Fault -> presentation restored

   HOUSE-RULE HONESTY: no recovery procedure is currently confirmed for this
   room, so this phase teaches DETECTION only. Detection answers come from
   the simulation and are not room-specific. Remedies are marked
   needs-confirmation and are deliberately not taught as fact.

   Works in Node (require) and the browser (window.RailErrors).
   ============================================================ */
(function(exports){

/* Provenance for anything this layer might eventually teach. */
const RULE_SOURCE = {
  CONFIRMED: 'confirmed-house-rule',
  STANDARD_UNCONFIRMED: 'standard-rule-unconfirmed',
  NEEDS_CONFIRMATION: 'needs-confirmation'
};

/* ---------- Error registry ----------
   Each entry describes WHERE a fault can occur, HOW it is presented, what
   the detection task asks, and how the presentation is restored. No entry
   contains a recovery remedy unless its ruleSource is CONFIRMED. */
const DEALER_ERRORS = {

  'exposed-card': {
    label: 'Exposed card',
    difficulty: 2,
    // Applies wherever a player holds a face-down card.
    appliesTo: () => true,
    description: 'A card that should be face down was accidentally turned face up during the deal.',
    // Presentation only: flips one already-dealt card face up. The card's
    // rank/suit and its physical slot are untouched.
    plan(ctx){
      const seat = ctx.pickSeat();
      if(seat === null || seat === undefined) return null;
      return { errorType:'exposed-card', affectedSeat: seat, affectedCardIndex: 0,
               street: ctx.street, detected:false, resolved:false };
    },
    detectionTask: {
      taskType: 'multiple-choice',
      prompt: 'Watch the deal. What just happened?',
      options: [
        { text:'A card that should be face down was exposed', correct:true,
          feedback:'Right — that hole card is showing when it should be face down. Recognising it immediately is the dealer\u2019s job.' },
        { text:'Nothing unusual — that card is meant to be face up', correct:false,
          feedback:'In this game that card is dealt face down. Seeing it face up means it was exposed during the deal.' },
        { text:'A player was skipped in the deal', correct:false,
          feedback:'Every seat received a card. The problem is that one of them is showing.' }
      ]
    },
    // Deliberately NOT taught: the remedy varies by room.
    recovery: { ruleSource: RULE_SOURCE.NEEDS_CONFIRMATION,
                note: 'Exposed-card remedy (replace/burn, misdeal threshold) is room-specific and unconfirmed for this room.' }
  },

  'wrong-recipient': {
    label: 'Card to the wrong seat',
    difficulty: 1,
    appliesTo: () => true,
    description: 'A card visually landed at a seat other than the one next in the deal order.',
    plan(ctx){
      const expected = ctx.expectedRecipient();
      if(expected === null || expected === undefined) return null;
      const wrong = ctx.pickSeat(expected); // any active seat that isn't the expected one
      if(wrong === null || wrong === undefined) return null;
      return { errorType:'wrong-recipient', expectedRecipient: expected, presentedRecipient: wrong,
               street: ctx.street, detected:false, resolved:false };
    },
    detectionTask: {
      taskType: 'select-seat',
      prompt: 'That card went to the wrong seat. Tap the player who should have received it.',
      // Answer comes from the SAME deal-order logic the simulation uses.
      resolve: (s, fault) => fault ? fault.expectedRecipient : null,
      explain: (s, given, expected, correct, fault) => {
        const p = n => 'Player ' + (n + 1);
        return correct
          ? 'Correct — the deal order made ' + p(expected) + ' next to receive a card.'
          : 'The card landed on ' + p(fault.presentedRecipient) + ', but the deal order made ' +
            p(expected) + ' next. Follow the button and the seats already served.';
      }
    },
    recovery: { ruleSource: RULE_SOURCE.NEEDS_CONFIRMATION,
                note: 'Whether the card is passed along or the hand is a misdeal depends on the room.' }
  },

  'premature-board': {
    label: 'Premature board card',
    difficulty: 3,
    // Only meaningful in games that actually have a shared board.
    appliesTo: ctx => ctx.hasBoard === true,
    description: 'A community card was placed while a betting round was still open.',
    plan(ctx){
      if(!ctx.actionOpen) return null; // only a fault if action is genuinely incomplete
      return { errorType:'premature-board', street: ctx.street,
               actorWhoStillOwes: ctx.currentActor, detected:false, resolved:false };
    },
    detectionTask: {
      taskType: 'multiple-choice',
      prompt: 'The next board card just appeared. Should it have been dealt?',
      options: [
        { text:'No — the betting round is not complete', correct:true,
          feedback:'Correct. Action was still open, so no board card should go out until every live player has acted.' },
        { text:'Yes — the board card comes next in the sequence', correct:false,
          feedback:'The sequence is right but the timing is not. Betting must close before the next street.' },
        { text:'Yes — a burn was taken first', correct:false,
          feedback:'Burning does not authorise the card. Action has to be complete first.' }
      ]
    },
    // A second, harder detection task that reads live action state.
    followUpTask: {
      taskType: 'select-seat',
      prompt: 'Tap the player who still owes action.',
      resolve: (s, fault) => fault ? fault.actorWhoStillOwes : null,
      explain: (s, given, expected, correct) => {
        const p = n => 'Player ' + (n + 1);
        return correct
          ? 'Correct — action was on ' + p(expected) + ', so the round was still open.'
          : 'Action was on ' + p(expected) + '. Until they act, the betting round cannot close.';
      }
    },
    recovery: { ruleSource: RULE_SOURCE.NEEDS_CONFIRMATION,
                note: 'Handling of a prematurely dealt board card varies by room.' }
  },

  'action-out-of-turn': {
    label: 'Action out of turn',
    difficulty: 2,
    appliesTo: ctx => ctx.currentActor !== null && ctx.currentActor !== undefined,
    description: 'A player acted when the action was on someone else.',
    plan(ctx){
      const actual = ctx.currentActor;
      if(actual === null || actual === undefined) return null;
      const offender = ctx.pickSeat(actual);
      if(offender === null || offender === undefined) return null;
      return { errorType:'action-out-of-turn', authoritativeActor: actual,
               offendingSeat: offender, street: ctx.street, detected:false, resolved:false };
    },
    detectionTask: {
      taskType: 'select-seat',
      prompt: 'A player just acted out of turn. Tap the player who actually has the action.',
      // Reads the authoritative actor — the fake action never changed it.
      resolve: (s, fault) => fault ? fault.authoritativeActor : null,
      explain: (s, given, expected, correct, fault) => {
        const p = n => 'Player ' + (n + 1);
        return correct
          ? 'Correct — action is on ' + p(expected) + '. ' + p(fault.offendingSeat) + ' acted out of turn.'
          : p(fault.offendingSeat) + ' acted out of turn, but action is on ' + p(expected) + '.';
      }
    },
    recovery: { ruleSource: RULE_SOURCE.NEEDS_CONFIRMATION,
                note: 'Whether an out-of-turn action is binding depends on the room.' }
  }
};

/* ---------- Injection configuration ----------
   Errors must never be constant. Frequency lives here rather than being
   scattered through the app, so difficulty modes can drive it later. */
const ERROR_TRAINING_CONFIG = {
  enabled: false,          // opt-in; a clean hand remains the default
  frequency: 0.25,         // chance a given eligible moment produces a fault
  allowedTypes: Object.keys(DEALER_ERRORS),
  // Tests inject deterministically instead of relying on chance.
  deterministicType: null
};

/* Decides whether to inject, and which type. rng is injectable so tests are
   never at the mercy of Math.random. */
function chooseError(ctx, config, rng){
  const cfg = config || ERROR_TRAINING_CONFIG;
  if(!cfg.enabled) return null;
  if(cfg.deterministicType){
    const def = DEALER_ERRORS[cfg.deterministicType];
    if(!def || !def.appliesTo(ctx)) return null;
    return def.plan(ctx);
  }
  const roll = (typeof rng === 'function' ? rng() : Math.random());
  if(roll > cfg.frequency) return null;
  const eligible = cfg.allowedTypes.filter(t => DEALER_ERRORS[t] && DEALER_ERRORS[t].appliesTo(ctx));
  if(eligible.length === 0) return null;
  const pickIdx = Math.floor((typeof rng === 'function' ? rng() : Math.random()) * eligible.length);
  const def = DEALER_ERRORS[eligible[Math.min(pickIdx, eligible.length - 1)]];
  return def.plan(ctx);
}

/* Builds the detection task for an active fault, binding the fault into the
   resolver/explanation so the answer still derives from simulation state. */
function detectionTaskFor(fault, useFollowUp){
  if(!fault) return null;
  const def = DEALER_ERRORS[fault.errorType];
  if(!def) return null;
  const base = useFollowUp ? def.followUpTask : def.detectionTask;
  if(!base) return null;
  const task = Object.assign({}, base, {
    errorType: fault.errorType,
    difficulty: def.difficulty
  });
  if(typeof base.resolve === 'function'){
    task.resolve = s => base.resolve(s, fault);
  }
  if(typeof base.explain === 'function'){
    task.explain = (s, given, expected, correct) => base.explain(s, given, expected, correct, fault);
  }
  return task;
}

/* Immutable record so a missed error stays reviewable after the hand ends. */
function errorReviewRecord(fault, taskResult){
  const def = fault ? DEALER_ERRORS[fault.errorType] : null;
  return {
    errorType: fault ? fault.errorType : null,
    errorLabel: def ? def.label : null,
    situation: def ? def.description : null,
    prompt: taskResult ? taskResult.prompt : null,
    givenLabel: taskResult && taskResult.reviewRecord ? taskResult.reviewRecord.givenLabel : null,
    expectedLabel: taskResult && taskResult.reviewRecord ? taskResult.reviewRecord.expectedLabel : null,
    feedback: taskResult ? taskResult.feedback : null,
    recoveryRuleSource: def && def.recovery ? def.recovery.ruleSource : null
  };
}

/* Recovery guidance is only returned when the rule is actually confirmed. */
function recoveryGuidance(errorType){
  const def = DEALER_ERRORS[errorType];
  if(!def || !def.recovery) return null;
  if(def.recovery.ruleSource !== RULE_SOURCE.CONFIRMED) return null;
  return def.recovery;
}
function unconfirmedRecoveries(){
  return Object.keys(DEALER_ERRORS)
    .filter(k => DEALER_ERRORS[k].recovery && DEALER_ERRORS[k].recovery.ruleSource !== RULE_SOURCE.CONFIRMED)
    .map(k => ({ errorType:k, ruleSource:DEALER_ERRORS[k].recovery.ruleSource, note:DEALER_ERRORS[k].recovery.note }));
}

function registerError(name, def){ DEALER_ERRORS[name] = def; }
function errorTypeNames(){ return Object.keys(DEALER_ERRORS); }

exports.RULE_SOURCE = RULE_SOURCE;
exports.DEALER_ERRORS = DEALER_ERRORS;
exports.ERROR_TRAINING_CONFIG = ERROR_TRAINING_CONFIG;
exports.chooseError = chooseError;
exports.detectionTaskFor = detectionTaskFor;
exports.errorReviewRecord = errorReviewRecord;
exports.recoveryGuidance = recoveryGuidance;
exports.unconfirmedRecoveries = unconfirmedRecoveries;
exports.registerError = registerError;
exports.errorTypeNames = errorTypeNames;

})(typeof module !== 'undefined' ? module.exports : (window.RailErrors = window.RailErrors || {}));
