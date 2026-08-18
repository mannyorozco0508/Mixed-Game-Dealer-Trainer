/* ============================================================
   training-modes.js — Learn / Guided / Practice / Table Ready

   ONE configuration object drives every difference between modes. No
   `if (mode === 'learn')` checks scattered through rendering: callers ask
   this module a question ("should I show a hint?", "does this task belong
   in this mode?") and it answers from config.

   CONTENT IS NEVER DUPLICATED. A single task definition is presented four
   different ways. Mode changes what the trainee SEES and which tasks are
   SELECTED — it never changes what is true.

   Works in Node (require) and the browser (window.RailModes).
   ============================================================ */
(function(exports){

const MODES = {
  learn: {
    id: 'learn',
    label: 'Learn',
    order: 1,
    blurb: 'Teaches the game step by step. Mistakes explain rather than penalize.',
    // Presentation
    showHints: true,
    showInstruction: true,      // "NEXT: burn one card, then deal the flop"
    explanationLength: 'full',  // full reasoning on correct answers too
    showAnswerChoices: true,
    // Content selection
    difficultyRange: [1, 1],
    allowMoneyTasks: true,
    moneyDifficultyMax: 1,
    // Errors
    errorsEnabled: false,
    errorFrequency: 0,
    errorTypes: [],
    // Feel
    actionPaceMs: [600, 900],   // slower so a learner can follow
    strictScoring: false
  },

  guided: {
    id: 'guided',
    label: 'Guided Practice',
    order: 2,
    blurb: 'Real hands with hints and strong dealer cues.',
    showHints: true,
    showInstruction: false,
    explanationLength: 'full',
    showAnswerChoices: true,
    difficultyRange: [1, 2],
    allowMoneyTasks: true,
    moneyDifficultyMax: 2,
    errorsEnabled: false,
    errorFrequency: 0,
    errorTypes: [],
    actionPaceMs: [450, 750],
    strictScoring: false
  },

  practice: {
    id: 'practice',
    label: 'Practice',
    order: 3,
    blurb: 'The standard table. Fewer hints, real money decisions.',
    showHints: false,           // available on request, not shown by default
    hintsOnRequest: true,
    showInstruction: false,
    explanationLength: 'short',
    showAnswerChoices: true,
    difficultyRange: [1, 3],
    allowMoneyTasks: true,
    moneyDifficultyMax: 3,
    errorsEnabled: true,
    errorFrequency: 0.12,       // occasional
    errorTypes: ['wrong-recipient', 'action-out-of-turn'],
    actionPaceMs: [350, 650],
    strictScoring: true
  },

  tableReady: {
    id: 'tableReady',
    label: 'Table Ready',
    order: 4,
    blurb: 'The box. Minimal help, harder decisions, errors happen.',
    showHints: false,
    hintsOnRequest: false,
    showInstruction: false,
    explanationLength: 'minimal',
    showAnswerChoices: true,
    // Fundamentals are NOT hidden from Table Ready just because they are
    // difficulty 1 — a dealer still has to get the basics right under pressure.
    difficultyRange: [1, 4],
    allowMoneyTasks: true,
    moneyDifficultyMax: 4,
    errorsEnabled: true,
    errorFrequency: 0.25,       // realistic, still far from every hand
    errorTypes: null,           // null = all registered types
    actionPaceMs: [300, 550],
    strictScoring: true
  }
};

const DEFAULT_MODE = 'practice';
const STORAGE_KEY = 'railTrainingMode';
const ONBOARDING_KEY = 'railOnboardingComplete';

/* Unknown ids fall back safely rather than throwing. */
function getMode(id){
  return MODES[id] || MODES[DEFAULT_MODE];
}
function modeIds(){
  return Object.keys(MODES).sort((a,b) => MODES[a].order - MODES[b].order);
}
function allModes(){
  return modeIds().map(id => MODES[id]);
}

/* ---------- Content selection ----------
   A task with no difficulty defaults to 1 so legacy content is never
   accidentally filtered out of any mode. */
function taskDifficulty(task){
  return (task && typeof task.difficulty === 'number') ? task.difficulty : 1;
}
function taskAllowedInMode(task, modeId){
  const m = getMode(modeId);
  const d = taskDifficulty(task);
  if(d < m.difficultyRange[0] || d > m.difficultyRange[1]) return false;
  const isMoney = !!(task && task.taskType === 'numeric-amount');
  if(isMoney){
    if(!m.allowMoneyTasks) return false;
    if(d > m.moneyDifficultyMax) return false;
  }
  return true;
}

/* ---------- Presentation ---------- */
function shouldShowHint(modeId, requested){
  const m = getMode(modeId);
  if(m.showHints) return true;
  return !!(m.hintsOnRequest && requested);
}
function shouldShowInstruction(modeId){
  return getMode(modeId).showInstruction === true;
}

/* Shapes feedback text by mode WITHOUT changing what is correct. */
function presentFeedback(modeId, result){
  const m = getMode(modeId);
  const full = result && result.feedback ? result.feedback : '';
  if(result && result.correct){
    if(m.explanationLength === 'minimal') return 'Correct';
    if(m.explanationLength === 'short') return full ? full.split('.')[0] + '.' : 'Correct';
    return full || 'Correct';
  }
  // A wrong answer always explains, in every mode — that is the teaching moment.
  return full;
}

/* ---------- Errors ----------
   Produces the config object dealer-errors.js expects. Frequency lives in
   the MODE, never hardwired inside the error module. */
function errorConfigForMode(modeId, allTypes){
  const m = getMode(modeId);
  return {
    enabled: m.errorsEnabled,
    frequency: m.errorFrequency,
    allowedTypes: m.errorTypes === null ? (allTypes || []) : m.errorTypes.slice(),
    deterministicType: null
  };
}

/* ---------- Pacing ---------- */
function actionDelay(modeId, rng){
  const m = getMode(modeId);
  const [lo, hi] = m.actionPaceMs;
  const r = typeof rng === 'function' ? rng() : Math.random();
  return Math.round(lo + r * (hi - lo));
}

/* ---------- Persistence ----------
   Storage is injected so tests never depend on a browser. */
function loadMode(storage){
  try {
    const saved = storage && storage.getItem(STORAGE_KEY);
    return MODES[saved] ? saved : DEFAULT_MODE;
  } catch(e){ return DEFAULT_MODE; }
}
function saveMode(storage, modeId){
  try {
    if(MODES[modeId] && storage) storage.setItem(STORAGE_KEY, modeId);
  } catch(e){ /* storage unavailable — mode simply won't persist */ }
}
function isOnboardingComplete(storage){
  try { return !!(storage && storage.getItem(ONBOARDING_KEY) === 'true'); }
  catch(e){ return false; }
}
function setOnboardingComplete(storage, value){
  try { if(storage) storage.setItem(ONBOARDING_KEY, value ? 'true' : 'false'); }
  catch(e){ /* ignore */ }
}

/* ---------- Onboarding content ----------
   Four short cards. Deliberately not a slideshow. */
const ONBOARDING_CARDS = [
  { title: 'Welcome to The Rail',
    body: 'Learn poker dealing by actually dealing.' },
  { title: 'Run real hands',
    body: 'Cards, action, pots and showdowns behave like a live table \u2014 not a quiz.' },
  { title: "You're the dealer",
    body: 'The Rail pauses mid-hand and asks you to make the dealer\u2019s decision.' },
  { title: 'Choose your level',
    body: 'You can change this any time.', isModePicker: true }
];

// New dealers get a recommendation, never a forced path.
const RECOMMENDED_START = { game: "Texas Hold'em", mode: 'learn' };

exports.MODES = MODES;
exports.DEFAULT_MODE = DEFAULT_MODE;
exports.STORAGE_KEY = STORAGE_KEY;
exports.ONBOARDING_KEY = ONBOARDING_KEY;
exports.ONBOARDING_CARDS = ONBOARDING_CARDS;
exports.RECOMMENDED_START = RECOMMENDED_START;
exports.getMode = getMode;
exports.modeIds = modeIds;
exports.allModes = allModes;
exports.taskDifficulty = taskDifficulty;
exports.taskAllowedInMode = taskAllowedInMode;
exports.shouldShowHint = shouldShowHint;
exports.shouldShowInstruction = shouldShowInstruction;
exports.presentFeedback = presentFeedback;
exports.errorConfigForMode = errorConfigForMode;
exports.actionDelay = actionDelay;
exports.loadMode = loadMode;
exports.saveMode = saveMode;
exports.isOnboardingComplete = isOnboardingComplete;
exports.setOnboardingComplete = setOnboardingComplete;

})(typeof module !== 'undefined' ? module.exports : (window.RailModes = window.RailModes || {}));
