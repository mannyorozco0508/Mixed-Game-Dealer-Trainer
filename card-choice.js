/* ============================================================
   card-choice.js — Human non-betting card decisions

   ONE selection engine serves every game that asks a player to release
   cards. Games differ only in configuration (how many, which slots are
   eligible, whether standing Pat is offered) — never in click handling.

   WHAT THIS COVERS: games whose DEAL_PATTERNS contain a real card removal
   (a discardKeep rule). Those are the only decisions the simulation can
   actually carry out today.

   WHAT IT DOES NOT COVER: triple-draw and Drawmaha draws. Their hole
   counts are flat across every street, which means the engine never
   removes or replaces a card during a draw — the draws exist only as
   narrative scenario steps. Collecting a human draw there needs real
   draw mechanics in the dealing engine first, so those games stay PARTIAL
   rather than being given a selection UI that quietly does nothing.

   Works in Node (require) and the browser (window.RailCardChoice).
   ============================================================ */
(function(exports){

const MODE = { DISCARD:'discard', PAT_OR_DISCARD:'pat-or-discard', DRAW:'draw' };

/* ---------- Per-game configuration ----------
   mandatoryKeep: slots the rule forces the player to retain (for Super
   Stud the face-up card cannot be discarded). eligible slots are the ones
   the human actually chooses among. */
const CHOICE_RULES = {
  superStud: {
    step: 2,
    mode: MODE.PAT_OR_DISCARD,
    discardCount: 2,
    handSize: 5,
    mandatoryKeep: [4],          // the exposed fifth card always stays
    patKeepsAll: true,
    label: 'Super Pat, or select 2 cards to discard',
    patLabel: 'SUPER PAT',
    helpText: 'You may keep all five cards (Super Pat) and take no more cards, or discard two of your face-down cards.'
  },
  pineapple: {
    step: 1,
    mode: MODE.DISCARD,
    discardCount: 1,
    handSize: 3,
    mandatoryKeep: [],
    label: 'Select 1 card to discard',
    helpText: 'You must discard one card before any betting.'
  },
  crazyPineapple: {
    step: 5,
    mode: MODE.DISCARD,
    discardCount: 1,
    handSize: 3,
    mandatoryKeep: [],
    label: 'Select 1 card to discard',
    helpText: 'You must discard one card after the flop betting round.'
  }
};

function ruleFor(dealCat, step){
  const r = CHOICE_RULES[dealCat];
  if(!r) return null;
  if(step !== undefined && step !== null && r.step !== step) return null;
  return r;
}
function hasChoiceAt(dealCat, step){ return !!ruleFor(dealCat, step); }
function gamesWithChoice(){ return Object.keys(CHOICE_RULES); }

/* Slots the human may choose among (hand size minus anything forced to stay). */
function eligibleSlots(rule, handSize){
  const size = handSize || (rule && rule.handSize) || 0;
  const forced = (rule && rule.mandatoryKeep) || [];
  const out = [];
  for(let i = 0; i < size; i++) if(forced.indexOf(i) === -1) out.push(i);
  return out;
}

/* ---------- Selection session ----------
   generation guards against a stale confirm from an abandoned hand. */
function beginCardChoice(opts){
  const o = opts || {};
  const rule = o.rule;
  return {
    dealCat: o.dealCat,
    rule: rule,
    generation: o.generation || 0,
    handSize: o.handSize || (rule && rule.handSize) || 0,
    eligible: eligibleSlots(rule, o.handSize),
    selected: [],
    pat: false,
    confirmed: false,
    cancelled: false
  };
}

/* Toggling is the only way selection changes — ineligible slots are inert. */
function toggleSlot(session, slot){
  if(!session || session.confirmed || session.cancelled) return session;
  if(session.pat) return session;                       // Pat means no discards
  if(session.eligible.indexOf(slot) === -1) return session;
  const i = session.selected.indexOf(slot);
  if(i === -1) session.selected.push(slot);
  else session.selected.splice(i, 1);
  session.selected.sort((a,b) => a - b);
  return session;
}

function declarePat(session, on){
  if(!session || session.confirmed || session.cancelled) return session;
  if(!session.rule || session.rule.mode !== MODE.PAT_OR_DISCARD) return session;
  session.pat = on !== false;
  if(session.pat) session.selected = [];               // Pat discards nothing
  return session;
}

/* The rule, not the UI, decides whether a selection may be submitted. */
function isValid(session){
  if(!session || !session.rule || session.cancelled) return false;
  if(session.pat) return session.rule.mode === MODE.PAT_OR_DISCARD;
  // A draw accepts ANY count including zero — standing pat is a legal draw.
  if(session.rule.mode === MODE.DRAW || session.rule.discardCount === null){
    return session.selected.length <= session.handSize;
  }
  return session.selected.length === session.rule.discardCount;
}

function statusText(session){
  if(!session || !session.rule) return '';
  if(session.pat) return 'Standing pat — no cards discarded';
  if(session.rule.mode === MODE.DRAW || session.rule.discardCount === null){
    const n = session.selected.length;
    return n === 0 ? 'Standing pat — tap cards to replace them'
                   : 'Replacing ' + n + ' card' + (n === 1 ? '' : 's');
  }
  return 'Selected: ' + session.selected.length + ' of ' + session.rule.discardCount;
}

/* Resolves the choice into the keep-slots the dealing engine consumes.
   Returns null if invalid or stale, so nothing can mutate the hand. */
function confirmChoice(session, currentGeneration){
  if(!isValid(session)) return null;
  if(currentGeneration !== undefined && session.generation !== currentGeneration) return null;

  session.confirmed = true;
  if(session.pat){
    const all = [];
    for(let i = 0; i < session.handSize; i++) all.push(i);
    return { pat:true, keepSlots: all, discardSlots: [] };
  }
  const discard = session.selected.slice();
  const keep = [];
  for(let i = 0; i < session.handSize; i++) if(discard.indexOf(i) === -1) keep.push(i);
  return { pat:false, keepSlots: keep, discardSlots: discard };
}

function cancelChoice(session){
  if(!session) return session;
  session.cancelled = true;
  session.selected = [];
  session.pat = false;
  return session;
}

/* ---------- Help and coach text (rules only, never strategy) ---------- */
function choiceHelp(rule){
  return rule ? rule.helpText : '';
}
function choiceCoach(session, isHuman){
  if(!session || !session.rule) return '';
  const who = isHuman ? 'The player' : 'The player';
  if(session.pat){
    return who + ' declared Super Pat and receives no more cards. The dealer skips them on every later street.';
  }
  if(session.confirmed){
    const n = session.selected.length;
    return 'Discarding ' + n + '. The dealer collects those cards into the muck.';
  }
  return 'The dealer is waiting for the discard before continuing.';
}

/* ---------- Support classification ----------
   FULL requires that EVERY player decision the game asks for is under human
   control. A game whose draws are not modelled cannot be FULL, regardless
   of how good its betting support is. */
function decisionsCovered(dealCat){
  const covered = [];
  const missing = [];
  if(CHOICE_RULES[dealCat]) covered.push('discard');
  // Draw games are handled by draw-engine.js, which performs the real
  // discard/replacement mutation, so the decision is genuinely covered.
  if(dealCat === 'draw4' || dealCat === 'draw5' || dealCat === 'drawmaha'){
    covered.push('draw');
  }
  return { covered, missing };
}

exports.MODE = MODE;
exports.CHOICE_RULES = CHOICE_RULES;
exports.ruleFor = ruleFor;
exports.hasChoiceAt = hasChoiceAt;
exports.gamesWithChoice = gamesWithChoice;
exports.eligibleSlots = eligibleSlots;
exports.beginCardChoice = beginCardChoice;
exports.toggleSlot = toggleSlot;
exports.declarePat = declarePat;
exports.isValid = isValid;
exports.statusText = statusText;
exports.confirmChoice = confirmChoice;
exports.cancelChoice = cancelChoice;
exports.choiceHelp = choiceHelp;
exports.choiceCoach = choiceCoach;
exports.decisionsCovered = decisionsCovered;

})(typeof module !== 'undefined' ? module.exports : (window.RailCardChoice = window.RailCardChoice || {}));
