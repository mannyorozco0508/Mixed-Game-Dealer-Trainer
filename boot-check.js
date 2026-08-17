/* ============================================================
   boot-check.js — Startup verification for The Rail

   WHY THIS EXISTS: a missing or misnamed module file used to fail silently.
   The browser would 404 the script, every other module would load fine, and
   the app would look normal — right up until a hand reached the code path
   that needed it, then throw an error a dealer could not interpret.

   This module runs BEFORE any hand can start and answers one question:
   is every required capability actually present and callable?

   It checks CONTRACTS, not just presence. A global existing is not the same
   as the function the app depends on existing on it.

   Load this LAST, after every other module.
   Works in Node (require) and the browser (window.RailBoot).
   ============================================================ */
(function(exports){

/* ---------- Module registry ----------
   filename is what a person must upload; global is what it must publish;
   requires lists the globals that must already exist for it to work;
   provides lists the functions the app actually calls. */
const REQUIRED_MODULES = [
  { filename:'cards-eval.js',     global:'RailCards',     requires:[],
    provides:['freshDeck','evaluate5High','bestOmahaHigh','bestBadugi','qualifiesEightLow'],
    role:'Hand evaluation — card rankings for every game' },

  { filename:'betting-engine.js', global:'RailBetting',   requires:[],
    provides:['potLimitMaxTotalWager','buildSidePots','splitPotHiLo'],
    role:'Pot math — pot-limit sizing and side pots' },

  { filename:'ai-players.js',     global:'RailAI',        requires:[],
    provides:['decideAction','classifyHigh','TIER','ACTION'],
    role:'Player decisions — hand strength and action choice' },

  { filename:'showdown.js',       global:'RailShowdown',  requires:['RailCards'],
    provides:['evaluateShowdown','SHOWDOWN_RULES'],
    role:'Showdown — who wins each pot' },

  { filename:'table-action.js',   global:'RailAction',    requires:['RailAI','RailCards'],
    provides:['createRound','applyAction','firstActor','chooseAction','tierForSeat'],
    role:'Action order — whose turn it is and what is legal' },

  { filename:'money-state.js',    global:'RailMoney',     requires:['RailBetting'],
    provides:['createMoneyState','callAmount','applyMoneyAction','awardPots','HOUSE_RULES'],
    role:'Chips — stacks, pots and payouts' },

  { filename:'dealer-tasks.js',   global:'RailTasks',     requires:[],
    provides:['buildDealerTaskState','validateDealerTask','typeOf'],
    role:'Training tasks — dynamic questions from live state' },

  { filename:'money-tasks.js',    global:'RailMoneyTasks',requires:[],
    provides:['callAmountForActor','potAmountTask','sidePotEligibilityTask'],
    role:'Money training — call amounts, pots, side pots' },

  { filename:'dealer-errors.js',  global:'RailErrors',    requires:[],
    provides:['chooseError','detectionTaskFor','ERROR_TRAINING_CONFIG'],
    role:'Error training — dealer mistakes and detection' },

  { filename:'training-modes.js', global:'RailModes',     requires:[],
    provides:['getMode','taskAllowedInMode','errorConfigForMode','loadMode'],
    role:'Training modes — Learn through Table Ready' },

  { filename:'chip-render.js',    global:'RailChips',     requires:[],
    provides:['breakdown','layout','renderStack','renderWager','renderPot','chipsFromMoneyState'],
    role:'Chip visuals — stacks, wagers and pot' },

  { filename:'player-mode.js',    global:'RailPlayer',    requires:[],
    provides:['createPlayerSession','isAiControlled','humanActions','playerHelp','dealerCoach','supportFor'],
    role:'Play & Learn — sitting in a player seat' },

  { filename:'card-choice.js',    global:'RailCardChoice', requires:[],
    provides:['ruleFor','beginCardChoice','toggleSlot','declarePat','isValid','confirmChoice'],
    role:'Player card decisions — discards and Super Pat' }
];

/* Verifies one module against its contract. scope is the object globals live
   on (window in the browser). Returns a structured result, never throws. */
function verifyModule(def, scope){
  const mod = scope ? scope[def.global] : undefined;

  if(mod === undefined || mod === null){
    return {
      filename: def.filename, global: def.global, role: def.role,
      ok: false, reason: 'missing',
      detail: def.filename + ' did not load. The file is missing from the repository, ' +
              'or its name does not match exactly (check hyphens vs underscores).'
    };
  }

  const missingFns = def.provides.filter(name => {
    const v = mod[name];
    return v === undefined || v === null;
  });
  if(missingFns.length){
    return {
      filename: def.filename, global: def.global, role: def.role,
      ok: false, reason: 'incomplete', missing: missingFns,
      detail: def.filename + ' loaded but is missing: ' + missingFns.join(', ') +
              '. The file is likely an older version — re-upload the current one.'
    };
  }

  const missingDeps = def.requires.filter(g => !scope || !scope[g]);
  if(missingDeps.length){
    const depFiles = missingDeps.map(g => {
      const d = REQUIRED_MODULES.find(m => m.global === g);
      return d ? d.filename : g;
    });
    return {
      filename: def.filename, global: def.global, role: def.role,
      ok: false, reason: 'unmet-dependency', missing: depFiles,
      detail: def.filename + ' needs ' + depFiles.join(' and ') +
              ', which did not load. It will fail partway through a hand.'
    };
  }

  return { filename: def.filename, global: def.global, role: def.role, ok: true };
}

/* Runs the full check. Never throws — a boot check that crashes is useless. */
function verifyBoot(scope){
  let results;
  try {
    results = REQUIRED_MODULES.map(def => verifyModule(def, scope));
  } catch(err){
    return {
      ok: false,
      results: [],
      failures: [{ filename:'(boot check)', ok:false, reason:'internal',
        detail:'The startup check itself failed: ' + err.message }],
      summary: 'Startup verification could not run.'
    };
  }
  const failures = results.filter(r => !r.ok);
  return {
    ok: failures.length === 0,
    results,
    failures,
    summary: failures.length === 0
      ? 'All ' + results.length + ' modules loaded.'
      : failures.length + ' of ' + results.length + ' modules failed to load correctly.'
  };
}

/* Plain-language report. No stack traces, no jargon — a dealer reading this
   should know exactly which file to fix. */
function describeFailures(report){
  if(!report || report.ok) return '';
  return report.failures.map(f => {
    const head = f.filename + (f.role ? ' — ' + f.role : '');
    return head + '\n' + f.detail;
  }).join('\n\n');
}

/* Filenames the person needs to add or re-upload, deduplicated. */
function filesToFix(report){
  if(!report || report.ok) return [];
  const out = [];
  report.failures.forEach(f => {
    if(f.reason === 'unmet-dependency'){
      (f.missing || []).forEach(n => { if(out.indexOf(n) === -1) out.push(n); });
    } else if(out.indexOf(f.filename) === -1){
      out.push(f.filename);
    }
  });
  return out;
}

exports.REQUIRED_MODULES = REQUIRED_MODULES;
exports.verifyModule = verifyModule;
exports.verifyBoot = verifyBoot;
exports.describeFailures = describeFailures;
exports.filesToFix = filesToFix;

})(typeof module !== 'undefined' ? module.exports : (window.RailBoot = window.RailBoot || {}));
