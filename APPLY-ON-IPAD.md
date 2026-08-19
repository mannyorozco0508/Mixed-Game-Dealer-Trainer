# Applying the baseline repair from the GitHub web editor

No terminal needed. Seven files are replaced wholesale (select all, paste),
and `index.html` needs three small edits because it is too large to paste.

Verified: these exact file versions produce **110 passed / 0 failed** from a
clean clone.

---

## Step 1 — Replace seven files

For each file below: open it in the repo → pencil icon (Edit) → select all →
paste the new contents → Commit.

`package.json` does not exist yet, so use **Add file → Create new file** and
name it exactly `package.json`.

| File | How |
|---|---|
| `package.json` | create new |
| `showdown.js` | replace |
| `boot-check.js` | replace |
| `test-showdown.js` | replace |
| `test-card-model.js` | replace |
| `test-showdown-integration.js` | replace |
| `test-dealer-box-integration.js` | replace |

Order does not matter. The suite will not pass until all of them plus the
`index.html` edits are in.

---

## Step 2 — Three edits in `index.html`

Open `index.html` → Edit. Use the editor's find (⌘F / the search box).

### Edit 1 — near line 1521

**Find:**

```
<footer>THE RAIL — 21 GAMES · REAL 7-HANDED TABLES · HOLE CARDS HIDDEN LIKE THE REAL FLOOR</footer>
```

**Replace with:**

```
<footer id="railFooter">THE RAIL — REAL 7-HANDED TABLES · HOLE CARDS HIDDEN LIKE THE REAL FLOOR</footer>
```

### Edit 2 — near line 2778

**Find** (this exact block; it appears once):

```
  catsEl.appendChild(block);
});

/* ---------------- Local Progress Tracking ---------------- */
```

**Replace with:**

```
  catsEl.appendChild(block);
});

/* The footer count is DERIVED from DATA rather than typed in, so the roster
   can never drift away from what the product actually spreads. General Floor
   Rules is a reference card, not a poker game, so it is excluded — it has no
   dealCat and no showdown rule. */
function pokerGameCount(){
  let n = 0;
  DATA.forEach(cat => cat.games.forEach(g => { if(g.dealCat) n++; }));
  return n;
}
(function renderFooterCount(){
  const f = document.getElementById('railFooter');
  if(!f) return;
  f.textContent = 'THE RAIL — ' + pokerGameCount() +
    ' GAMES · REAL 7-HANDED TABLES · HOLE CARDS HIDDEN LIKE THE REAL FLOOR';
})();

/* ---------------- Local Progress Tracking ---------------- */
```

### Edit 3 — near line 4048

**Find:**

```
  const rule = window.RailShowdown && window.RailShowdown.SHOWDOWN_RULES[currentScenario.name];
```

**Replace with:**

```
  // Goes through ruleForGame so a legacy game name still resolves to the
  // canonical rule rather than silently skipping board completion.
  const rule = window.RailShowdown && window.RailShowdown.ruleForGame(currentScenario.name);
```

Commit `index.html`.

---

## Step 3 — Delete the patch file

`rail-baseline-repair.patch` is scaffolding, not source. Once the edits above
are committed it serves no purpose and will confuse anyone who clones the
repo into thinking there is an unapplied change.

Open it → trash icon → Commit.

Keep `diag-deal-race.js` and `phase-2-deal-seam-brief.md` if you want them
tracked; they are real artifacts, not scaffolding. `diag-deal-race.js` needs
`jsdom`, which arrives with `package.json` in step 1.

---

## Step 4 — Verify

You cannot run the suite from the web editor. Either:

- ask me to re-clone and run it, or
- open a Codespace (green **Code** button → **Codespaces**) and run
  `npm install && npm test`

Expected:

```
test-showdown.js                 40 passed  0 failed
test-card-model.js               28 passed  0 failed
test-showdown-integration.js      6 passed  0 failed
test-dealer-box-integration.js   36 passed  0 failed
TOTAL: 110 passed, 0 failed
```

---

## What this does NOT fix

The deal race is untouched and still live. `firstActor()` can seat the wrong
player and AI tier misreads 4 of 7 seats on later stud streets. That is a
separate decision — see `phase-2-deal-seam-brief.md`.
