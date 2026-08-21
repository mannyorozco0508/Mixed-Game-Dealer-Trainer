/* ============================================================
   deal-state.js — the pure street transition

   applyStreet() answers one question: given the authoritative deal state and
   a target step, what does the hand look like now, and what should be pitched
   to show it? It is the ONLY place that decides which cards a street adds,
   which physical slots survive a discard, and in what order cards leave the
   dealer's hand.

   It has no DOM, no timers, no element references, no app globals, no sound,
   no training UI. Given the same state and the same draw source it produces
   the same result every time, which is what makes it testable without jsdom.

   ON MUTATION: the state arrays are mutated IN PLACE rather than replaced.
   index.html holds long-lived references to seatHoleCards and friends, and
   several call sites alias individual seat arrays, so returning fresh objects
   would either break that aliasing or force a much larger rewrite than this
   phase allows. The seam is still deterministic and directly testable — every
   input is explicit and nothing is read from ambient scope — it simply owns
   the arrays it is handed. That tradeoff is deliberate.
   ============================================================ */
(function(root, factory){
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) root.RailDealState = api;
})(typeof window !== 'undefined' ? window : null, function(){

  /* Cumulative targets for a step, clamped to the pattern's length. */
  function targetsFor(pattern, stepIndex){
    const step = Math.min(stepIndex, pattern.hole.length - 1);
    return {
      step,
      hole:   pattern.hole[step],
      up:     (pattern.upCount && pattern.upCount[step]) || 0,
      board:  pattern.board[step],
      board2: pattern.board2 ? pattern.board2[step] : 0,
      faceSeq: (pattern.faceSeq && pattern.faceSeq[step]) || '',
      burns:  (pattern.burns && pattern.burns[step]) || 0,
      phases: (pattern.phases && pattern.phases[step]) || null
    };
  }

  /* Which physical positions a discard removes from a seat, and the slot map
     that survives. Positions index the CURRENT map, so the renderer can drop
     exactly those card elements. */
  function planDiscard(currentMap, keepSlots, removeCount){
    if(keepSlots){
      const keepSet = new Set(keepSlots);
      const newMap = [], removedPositions = [], removedSlots = [];
      currentMap.forEach((slot, pos) => {
        if(keepSet.has(slot)) newMap.push(slot);
        else { removedPositions.push(pos); removedSlots.push(slot); }
      });
      return { newMap, removedPositions, removedSlots };
    }
    // No explicit keep rule — the most recently dealt cards go, last first,
    // which is the order the old renderer removed elements in.
    const removedPositions = [], removedSlots = [];
    for(let r = 0; r < removeCount && currentMap.length - r - 1 >= 0; r++){
      const pos = currentMap.length - r - 1;
      removedPositions.push(pos);
      removedSlots.push(currentMap[pos]);
    }
    return {
      newMap: currentMap.slice(0, Math.max(0, currentMap.length - removeCount)),
      removedPositions,
      removedSlots
    };
  }

  /*
    applyStreet({ pattern, stepIndex, seatCount, sitOutSeat, state, drawCard,
                  keepSlotsFor })

      state        — { seatHoleCards, seatSlotMaps, seatDealtCounts,
                       tableBoardCards, tableBoard2Cards, muckPile,
                       prevHoleCount, prevUpCount, prevBoardCount,
                       prevBoard2Count, burnPileCount }
      drawCard     — () => card | null, the live draw source
      keepSlotsFor — (seat) => array | null, per-seat discard override; used
                     for the human's own choice in Play & Learn

    Returns a plan:
      { kind, step, faceSeq, burned, dealtSound, pitchQueue, removals, counts }

    kind:
      'none'    nothing changed this step
      'discard' cards left hands; nothing new was dealt
      'deal'    new cards (and/or board cards) were added
  */
  function applyStreet(opts){
    const pattern     = opts.pattern;
    const seatCount   = opts.seatCount;
    const sitOutSeat  = opts.sitOutSeat;
    const st          = opts.state;
    const drawCard    = opts.drawCard;
    const keepSlotsFor= opts.keepSlotsFor || function(){ return null; };
    // SUPER PAT: a locked seat holds exactly the five cards it started with.
    // It discards nothing and is dealt nothing on any later street, so the
    // model itself stays at five — no phantom card is created and then hidden.
    const isPatSeat   = opts.isPatSeat || function(){ return false; };

    const t = targetsFor(pattern, opts.stepIndex);

    const holeTotalDelta = t.hole   - st.prevHoleCount;
    const boardDelta     = t.board  - st.prevBoardCount;
    const board2Delta    = t.board2 - st.prevBoard2Count;

    const commitCounts = () => {
      st.prevHoleCount   = t.hole;
      st.prevUpCount     = t.up;
      st.prevBoardCount  = t.board;
      st.prevBoard2Count = t.board2;
    };

    // Burns are no longer taken up front. A step can represent more than one
    // physical street, and the table burns before EACH of them, so burning is
    // now part of each ordered phase below (see runPhase).
    let burned = 0;

    // ---- nothing changed ----
    // A burn is a real deck event even when no card reaches a player: a draw
    // round burns first and then the draw engine replaces cards, so the hole
    // count never moves. Returning early on "no deltas" skipped those burns
    // entirely, which is why triple draw was consuming one burn instead of
    // three.
    if(holeTotalDelta === 0 && boardDelta === 0 && board2Delta === 0 && t.burns === 0){
      commitCounts();
      return { kind:'none', step:t.step, faceSeq:t.faceSeq, burned,
               dealtSound:false, pitchQueue:[], removals:[] };
    }

    // ---- discards ----
    // A street can BOTH discard and deal: Crazy Pineapple throws the third
    // hole card on the same step that brings the turn and river. This used to
    // return early after discarding, so those board cards were never pitched
    // and the table silently stopped at the flop. Discarding is now a phase of
    // the street, not an alternative to it.
    const removals = [];
    if(holeTotalDelta < 0){
      const defaultKeep = pattern.discardKeep && pattern.discardKeep[t.step];
      for(let i = 0; i < seatCount; i++){
        if(i === sitOutSeat) continue;
        if(isPatSeat(i) && (st.seatSlotMaps[i] || []).length > 0){
          // Pat discards nothing. Its slot map is untouched and nothing
          // reaches the muck, so its cards can never re-enter the deck.
          removals.push({ seat:i, positions:[] });
          continue;
        }
        const override = keepSlotsFor(i);
        const keepSlots = override || defaultKeep;
        const currentMap = st.seatSlotMaps[i] || [];
        const seatCards  = st.seatHoleCards[i] || [];
        const plan = planDiscard(currentMap, keepSlots, -holeTotalDelta);
        // Discarded physical cards join the muck, where they stay eligible for
        // a legitimate reshuffle later in the hand.
        plan.removedSlots.forEach(slot => {
          if(seatCards[slot]) st.muckPile.push(seatCards[slot]);
        });
        st.seatSlotMaps[i] = plan.newMap;
        removals.push({ seat:i, positions:plan.removedPositions });
      }
    }

    /* ---- ORDERED PHYSICAL PHASES ----
       One app step may cover several real streets. The table burns and deals
       street by street, so the deck must experience the same order: burn,
       deal, burn, deal — never both burns and then both deals.

       A step with no `phases` data is a single street and runs as one phase,
       so simple patterns stay simple and there is only ever one code path. */
    const phases = t.phases || [{
      burn:   t.burns,
      // A simple step keeps the TARGET-based rule: deal each seat up to this
      // step's hole count. That stays correct after a discard has shortened a
      // hand, which a fixed per-seat count would not. Explicit phases instead
      // name how many cards that one street deals.
      targetHole: t.hole,
      board:  boardDelta  > 0 ? boardDelta  : 0,
      board2: board2Delta > 0 ? board2Delta : 0
    }];

    const pitchQueue = [];

    /* Runs ONE physical street: its burn, then its cards. State is committed
       before the next phase begins, so a reshuffle triggered mid-step happens
       at the correct physical moment rather than after the whole step. */
    function runPhase(phase, phaseIndex){
      // 1. Burn first. Never fake one if the deck is finished.
      for(let b = 0; b < (phase.burn || 0); b++){
        const card = drawCard();
        if(!card) break;
        if(st.burnCards) st.burnCards.push(card);
        burned++;
      }
      st.burnPileCount = st.burnCards ? st.burnCards.length : st.burnPileCount + burned;

      // 2. Player cards for this street, round-robin one card at a time.
      const needFor = i => {
        if(i === sitOutSeat) return 0;
        // A Pat seat is locked at the hand it holds and takes no later card.
        if(isPatSeat(i) && (st.seatSlotMaps[i] || []).length > 0) return 0;
        return phase.targetHole !== undefined
          ? Math.max(0, phase.targetHole - (st.seatSlotMaps[i] || []).length)
          : (phase.hole || 0);
      };
      const anyNeed = (() => {
        for(let i = 0; i < seatCount; i++) if(needFor(i) > 0) return true;
        return false;
      })();
      if(anyNeed){
        const newCards = [];
        for(let i = 0; i < seatCount; i++){
          const need = needFor(i);
          if(need <= 0){ newCards.push([]); continue; }
          const seatCards = st.seatHoleCards[i] || [];
          // DEFERRED DEALING: buildTable places the opening cards into
          // seatHoleCards before any slot map exists, so a street first
          // CONSUMES anything already sitting there and only draws the
          // shortfall. Drawing unconditionally would deal the opening cards a
          // second time.
          const already = st.seatDealtCounts[i] || 0;
          while(seatCards.length < already + need){
            const c = drawCard();
            if(!c) break;               // deck and muck exhausted
            seatCards.push(c);
          }
          newCards.push(seatCards.slice(already, already + need));
        }
        const maxNew = Math.max(0, ...newCards.map(a => a.length));
        for(let round = 0; round < maxNew; round++){
          for(let i = 0; i < seatCount; i++){
            const card = newCards[i][round];
            if(card === undefined) continue;
            const slotIndex = (st.seatDealtCounts[i] || 0) + round;                 // physical deal index
            const handPos   = (st.seatSlotMaps[i] ? st.seatSlotMaps[i].length : 0) + round; // position after any discard
            pitchQueue.push({
              kind:'seat', seat:i, card, slotIndex, handPos, phase: phaseIndex,
              faceUp: t.faceSeq.charAt(handPos) === 'U'
            });
          }
        }
        // Commit this street's slot map and dealt count before the next phase,
        // so the next phase's slot indices and face positions are correct.
        for(let i = 0; i < seatCount; i++){
          for(let round = 0; round < (newCards[i] || []).length; round++){
            const slotIndex = (st.seatDealtCounts[i] || 0) + round;
            if(!st.seatSlotMaps[i]) st.seatSlotMaps[i] = [];
            st.seatSlotMaps[i].push(slotIndex);
          }
          if((newCards[i] || []).length){
            st.seatDealtCounts[i] = (st.seatDealtCounts[i] || 0) + newCards[i].length;
          }
        }
      }

      // 3. Board cards for this street, off the live deck after the burn.
      for(let n = 0; n < (phase.board || 0); n++){
        const c = drawCard();
        if(!c) break;
        st.tableBoardCards.push(c);
        pitchQueue.push({ kind:'board1', card:c, phase: phaseIndex });
      }
      // Double Board takes ONE burn per street and then deals BOTH boards, so
      // the second board belongs to this same phase — never its own phase.
      if(pattern.board2){
        for(let n = 0; n < (phase.board2 || 0); n++){
          const c = drawCard();
          if(!c) break;
          st.tableBoard2Cards.push(c);
          pitchQueue.push({ kind:'board2', card:c, phase: phaseIndex });
        }
      }
    }

    phases.forEach(runPhase);

    commitCounts();
    const kind = pitchQueue.length ? 'deal' : (removals.length ? 'discard' : 'none');
    return { kind, step:t.step, faceSeq:t.faceSeq, burned,
             dealtSound: kind !== 'none', pitchQueue, removals };
  }

  /* ---------- Reshuffle eligibility ----------
     Talking Stick, "Reshuffling Discards": when not enough cards remain for
     all active players, reshuffle ONLY the muck, the burn cards, and the last
     card off the deck — never the CURRENT round's player discards. The last
     card off the deck is never dealt or used as a burn, so it goes into the
     reshuffle rather than to a player.

     This is a whitelist, not a filter over one pile. A card can only come back
     by being named in an eligible category, so a card that is still in play,
     on the board, or freshly discarded this round has no path back in. */
  function reshuffleEligible(src){
    const out = [];
    const banned = new Set();
    (src.currentRoundDiscards || []).forEach(c => banned.add(cardKey(c)));

    const add = card => {
      if(!card) return;
      // A current-round discard is never eligible, whichever pile it sits in.
      if(banned.has(cardKey(card))) return;
      if(out.some(c => cardKey(c) === cardKey(card))) return;  // never duplicate an identity
      out.push(card);
    };

    (src.muck || []).forEach(add);
    (src.burns || []).forEach(add);

    // The withheld last card joins the reshuffle, but it cannot BE the
    // reshuffle. If the muck and burns contribute nothing there is nothing to
    // shuffle it with, and handing it straight back out would deal the very
    // card the rule withholds. In that case the deck is genuinely finished.
    if(out.length === 0) return [];

    add(src.stubLastCard || null);
    return out;
  }

  function cardKey(c){ return c ? (c.rank + c.suit) : ''; }

  return { applyStreet, targetsFor, planDiscard, reshuffleEligible, cardKey };
});
