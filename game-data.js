/* ============================================================
   game-data.js — the canonical game roster and its scenario generators

   Authoritative source. index.html consumes this module; it does not keep a
   second copy. Loaded as a plain <script> in the browser and required() by
   the test suite, so it must stay free of DOM, timers and app state.
   ============================================================ */
(function(root, factory){
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) root.RailGameData = api;
})(typeof window !== 'undefined' ? window : null, function(){
  function tripleDrawSteps({downCards, extraStep, showdownPrompt, showdownOptions}){
    // extraStep carries a question specific to THIS game's scoring, so games
    // sharing the same dealing shape stop sharing an identical question set.
    const base = [
      {
        street:"Deal",
        prompt:"New hand. Cards are shuffled. What do you do first?",
        options:[
          {text:`Deal ${downCards} down to each player, no burn`, correct:true, feedback:"Right — no burn before the very first deal of a fresh hand. Burns start before the first draw."},
          {text:`Burn one card, then deal ${downCards} down`, correct:false, feedback:"No burn before the initial deal — that only starts with the first draw."},
          {text:"Deal the first draw before the initial cards", correct:false, feedback:"Nothing to draw yet — the initial hand goes out first."}
        ]
      },
      {
        street:"Draw 1",
        requiresDraw:true,   // PHYSICAL draw street: cards are actually replaced here
        prompt:"First betting round wraps up. What's next?",
        options:[
          {text:"Burn, then deal Draw 1", correct:true, feedback:"Correct — always burn before a draw, even if nobody's drawing cards."},
          {text:"Deal Draw 1, no burn needed", correct:false, feedback:"Golden Rule: always burn before dealing new cards, including every draw round."},
          {text:"Skip straight to Draw 2", correct:false, feedback:"Each draw round gets its own betting round first — you can't skip ahead."}
        ]
      },
      {
        street:"Draw 2",
        requiresDraw:true,   // PHYSICAL draw street: cards are actually replaced here
        prompt:"Draw 1 betting wraps up. What's next?",
        options:[
          {text:"Burn, then deal Draw 2", correct:true, feedback:"Right — same rule, every draw round, no exceptions."},
          {text:"Deal Draw 2 with no burn since you already burned once this hand", correct:false, feedback:"Every single draw gets its own burn — it doesn't matter how many times you've already burned this hand."},
          {text:"Go to showdown", correct:false, feedback:"There's still a third draw round to go before showdown."}
        ]
      },
      {
        street:"Draw 2",
        difficulty:3,
        prompt:"Mid-hand the deck runs short during a draw. Which cards may legitimately be reshuffled back in?",
        options:[
          {text:"The muck, the burn cards, and the last card off the deck — never this round's discards", correct:true, feedback:"Correct. This round's discards stay out because they are still live information for the hand in progress. Everything already dead can come back."},
          {text:"Everything not currently in a player's hand, including this round's discards", correct:false, feedback:"This round's discards are the one exclusion. Returning them would put cards a player just released back into play in the same hand."},
          {text:"Only the burn cards", correct:false, feedback:"The muck and the deck's last card are also eligible. Restricting to burns alone often will not produce enough cards."}
        ]
      },
      {
        street:"Draw 3",
        requiresDraw:true,   // PHYSICAL draw street: cards are actually replaced here
        prompt:"Draw 2 betting wraps up. What's next?",
        options:[
          {text:"Burn, then deal Draw 3", correct:true, feedback:"Correct — the third and final draw, same burn rule applies."},
          {text:"No more draws — go to showdown", correct:false, feedback:"This format runs three total draws before showdown."},
          {text:"Deal Draw 3 with no burn", correct:false, feedback:"Still burn first, even on the last draw."}
        ]
      },
    ];
    if(extraStep) base.push(extraStep);
    base.push({ street:"Showdown", prompt:showdownPrompt, options:showdownOptions });
    return base;
  }

  function drawmahaCommonSteps(){
    return [
      {
        street:"Deal",
        prompt:"New hand. Cards are shuffled. What do you do first?",
        options:[
          {text:"Deal 5 hole cards to each player, no burn", correct:true, feedback:"Right — no burn before the very first deal. Burns start before the flop."},
          {text:"Burn one card, then deal 5 hole cards", correct:false, feedback:"No burn before the initial deal — that's the very first cards out of a fresh shuffle."},
          {text:"Deal the flop first, then hole cards", correct:false, feedback:"Hole cards always go out before any board cards."}
        ]
      },
      {
        street:"Pre-Flop",
        prompt:"Betting on the hole cards just wrapped up. What's next?",
        options:[
          {text:"Burn, then deal the flop (3 cards)", correct:true, feedback:"Correct. Golden rule — always burn before dealing new cards to the board."},
          {text:"Deal the flop, no burn needed", correct:false, feedback:"The Golden Rule applies here: always burn before dealing to the board."},
          {text:"Ask players to declare their draw now", correct:false, feedback:"Too early — the draw declaration comes after the flop is out and bet on."}
        ]
      },
      {
        street:"Flop",
        prompt:"Flop's out, betting is done. Players are ready to draw. What's next?",
        options:[
          {text:"Have players declare their draw (up to 3 cards) — no cards dealt yet", correct:true, feedback:"Right — declaration comes first, before any dealing happens."},
          {text:"Burn, then deal replacement cards immediately", correct:false, feedback:"Not yet — players need to declare how many cards they're drawing first."},
          {text:"Burn, then deal the turn to the board", correct:false, feedback:"The turn and the draw replacements happen together, but the draw has to be declared first."}
        ]
      },
      {
        street:"Draw Declared",
        requiresDraw:true,   // PHYSICAL draw street: cards are actually replaced here
        prompt:"Draws are declared. Now you deal the turn AND get players their replacement cards. How many times do you burn?",
        options:[
          {text:"Burn once — deal the turn to the board, then deal replacements to players with no second burn", correct:true, feedback:"Exactly right. One burn covers both the turn card and the players' replacement cards — Drawmaha's signature quirk."},
          {text:"Burn once for the turn, burn again before replacements", correct:false, feedback:"Drawmaha only burns once here — the single burn covers both actions."},
          {text:"No burn needed since players are just replacing cards", correct:false, feedback:"You do burn once — for the turn card. It just doesn't repeat for the replacements."}
        ]
      },
      {
        street:"Draw Declared",
        difficulty:3,
        prompt:"You burn once, deal the turn, then start distributing replacements. A player says you owe a second burn before their cards. How do you handle it?",
        options:[
          {text:"Explain that one burn covers both the turn and the replacements in this game, and continue", correct:true, feedback:"Correct. The single burn is the defining Drawmaha quirk. A dealer who knows it can state it calmly and keep the hand moving rather than second-guessing mid-deal."},
          {text:"Burn again to be safe — an extra burn never hurts", correct:false, feedback:"An unnecessary burn removes a card that belongs in play and teaches the table the wrong procedure. Being right matters more than appearing accommodating."},
          {text:"Stop the hand and call the floor", correct:false, feedback:"This is settled procedure, not a ruling. Calling the floor for a known rule slows the game and undermines confidence in the box."}
        ]
      },
      {
        street:"Turn",
        prompt:"Turn and replacements are out, betting's done. What's next?",
        options:[
          {text:"Burn, then deal the river", correct:true, feedback:"Correct — standard burn before the final board card."},
          {text:"Deal the river with no burn", correct:false, feedback:"Golden Rule again — always burn before a new community card."},
          {text:"Go straight to showdown", correct:false, feedback:"The river still needs to come out and get bet on first."}
        ]
      }
    ];
  }
  function drawmahaScenario({extraStep, showdownPrompt, showdownOptions}){
    // extraStep lets each Drawmaha variant carry a question about its OWN
    // draw-side scoring, so the variants stop sharing one identical template.
    const steps = drawmahaCommonSteps();
    if(extraStep) steps.push(extraStep);
    steps.push({ street:"Showdown", prompt:showdownPrompt, options:showdownOptions });
    return steps;
  }

  function superStudSteps({showdownPrompt, showdownOptions}){
    return [
      {
        street:"Deal",
        prompt:"New hand. What's dealt to each player to start?",
        options:[
          {text:"4 cards down, 1 card up — no burn", correct:true, feedback:"Right — Super Stud deals 5 total, 4 down and 1 up. No burn before the initial deal."},
          {text:"2 down, 1 up, like standard stud", correct:false, feedback:"That's the standard 7-Card Stud deal. Super Stud starts everyone with 5 cards: 4 down, 1 up."},
          {text:"5 down, no up card yet", correct:false, feedback:"There's always one card up to start Super Stud — that's what makes bring-in possible."}
        ]
      },
      {
        street:"Discard/Pat",
        prompt:"Before 4th street, what does every player have to do?",
        options:[
          {text:"Discard 2 of their down cards (getting to 3 total) — or declare Pat and keep all 5", correct:true, feedback:"Correct. Players trim down to a 3-card starting hand unless they lock in with a Pat."},
          {text:"Everyone must discard — Pat isn't an option in Super Stud", correct:false, feedback:"Pat is very much an option — a player can keep all 5 original cards and lock in their hand instead of discarding."},
          {text:"Discard happens after 4th street is dealt, not before", correct:false, feedback:"The discard-or-Pat decision happens before 4th street goes out, not after."}
        ]
      },
      {
        street:"Super Pat Action",
        prompt:"One player declares Super Pat. For the rest of the hand, who acts first each street?",
        options:[
          {text:"The Super Pat player drives the action every round after", correct:true, feedback:"Exactly — Super Pat overrides the normal 'best hand showing acts first' rule. Once locked in, that player leads the betting every street."},
          {text:"Whoever has the best hand showing, like normal stud rules", correct:false, feedback:"That's the standard rule, but Super Pat overrides it — the Pat player always acts first from here on."},
          {text:"The player to the Pat player's left", correct:false, feedback:"Not quite — it's the Pat player themselves who drives the action, not the person next to them."}
        ]
      },
      {
        street:"Multiple Pats",
        prompt:"A second player also declares Super Pat this hand. Who acts first now?",
        options:[
          {text:"The bring-in acts as the button", correct:true, feedback:"Right — with multiple Pats, the bring-in position effectively becomes the button for action order purposes."},
          {text:"Whichever player declared Pat first", correct:false, feedback:"That rule only holds with a single Pat. Once there are multiple Pats, the bring-in takes over as the button."},
          {text:"Both Pat players act simultaneously", correct:false, feedback:"Betting is always sequential — with multiple Pats, the bring-in becomes the button and normal seat order resumes from there."}
        ]
      },
      {
        street:"Showdown",
        difficulty:2,
        prompt:"A Super Pat player kept their original five cards. Which side of the pot is their hand eligible for?",
        options:[
          {text:"Both — the same five cards play for high AND for the 8-or-better low", correct:true, feedback:"Correct. Declaring Pat locks the hand, it does not restrict which half it competes for. Those five cards are read for both sides."},
          {text:"High only — a Pat player gives up the low side", correct:false, feedback:"Pat only means no more cards. The hand still plays for both high and low like anyone else's."},
          {text:"Only whichever side they declare at showdown", correct:false, feedback:"There is no declaration at showdown in this game. Every eligible hand is automatically read for both sides."}
        ]
      },
      {
        street:"Discard/Pat",
        difficulty:2,
        prompt:"A player declares Pat, then a second player also declares Pat. Who acts first from here?",
        options:[
          {text:"The bring-in acts as the button once there are multiple Pats", correct:true, feedback:"Correct. A single Pat drives the action, but with two the convention falls back to the bring-in acting as the button."},
          {text:"Whichever player declared Pat first", correct:false, feedback:"Declaration order only settles a single Pat. With multiple Pats the bring-in takes over as the reference point."},
          {text:"The player showing the best board", correct:false, feedback:"That is the normal stud rule, which the Pat declaration overrides."}
        ]
      },
      {
        street:"5th Street",
        difficulty:3,
        prompt:"A Pat player has taken no cards since 3rd street while others have drawn. How many cards does the Pat player hold at showdown?",
        options:[
          {text:"Five — a Pat player locks their hand and receives no further cards", correct:true, feedback:"Correct. Pat means exactly that: the five-card hand is fixed. Everyone else builds to seven while the Pat player stands still."},
          {text:"Seven, the same as everyone else", correct:false, feedback:"A Pat player forgoes all further cards. That is the trade-off for locking in early."},
          {text:"Six — they skip only the final down card", correct:false, feedback:"Pat stops all draws from the moment it is declared, not just the last one."}
        ]
      },
      {
        street:"4th–7th Street",
        prompt:"Streets 4 through 7 are dealt one at a time. What do you do before each one?",
        options:[
          {text:"Burn before every street, 4th through 7th, then bet each round", correct:true, feedback:"Correct — Golden Rule, every single street, no exceptions."},
          {text:"Burn only before 4th street, not the rest", correct:false, feedback:"Every street needs its own burn, all the way through 7th street."},
          {text:"No burns needed since players already discarded once", correct:false, feedback:"The discard has nothing to do with burn cards — you still burn before every new street."}
        ]
      },
      { street:"Showdown", prompt:showdownPrompt, options:showdownOptions }
    ];
  }

  /* ---------------- Data ---------------- */
  function sevenStudSteps({bringInPrompt, bringInOptions, bringInTaskType, bringInResolve, bringInExplain, showdownPrompt, showdownOptions}){
    const bringInStep = { street:"3rd Street", prompt:bringInPrompt, options:bringInOptions };
    // When a resolver is supplied the step becomes a live-table task: the
    // correct seat is derived from simulation state, never stored here.
    if(bringInTaskType){
      bringInStep.taskType = bringInTaskType;
      bringInStep.resolve = bringInResolve;
      bringInStep.explain = bringInExplain;
    }
    return [
      bringInStep,
      {
        street:"3rd Street",
        taskType:"numeric-amount",
        difficulty:2,
        prompt:"A player completes the bring-in. How much MORE does the bring-in owe to call?",
        resolve: s => (s.bringInSeat === null || s.bringInSeat === undefined)
          ? null : s.callAmounts[s.bringInSeat],
        explain: (s, given, expected, correct) => {
          const posted = (s.streetContrib && s.streetContrib[s.bringInSeat]) || 0;
          const base = 'The bring-in already has $' + posted + ' in. Completion is TO $' +
            s.completionTo + ' total, not on top of it, so they owe $' + expected + ' more.';
          return correct ? 'Correct — ' + base : base;
        },
        options:[]
      },
      {
        street:"4th Street",
        prompt:"3rd street action wraps up. What's next?",
        options:[
          {text:"Burn, then deal 4th street", correct:true, feedback:"Correct — standard burn before every new street."},
          {text:"Deal 4th street with no burn since 3rd street had no burn", correct:false, feedback:"3rd street's initial deal doesn't get a burn, but every street after it does."},
          {text:"Ask for a pot-limit bet before dealing", correct:false, feedback:"Betting structure doesn't change the dealing procedure — burn then deal, regardless of limit type."}
        ]
      },
      {
        street:"Pairs",
        prompt:"4th street lands and pairs a player's door card. What do you do?",
        options:[
          {text:"Announce it out loud — e.g. \"pair of fives are new, kings are high\"", correct:true, feedback:"Right — always call out new pairs as they hit, so the whole table knows the board."},
          {text:"Say nothing, players can see it themselves", correct:false, feedback:"Dealers are expected to announce pairs proactively — don't rely on players to notice."},
          {text:"Only mention it if a player asks", correct:false, feedback:"It should be called out automatically, not just on request."}
        ]
      },
      {
        street:"6th Street",
        difficulty:3,
        prompt:"Six players are still live on 6th street and you count the stub. There are not enough cards to give everyone a 7th street card. What is the correct sequence of remedies?",
        options:[
          {text:"Reshuffle the burns and muck first; only if that still falls short, deal one community card face up for everyone", correct:true, feedback:"Correct. Recovering cards comes before changing the game. The shared community card is the last resort, not the first move, and it goes to every remaining player at once."},
          {text:"Deal a community card immediately to save time", correct:false, feedback:"That skips the recovery step. Reshuffling burns and muck often produces enough cards, and changing the deal shape should always be the final option."},
          {text:"Deal 7th street to as many players as the stub allows, in order", correct:false, feedback:"Never leave a live player short. Every remaining player must receive a 7th card, or all of them share a community card."}
        ]
      },
      {
        street:"7th Street",
        prompt:"You're dealing 7th street but the deck's short. What's the priority?",
        options:[
          {text:"Try to shuffle in burns and still give everyone a 7th card — if that's impossible, use a burn card as a shared community card so everyone still gets a 7th card", correct:true, feedback:"Exactly right — the priority is always making sure every player gets a 7th street card."},
          {text:"Skip 7th street for whichever players run out of cards", correct:false, feedback:"The goal is to always find a way to give every player a 7th card — skipping players isn't the answer."},
          {text:"Reshuffle the current round's discards to make more cards", correct:false, feedback:"Never reshuffle this round's player discards — only the muck, burns, and the last card off the deck are fair game for a reshuffle."}
        ]
      },
      { street:"Showdown", prompt:showdownPrompt, options:showdownOptions }
    ];
  }

  const DATA = [
    {
      tag: "House Rules",
      desc: "Core principles that apply across every format",
      games: [
        { name:"General Floor Rules", pot:"single", meta:"4 core rules · applies to every game", flow:[
          "Always burn before dealing new cards to players or the board — no exceptions",
          "Split pot odd chip defaults to the best 5-card hand, unless the game says otherwise",
          "Reshuffle only the muck, burns, and the last card off the deck — never this round's discards",
          "On 7th street, prioritize giving every player a card, even if it takes a burn-as-community-card"
        ], notes:"These four rules apply underneath every single game on the sheet. Know these cold before anything else.",
        scenario:[
          {
            street:"Golden Rule",
            prompt:"You're dealing any format and there's a street where nobody's drawing and there's been no action at all. Do you still burn before the next card?",
            options:[
              {text:"Yes — always burn before dealing new cards, no exceptions, even with zero action", correct:true, feedback:"Correct. This is the Golden Rule and it has no exceptions — burn before every new street or draw, always."},
              {text:"No — skip the burn if nothing happened that street", correct:false, feedback:"The burn still happens regardless of action. This rule exists specifically because it's tempting to skip it when nothing's going on."},
              {text:"Only burn if a player asks for it", correct:false, feedback:"The burn isn't optional or player-triggered — it's automatic, every time, every street."}
            ]
          },
          {
            street:"Odd Chip",
            prompt:"You're chopping a split pot and there's an odd chip left over with no game-specific rule stated. Who gets it by default?",
            options:[
              {text:"The best 5-card hand", correct:true, feedback:"Correct — that's the default. Specific games override this, like Archie (best high hand) or the Drawmaha family (best draw hand)."},
              {text:"Always the high hand, no matter the game", correct:false, feedback:"Not the universal default — the baseline rule is the best 5-card hand, though some games do override toward the high hand specifically."},
              {text:"Split it into smaller denomination chips", correct:false, feedback:"An odd chip by definition can't be split evenly — it has to go to one side."}
            ]
          },
          {
            street:"Reshuffling",
            prompt:"You're short on cards mid-hand and need to reshuffle. What are you allowed to reshuffle back in?",
            options:[
              {text:"Only the muck, burn cards, and the last card off the deck — never this round's player discards", correct:true, feedback:"Correct. And the last card off the deck itself is never dealt or used as a burn once it's back in play."},
              {text:"Any cards not currently in a player's hand, including this round's discards", correct:false, feedback:"This round's discards are off-limits — only the muck, burns, and the deck's last card can go back in."},
              {text:"Just the burn cards, nothing else", correct:false, feedback:"The muck and the last card off the deck are fair game too, not just burns."}
            ]
          },
          {
            street:"Protection",
            difficulty:1,
            prompt:"A player's hole cards are sitting unprotected near the edge of the table as you sweep the muck. What's the dealer's responsibility?",
            options:[
              {text:"Pause and let the player protect their hand before the muck passes", correct:true, feedback:"Right. A hand that touches the muck is dead, so a good dealer creates the moment for the player to protect it rather than sweeping through."},
              {text:"Sweep normally — protecting the hand is entirely the player's job", correct:false, feedback:"Protection is the player's responsibility, but a dealer who sweeps carelessly creates avoidable rulings. Slow down and give them the beat."},
              {text:"Push their cards back toward them", correct:false, feedback:"Never handle a live hand. Pause, make eye contact, let them protect it themselves."}
            ]
          },
          {
            street:"Dead Hand",
            difficulty:2,
            prompt:"Two cards from a player's hand touch the muck pile while action is still live. What's the status of that hand?",
            options:[
              {text:"The hand is dead — cards that reach the muck cannot be retrieved", correct:true, feedback:"Correct. The muck is a one-way boundary. This is why protecting a hand matters and why the muck stays clearly separated."},
              {text:"Retrievable if the dealer can identify the exact cards", correct:false, feedback:"Identifiability isn't the test — the muck is final regardless of whether the cards are distinguishable."},
              {text:"Live if the player hadn't released them intentionally", correct:false, feedback:"Intent doesn't reverse it. Once the cards reach the muck the hand is dead."}
            ]
          },
          {
            street:"Deck Handling",
            difficulty:1,
            prompt:"During a hand you notice the deck was never cut before the deal. What does this affect?",
            options:[
              {text:"Deck integrity — the cut is what makes the shuffle verifiable to the table", correct:true, feedback:"Right. The cut is a game-security step, not a formality. Skipping it undermines the table's confidence in every hand that follows."},
              {text:"Nothing, as long as the shuffle was thorough", correct:false, feedback:"A thorough shuffle still isn't verifiable without the cut. The cut is what the table can see."},
              {text:"Only the burn card sequence", correct:false, feedback:"Burns are unrelated. The cut is about deck security before any card leaves the deck."}
            ]
          },
          {
            street:"7th Street",
            prompt:"You're on 7th street in a stud-format game and the deck's short. What's the priority?",
            options:[
              {text:"Try to shuffle in burns and still give everyone a 7th card; if that's not possible, use a burn card as a shared community card so every player still gets one", correct:true, feedback:"Exactly right — the priority is always making sure every player gets their 7th street card, even if it takes a creative fix."},
              {text:"Skip 7th street for whichever players run out of cards first", correct:false, feedback:"The goal is to find a way to give every player a 7th card, not to leave anyone short."},
              {text:"End the hand early and chop the pot among remaining players", correct:false, feedback:"That's a last resort, not the first move — always try the burn-shuffling and community-card fixes first."}
            ]
          }
        ]}
      ]
    },
    {
      tag: "Triple Draw",
      desc: "Down cards only, no board",
      games: [
        { name:"Badugi", dealCat:"draw4", maxPlayers:7, pot:"single", meta:"4 cards · 3 draws · max 7", flow:[
          "Deal 4 down to each player",
          "Betting round",
          "Burn, then Draw 1 — betting round",
          "Burn, then Draw 2 — betting round",
          "Burn, then Draw 3 — betting round",
          "Showdown"
        ], notes:"Best hand: 4 unpaired, unsuited, ace-low cards. Always burn before every draw, even with no action.",
        scenario: tripleDrawSteps({
          downCards:4,
          showdownPrompt:"Final betting's done. What's the best possible Badugi hand?",
          showdownOptions:[
            {text:"4 unpaired, unsuited cards, ace playing low — e.g. A♠2♥3♣4♦", correct:true, feedback:"That's the nuts in Badugi — four different ranks, four different suits, ace low."},
            {text:"5 unpaired, unsuited cards, ace playing low", correct:false, feedback:"Badugi is a 4-card game, not 5 — you're thinking of A-5 lowball."},
            {text:"Any 4-card straight, suits don't matter", correct:false, feedback:"Straights don't matter in Badugi at all — it's about rank and suit uniqueness, not sequence."}
          ]
        })},
        { name:"A-5 Lowball", dealCat:"draw5", maxPlayers:6, pot:"single", meta:"5 cards · 3 draws · max 6", flow:[
          "Deal 5 down to each player",
          "Betting round",
          "Burn, then Draw 1 — betting round",
          "Burn, then Draw 2 — betting round",
          "Burn, then Draw 3 — betting round",
          "Showdown"
        ], notes:"Straights and flushes don't count against you. UTG sits out if table is 7-handed.",
        scenario: tripleDrawSteps({
          downCards:5,
          showdownPrompt:"Final betting's done. What's the best possible A-5 hand, and do straights/flushes matter?",
          showdownOptions:[
            {text:"A-2-3-4-5, any suits — straights and flushes don't count against you", correct:true, feedback:"Correct, the wheel plays regardless of suits, since flushes and straights aren't counted against the hand in A-5."},
            {text:"A-2-3-4-5, but only if it's not all one suit", correct:false, feedback:"Suits don't matter in A-5 — flushes aren't counted against the hand."},
            {text:"7-5-4-3-2 unsuited, since aces play high", correct:false, feedback:"That's the 2-7 nut low, not A-5. In A-5 the ace plays low and completes the wheel."}
          ]
        })},
        { name:"2-7 Lowball", dealCat:"draw5", maxPlayers:6, pot:"single", meta:"5 cards · 3 draws · max 6", flow:[
          "Deal 5 down to each player",
          "Betting round",
          "Burn, then Draw 1 — betting round",
          "Burn, then Draw 2 — betting round",
          "Burn, then Draw 3 — betting round",
          "Showdown"
        ], notes:"Ace plays high. Straights and flushes count against you — best hand is 7-5-4-3-2 unsuited.",
        scenario: tripleDrawSteps({
          downCards:5,
          showdownPrompt:"Final betting's done. What's the best possible 2-7 hand?",
          showdownOptions:[
            {text:"7-5-4-3-2, unsuited — straights and flushes count against you, ace plays high", correct:true, feedback:"That's the 2-7 nut low. Since straights and flushes count against you, the ace has to play high to avoid completing a wheel-type straight."},
            {text:"A-2-3-4-5, since ace plays low", correct:false, feedback:"That's the A-5 nut low. In 2-7, the ace plays high, which is exactly why the wheel isn't the target hand here."},
            {text:"7-5-4-3-2, any suits including all one suit", correct:false, feedback:"Straights and flushes count against you in 2-7, so a flush would actually ruin this hand."}
          ]
        })},
        { name:"Badacey", dealCat:"draw5", maxPlayers:6, pot:"split", meta:"5 cards · 3 draws · max 6", flow:[
          "Deal 5 down to each player",
          "Betting round",
          "Burn, then Draw 1 — betting round",
          "Burn, then Draw 2 — betting round",
          "Burn, then Draw 3 — betting round",
          "Showdown"
        ], notes:"50% best Badugi (4-card) + 50% best A-5 low (5-card). Odd chip → best 5-card hand.",
        scenario: tripleDrawSteps({
          extraStep: {
            street:"Draw",
            difficulty:2,
            prompt:"In Badacey, which low ranking is used for the five-card half?",
            options:[
              {text:"A-5 low — the ace plays low and straights and flushes are ignored", correct:true, feedback:"Correct. Badacey pairs a badugi with an A-5 low, so A-2-3-4-5 is the nut low on that half."},
              {text:"2-7 low — the ace plays high", correct:false, feedback:"That is Baducey. The names differ by exactly this: Badacey uses A-5, Baducey uses 2-7."},
              {text:"Whichever the player declares", correct:false, feedback:"There is no declaration. The low ranking is fixed by the game."}
            ]
          },
          downCards:5,
          showdownPrompt:"Final betting's done — this is a split pot game. What are you awarding it to?",
          showdownOptions:[
            {text:"50% best Badugi (4-card) + 50% best A-5 low (5-card), odd chip to the best 5-card hand", correct:true, feedback:"Right — Badacey splits between the two, and the odd chip breaks toward the 5-card A-5 side."},
            {text:"50% best Badugi + 50% best 2-7 low", correct:false, feedback:"That combo is Baducey, not Badacey. Badacey pairs Badugi with A-5 low specifically."},
            {text:"Whole pot to whoever has the best Badugi", correct:false, feedback:"This is a split-pot game — the A-5 low hand gets an equal share, it's not winner-take-all."}
          ]
        })},
        { name:"Baducey", dealCat:"draw5", maxPlayers:6, pot:"split", meta:"5 cards · 3 draws · max 6", flow:[
          "Deal 5 down to each player",
          "Betting round",
          "Burn, then Draw 1 — betting round",
          "Burn, then Draw 2 — betting round",
          "Burn, then Draw 3 — betting round",
          "Showdown"
        ], notes:"50% best Badugi (4-card) + 50% best 2-7 low (5-card). Odd chip → best 5-card hand.",
        scenario: tripleDrawSteps({
          extraStep: {
            street:"Draw",
            difficulty:2,
            prompt:"In Baducey, which low ranking is used for the five-card half?",
            options:[
              {text:"2-7 low — the ace plays high and straights and flushes count against you", correct:true, feedback:"Correct. Baducey pairs a badugi with a 2-7 low, so 7-5-4-3-2 unsuited is the nut low on that half."},
              {text:"A-5 low — the ace plays low", correct:false, feedback:"That is Badacey. The one-letter difference in the name is the whole distinction."},
              {text:"The same ranking as the badugi half", correct:false, feedback:"The two halves use different rankings — that is what makes it a split game."}
            ]
          },
          downCards:5,
          showdownPrompt:"Final betting's done — this is a split pot game. What are you awarding it to?",
          showdownOptions:[
            {text:"50% best Badugi (4-card) + 50% best 2-7 low (5-card), odd chip to the best 5-card hand", correct:true, feedback:"Right — Baducey splits between the two, and the odd chip breaks toward the 5-card 2-7 side."},
            {text:"50% best Badugi + 50% best A-5 low", correct:false, feedback:"That combo is Badacey, not Baducey. Baducey pairs Badugi with 2-7 low specifically."},
            {text:"Whole pot to whoever has the best Badugi", correct:false, feedback:"This is a split-pot game — the 2-7 low hand gets an equal share, it's not winner-take-all."}
          ]
        })},
        { name:"Archie", dealCat:"draw5", maxPlayers:6, pot:"qual", meta:"5 cards · 3 draws · max 6 · qualifier", flow:[
          "Deal 5 down to each player",
          "Betting round",
          "Burn, then Draw 1 — betting round",
          "Burn, then Draw 2 — betting round",
          "Burn, then Draw 3 — betting round",
          "Showdown"
        ], notes:"High (pair of 9s or better) / Low (8-or-better). No qualifiers either way → pot splits among remaining players. Odd chip → best high hand.",
        scenario: tripleDrawSteps({
          downCards:5,
          showdownPrompt:"Final betting's done. Walk through the Archie payout.",
          showdownOptions:[
            {text:"50% to best High (pair of 9s or better) + 50% to best Low (8-or-better) — if nobody qualifies either way, the pot splits among remaining players; odd chip to the high hand", correct:true, feedback:"That's Archie. Remember — if nobody qualifies, it's not a scoop, the pot just splits among whoever's left in the hand."},
            {text:"50% High + 50% Low, no qualifiers required at all", correct:false, feedback:"Archie has real qualifiers — pair of 9s or better for high, 8-or-better for low. Without meeting them, that side doesn't win outright."},
            {text:"If nobody qualifies for low, the whole pot goes to the best high hand", correct:false, feedback:"Not in Archie — if neither side qualifies, the pot splits among the remaining players rather than getting scooped by one side."}
          ]
        })}
      ]
    },
    {
      tag: "7-Card Stud",
      desc: "Individual up/down cards, 3rd–7th street",
      games: [
        { name:"Stud Hi-Lo / 8-or-Better", dealCat:"studSplit", maxPlayers:7, pot:"single/split", meta:"2 down, 1 up to start", flow:[
          "3rd street: 2 down + 1 up — low card brings it in",
          "Burn, deal 4th street — betting round",
          "Burn, deal 5th street — betting round",
          "Burn, deal 6th street — betting round",
          "Burn, deal 7th street down — betting round",
          "Showdown"
        ], notes:"Low brings in, high drives the action. Announce pairs as they hit.",
        scenario: sevenStudSteps({
          bringInPrompt:"3rd street is out. Tap the player who has the bring-in.",
          bringInTaskType:"select-seat",
          bringInResolve: s => s.bringInSeat,
          bringInExplain: (s, given, expected, correct) => correct
            ? "Correct — in Stud Hi-Lo the LOWEST card showing brings it in."
            : "In Stud Hi-Lo the lowest door card brings it in. That's Player " + (expected + 1) + ", not Player " + (given + 1) + ".",
          bringInOptions:[
            {text:"The player showing the lowest card up", correct:true, feedback:"Correct — for Hi-Lo and 8-or-better, low brings it in and high drives the action from there."},
            {text:"The player showing the highest card up", correct:false, feedback:"That's the Razz rule. In Hi-Lo/8b it's the opposite — lowest card up brings it in."},
            {text:"Whoever posted the big blind", correct:false, feedback:"Stud doesn't use blinds — bring-in is determined by the door card, not a forced bet position."}
          ],
          showdownPrompt:"Final betting's done. What determines the winner in Stud 8-or-better?",
          showdownOptions:[
            {text:"Split pot — 50% best Hi hand + 50% best 8-or-better Lo hand (if no low qualifies, Hi scoops)", correct:true, feedback:"Right — and remember, if nobody has an 8-or-better low, the high hand takes the whole pot."},
            {text:"Always split 50/50, no qualifier needed for the low side", correct:false, feedback:"The 8-or-better qualifier matters — without it, there's no low hand to split with, and Hi scoops."},
            {text:"Winner take all to the best high hand, no low side at all", correct:false, feedback:"This is a hi-lo split format — there's a genuine low side in play whenever a qualifying hand shows up."}
          ]
        })},
        { name:"Razz", dealCat:"studSplit", maxPlayers:7, pot:"single", meta:"2 down, 1 up to start", flow:[
          "3rd street: 2 down + 1 up — high card brings it in",
          "Burn, deal 4th street — betting round",
          "Burn, deal 5th street — betting round",
          "Burn, deal 6th street — betting round",
          "Burn, deal 7th street down — betting round",
          "Showdown"
        ], notes:"High brings in, low drives the action — the opposite of Hi-Lo bring-in. Announce pairs as they hit.",
        scenario: sevenStudSteps({
          bringInPrompt:"3rd street is out. Tap the player who has the bring-in.",
          bringInTaskType:"select-seat",
          bringInResolve: s => s.bringInSeat,
          bringInExplain: (s, given, expected, correct) => correct
            ? "Correct — in Razz the highest card showing is forced to bring it in."
            : "In Razz the highest door card brings it in. That's Player " + (expected + 1) + ", not Player " + (given + 1) + ".",
          bringInOptions:[
            {text:"The player showing the highest card up", correct:true, feedback:"Right — in Razz, the worst-looking hand (highest card showing) is forced to bring it in and act first."},
            {text:"The player showing the lowest card up", correct:false, feedback:"That's the bring-in rule for Stud Hi-Lo and 8-or-better, not Razz. In Razz it flips — highest card up brings it in."},
            {text:"The player to the left of the dealer button, like a flop game", correct:false, feedback:"Stud games don't use a button for action order — it's determined by the cards showing, not seating position."}
          ],
          showdownPrompt:"Final betting's done. In Razz, what's the best possible hand?",
          showdownOptions:[
            {text:"A-2-3-4-5, the wheel, ace playing low", correct:true, feedback:"Correct — that's the nut low in Razz, same target hand as A-5 lowball."},
            {text:"7-5-4-3-2 unsuited", correct:false, feedback:"That's the 2-7 nut low. Razz plays like A-5 — ace low, and straights/flushes don't count against you."},
            {text:"Any pair or better, high hand wins", correct:false, feedback:"Razz is a low-only game — the lowest 5-card hand wins, not the highest."}
          ]
        })},
        { name:"Super Stud Hi-Lo 8 / Super Pat", dealCat:"superStud", maxPlayers:7, pot:"split", meta:"4 down, 1 up · max 7", flow:[
          "Deal 4 down + 1 up",
          "Discard 2 down before 4th street — or declare Pat",
          "Burn, deal 4th street — betting round",
          "Burn, deal 5th street — betting round",
          "Burn, deal 6th street — betting round",
          "Burn, deal 7th street — betting round",
          "Showdown"
        ], notes:"Hi-Lo split, 8-or-better qualifier. A Super Pat player keeps the original five cards, takes no more cards, and drives betting every round after — but their five-card hand still plays for BOTH high and low. Multiple Pats → bring-in acts as the button. No qualifying low → high takes the whole pot.",
        scenario: superStudSteps({
          showdownPrompt:"Final betting's done. How is this pot awarded?",
          showdownOptions:[
            {text:"50% best Hi hand + 50% best 8-or-better Lo hand, odd chip to the Hi hand", correct:true, feedback:"Correct — this is a Hi-Lo split. The low must be eight-high or better to qualify, and when the pot splits unevenly the odd chip goes to the high side."},
            {text:"Winner take all to the best 5-card high hand", correct:false, feedback:"That is the generic high-only Super Stud family. The game spread here is Hi-Lo 8-or-better, so a qualifying low takes half the pot."},
            {text:"50% Hi + 50% Lo with any low qualifying, no 8-or-better requirement", correct:false, feedback:"The low must be eight-high or better. With no qualifying low, the high hand takes the entire pot."}
          ]
        })},
        { name:"Super Baducey", dealCat:"superStud", maxPlayers:7, pot:"split", meta:"4 down, 1 up · max 7", flow:[
          "Deal 4 down + 1 up",
          "Discard 2 down before 4th street",
          "Burn, deal 4th–7th street — betting each round",
          "Showdown"
        ], notes:"High brings in, low hand drives action. 50% Badugi + 50% best 2-7 low. Odd chip → low/best 5-card hand.",
        scenario: superStudSteps({
          showdownPrompt:"Final betting's done. What are you paying out?",
          showdownOptions:[
            {text:"50% best Badugi + 50% best 2-7 low, odd chip to the low/best 5-card hand", correct:true, feedback:"Correct — same low-hand-gets-the-odd-chip rule as the triple draw version of this split."},
            {text:"50% best Badugi + 50% best A-5 low", correct:false, feedback:"That combo is Super Badacey. Super Baducey pairs Badugi with 2-7 low specifically."},
            {text:"Winner take all to the best 5-card hand", correct:false, feedback:"This is a split pot — Badugi and 2-7 low each take half, not winner-take-all."}
          ]
        })},
        { name:"Super Badacey", dealCat:"superStud", maxPlayers:7, pot:"split", meta:"4 down, 1 up · max 7", flow:[
          "Deal 4 down + 1 up",
          "Discard 2 down before 4th street",
          "Burn, deal 4th–7th street — betting each round",
          "Showdown"
        ], notes:"High brings in, low hand drives action. 50% Badugi + 50% best A-5 low. Odd chip → low/best 5-card hand.",
        scenario: superStudSteps({
          showdownPrompt:"Final betting's done. What are you paying out?",
          showdownOptions:[
            {text:"50% best Badugi + 50% best A-5 low, odd chip to the low/best 5-card hand", correct:true, feedback:"Correct — same low-hand-gets-the-odd-chip rule as the triple draw version of this split."},
            {text:"50% best Badugi + 50% best 2-7 low", correct:false, feedback:"That combo is Super Baducey. Super Badacey pairs Badugi with A-5 low specifically."},
            {text:"Winner take all to the best 5-card hand", correct:false, feedback:"This is a split pot — Badugi and A-5 low each take half, not winner-take-all."}
          ]
        })}
      ]
    },
    {
      tag: "Omaha & Flop",
      desc: "Hole cards + shared community board",
      games: [
        { name:"Big O Hi-Lo", dealCat:"bigO", maxPlayers:7, pot:"split", meta:"5 hole cards · Omaha board · 8-or-better", flow:[
          "Deal 5 hole cards face down to each player",
          "Betting round",
          "Burn, deal flop (3) — betting round",
          "Burn, deal turn — betting round",
          "Burn, deal river — betting round",
          "Showdown: 50% best Hi + 50% best 8-or-better Lo"
        ], notes:"Five-card Omaha, high-low split. Both the high AND the low must use exactly 2 hole cards + 3 board cards. Low qualifies at 8-or-better; if no low qualifies, the high scoops.",
        scenario:[
          {
            street:"Deal",
            prompt:"New Big O Hi-Lo hand. How many cards does each player get, and how are they dealt?",
            options:[
              {text:"5 cards, all face down, one at a time around the table", correct:true, feedback:"Right — Big O is five-card Omaha. All five go out face down, one card per player per pass."},
              {text:"4 cards face down, like standard Omaha", correct:false, feedback:"That's regular Omaha. Big O gives each player five hole cards, not four."},
              {text:"5 cards, with the last one face up", correct:false, feedback:"No up cards in Big O — it's a flop game, all hole cards stay face down until showdown."}
            ]
          },
          {
            street:"Pre-Flop",
            prompt:"Betting is complete. What's next?",
            options:[
              {text:"Burn one card, then deal the flop (3 cards)", correct:true, feedback:"Correct — always burn before the board, same as any flop game."},
              {text:"Deal the flop with no burn", correct:false, feedback:"The Golden Rule applies: always burn before dealing to the board."},
              {text:"Let players discard down to 4 cards first", correct:false, feedback:"There's no discard in Big O — players keep all five hole cards through the hand."}
            ]
          },
          {
            street:"Flop",
            prompt:"A player has four spades in the hole and there are two spades on the flop. Do they have a flush draw?",
            options:[
              {text:"They need exactly 2 hole cards + 3 board cards, so they'd need three spades on the board", correct:true, feedback:"Exactly — the 2+3 rule is absolute in Big O. Four spades in hand doesn't help unless three come on the board."},
              {text:"Yes — four in hand plus two on board makes six spades", correct:false, feedback:"That's Hold'em thinking. Omaha construction requires exactly two from hand and exactly three from the board."},
              {text:"Yes, because Big O allows using any number of hole cards", correct:false, feedback:"Big O follows strict Omaha rules — exactly two hole cards, no more, no fewer."}
            ]
          },
          {
            street:"Turn",
            prompt:"Turn is out and bet. What's next?",
            options:[
              {text:"Burn, then deal the river", correct:true, feedback:"Correct — burn before the final board card."},
              {text:"Go straight to showdown", correct:false, feedback:"The river still has to come out and be bet on."},
              {text:"Deal the river with no burn since it's the last card", correct:false, feedback:"Every board card gets a burn, including the river."}
            ]
          },
          {
            street:"Showdown",
            prompt:"The board is K-9-7-4-2. One player shows A-2-3-5-6. What do they have for low, and does it qualify?",
            options:[
              {text:"They use exactly 2 hole cards + 3 board cards — A-2 with 7-4-2 gives 7-4-3-2-A, which qualifies (8-or-better)", correct:true, feedback:"Right. The low still obeys the 2+3 rule, and any five unpaired cards eight-or-lower qualify."},
              {text:"No qualifying low, because the board only has three low cards", correct:false, feedback:"Three low cards on the board is exactly enough — the player supplies the other two from their hand."},
              {text:"They can use A-2-3 from hand plus 4-2 from the board", correct:false, feedback:"That's three hole cards. Big O requires exactly two from hand for the low as well as the high."}
            ]
          },
          {
            street:"Turn",
            difficulty:2,
            prompt:"Three players are live. The board is 8-7-2 with two hearts. A player asks whether a low is still possible. What determines it?",
            options:[
              {text:"Three board cards eight-or-lower must be available — 8-7-2 already qualifies", correct:true, feedback:"Right. The board must supply three low cards for any low to exist, and 8-7-2 does. Two more low cards are not required."},
              {text:"At least four low cards must appear on the board", correct:false, feedback:"Only three are needed, because the player supplies exactly two from their hand."},
              {text:"A low is impossible once a flush draw is present", correct:false, feedback:"Flushes and lows are independent in Big O — straights and flushes never count against the low."}
            ]
          },
          {
            street:"Showdown",
            difficulty:3,
            prompt:"Two players tie for the best low and a third wins the high. The pot is $301. How is it distributed?",
            options:[
              {text:"High takes $151, the two low winners take $75 each", correct:true, feedback:"Correct. The pot halves to $150 low and $151 high (odd chip to high), then the low half quarters between the tied players."},
              {text:"High takes $150, low winners take $75.50 each", correct:false, feedback:"Chips do not split into halves. The odd chip goes to the high side, leaving an even $150 to quarter."},
              {text:"Each of the three players receives $100", correct:false, feedback:"This is a split-pot game, not a three-way chop. The high half and low half are awarded separately."}
            ]
          },
          {
            street:"Showdown",
            prompt:"No player can make an 8-or-better low. How does the pot get awarded?",
            options:[
              {text:"The best high hand scoops the entire pot", correct:true, feedback:"Correct — with no qualifying low, there's no low half to award, so high takes it all."},
              {text:"The pot splits between the two best high hands", correct:false, feedback:"Only if they tie. Otherwise the single best high hand takes the whole pot."},
              {text:"The lowest hand takes the low half even without qualifying", correct:false, feedback:"The 8-or-better qualifier is absolute — no qualifier means no low winner."}
            ]
          }
        ]},
        { name:"Big O PLO", dealCat:"bigO", maxPlayers:7, pot:"single", meta:"5 hole cards · Omaha board · high only", flow:[
          "Deal 5 hole cards face down to each player",
          "Betting round",
          "Burn, deal flop (3) — betting round",
          "Burn, deal turn — betting round",
          "Burn, deal river — betting round",
          "Showdown: best Omaha high hand"
        ], notes:"Five-card Omaha, high only. Exactly 2 hole cards + 3 board cards. Played pot-limit in the room; this trainer covers dealing procedure, not betting math.",
        scenario:[
          {
            street:"Deal",
            prompt:"New Big O PLO hand. What goes out to each player?",
            options:[
              {text:"5 hole cards face down, one at a time around the table", correct:true, feedback:"Right — same five-card deal as Big O Hi-Lo. Only the showdown differs."},
              {text:"4 hole cards face down", correct:false, feedback:"That's standard PLO. Big O deals five."},
              {text:"5 hole cards, players discard one before the flop", correct:false, feedback:"No discard in Big O — that's a Pineapple-family mechanic."}
            ]
          },
          {
            street:"Pre-Flop",
            prompt:"Betting is done. What's next?",
            options:[
              {text:"Burn, then deal the flop (3 cards)", correct:true, feedback:"Correct — burn before every board card."},
              {text:"Deal the flop with no burn", correct:false, feedback:"Always burn before the board."},
              {text:"Deal a fourth street card to each player", correct:false, feedback:"Big O is a flop game — all remaining cards go to the shared board, not to players."}
            ]
          },
          {
            street:"Flop",
            taskType:"numeric-amount",
            difficulty:2,
            prompt:'A player says "POT." What is the maximum total wager?',
            resolve: s => s.potLimitMax,
            explain: (s, given, expected, correct) => {
              const seat = s.currentActor;
              const toCall = (s.callAmounts && s.callAmounts[seat]) || 0;
              const live = Object.keys(s.streetContrib).reduce((n,k) => n + s.streetContrib[k], 0);
              const potNow = (s.pot || 0) + live;
              const base = 'There is $' + potNow + ' on the table. They first call $' + toCall +
                ', then may raise by that new total — maximum total wager $' + expected + '.';
              return correct ? 'Correct — ' + base : base;
            },
            options:[]
          },
          {
            street:"Flop",
            prompt:"The board shows A-K-Q all spades. A player holds one spade. Can they make a flush?",
            options:[
              {text:"No — they need exactly two spades in hand to use three from the board", correct:true, feedback:"Correct. One hole spade can't work: the 2+3 rule means they'd be using only one hole card."},
              {text:"Yes, one spade plus three board spades makes a flush", correct:false, feedback:"That's four cards using only one from hand. Omaha requires exactly two hole cards."},
              {text:"Yes, they can play the board's flush", correct:false, feedback:"You can never play the board in Omaha — two hole cards must always be used."}
            ]
          },
          {
            street:"Turn/River",
            prompt:"The board runs out J-T-9-8-7. A player holds A-K-2-3-4. Do they have a straight?",
            options:[
              {text:"No — the board straight can't be played, and their two best hole cards don't complete one", correct:true, feedback:"Right. This is the classic board-made-hand trap: in Omaha the board alone is never a hand, and A-K doesn't connect to J-T-9-8-7."},
              {text:"Yes, the board makes a straight so everyone has it", correct:false, feedback:"Playing the board is impossible in Omaha — exactly two hole cards must be used."},
              {text:"Yes, they can use the A for a broadway straight", correct:false, feedback:"That would need one hole card, and there's no K-Q-J-T-A available using exactly two from hand plus three from board."}
            ]
          },
          {
            street:"Showdown",
            prompt:"How is the winner determined?",
            options:[
              {text:"Best high hand using exactly 2 hole cards + 3 board cards — no low side", correct:true, feedback:"Correct. Big O PLO is high only; the whole pot goes to the best Omaha high hand."},
              {text:"Split between best high and best 8-or-better low", correct:false, feedback:"That's Big O Hi-Lo. The PLO version is high only."},
              {text:"Best five-card hand using any combination of hole and board cards", correct:false, feedback:"That's Hold'em construction. Omaha is strictly two from hand, three from board."}
            ]
          }
        ]},
        { name:"Drawmaha Hi", dealCat:"drawmaha", maxPlayers:6, pot:"split", meta:"5 hole cards · Omaha board · max 6", flow:[
          "Deal 5 hole cards — betting round",
          "Burn, deal flop (3) — betting round",
          "Players declare draw (up to 3 cards)",
          "Burn, deal turn — deal replacements (no burn) — betting round",
          "Burn, deal river — betting round",
          "Showdown"
        ], notes:"50% best Omaha Hi (2 hand + 3 board) + 50% best 5-card draw Hi. Odd chip → best draw hand.",
        scenario:[
          {
            street:"Deal",
            prompt:"New hand. Cards are shuffled. What do you do first?",
            options:[
              {text:"Deal 5 hole cards to each player, no burn", correct:true, feedback:"Right — there's no burn before the very first deal of a hand. Burns start before the next street."},
              {text:"Burn one card, then deal 5 hole cards", correct:false, feedback:"No burn before the initial deal — that's the very first cards out of a fresh shuffle. You'll start burning before the flop."},
              {text:"Deal the flop first, then hole cards", correct:false, feedback:"Hole cards always go out before any board cards. The flop hasn't happened yet."}
            ]
          },
          {
            street:"Pre-Flop",
            prompt:"Betting on the hole cards just wrapped up. What's next?",
            options:[
              {text:"Burn, then deal the flop (3 cards)", correct:true, feedback:"Correct. Golden rule — always burn before dealing new cards to the board, every time."},
              {text:"Deal the flop, no burn needed", correct:false, feedback:"The Golden Rule applies here: you always burn before dealing to the board, even though it feels routine."},
              {text:"Ask players to declare their draw now", correct:false, feedback:"Too early — the draw declaration comes after the flop is out and bet on, not before."}
            ]
          },
          {
            street:"Flop",
            prompt:"Flop's out, betting is done. Players are ready to draw. What's next?",
            options:[
              {text:"Have players declare their draw (up to 3 cards) — no cards dealt yet", correct:true, feedback:"Right — declaration comes first. No burn or deal happens for a declaration, just players stating how many cards they want."},
              {text:"Burn, then deal replacement cards immediately", correct:false, feedback:"Not yet — players need to declare how many cards they're drawing before anything gets dealt."},
              {text:"Burn, then deal the turn to the board", correct:false, feedback:"The turn and the draw replacements happen together in this game, but the draw has to be declared first."}
            ]
          },
          {
            street:"Draw Declared",
            requiresDraw:true,   // PHYSICAL draw street: cards are actually replaced here
            prompt:"Draws are declared. Now you deal the turn AND get players their replacement cards. How many times do you burn?",
            options:[
              {text:"Burn once — deal the turn to the board, then deal replacements to players with no second burn", correct:true, feedback:"Exactly right. This is Drawmaha's signature quirk: one burn covers both the turn card and the players' replacement cards."},
              {text:"Burn once for the turn, burn again before replacements", correct:false, feedback:"That's the instinct from other games, but Drawmaha only burns once here — the single burn covers both the turn and the replacement deal."},
              {text:"No burn needed since players are just replacing cards", correct:false, feedback:"You do burn once — for the turn card going to the board. It just doesn't repeat for the replacement cards."}
            ]
          },
          {
            street:"Turn",
            prompt:"Turn and replacements are out, betting's done. What's next?",
            options:[
              {text:"Burn, then deal the river", correct:true, feedback:"Correct — standard burn before the final board card."},
              {text:"Deal the river with no burn", correct:false, feedback:"Golden Rule again — always burn before a new community card, including the river."},
              {text:"Go straight to showdown", correct:false, feedback:"Not yet — the river still needs to come out and get bet on first."}
            ]
          },
          {
            street:"Showdown",
            prompt:"River's out, final betting's done. The pot splits. What two hands are you awarding it to?",
            options:[
              {text:"50% best Omaha Hi (2 hole + 3 board) + 50% best 5-card draw hand (all 5 hole cards)", correct:true, feedback:"That's the split. And if there's an odd chip, it goes to the best draw hand, not the Omaha side."},
              {text:"50% best Omaha Hi + 50% best Omaha Lo", correct:false, feedback:"There's no Omaha Lo side in this game — that's a different split-pot format. Drawmaha Hi pairs Omaha Hi with a straight 5-card draw hand."},
              {text:"Whole pot to the best overall 5-card hand", correct:false, feedback:"This is a split-pot game — half goes to the board-based Omaha hand, half to the draw hand made entirely from hole cards."}
            ]
          }
        ]},
        { name:"Drawmaha A-5", dealCat:"drawmaha", maxPlayers:6, pot:"split", meta:"5 hole cards · Omaha board · max 6", flow:[
          "Same flow as Drawmaha Hi — draw hand scored as A-5 low"
        ], notes:"50% Omaha Hi + 50% best A-5 low in hole cards. Odd chip → best draw hand.",
        scenario: drawmahaScenario({
          extraStep: {
            street:"Draw",
            difficulty:2,
            prompt:"On the draw side of Drawmaha A-5, does a flush in your five hole cards hurt your low?",
            options:[
              {text:"No — straights and flushes do not count against an A-5 low", correct:true, feedback:"Correct. A-5 scoring ignores straights and flushes entirely, so A-2-3-4-5 of one suit is still the nuts on that side."},
              {text:"Yes — a flush disqualifies the low", correct:false, feedback:"That is 2-7 scoring. In A-5 the suits simply do not matter for the low."},
              {text:"Only if it is an ace-high flush", correct:false, feedback:"Suits never affect an A-5 low, regardless of the high card."}
            ]
          },
          showdownPrompt:"Final betting's done. What is the best possible A-5 low hand here?",
          showdownOptions:[
            {text:"50% best Omaha Hi (board) + 50% best A-5 low using hole cards only, odd chip to the low hand", correct:true, feedback:"Right — the low side is scored from hole cards only, like a straight A-5 lowball hand."},
            {text:"50% Omaha Hi + 50% best 2-7 low", correct:false, feedback:"That's Drawmaha 2-7. This variant pairs Omaha Hi with A-5 low specifically."},
            {text:"Odd chip goes to the Omaha Hi side", correct:false, feedback:"In every Drawmaha variant, the odd chip goes to the draw/low hand side, not the Omaha Hi side."}
          ]
        })},
        { name:"Drawmaha 2-7", dealCat:"drawmaha", maxPlayers:6, pot:"split", meta:"5 hole cards · Omaha board · max 6", flow:[
          "Same flow as Drawmaha Hi — draw hand scored as 2-7 low (ace high)"
        ], notes:"50% Omaha Hi + 50% best 2-7 low in hole cards. Odd chip → best draw hand.",
        scenario: drawmahaScenario({
          extraStep: {
            street:"Draw",
            difficulty:2,
            prompt:"On the draw side of Drawmaha 2-7, a player holds 5-4-3-2-A. How good is that low?",
            options:[
              {text:"Poor — the ace plays high and A-2-3-4-5 makes a straight, both bad for 2-7", correct:true, feedback:"Correct. In 2-7 the ace is a high card and straights count against you, so the wheel is close to worthless on that side."},
              {text:"It is the nuts — the wheel is the best low", correct:false, feedback:"That is A-5 scoring. In 2-7 that same holding is a straight with an ace in it."},
              {text:"Strong, because it contains no pair", correct:false, feedback:"Unpaired is necessary but not sufficient — the straight and the high ace both count against it."}
            ]
          },
          showdownPrompt:"Final betting's done. What is the best possible 2-7 low hand here?",
          showdownOptions:[
            {text:"50% Omaha Hi + 50% best 2-7 low (ace plays high) using hole cards only, odd chip to the low hand", correct:true, feedback:"Correct — and remember ace plays high here since it's 2-7, unlike the A-5 variant."},
            {text:"50% Omaha Hi + 50% best A-5 low", correct:false, feedback:"That's Drawmaha A-5. This variant uses 2-7 low scoring specifically, where the ace plays high."},
            {text:"Straights and flushes don't count against the low hand", correct:false, feedback:"In 2-7 scoring, straights and flushes DO count against you — that's exactly what makes it 2-7 instead of A-5."}
          ]
        })},
        { name:"Drawmaha 49", dealCat:"drawmaha", maxPlayers:6, pot:"split", meta:"5 hole cards · Omaha board", flow:[
          "Same flow as Drawmaha Hi — draw hand scored by point count"
        ], notes:"50% Omaha Hi + 50% highest point count (Aces=1, faces=0, number cards=value, max 49). Odd chip → best draw hand.",
        scenario: drawmahaScenario({
          extraStep: {
            street:"Draw",
            difficulty:2,
            prompt:"On the draw side of Drawmaha 49, what does a hand of K-Q-J-T-9 score?",
            options:[
              {text:"19 points — face cards count zero, the ten and nine count their value", correct:true, feedback:"Correct. Kings, queens and jacks score nothing, so only the T and 9 contribute: 10 + 9 = 19."},
              {text:"49 points — it is the maximum", correct:false, feedback:"The maximum 49 comes from T-T-T-T-9. Face cards are worth nothing at all."},
              {text:"Zero — all five are high cards", correct:false, feedback:"Only J, Q and K score zero. Tens and nines count their face value."}
            ]
          },
          showdownPrompt:"Final betting's done, split pot. What's the payout?",
          showdownOptions:[
            {text:"50% Omaha Hi + 50% highest point count from hole cards (aces=1, faces=0, number cards=value, max 49), odd chip to the point-count hand", correct:true, feedback:"Right — it's a point count contest on the draw side, not a traditional poker hand."},
            {text:"50% Omaha Hi + 50% lowest point count", correct:false, feedback:"It's highest point count that wins the draw side in Drawmaha 49, not lowest."},
            {text:"Face cards count as 10 points each", correct:false, feedback:"Face cards count as 0 in this format — aces count as 1, and number cards count at face value."}
          ]
        })},
        { name:"Drawmaha Badugi", dealCat:"drawmaha", maxPlayers:6, pot:"split", meta:"5 hole cards · Omaha board", flow:[
          "Same flow as Drawmaha Hi — draw hand scored as Badugi"
        ], notes:"50% Omaha Hi + 50% best Badugi in hole cards. Odd chip → best draw hand.",
        scenario: drawmahaScenario({
          extraStep: {
            street:"Draw",
            difficulty:2,
            prompt:"On the draw side of Drawmaha Badugi, a player holds five cards but only three different suits. What is the best badugi possible?",
            options:[
              {text:"A three-card badugi — a badugi needs four distinct suits AND four distinct ranks", correct:true, feedback:"Correct. With only three suits present, no four-card badugi exists no matter how the ranks fall."},
              {text:"A four-card badugi, using the lowest four cards", correct:false, feedback:"Four cards need four different suits. Three suits caps the badugi at three cards."},
              {text:"A five-card badugi, since they hold five cards", correct:false, feedback:"A badugi is never more than four cards, regardless of how many are held."}
            ]
          },
          showdownPrompt:"Final betting's done, split pot. What's the payout?",
          showdownOptions:[
            {text:"50% Omaha Hi + 50% best Badugi (4 unpaired, unsuited cards) from the hole cards, odd chip to the Badugi hand", correct:true, feedback:"Correct — even though players get 5 hole cards, the Badugi side only counts the best 4-card Badugi within those 5."},
            {text:"50% Omaha Hi + 50% best 5-card low hand", correct:false, feedback:"The draw side here is scored as Badugi specifically — best 4 unpaired, unsuited cards, not a straight 5-card low."},
            {text:"All 5 hole cards must be used for the Badugi hand", correct:false, feedback:"Badugi is always best-4-of-however-many-available — you use the best 4 out of the 5 hole cards, not all 5."}
          ]
        })},
        { name:"Double Board Omaha", dealCat:"doubleBoard", maxPlayers:7, pot:"split", meta:"4-5 hole cards · two boards · max 7", flow:[
          "Deal hole cards — betting round",
          "Burn, deal flop on both boards — betting round",
          "Burn, deal turn on both boards — betting round",
          "Burn, deal river on both boards — betting round",
          "Showdown"
        ], notes:"50% best Omaha Hi Top Board + 50% best Omaha Hi Bottom Board. PLO or fixed-limit.",
        scenario:[
          {
            street:"Deal",
            prompt:"New hand. What's dealt to start, and how many boards are in play?",
            options:[
              {text:"4 or 5 hole cards to each player, no burn — two separate community boards will run", correct:true, feedback:"Right — standard Omaha hole cards, but two boards run simultaneously instead of one."},
              {text:"4 or 5 hole cards, and burn before the initial deal", correct:false, feedback:"No burn before the very first deal, same as any other format."},
              {text:"2 hole cards like Hold'em, since there are two boards", correct:false, feedback:"The two-board part refers to the community cards — players still get Omaha-style 4 or 5 hole cards."}
            ]
          },
          {
            street:"Flop",
            prompt:"Preflop betting wraps up. You're dealing the flop to both boards. How many times do you burn?",
            options:[
              {text:"Burn once, then deal 3 cards to each of the two boards", correct:true, feedback:"Correct — one burn covers the flop deal even though it's going out to two boards at once."},
              {text:"Burn once per board — two burns total", correct:false, feedback:"It's one burn per street, regardless of how many boards you're dealing to."},
              {text:"No burn needed since you're not dealing to players", correct:false, feedback:"The Golden Rule covers the board too — always burn before new community cards."}
            ]
          },
          {
            street:"Turn",
            prompt:"Flop betting's done. What's next?",
            options:[
              {text:"Burn once, deal the turn to both boards", correct:true, feedback:"Same pattern — one burn, both boards get their turn card."},
              {text:"Burn twice, once per board", correct:false, feedback:"Still just one burn per street, even with two boards live."},
              {text:"Deal the turn with no burn", correct:false, feedback:"Always burn before a new street, boards or no boards."}
            ]
          },
          {
            street:"River",
            prompt:"Turn betting's done. What's next?",
            options:[
              {text:"Burn once, deal the river to both boards", correct:true, feedback:"Right — same single-burn pattern through the river."},
              {text:"Skip the burn since it's the last street", correct:false, feedback:"The river still gets a burn, same as every other street."},
              {text:"Go straight to showdown", correct:false, feedback:"The river still needs to be dealt and bet on before showdown."}
            ]
          },
          {
            street:"River",
            difficulty:3,
            prompt:"A pot layer of $201 must be split between the boards, and two players tie for the Top Board. How many separate odd-chip decisions are involved?",
            options:[
              {text:"Two — the odd chip between boards goes to the Top Board, then the tied Top winners split their share under the tie rule", correct:true, feedback:"Correct. These are independent decisions and conflating them is a common payout error. Board allocation resolves first, then ties within a board."},
              {text:"One — the odd chip simply goes to whoever wins the Top Board", correct:false, feedback:"That collapses two rules into one. The board split happens first, then the tie within that board is resolved separately."},
              {text:"None — an odd pot is split evenly and the extra chip stays in the rack", correct:false, feedback:"Every chip is awarded. Odd chips always have a defined destination."}
            ]
          },
          {
            street:"Showdown",
            prompt:"Final betting's done. What's the payout?",
            options:[
              {text:"50% best Omaha Hi hand using Top Board + 50% best Omaha Hi hand using Bottom Board", correct:true, feedback:"Correct — each board is scored independently, and the pot splits between them."},
              {text:"Best combined hand using cards from both boards at once", correct:false, feedback:"Boards are scored separately — a player builds one hand vs Top Board and a separate hand vs Bottom Board."},
              {text:"Whichever board has the better hand wins the entire pot", correct:false, feedback:"This is a 50/50 split by board, not winner-take-all."}
            ]
          }
        ]},
        { name:"Pineapple", dealCat:"pineapple", maxPlayers:7, pot:"single", meta:"3 hole cards · Hold'em board · max 7", flow:[
          "Deal 3 hole cards",
          "Discard 1 down to 2 — before any flop betting",
          "Burn, deal flop — betting round",
          "Burn, deal turn — betting round",
          "Burn, deal river — betting round",
          "Showdown"
        ], notes:"Texas Hold'em high hand. Discard happens before the flop is even bet on.",
        scenario:[
          {
            street:"Deal",
            prompt:"New hand. Everyone gets 3 hole cards. What's next?",
            options:[
              {text:"Immediately have players discard down to 2 cards — before any betting happens at all", correct:true, feedback:"Right — in regular Pineapple, the discard happens before even the first betting round."},
              {text:"Preflop betting happens first with all 3 cards, then discard", correct:false, feedback:"That's Crazy Pineapple's order. Regular Pineapple discards immediately, before any betting."},
              {text:"Burn, then deal the flop with players still holding 3 cards", correct:false, feedback:"The discard down to 2 has to happen before the flop, and before any betting."}
            ]
          },
          {
            street:"Pre-Flop",
            prompt:"Players are down to 2 cards. What's next?",
            options:[
              {text:"Standard preflop betting round, then burn and deal the flop", correct:true, feedback:"Correct — from here it plays out exactly like standard Hold'em."},
              {text:"Deal the flop immediately, no betting round", correct:false, feedback:"There's still a full preflop betting round before the flop comes out."},
              {text:"Have players discard again", correct:false, feedback:"The discard only happens once, right at the start — from here it's standard Hold'em streets."}
            ]
          },
          {
            street:"Flop",
            prompt:"Flop betting wraps up. What's next?",
            options:[
              {text:"Burn, then deal the turn", correct:true, feedback:"Right — standard burn-and-deal from here."},
              {text:"Deal the turn with no burn", correct:false, feedback:"Golden Rule — always burn before a new street."},
              {text:"Go to showdown", correct:false, feedback:"Turn and river still need to come out."}
            ]
          },
          {
            street:"Pre-Flop",
            difficulty:2,
            prompt:"A player has already discarded and now wants their card back before the flop is dealt. What's the ruling?",
            options:[
              {text:"The discard is final — a released card is dead", correct:true, feedback:"Correct. Once a card is released face down toward the muck it's dead. Protecting that boundary is what keeps the deck honest."},
              {text:"Return it, since betting hasn't started", correct:false, feedback:"Timing doesn't reopen a released card. In Pineapple the discard happens before betting precisely so it's settled early."},
              {text:"Return it only if it hasn't touched the muck", correct:false, feedback:"That's a common instinct, but a card released toward the muck is treated as dead regardless of contact."}
            ]
          },
          {
            street:"Flop",
            difficulty:2,
            prompt:"How many cards does each player hold when the flop is dealt in Pineapple?",
            options:[
              {text:"2 — the discard already happened before any betting", correct:true, feedback:"Right. That's the defining difference from Crazy Pineapple, where players still hold 3 when the flop comes out."},
              {text:"3 — the discard happens after the flop", correct:false, feedback:"That's Crazy Pineapple. In regular Pineapple the discard is complete before the first betting round."},
              {text:"2, but they may swap one on the flop", correct:false, feedback:"There's no swap in Pineapple — one discard, made before betting, and that's it."}
            ]
          },
          {
            street:"Turn/River",
            prompt:"Turn betting's done. What's next, and what hand wins at showdown?",
            options:[
              {text:"Burn, deal the river, bet, then showdown — best standard Hold'em high hand wins", correct:true, feedback:"Correct — Pineapple plays out as a single-pot Hold'em high hand from here, using the 2 cards each player kept."},
              {text:"Deal the river with no burn since it's the last card", correct:false, feedback:"The river still gets burned before it's dealt, same as every other street."},
              {text:"Split the pot between the discarded card and the final hand", correct:false, feedback:"Discarded cards are dead — showdown is a single winner-take-all Hold'em high hand with the 2 cards kept."}
            ]
          }
        ]},
        { name:"Crazy Pineapple", dealCat:"crazyPineapple", maxPlayers:7, pot:"single", meta:"3 hole cards · Hold'em board · max 7", flow:[
          "Deal 3 hole cards",
          "Burn, deal flop — betting round",
          "Discard 1 down to 2 — after flop betting",
          "Burn, deal turn — betting round",
          "Burn, deal river — betting round",
          "Showdown"
        ], notes:"Same as Pineapple, but the discard happens AFTER the flop betting round — key procedural difference.",
        scenario:[
          {
            street:"Deal",
            prompt:"New hand. Everyone gets 3 hole cards. What's next?",
            options:[
              {text:"Standard preflop betting round with all 3 cards still in hand — discard comes later", correct:true, feedback:"Right — this is the key difference from regular Pineapple. Crazy Pineapple keeps all 3 cards through preflop betting."},
              {text:"Immediately discard down to 2 cards before any betting", correct:false, feedback:"That's regular Pineapple's rule. In Crazy Pineapple, players hold all 3 cards through the preflop betting round."},
              {text:"Burn and deal the flop immediately", correct:false, feedback:"There's a full preflop betting round with 3 cards before the flop even comes out."}
            ]
          },
          {
            street:"Pre-Flop",
            prompt:"Preflop betting wraps up (players still have 3 cards each). What's next?",
            options:[
              {text:"Burn, then deal the flop — betting round follows", correct:true, feedback:"Correct — the flop comes out before the discard happens."},
              {text:"Discard down to 2 cards now, before the flop", correct:false, feedback:"Not yet — the discard in Crazy Pineapple happens after the flop betting round, not before the flop is even dealt."},
              {text:"Skip the flop betting round", correct:false, feedback:"Flop betting happens as normal, with players still holding 3 cards."}
            ]
          },
          {
            street:"Flop",
            prompt:"Flop betting just wrapped up. Players are still holding 3 cards each. What do you do now?",
            options:[
              {text:"NOW have players discard down to 2 cards", correct:true, feedback:"Exactly right — this is the defining Crazy Pineapple quirk: the discard happens after the flop betting round, not before."},
              {text:"Deal the turn — the discard already happened", correct:false, feedback:"It hasn't happened yet in Crazy Pineapple — this is the moment the discard occurs, right after flop betting."},
              {text:"Ask players to discard 2 cards, keeping only 1", correct:false, feedback:"Players discard down to 2 cards, keeping 2, not 1."}
            ]
          },
          {
            street:"Flop",
            difficulty:2,
            prompt:"The flop betting round is complete and you call for the discard. One player has already turned their turn card face up. What went wrong?",
            options:[
              {text:"The turn card was dealt before the discard was collected", correct:true, feedback:"Right. In Crazy Pineapple the discard comes AFTER flop betting and BEFORE the turn. Dealing the turn early skips a required step."},
              {text:"Nothing — the turn follows flop betting", correct:false, feedback:"In Hold'em yes, but Crazy Pineapple inserts the discard between flop betting and the turn."},
              {text:"The discard should have happened before the flop", correct:false, feedback:"That's regular Pineapple. Crazy Pineapple deliberately delays it until after flop betting."}
            ]
          },
          {
            street:"Flop",
            difficulty:1,
            prompt:"How many cards does each player hold while the flop is being bet in Crazy Pineapple?",
            options:[
              {text:"3 — the discard comes after flop betting", correct:true, feedback:"Correct. Players see the flop with all three cards, which is exactly what makes the game play differently from Pineapple."},
              {text:"2 — the discard already happened", correct:false, feedback:"That's regular Pineapple. Here the discard is still ahead."},
              {text:"3, but one is face up", correct:false, feedback:"All hole cards stay face down — this is a flop game, not stud."}
            ]
          },
          {
            street:"Turn/River",
            prompt:"Discard's done, players hold 2 cards. What's next, and what hand wins at showdown?",
            options:[
              {text:"Burn+turn, bet, burn+river, bet, showdown — best standard Hold'em high hand wins", correct:true, feedback:"Correct — from here it's identical to regular Pineapple and standard Hold'em, single pot, high hand wins."},
              {text:"Players get a second discard before the river", correct:false, feedback:"Only one discard happens all hand, right after the flop betting round."},
              {text:"Deal turn and river together with one burn", correct:false, feedback:"Each street still gets its own separate burn — turn and river are dealt one at a time."}
            ]
          }
        ]}
      ]
    },
    {
      tag: "Texas Hold'em",
      desc: "Straight community-board game",
      games: [
        { name:"Texas Hold'em", dealCat:"holdem", maxPlayers:7, pot:"single", meta:"2 hole cards · Hold'em board", flow:[
          "Deal 2 hole cards to each player",
          "Betting round (preflop)",
          "Burn, deal flop (3) — betting round",
          "Burn, deal turn — betting round",
          "Burn, deal river — betting round",
          "Showdown"
        ], notes:"The baseline format the Pineapple variants are built from — good reference point before dealing the mixed spreads.",
        scenario:[
          {
            street:"Deal",
            prompt:"New hand. What's dealt to start?",
            options:[
              {text:"2 hole cards to each player, no burn", correct:true, feedback:"Correct — standard Hold'em deal, no burn before the very first cards."},
              {text:"2 hole cards, with a burn first", correct:false, feedback:"No burn before the initial deal in any format — burns start before the flop."},
              {text:"3 hole cards, like Pineapple", correct:false, feedback:"Straight Hold'em is always 2 hole cards — the 3-card versions are the Pineapple variants."}
            ]
          },
          {
            street:"Pre-Flop",
            taskType:"numeric-amount",
            prompt:"Action is on the big blind. How much do they owe to call?",
            resolve: s => {
              const bb = s.buttonSeat === undefined || s.buttonSeat === null ? null : (s.buttonSeat + 2) % 7;
              return bb !== null && s.callAmounts[bb] !== undefined ? s.callAmounts[bb] : 0;
            },
            explain: (s, given, expected) => {
              const bb = (s.buttonSeat + 2) % 7;
              return 'The big blind already has $' + (s.streetContrib[bb] || 0) +
                ' posted and the wager is $' + s.currentBet + ', so they owe the $' + expected + ' difference.';
            },
            options:[]
          },
          {
            street:"Pre-Flop",
            prompt:"Preflop betting wraps up. What's next?",
            options:[
              {text:"Burn, then deal the flop (3 cards)", correct:true, feedback:"Right — Golden Rule, burn before every new street."},
              {text:"Deal the flop with no burn", correct:false, feedback:"Always burn before dealing to the board."},
              {text:"Deal the turn and flop together", correct:false, feedback:"Flop, turn, and river are always separate streets with their own betting rounds."}
            ]
          },
          {
            street:"Flop/Turn",
            prompt:"Flop betting's done. What's next?",
            options:[
              {text:"Burn, deal the turn, bet — then burn, deal the river, bet", correct:true, feedback:"Correct — standard burn-and-deal pattern for both remaining streets."},
              {text:"Deal the turn and river with a single burn", correct:false, feedback:"Each street gets its own burn — turn and river are not combined."},
              {text:"Skip straight to showdown after the flop", correct:false, feedback:"Turn and river still need to be dealt and bet on."}
            ]
          },
          {
            street:"Turn",
            difficulty:2,
            prompt:"A player bets, a second raises, and the original bettor now wants to raise again. Is the action still open to them?",
            options:[
              {text:"Yes — a raise reopens the action to everyone who has already acted", correct:true, feedback:"Correct. A legitimate raise reopens betting for all live players, including the original bettor. This is the rule dealers misapply most often."},
              {text:"No — they already acted this street", correct:false, feedback:"Acting once does not close a player out. A raise behind them reopens their action."},
              {text:"Only if the raise was at least double the bet", correct:false, feedback:"Sizing determines whether a raise is legal, not whether it reopens action. A full legal raise always reopens it."}
            ]
          },
          {
            street:"River",
            difficulty:3,
            prompt:"Three players are all-in for different amounts and one folded after contributing. Which players compete for the main pot?",
            options:[
              {text:"Every player who contributed to that layer and has not folded", correct:true, feedback:"Correct. Eligibility follows contribution level and live status. The folded player's chips stay in the pot but they can never win any layer."},
              {text:"Only the two players with the largest stacks", correct:false, feedback:"Stack size is irrelevant to the main pot. The shortest all-in caps it, and everyone who matched that amount competes."},
              {text:"All four, since the folded player contributed", correct:false, feedback:"Contributing funds the pot but does not grant eligibility. A folded hand can never be awarded any portion."}
            ]
          },
          {
            street:"Showdown",
            prompt:"River betting's done. What determines the winner?",
            options:[
              {text:"Best standard 5-card high hand using any combination of hole cards and board", correct:true, feedback:"Correct — straightforward single-pot, best 5-card high hand wins."},
              {text:"Best hand using only the 2 hole cards", correct:false, feedback:"Hold'em hands are built from any combination of the 2 hole cards and 5 board cards — not hole cards alone."},
              {text:"It's always a split pot between high and low", correct:false, feedback:"Standard Hold'em is single-pot, high hand only — no low side unless it's a specific hi-lo variant."}
            ]
          }
        ]}
      ]
    }
  ];

  return { DATA, tripleDrawSteps, drawmahaCommonSteps, drawmahaScenario, superStudSteps, sevenStudSteps };
});
