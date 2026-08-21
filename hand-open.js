/* ============================================================
   hand-open.js — opening a new hand.

   openHand() creates the authoritative poker state for a fresh hand: which
   cards each seat starts with, what remains in the live deck, and the piles
   that track burns, muck and discards. It answers "what hand is this?" — not
   "what does the table look like?".

   It has no DOM, no timers, no element references, no sounds, no training UI
   and no chips. Given the same deck it produces the same hand every time,
   which is what lets it be tested without jsdom.

   DELIBERATELY NOT OWNED:
     · button and sit-out selection — those are table orchestration, decided
       before a hand is opened and passed IN as inputs. Moving them here would
       bury a Math.random() call inside a function whose whole value is being
       deterministic.
     · money. Chips, blinds, antes and the stud bring-in are already cleanly
       owned by money-state.js, and the bring-in in particular has to be posted
       AFTER the door cards are known. buildTable therefore calls openHand()
       first and initialises money second, which keeps that ordering visible.
     · slot maps. See OPENING SLOT MAPS below.

   OPENING SLOT MAPS
   The opening cards are placed into seatHoleCards but their slot maps stay
   empty, because the app deals deferred: applyStreet() consumes whatever is
   already sitting in seatHoleCards on the first street and commits the slot
   map then. Committing here as well would deal the opening cards twice. The
   maps are still complete before any animation — applyStreet runs
   synchronously — and the bring-in does not depend on them, since
   upCardsFromModel() reads seatHoleCards and faceSeq directly.
   ============================================================ */
(function(root, factory){
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) root.RailHandOpen = api;
})(typeof window !== 'undefined' ? window : null, function(){

  /* Which step of the pattern is the opening deal, and how many cards it gives
     each seat. Some patterns show nothing at step 0 and deal at step 1. */
  function openingStepFor(pattern){
    if(!pattern) return { step:0, cards:0 };
    if(pattern.hole[0] > 0) return { step:0, cards:pattern.hole[0] };
    return { step:1, cards:pattern.hole[1] || 0 };
  }

  /* Every per-hand pile and per-seat flag that must start clean. Anything a
     player chose in the previous hand belongs here — a stale keep-list or Pat
     lock leaking into the next hand is a real bug, not cosmetic. */
  function freshHandPiles(seatCount){
    return {
      tableBoardCards: [],     // the board does not exist until it is dealt
      tableBoard2Cards: [],
      muckPile: [],            // settled discards, eligible for a reshuffle
      roundDiscards: [],       // this round's discards, NOT eligible
      burnCards: [],           // physical burns
      seatPatLocked: new Array(seatCount).fill(false),
      seatSlotMaps: [],
      seatDealtCounts: new Array(seatCount).fill(0),
      seatVisibleCardCounts: new Array(seatCount).fill(0)
    };
  }

  /*
    openHand({ pattern, seatCount, sitOutSeat, deck })

      pattern    — the DEAL_PATTERNS entry for this game
      seatCount  — seats at the table
      sitOutSeat — seat index sitting this hand out, or null
      deck       — a shuffled deck to deal from. Injected rather than created,
                   so a test can stack it without reaching for a global.

    Returns the authoritative opening hand. The caller assigns these onto its
    own state; nothing is read from or written to ambient scope.
  */
  function openHand(opts){
    const pattern    = opts.pattern;
    const seatCount  = opts.seatCount;
    const sitOutSeat = (opts.sitOutSeat === undefined) ? null : opts.sitOutSeat;
    const deck       = (opts.deck || []).slice();

    const piles = freshHandPiles(seatCount);
    const seatHoleCards = [];

    if(!pattern){
      for(let i = 0; i < seatCount; i++){ seatHoleCards.push([]); piles.seatSlotMaps.push([]); }
      return Object.assign({}, piles, {
        seatHoleCards, remainingDeck: deck, openingPitch: [],
        openingStep: 0, openingCards: 0
      });
    }

    const open = openingStepFor(pattern);
    const faceSeq = (pattern.faceSeq && pattern.faceSeq[open.step]) || '';

    // DEFERRED DEALING: only the opening street comes off the deck now. Later
    // streets draw as they are reached, which is how a real deal works and is
    // what lets 7-handed Super Stud complete — its discards reach the muck and
    // the muck is legitimately reshuffled back in when the deck runs short.
    for(let i = 0; i < seatCount; i++){
      piles.seatSlotMaps.push([]);
      seatHoleCards.push([]);
    }

    // ONE CARD PER SEAT PER PASS.
    // A dealer pitches a single card to each seat in turn and then comes
    // around again, so the deck is consumed in passes, not in blocks. This
    // loop IS the physical deal: every card is removed from the live deck at
    // the moment it is pitched, and openingPitch records that same order. The
    // card that visually arrives at a seat is therefore the card that actually
    // left the top of the deck at that moment.
    //
    // Seat order is plain seat-index order, matching how applyStreet pitches
    // later streets and how the table has always animated. The room sheet does
    // not specify a first recipient, so no new convention is invented here.
    const openingPitch = [];
    for(let pass = 0; pass < open.cards; pass++){
      for(let i = 0; i < seatCount; i++){
        if(i === sitOutSeat) continue;    // a sitting-out seat consumes nothing
        const card = deck.shift();
        if(!card) break;                  // deck exhausted; never invent a card
        seatHoleCards[i].push(card);
        openingPitch.push({
          kind:'seat', seat:i, card,
          slotIndex: pass, handPos: pass, phase: 0, pass,
          faceUp: faceSeq.charAt(pass) === 'U'
        });
      }
    }

    return Object.assign({}, piles, {
      seatHoleCards,
      remainingDeck: deck,
      openingPitch,
      openingStep: open.step,
      openingCards: open.cards
    });
  }

  return { openHand, openingStepFor, freshHandPiles };
});
