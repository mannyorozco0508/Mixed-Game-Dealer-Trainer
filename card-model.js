/* ============================================================
   card-model.js — the canonical card model

   Authoritative source. index.html consumes this module; it does not keep a
   second copy. Loaded as a plain <script> in the browser and required() by
   the test suite, so it must stay free of DOM, timers and app state.
   ============================================================ */
(function(root, factory){
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) root.RailCardModel = api;
})(typeof window !== 'undefined' ? window : null, function(){
  const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const SUITS = ['S','H','D','C'];
  const SUIT_SYMBOL = { S:'\u2660', H:'\u2665', D:'\u2666', C:'\u2663' };
  const RED_SUITS = new Set(['H','D']);

  // The one and only place a card object is constructed.
  function createCard(rank, suit){
    return { rank, suit };
  }
  // Derived presentation helpers — never stored on the card itself.
  function cardIsRed(card){ return RED_SUITS.has(card.suit); }
  function cardFaceText(card){ return card.rank + SUIT_SYMBOL[card.suit]; }

  function freshDeck(){
    const d = [];
    RANKS.forEach(r => SUITS.forEach(s => d.push(createCard(r, s))));
    for(let i = d.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  function cardHtml(c, mini, delayMs, dx, dy){
    const cls = mini ? 'mini-card' : 'board-card';
    const rot = ((dx || 0) > 0 ? 1 : -1) * (6 + Math.random() * 8); // slight rotation, direction matches travel side, for a natural flick
    const styleParts = [];
    if(delayMs) styleParts.push(`animation-delay:${delayMs}ms`);
    if(dx !== undefined) styleParts.push(`--deal-dx:${dx}px`);
    if(dy !== undefined) styleParts.push(`--deal-dy:${dy}px`);
    if(dx !== undefined || dy !== undefined) styleParts.push(`--deal-rot:${rot.toFixed(1)}deg`);
    const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
    return `<span class="${cls}${cardIsRed(c) ? ' red' : ''}"${styleAttr}>${cardFaceText(c)}</span>`;
  }

  // Cumulative hole/board card counts visible while each scenario step is on screen.
  //
  // faceSeq expresses face state BY PHYSICAL POSITION, one character per card in
  // the order it was dealt: 'D' = face down, 'U' = face up. This exists because
  // upCount alone is ambiguous — "1 up card" cannot distinguish Super Stud's real
  // deal (D D D D U) from the wrong one (U D D D D). The renderer reads faceSeq.
  // upCount is retained only as a derived total for existing checks.
  //
  // discardKeep lists which PHYSICAL SLOTS from the previous step survive a
  // discard. Super Stud discards two DOWN cards and keeps the up card, so the
  // renderer cannot simply drop cards from the end of the hand.

  return { RANKS, SUITS, SUIT_SYMBOL, RED_SUITS, createCard, cardIsRed, cardFaceText, freshDeck, cardHtml };
});
