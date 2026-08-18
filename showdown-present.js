/* ============================================================
   showdown-present.js — Showdown pacing and payout comprehension

   THIS MODULE CALCULATES NOTHING. Every hand label, winner, layer amount,
   eligibility list and payout figure is read from results the validated
   engines already produced (showdown.js and money-state.js). Its only job
   is to order that information into stages a trainee can follow.

   STAGE MACHINE:
     showdown -> reveal -> read -> layers -> payout -> complete
   Each stage is discrete, so no stage can be skipped or duplicated.

   Works in Node (require) and the browser (window.RailShowPresent).
   ============================================================ */
(function(exports){

const STAGE = {
  SHOWDOWN:'showdown',   // announce
  REVEAL:'reveal',       // eligible hands turn face up
  READ:'read',           // what each hand made
  LAYERS:'layers',       // pot layers, sides and shares
  PAYOUT:'payout',       // chips move
  COMPLETE:'complete'    // hand complete may now appear
};
const STAGE_ORDER = [STAGE.SHOWDOWN, STAGE.REVEAL, STAGE.READ, STAGE.LAYERS, STAGE.PAYOUT, STAGE.COMPLETE];

/* Pacing by training mode. Learn lingers so a beginner can read; Table
   Ready moves briskly because the dealer is expected to keep up. */
const PACING = {
  learn:      { showdown:500, reveal:700, read:900, layers:1000, payout:700 },
  guided:     { showdown:400, reveal:600, read:700, layers:800,  payout:600 },
  practice:   { showdown:400, reveal:500, read:600, layers:700,  payout:500 },
  tableReady: { showdown:250, reveal:350, read:400, layers:450,  payout:350 }
};
function pacingFor(mode){ return PACING[mode] || PACING.practice; }
function stageDelay(mode, stage){
  const p = pacingFor(mode);
  return p[stage] === undefined ? 400 : p[stage];
}

function createPresentation(opts){
  const o = opts || {};
  return {
    stage: STAGE.SHOWDOWN,
    mode: o.mode || 'practice',
    generation: o.generation || 0,
    skipped: false
  };
}
function nextStage(pres){
  if(!pres) return null;
  const i = STAGE_ORDER.indexOf(pres.stage);
  if(i === -1 || i === STAGE_ORDER.length - 1) return pres.stage;
  pres.stage = STAGE_ORDER[i + 1];
  return pres.stage;
}
function isComplete(pres){ return !!pres && pres.stage === STAGE.COMPLETE; }
// Skipping jumps straight to the end without omitting any state change.
function skipToEnd(pres){
  if(!pres) return null;
  pres.skipped = true;
  pres.stage = STAGE.COMPLETE;
  return pres.stage;
}

/* ---------- Hand reading ----------
   Reads the labels showdown.js already produced. Folded players are absent
   from the result entirely, so they can never appear here. */
function handLines(showdown, opts){
  if(!showdown || !showdown.ok) return [];
  const o = opts || {};
  const seen = {};
  const lines = [];
  showdown.sides.forEach(side => {
    side.results.forEach(r => {
      const key = r.seat + '|' + side.key;
      if(seen[key]) return;
      seen[key] = true;
      lines.push({
        seat: r.seat,
        sideKey: side.key,
        sideLabel: side.label,
        label: r.label,
        isWinner: side.winners.indexOf(r.seat) !== -1,
        isYou: o.humanSeat !== undefined && r.seat === o.humanSeat
      });
    });
  });
  return lines;
}

/* ---------- Side summary ----------
   Turns each evaluated side into one readable outcome line. */
function sideSummaries(showdown){
  if(!showdown || !showdown.ok) return [];
  return showdown.sides.map(side => {
    if(side.winners.length === 0){
      const isLow = /low/i.test(side.key) || /low/i.test(side.label);
      return {
        key: side.key,
        label: side.label,
        qualified: false,
        text: isLow ? 'NO QUALIFYING LOW' : 'NO QUALIFYING HAND',
        winners: []
      };
    }
    const winnerText = side.winners.map(s => 'Player ' + (s + 1)).join(' / ');
    const first = side.results.find(r => r.seat === side.winners[0]);
    return {
      key: side.key,
      label: side.label,
      qualified: true,
      text: winnerText + (first && first.label ? ' — ' + first.label : ''),
      winners: side.winners.slice(),
      tie: side.winners.length > 1
    };
  });
}

/* Headline outcome for the whole showdown. */
function outcomeHeadline(showdown){
  if(!showdown || !showdown.ok) return '';
  if(showdown.isScoop) return 'SCOOP — PLAYER ' + (showdown.winners[0] + 1);
  const unqualified = showdown.unqualifiedSides || [];
  if(showdown.sides.length > 1 && unqualified.length > 0){
    return 'NO QUALIFYING LOW — HIGH TAKES ALL';
  }
  if(showdown.sides.length > 1) return 'SPLIT POT';
  if(showdown.hasTie) return 'SPLIT — TIE';
  return showdown.winners.length ? 'PLAYER ' + (showdown.winners[0] + 1) + ' WINS' : '';
}

/* ---------- Pot layers ----------
   Each layer is presented independently with its own eligibility, so a
   trainee sees that a short all-in cannot reach a side pot. */
function layerBreakdown(payoutInfo, showdown){
  if(!payoutInfo || !payoutInfo.layers) return [];
  return payoutInfo.layers.map((layer, i) => {
    const eligible = (layer.eligiblePlayerIds || []).slice();
    const detail = payoutInfo.detail && payoutInfo.detail[i];
    const out = {
      index: i,
      name: i === 0 ? 'MAIN POT' : 'SIDE POT ' + i,
      amount: layer.amount,
      eligible,
      eligibleText: eligible.map(s => 'Player ' + (s + 1)).join(', ')
    };
    // Double Board layers carry their own top/bottom split.
    if(detail && detail.topShare !== undefined){
      out.boards = [
        { name:'TOP BOARD', share: detail.topShare,
          winners: (detail.topWinners || []).slice(),
          winnerText: (detail.topWinners || []).map(s => 'Player ' + (s + 1)).join(' / ') },
        { name:'BOTTOM BOARD', share: detail.bottomShare,
          winners: (detail.bottomWinners || []).slice(),
          winnerText: (detail.bottomWinners || []).map(s => 'Player ' + (s + 1)).join(' / ') }
      ];
      out.oddChipNote = detail.topShare > detail.bottomShare
        ? 'Odd chip goes to the top board.' : '';
    }
    return out;
  });
}

/* Hi-lo share of a layer, taken from the same halving the engine performs. */
function hiLoShares(amount, lowQualifies){
  const total = Math.max(0, Math.floor(amount || 0));
  if(!lowQualifies) return { high: total, low: 0, note: 'No qualifying low, so high takes the whole layer.' };
  const low = Math.floor(total / 2);
  const high = total - low;
  return { high, low,
    note: high > low ? 'Odd chip goes to the high side.' : '' };
}

/* Final per-player amounts, straight from the payout result. */
function payoutLines(payoutInfo, opts){
  if(!payoutInfo || !payoutInfo.payouts) return [];
  const o = opts || {};
  return Object.keys(payoutInfo.payouts).map(k => {
    const seat = isNaN(+k) ? k : +k;
    return {
      seat,
      amount: payoutInfo.payouts[k],
      isYou: o.humanSeat !== undefined && seat === o.humanSeat,
      text: (o.humanSeat === seat ? 'YOU' : 'Player ' + (seat + 1)) +
            ' receives $' + payoutInfo.payouts[k]
    };
  }).sort((a,b) => b.amount - a.amount);
}

/* ---------- Dealer coach ----------
   Explains dealer duty from the actual result. Payout ORDER is deliberately
   not taught: the room's procedure for which layer to push first is not
   confirmed, so layers are simply identified rather than sequenced. */
function coachForStage(stage, ctx){
  const c = ctx || {};
  switch(stage){
    case STAGE.REVEAL:
      return 'Turn up the hands that are still live. Folded hands stay down.';
    case STAGE.READ: {
      if(c.sides && c.sides.length > 1){
        const low = c.sides.find(s => /low/i.test(s.key));
        if(low && !low.qualified){
          return 'No player has five unique cards eight or lower, so there is no qualifying low. High takes the whole pot.';
        }
        return 'Read both sides separately — the high hand and the qualifying low.';
      }
      return 'Read each live hand and find the best five cards.';
    }
    case STAGE.LAYERS: {
      if(c.layers && c.layers.length > 1){
        return 'There ' + (c.layers.length === 2 ? 'is 1 side pot' : 'are ' + (c.layers.length - 1) + ' side pots') +
          '. Award each layer only among the players who funded it.';
      }
      return c.layers && c.layers.length ? 'One pot. Every live player is eligible.' : '';
    }
    case STAGE.PAYOUT:
      return 'Push each layer to its winner and confirm the stacks.';
    default:
      return '';
  }
}

/* ---------- Human result ---------- */
function humanOutcome(showdown, humanSeat, folded){
  if(folded) return { text:'YOU FOLDED', won:false, watching:true };
  if(!showdown || !showdown.ok) return { text:'', won:false };
  const won = showdown.sides.filter(s => s.winners.indexOf(humanSeat) !== -1);
  if(won.length === 0) return { text:'YOU LOSE', won:false };
  if(showdown.isScoop && showdown.winners.indexOf(humanSeat) !== -1)
    return { text:'YOU SCOOP', won:true };
  if(won.length === showdown.sides.length && showdown.sides.length > 1)
    return { text:'YOU WIN BOTH', won:true };
  const side = won[0];
  const tie = side.winners.length > 1;
  const isLow = /low/i.test(side.key);
  return {
    text: 'YOU WIN' + (isLow ? ' LOW' : (showdown.sides.length > 1 ? ' HIGH' : '')) + (tie ? ' (TIE)' : ''),
    won: true
  };
}

/* ---------- Mode-shaped detail ---------- */
function detailLevel(mode){
  if(mode === 'learn') return 'full';
  if(mode === 'guided') return 'concise';
  if(mode === 'tableReady') return 'minimal';
  return 'standard';
}
function showCoachAtShowdown(mode){ return mode !== 'tableReady'; }

exports.STAGE = STAGE;
exports.STAGE_ORDER = STAGE_ORDER;
exports.PACING = PACING;
exports.pacingFor = pacingFor;
exports.stageDelay = stageDelay;
exports.createPresentation = createPresentation;
exports.nextStage = nextStage;
exports.isComplete = isComplete;
exports.skipToEnd = skipToEnd;
exports.handLines = handLines;
exports.sideSummaries = sideSummaries;
exports.outcomeHeadline = outcomeHeadline;
exports.layerBreakdown = layerBreakdown;
exports.hiLoShares = hiLoShares;
exports.payoutLines = payoutLines;
exports.coachForStage = coachForStage;
exports.humanOutcome = humanOutcome;
exports.detailLevel = detailLevel;
exports.showCoachAtShowdown = showCoachAtShowdown;

})(typeof module !== 'undefined' ? module.exports : (window.RailShowPresent = window.RailShowPresent || {}));
