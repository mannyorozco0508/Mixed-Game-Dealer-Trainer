/* ============================================================
   player-mode.js — Play & Learn (human sits in one seat)

   ARCHITECTURE RULE: this does NOT contain a second poker engine. The human
   simply replaces ONE AI seat. Whose turn it is, which actions are legal,
   what a call costs, and who wins are all still answered by table-action,
   money-state, betting-engine and showdown. This module decides only:
     - which seat is human
     - whether the AI is allowed to act for it (never)
     - what to show the human, and what to explain

   SUPPORT IS HONEST. Games needing a draw/discard/Pat decision that the
   engine cannot yet collect from a human are reported PARTIAL, not FULL.

   Works in Node (require) and the browser (window.RailPlayer).
   ============================================================ */
(function(exports){

const EXPERIENCE = { DEALER_TRAINING:'dealer-training', PLAY_AND_LEARN:'play-and-learn' };

/* ---------- Support matrix ----------
   Derived from what the simulation can actually collect from a human.

   FULL    = every decision the game asks of a player is a betting decision,
             which the existing action pipeline already supports.
   PARTIAL = the game additionally requires a draw, discard or Pat choice.
             Betting works; that extra decision is not yet collectible from
             a human, so the AI default stands in for it. */
const PLAYER_SUPPORT = {
  // --- Pure betting games: fully playable now ---
  holdem:      { level:'FULL', family:'button-betting' },
  bigO:        { level:'FULL', family:'button-betting' },
  doubleBoard: { level:'FULL', family:'button-betting' },
  drawmaha:    { level:'PARTIAL', family:'button-betting',
                 missing:'Drawmaha includes a draw. Betting is fully playable; the draw selection is not yet collected from a human.' },
  studSplit:   { level:'FULL', family:'stud-betting' },

  // --- Games with a non-betting decision the engine cannot yet collect ---
  draw4:       { level:'PARTIAL', family:'draw-discard',
                 missing:'Triple-draw discard selection is not yet collected from a human player.' },
  draw5:       { level:'PARTIAL', family:'draw-discard',
                 missing:'Triple-draw discard selection is not yet collected from a human player.' },
  superStud:   { level:'PARTIAL', family:'stud-betting',
                 missing:'The Super Pat / discard-two decision is not yet collected from a human player.' },
  pineapple:   { level:'PARTIAL', family:'button-betting',
                 missing:'The pre-flop discard is not yet collected from a human player.' },
  crazyPineapple:{ level:'PARTIAL', family:'button-betting',
                 missing:'The post-flop discard is not yet collected from a human player.' }
};

function supportFor(dealCat){
  return PLAYER_SUPPORT[dealCat] || { level:'UNSUPPORTED', family:'unknown',
    missing:'No player-mode configuration for this game type.' };
}

/* ---------- Human seat ---------- */
function createPlayerSession(opts){
  const o = opts || {};
  return {
    experience: EXPERIENCE.PLAY_AND_LEARN,
    humanSeat: (o.humanSeat === undefined || o.humanSeat === null) ? null : o.humanSeat,
    playerHelp: o.playerHelp !== false,
    dealerCoach: o.dealerCoach !== false,
    folded: false,
    watching: false     // true once the human folds; the hand plays on
  };
}

// Picks a sensible seat so seat-selection UI is never a blocker.
function assignHumanSeat(tableSeats, sitOutSeat, preferred){
  if(preferred !== undefined && preferred !== null &&
     preferred !== sitOutSeat && preferred < tableSeats) return preferred;
  for(let i = 0; i < tableSeats; i++) if(i !== sitOutSeat) return i;
  return null;
}

/* THE critical guard: the AI must never act for the human seat. */
function isAiControlled(session, seat){
  if(!session || session.experience !== EXPERIENCE.PLAY_AND_LEARN) return true;
  return seat !== session.humanSeat;
}
function isHumanTurn(session, currentActor){
  if(!session || session.experience !== EXPERIENCE.PLAY_AND_LEARN) return false;
  if(session.folded) return false;
  return currentActor === session.humanSeat;
}

/* ---------- Legal human actions ----------
   Built from the authoritative round and money state — never invented here,
   and never showing an action the engine would reject. */
function humanActions(round, ms, seat, step, deps){
  if(!round || round.complete || round.current !== seat) return [];
  const A = deps && deps.action;
  const M = deps && deps.money;
  if(!A || !M) return [];

  const legal = A.legalActions(round);
  const out = [];
  const stack = ms ? (ms.stacks[seat] || 0) : 0;

  legal.forEach(a => {
    if(a === 'check'){
      out.push({ action:'check', label:'CHECK', amount:0 });
    } else if(a === 'fold'){
      out.push({ action:'fold', label:'FOLD', amount:0 });
    } else if(a === 'call'){
      const owed = M.callAmount(ms, seat);
      if(owed <= 0) return;                       // nothing to call
      const allIn = owed >= stack;
      out.push({ action:'call', label: allIn ? 'ALL-IN $' + Math.min(owed, stack) : 'CALL $' + owed,
                 amount: Math.min(owed, stack), allIn });
    } else if(a === 'bet'){
      const size = M.betSizeForStreet(ms, step);
      const amount = size === null ? M.maxRaiseTo(ms, seat, step) : size;
      if(amount <= 0 || stack <= 0) return;
      const allIn = amount >= stack;
      out.push({ action:'bet', label: allIn ? 'ALL-IN $' + stack : 'BET $' + amount,
                 amount: Math.min(amount, stack), allIn });
    } else if(a === 'raise'){
      const target = M.minRaiseTo(ms, step);
      const owed = target - (ms.streetContrib[seat] || 0);
      if(owed <= 0 || stack <= 0) return;
      const allIn = owed >= stack;
      out.push({ action:'raise', label: allIn ? 'ALL-IN $' + stack : 'RAISE TO $' + target,
                 amount: Math.min(owed, stack), to: target, allIn });
    }
  });
  return out;
}

/* Rejects anything not currently offered — a wrong tap can never mutate state. */
function isLegalHumanAction(round, ms, seat, step, action, deps){
  return humanActions(round, ms, seat, step, deps).some(a => a.action === action);
}

/* ---------- Player Help ----------
   Explains MECHANICS ONLY. Never strategy: no "should", no odds, no
   hand recommendations. Tested against a prohibited-phrase list. */
const HELP_BY_FAMILY = {
  'button-betting': {
    deal: 'Your hole cards stay hidden from the other players.',
    action: 'Calling matches the current wager. Checking passes the action when nothing is owed.',
    showdown: 'The best five-card hand wins.'
  },
  'stud-betting': {
    deal: 'Some of your cards are dealt face up. Everyone can see those.',
    action: 'On later streets the exposed cards decide who acts first, not a button.',
    showdown: 'The best five-card hand wins.'
  },
  'draw-discard': {
    deal: 'All of your cards are hidden from the other players.',
    action: 'Between betting rounds you get chances to exchange cards.',
    showdown: 'The hand you finish with after the last draw is the one that plays.'
  }
};

const HELP_BY_GAME = {
  bigO:        { deal:'You have five hole cards. At showdown you must use exactly two of them plus exactly three board cards.',
                 showdown:'Exactly two hole cards and exactly three board cards — no other combination is legal.' },
  doubleBoard: { deal:'Two boards are dealt. Each is played for high, and the pot is divided between them.',
                 showdown:'Top board and bottom board are scored separately, both for high.' },
  studSplit:   { action:'The exposed cards determine action order on every street after the bring-in.' },
  superStud:   { deal:'You receive four cards down and one face up. You may keep all five (Super Pat) or discard two.',
                 showdown:'Your hand plays for both the high and the eight-or-better low.' }
};

// Hi-lo games get an extra note about the qualifier.
const HILO_GAMES = ['Big O Hi-Lo','Super Stud Hi-Lo 8 / Super Pat','Stud Hi-Lo / 8-or-Better'];

function playerHelp(session, ctx){
  if(!session || !session.playerHelp) return '';
  const support = supportFor(ctx && ctx.dealCat);
  const phase = (ctx && ctx.phase) || 'action';
  const byGame = HELP_BY_GAME[ctx && ctx.dealCat] || {};
  const byFamily = HELP_BY_FAMILY[support.family] || {};
  let text = byGame[phase] || byFamily[phase] || '';

  if(phase === 'showdown' && ctx && HILO_GAMES.indexOf(ctx.gameName) !== -1){
    text += (text ? ' ' : '') +
      'A low must be eight-high or better to qualify. If no low qualifies, the high hand takes the whole pot.';
  }
  if(ctx && ctx.gameName === 'Razz' && phase !== ''){
    text = 'In Razz the lowest hand wins. Straights and flushes do not count against you, and the ace plays low.';
  }
  return text;
}

/* ---------- Dealer Coach ----------
   Derived entirely from live state — no scripted commentary. */
function dealerCoach(session, state){
  if(!session || !session.dealerCoach || !state) return '';
  const P = n => 'Player ' + (n + 1);
  const you = seat => (seat === session.humanSeat ? 'you' : P(seat));

  if(state.showdown){
    return 'Action is finished. The dealer reads the hands and pushes the pot.';
  }
  if(state.roundComplete){
    return state.hasNextStreet
      ? 'Action is complete. The dealer burns and deals the next street.'
      : 'Action is complete. The hand goes to showdown.';
  }
  if(state.currentActor === null || state.currentActor === undefined){
    return 'Waiting for the next street.';
  }

  const bits = [];
  bits.push(state.currentActor === session.humanSeat
    ? 'Action is on you. The dealer is waiting for your decision.'
    : 'Action is on ' + P(state.currentActor) + '.');

  if(state.allInSeats && state.allInSeats.length){
    bits.push(state.allInSeats.map(you).join(' and ') +
      (state.allInSeats.length > 1 ? ' are' : ' is') +
      ' all-in and no longer owes action.');
  }
  if(state.sidePotCount && state.sidePotCount > 1){
    bits.push('Different amounts are committed, so the dealer needs ' +
      (state.sidePotCount - 1) + ' side pot' + (state.sidePotCount > 2 ? 's' : '') + '.');
  }
  if(state.bringInSeat !== null && state.bringInSeat !== undefined && state.street === 0){
    bits.push(P(state.bringInSeat) + ' has the bring-in.');
  }
  return bits.join(' ');
}

/* Optional deeper explanation, still read from state. */
function coachWhy(session, state){
  if(!state) return '';
  const P = n => 'Player ' + (n + 1);
  if(state.roundComplete){
    return 'Every live player has now matched the current wager, so the betting round is closed.';
  }
  if(state.currentActor === null || state.currentActor === undefined) return '';
  const skipped = [];
  (state.foldedSeats || []).forEach(s => skipped.push(P(s) + ' folded'));
  (state.allInSeats || []).forEach(s => skipped.push(P(s) + ' is all-in'));
  return skipped.length
    ? skipped.join(', ') + ', so action skips those seats and moves to ' + P(state.currentActor) + '.'
    : 'The seats before ' + P(state.currentActor) + ' have already acted this round.';
}

/* ---------- Human showdown result ---------- */
function humanResult(session, showdown, payoutForSeat){
  if(!session || !showdown || !showdown.ok) return '';
  const seat = session.humanSeat;
  if(session.folded) return 'You folded. Your hand was dead for this pot.';

  const wonSides = showdown.sides.filter(s => s.winners.indexOf(seat) !== -1);
  if(wonSides.length === 0){
    const hi = showdown.sides.find(s => s.key === 'high' || s.key === 'omaha');
    const winner = hi && hi.winners.length ? hi.winners[0] : null;
    const res = winner !== null ? hi.results.find(r => r.seat === winner) : null;
    return res ? 'You lose to ' + res.label + '.' : 'You did not win this pot.';
  }
  if(showdown.isScoop && showdown.winners.indexOf(seat) !== -1) return 'You scoop.';

  return wonSides.map(s => {
    const mine = s.results.find(r => r.seat === seat);
    const shared = s.winners.length > 1 ? ' (split)' : '';
    const label = s.key === 'low' ? 'You win low' : 'You win';
    return label + shared + (mine && mine.label ? ' with ' + mine.label : '') + '.';
  }).join(' ');
}

/* ---------- Preference persistence ---------- */
const HELP_KEY = 'railPlayerHelp';
const COACH_KEY = 'railDealerCoach';
function loadPrefs(storage){
  const read = (k, dflt) => {
    try { const v = storage && storage.getItem(k); return v === null || v === undefined ? dflt : v === 'true'; }
    catch(e){ return dflt; }
  };
  return { playerHelp: read(HELP_KEY, true), dealerCoach: read(COACH_KEY, true) };
}
function savePrefs(storage, prefs){
  try {
    if(!storage || !prefs) return;
    storage.setItem(HELP_KEY, prefs.playerHelp ? 'true' : 'false');
    storage.setItem(COACH_KEY, prefs.dealerCoach ? 'true' : 'false');
  } catch(e){ /* storage unavailable */ }
}

exports.EXPERIENCE = EXPERIENCE;
exports.PLAYER_SUPPORT = PLAYER_SUPPORT;
exports.supportFor = supportFor;
exports.createPlayerSession = createPlayerSession;
exports.assignHumanSeat = assignHumanSeat;
exports.isAiControlled = isAiControlled;
exports.isHumanTurn = isHumanTurn;
exports.humanActions = humanActions;
exports.isLegalHumanAction = isLegalHumanAction;
exports.playerHelp = playerHelp;
exports.dealerCoach = dealerCoach;
exports.coachWhy = coachWhy;
exports.humanResult = humanResult;
exports.loadPrefs = loadPrefs;
exports.savePrefs = savePrefs;

})(typeof module !== 'undefined' ? module.exports : (window.RailPlayer = window.RailPlayer || {}));
