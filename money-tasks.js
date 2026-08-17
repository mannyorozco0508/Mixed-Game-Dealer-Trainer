/* ============================================================
   money-tasks.js — Reusable dynamic dealer money tasks

   Every task here is a TEMPLATE, not a question with an answer. Each one
   resolves from authoritative simulation state, so a single definition
   produces a different correct answer for every hand it appears in.

   NO POKER MATH LIVES HERE. Amounts come from money-state / betting-engine
   results carried on the frozen snapshot. If a number isn't on the snapshot,
   the task doesn't exist.

   difficulty: 1 = core dealer skill, 2 = intermediate, 3 = advanced.
   The difficulty UI is not built yet; the schema is simply ready for it.

   Works in Node (require) and the browser (window.RailMoneyTasks).
   ============================================================ */
(function(exports){

const P = seat => 'Player ' + (seat + 1);
const money = n => '$' + n;

/* ---------- CALL AMOUNTS (difficulty 1) ---------- */

// Asks what a specific seat owes. seatPicker chooses WHICH seat from live
// state, so the same template works for the big blind, the bring-in, or
// whoever action happens to be on.
function callAmountTask({ street, prompt, seatPicker, difficulty }){
  return {
    street: street || 'Betting',
    taskType: 'numeric-amount',
    difficulty: difficulty || 1,
    prompt: prompt,
    resolve: s => {
      const seat = seatPicker(s);
      return seat === null || seat === undefined ? null : s.callAmounts[seat];
    },
    explain: (s, given, expected, correct) => {
      const seat = seatPicker(s);
      if(seat === null || seat === undefined) return '';
      const already = s.streetContrib[seat] || 0;
      const base = P(seat) + ' already has ' + money(already) + ' in and the wager is ' +
                   money(s.currentBet) + ', so the call is the ' + money(expected) + ' difference.';
      return correct ? 'Correct — ' + base : base;
    }
  };
}

const callAmountForActor = callAmountTask({
  street: 'Betting',
  prompt: 'Action is on this player. How much do they owe to call?',
  seatPicker: s => s.currentActor,
  difficulty: 1
});

const callAmountForBigBlind = callAmountTask({
  street: 'Pre-Flop',
  prompt: 'How much does the big blind owe to call?',
  seatPicker: s => (s.buttonSeat === null || s.buttonSeat === undefined) ? null
    : (s.buttonSeat + 2) % 7,
  difficulty: 1
});

/* ---------- POT AMOUNT (difficulty 1) ---------- */
const potAmountTask = {
  street: 'Betting',
  taskType: 'numeric-amount',
  difficulty: 1,
  prompt: 'How much is in the pot?',
  resolve: s => {
    // Collected pot plus everything committed on the current street.
    const live = Object.keys(s.streetContrib).reduce((n, k) => n + s.streetContrib[k], 0);
    return (s.pot || 0) + live;
  },
  explain: (s, given, expected, correct) => {
    const live = Object.keys(s.streetContrib).reduce((n, k) => n + s.streetContrib[k], 0);
    const parts = [];
    if(s.pot) parts.push(money(s.pot) + ' collected from earlier streets');
    if(live) parts.push(money(live) + ' committed on this street');
    const base = parts.length ? parts.join(' plus ') + ' makes ' + money(expected) + '.'
                              : 'The pot is ' + money(expected) + '.';
    return correct ? 'Correct — ' + base : base;
  }
};

/* ---------- STUD COMPLETION (difficulty 1-2) ---------- */
const studCompletionOwedTask = {
  street: '3rd Street',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'The bring-in calls the completion. How much MORE do they put in?',
  resolve: s => (s.bringInSeat === null || s.bringInSeat === undefined) ? null
    : s.callAmounts[s.bringInSeat],
  explain: (s, given, expected, correct) => {
    const posted = s.streetContrib[s.bringInSeat] || 0;
    const base = 'The bring-in already has ' + money(posted) + ' in. Completion is TO ' +
      money(s.completionTo) + ' total, not on top of it, so they owe ' + money(expected) + ' more.';
    return correct ? 'Correct — ' + base : base;
  }
};

const completedWagerTask = {
  street: '3rd Street',
  taskType: 'numeric-amount',
  difficulty: 1,
  prompt: 'A player completes the bring-in. What is the completed wager?',
  resolve: s => s.completionTo,
  explain: (s, given, expected, correct) => {
    const base = 'Completion brings the wager TO ' + money(expected) +
      ' total — not the bring-in plus ' + money(expected) + '.';
    return correct ? 'Correct — ' + base : base;
  }
};

/* ---------- POT LIMIT (difficulty 2) ---------- */
const potLimitMaxTask = {
  street: 'Betting',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'This player says "POT." What is the maximum total wager?',
  // Comes straight off the snapshot, which the app fills from
  // money-state.maxRaiseTo() -> betting-engine.potLimitMaxTotalWager().
  resolve: s => (s.currentActor === null || s.currentActor === undefined) ? null
    : s.potLimitMax,
  explain: (s, given, expected, correct) => {
    const seat = s.currentActor;
    const toCall = s.callAmounts[seat] || 0;
    const potNow = (s.pot || 0) + Object.keys(s.streetContrib).reduce((n,k) => n + s.streetContrib[k], 0);
    const base = 'There is ' + money(potNow) + ' on the table. They first call ' + money(toCall) +
      ', then may raise by that new total — so the maximum total wager is ' + money(expected) + '.';
    return correct ? 'Correct — ' + base : base;
  }
};

/* ---------- UNCALLED RETURN (difficulty 2) ---------- */
const uncalledReturnTask = {
  street: 'Betting',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'The bet was not fully matched. How much is returned to the bettor?',
  resolve: s => s.uncalledReturn === undefined ? null : s.uncalledReturn,
  explain: (s, given, expected, correct) => {
    const base = expected > 0
      ? 'Only the matched portion stays in the pot. The unmatched ' + money(expected) +
        ' goes back to the bettor before the pot is collected.'
      : 'Every chip was matched, so nothing is returned.';
    return correct ? 'Correct — ' + base : base;
  }
};

/* ---------- SIDE POTS (difficulty 2-3) ---------- */
const mainPotAmountTask = {
  street: 'Showdown',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'How much is in the MAIN pot?',
  resolve: s => (s.sidePots && s.sidePots.length) ? s.sidePots[0].amount : null,
  explain: (s, given, expected, correct) => {
    const n = s.sidePots && s.sidePots[0] ? s.sidePots[0].eligiblePlayerIds.length : 0;
    const base = 'The main pot is capped at the shortest all-in, matched by every contender — ' +
      n + ' players funding it makes ' + money(expected) + '.';
    return correct ? 'Correct — ' + base : base;
  }
};

function sidePotAmountTask(layerIndex){
  return {
    street: 'Showdown',
    taskType: 'numeric-amount',
    difficulty: 3,
    prompt: 'How much is in SIDE POT ' + layerIndex + '?',
    resolve: s => (s.sidePots && s.sidePots[layerIndex]) ? s.sidePots[layerIndex].amount : null,
    explain: (s, given, expected, correct) => {
      const layer = s.sidePots && s.sidePots[layerIndex];
      const n = layer ? layer.eligiblePlayerIds.length : 0;
      const base = 'Side pot ' + layerIndex + ' holds only the chips above the previous all-in level, ' +
        'contested by the ' + n + ' players who put in that much — ' + money(expected) + '.';
      return correct ? 'Correct — ' + base : base;
    }
  };
}

function sidePotEligibilityTask(layerIndex){
  return {
    street: 'Showdown',
    taskType: 'select-seats',
    difficulty: 3,
    prompt: layerIndex === 0
      ? 'Tap every player eligible to win the MAIN pot, then Submit.'
      : 'Tap every player eligible to win SIDE POT ' + layerIndex + ', then Submit.',
    // Eligibility comes from the ENGINE's pot layers, never from stack size,
    // so folded contributors and all-in levels are handled correctly.
    resolve: s => (s.sidePots && s.sidePots[layerIndex])
      ? s.sidePots[layerIndex].eligiblePlayerIds.slice() : [],
    explain: (s, given, expected, correct) => {
      const exp = expected || [];
      const giv = given || [];
      const missed = exp.filter(x => giv.indexOf(x) === -1);
      const extra = giv.filter(x => exp.indexOf(x) === -1);
      if(correct){
        return 'Correct — ' + exp.map(P).join(' and ') + ' each funded this layer and are still live.';
      }
      const bits = [];
      if(extra.length) bits.push(extra.map(P).join(', ') +
        (extra.length > 1 ? ' are not eligible' : ' is not eligible') +
        ' — a player either folded or did not put in enough to reach this layer.');
      if(missed.length) bits.push('You missed ' + missed.map(P).join(', ') + '.');
      bits.push('Eligible: ' + (exp.length ? exp.map(P).join(', ') : 'nobody') + '.');
      return bits.join(' ');
    }
  };
}

/* ---------- FOLD vs ALL-IN (difficulty 2) ---------- */
const foldVsAllInTask = {
  street: 'Showdown',
  taskType: 'select-seats',
  difficulty: 2,
  prompt: 'Tap every player still eligible to win this pot, then Submit.',
  resolve: s => (s.sidePots && s.sidePots.length)
    ? s.sidePots[0].eligiblePlayerIds.slice() : s.activeSeats.slice(),
  explain: (s, given, expected, correct) => {
    const folded = s.foldedSeats || [];
    const allIn = s.allInSeats || [];
    const base = 'Chips a folded player put in stay in the pot, but they can never win it. ' +
      'An all-in player takes no more action yet REMAINS eligible for the layers they funded.' +
      (folded.length ? ' Folded: ' + folded.map(P).join(', ') + '.' : '') +
      (allIn.length ? ' All-in but live: ' + allIn.map(P).join(', ') + '.' : '');
    return correct ? 'Correct — ' + base : base;
  }
};

/* ---------- HI-LO PAYOUT (difficulty 2-3) ---------- */
const hiLoHighShareTask = {
  street: 'Showdown',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'How much of this pot goes to the HIGH side?',
  resolve: s => s.highShare === undefined ? null : s.highShare,
  explain: (s, given, expected, correct) => {
    const base = s.lowQualifies === false
      ? 'No hand qualifies for low, so there is no low half — the high winner takes the whole ' +
        money(expected) + '.'
      : 'With a qualifying low the pot splits in half, so ' + money(expected) + ' goes to high.';
    return correct ? 'Correct — ' + base : base;
  }
};

const hiLoLowShareTask = {
  street: 'Showdown',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'How much of this pot goes to the LOW side?',
  resolve: s => s.lowShare === undefined ? null : s.lowShare,
  explain: (s, given, expected, correct) => {
    const base = s.lowQualifies === false
      ? 'No qualifying low means nothing goes to low — the high winner scoops.'
      : 'The low half is ' + money(expected) + '. When the total is odd the extra chip goes to high.';
    return correct ? 'Correct — ' + base : base;
  }
};

const playerReceivesTask = seatPicker => ({
  street: 'Showdown',
  taskType: 'numeric-amount',
  difficulty: 3,
  prompt: 'How much does this player receive from the pot?',
  resolve: s => {
    const seat = seatPicker(s);
    return (seat === null || seat === undefined || !s.payouts) ? null : (s.payouts[seat] || 0);
  },
  explain: (s, given, expected, correct) => {
    const seat = seatPicker(s);
    const base = expected === 0
      ? P(seat) + ' receives nothing from this pot.'
      : P(seat) + ' receives ' + money(expected) + '.';
    return correct ? 'Correct — ' + base : base;
  }
});

/* ---------- DOUBLE BOARD (difficulty 2) ---------- */
const topBoardShareTask = {
  street: 'Showdown',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'How much of this pot goes to the TOP board?',
  resolve: s => s.topBoardShare === undefined ? null : s.topBoardShare,
  explain: (s, given, expected, correct) => {
    const base = 'The pot splits between the two high boards. ' +
      (s.bottomBoardShare !== undefined && expected > s.bottomBoardShare
        ? 'This layer is odd, and the odd chip goes to the TOP board — ' + money(expected) + '.'
        : 'That gives the top board ' + money(expected) + '.');
    return correct ? 'Correct — ' + base : base;
  }
};

const bottomBoardShareTask = {
  street: 'Showdown',
  taskType: 'numeric-amount',
  difficulty: 2,
  prompt: 'How much of this pot goes to the BOTTOM board?',
  resolve: s => s.bottomBoardShare === undefined ? null : s.bottomBoardShare,
  explain: (s, given, expected, correct) => {
    const base = 'The bottom board receives ' + money(expected) +
      '. Both boards are played HIGH only — there is no low side in this game.';
    return correct ? 'Correct — ' + base : base;
  }
};

exports.callAmountTask = callAmountTask;
exports.callAmountForActor = callAmountForActor;
exports.callAmountForBigBlind = callAmountForBigBlind;
exports.potAmountTask = potAmountTask;
exports.studCompletionOwedTask = studCompletionOwedTask;
exports.completedWagerTask = completedWagerTask;
exports.potLimitMaxTask = potLimitMaxTask;
exports.uncalledReturnTask = uncalledReturnTask;
exports.mainPotAmountTask = mainPotAmountTask;
exports.sidePotAmountTask = sidePotAmountTask;
exports.sidePotEligibilityTask = sidePotEligibilityTask;
exports.foldVsAllInTask = foldVsAllInTask;
exports.hiLoHighShareTask = hiLoHighShareTask;
exports.hiLoLowShareTask = hiLoLowShareTask;
exports.playerReceivesTask = playerReceivesTask;
exports.topBoardShareTask = topBoardShareTask;
exports.bottomBoardShareTask = bottomBoardShareTask;

})(typeof module !== 'undefined' ? module.exports : (window.RailMoneyTasks = window.RailMoneyTasks || {}));
