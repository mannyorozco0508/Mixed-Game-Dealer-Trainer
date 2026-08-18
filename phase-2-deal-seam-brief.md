# Phase 2 Brief — Separating the deal model from the deal animation

**Status:** proposal for review. No code written. Supersedes the earlier
`DATA` / `DEAL_PATTERNS` extraction plan.

**Baseline this builds on:** HEAD `557f5e9` + `rail-baseline-repair.patch`,
verified 110 passed / 0 failed / 0 crashed / 0 ENOENT from a clean clone.

---

## Why the earlier plan should be replaced

The previous brief proposed extracting pure data and pure helpers first —
`DATA`, `DEAL_PATTERNS`, card-model helpers — on the reasoning that this
would reduce test brittleness with minimal risk.

It would not. The three integration suites slice `index.html` by string
markers, and the slice that actually breaks is `buildTable`, which is
stateful and therefore stays put under a "pure code only" rule. Extracting
`DATA` and `DEAL_PATTERNS` retires four of seven slices in one suite and
leaves the dependency that caused the `clearActiveFault` failure fully
intact.

More importantly, the baseline repair surfaced a structural problem that a
pure-data extraction does not touch, and that is worth more than the
brittleness itself.

---

## The actual problem: model state rides the animation timeline

`updateTableView` deals a street in two stages.

Stage one is synchronous. Cards are drawn from the live deck and pushed into
`seatHoleCards` (`index.html:3486`). After this returns, the logical hand is
complete and correct.

Stage two is staggered. A `pitchQueue` is dispatched with `setTimeout` at
70–130ms per card so the street animates. Only `idx === 0` fires
immediately.

The problem is what happens in stage two. `placePitchedCard` does not only
write DOM — it also mutates the model:

```js
seatSlotMaps[pitch.seat].push(pitch.slotIndex);
seatDealtCounts[pitch.seat] = Math.max(seatDealtCounts[pitch.seat] || 0, pitch.slotIndex + 1);
```

So `seatSlotMaps` and `seatDealtCounts` become correct only after the
animation finishes. Until then the two halves of the model disagree.

This is not theoretical. Probing the real code with real timers, on
`Stud Hi-Lo / 8-or-Better` immediately after `updateTableView(1)`:

```
expected held this street : 3
seatHoleCards (model)     : 3
seatSlotMaps  (rendered)  : 1
```

### Why that matters

`heldCards()` reads through the slot map:

```js
function heldCards(seat){
  const all = seatHoleCards[seat] || [];
  const map = seatSlotMaps[seat] || [];
  return map.length ? map.map(s => all[s]).filter(Boolean) : all;
}
```

Two consumers read it during the window:

- `upCardsBySeat()` → `startActionRound()` → bring-in determination
- `runNextAction()` → `tierForSeat` / `tierForStreet` → AI decisions

And `advanceAfterCardChoice()` calls `renderStep()` — which schedules the
pitches — then calls `startActionRound()` **synchronously on the next line**
(`index.html:4722`). The action round therefore opens while the slot map is
still filling.

Whether this changes observable play depends on timing that varies by
training mode: pitch stagger runs roughly 2.4s for a 7-handed street, while
the first AI action delay is ~450–500ms. That overlap is large enough to
matter, but I have **not** demonstrated a wrong AI decision in a real hand —
only that the state it reads is incomplete during the window. Confirming or
ruling that out should be the first task of this phase, not an assumption.

### A second, smaller defect in the same area

`flushPendingDeals()` is called before showdown with this comment:

> Any cards still mid-pitch are finished instantly — showdown must always
> evaluate and display a complete table regardless of animation progress.

The implementation clears the timers **without firing them**:

```js
function flushPendingDeals(){
  pendingDealTimers.forEach(t => clearTimeout(t));
  pendingDealTimers = [];
}
```

So the cards are abandoned, not finished — the opposite of the stated
contract. Scoring is unaffected, because `runShowdown()` reads
`seatHoleCards` directly rather than the slot map. The impact is a visible
desync: the table can display fewer cards than the showdown evaluated. Same
call also fires on dealer-error injection (`index.html:5023`).

---

## Proposed seam

Split dealing into a state transition and a renderer.

**`deal-state.js` (new, pure).** Given the current deal state, a pattern, a
step index, and a draw source, return the next state:

```
applyStreet({ pattern, step, state, drawCard, muckPile })
  -> { state, newCards, discarded, burned }
```

`state` holds `seatHoleCards`, `seatSlotMaps`, `seatDealtCounts`,
`prevHoleCount`, `prevUpCount`, `prevBoardCount`, `prevBoard2Count`,
`burnPileCount`, `tableBoardCards`, `tableBoard2Cards`.

No DOM, no timers, no globals. Same deck in, same state out, every time.

**`updateTableView` becomes a renderer.** It calls `applyStreet`, commits
the returned state immediately, and then animates `newCards` purely as
presentation. `placePitchedCard` writes DOM only.

This inverts the current dependency: the model is settled before the first
pixel moves, instead of after the last one.

### What this fixes

- The race disappears by construction — nothing reads a half-built slot map,
  because the slot map is complete before any timer is scheduled.
- `flushPendingDeals` becomes honest. Dropping pending pitches can no longer
  desync the model, because pitches no longer carry model state. (The
  display-completion bug still needs its own fix; see below.)
- The three suites can import `deal-state.js` and drop marker slicing for
  dealing entirely.
- The synchronous-`setTimeout` injection added during the baseline repair
  becomes unnecessary and should be removed.

### What is explicitly out of scope

- `buildTable`'s seat/DOM construction. Only ~9 of its 142 lines touch the
  DOM (a cosmetic seat-chip strip and two board labels), so it is a
  reasonable later candidate — but not in this phase.
- Any change to what is dealt, in what order, or which cards are face up.
- `DATA` / `DEAL_PATTERNS` extraction. Still fine to do later; still not
  urgent.
- The `flushPendingDeals` display-completion fix. It is a real bug and
  should be fixed — but as a separate, reviewable change, not folded into a
  refactor. Making it fire pending callbacks instead of discarding them is a
  behavior change and deserves its own decision.

---

## Sequencing

1. **Confirm or rule out the gameplay impact of the race.** Write a test
   that runs a stud street with real timers and asserts what
   `upCardsBySeat()` returns before pitching settles. If a wrong bring-in or
   wrong AI tier is demonstrable, that reclassifies this from cleanup to bug
   fix and changes its priority.
2. **Characterize `applyStreet` against current behavior.** Golden-master
   the existing deal: fixed deck, every game, every street, record resulting
   state. This is the equivalence oracle.
3. **Extract `deal-state.js`.** Move logic, change nothing. Golden master
   must match exactly.
4. **Reduce `updateTableView` to a renderer.** Commit state up front,
   animate `newCards` only.
5. **Repoint the tests**, remove the `setTimeout` injection, update
   `boot-check.js` with the new module contract.
6. **Full suite green from a clean clone**, same criteria as the baseline
   repair.

Step 1 stands alone and is worth doing regardless of whether the rest is
approved.

---

## Risk

Higher than a pure-data extraction, and I want to be plain about that.
`updateTableView` is 200 lines handling discards, deferred draws, physical
slot mapping, two independent boards, burn cards, and Super Stud's
keep-the-up-card rule. The golden-master step in sequence position 2 is what
makes this safe; without it, this should not proceed.

The mitigating factor is that the hard part is already isolated. The DOM
surface inside that function is 12 lines out of 200. The rest is state
transition that merely happens to live next to a renderer.

---

## Recommendation

Do step 1 now, on its own. It is small, it is diagnostic rather than
structural, and its result determines whether the remaining steps are
architecture work or a bug fix — which is a materially different
conversation about priority.
