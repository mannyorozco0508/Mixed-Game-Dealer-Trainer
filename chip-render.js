/* ============================================================
   chip-render.js — Visual poker chips for The Rail

   ONE renderer serves stacks, wagers and the pot. There is no separate
   logic per context — only different placement and scale.

   CHIPS ALWAYS DERIVE FROM AUTHORITATIVE MONEY. Nothing here invents a
   decorative stack: every chip shown is backed by real dollars in
   money-state. If the amount is zero, no chips render.

   DENOMINATIONS (only these two for now):
     red   = $5
     green = $25

   Amounts that are not evenly divisible still show correctly: chips
   represent the largest clean portion, and the exact dollar figure is
   always displayed alongside, so the number is never approximated away.

   COMPACT BY DESIGN: a $1000 stack is 40 green chips, which would be
   unreadable and slow. Stacks are capped visually and annotated, so the
   picture stays legible while the text stays exact.

   Works in Node (require) and the browser (window.RailChips).
   ============================================================ */
(function(exports){

const DENOMINATIONS = [
  { name:'green', value:25 },
  { name:'red',   value:5  }
];

// Visual limits — beyond these a stack reads as noise rather than information.
const MAX_COLUMNS = 4;        // side-by-side piles
const MAX_PER_COLUMN = 5;     // chips drawn per pile before it is capped

/* Breaks an amount into chip counts, largest denomination first.
   Returns { chips:[{name,value,count}], remainder, total } where remainder
   is any amount smaller than the lowest denomination. */
function breakdown(amount){
  const total = Math.max(0, Math.floor(amount || 0));
  let left = total;
  const chips = [];
  DENOMINATIONS.forEach(d => {
    const count = Math.floor(left / d.value);
    if(count > 0){
      chips.push({ name:d.name, value:d.value, count:count });
      left -= count * d.value;
    }
  });
  return { chips, remainder:left, total };
}

/* Converts a breakdown into a drawable layout that respects the visual caps.
   Each column is one denomination pile. A pile that exceeds MAX_PER_COLUMN
   is drawn at the cap and marked truncated, so the eye reads "a lot" while
   the label carries the precise figure. */
function layout(amount, opts){
  const o = opts || {};
  const maxCols = o.maxColumns || MAX_COLUMNS;
  const maxPer = o.maxPerColumn || MAX_PER_COLUMN;
  const b = breakdown(amount);

  const columns = [];
  b.chips.forEach(c => {
    let remaining = c.count;
    while(remaining > 0 && columns.length < maxCols){
      const drawn = Math.min(remaining, maxPer);
      columns.push({
        name: c.name,
        value: c.value,
        drawn: drawn,
        represents: remaining > maxPer && columns.length === maxCols - 1 ? remaining : drawn,
        truncated: remaining > maxPer && columns.length === maxCols - 1
      });
      remaining -= drawn;
      if(columns.length >= maxCols) break;
    }
  });

  // If chips were dropped for space, the last column carries the overflow flag.
  const drawnValue = columns.reduce((n,c) => n + c.drawn * c.value, 0);
  const truncated = drawnValue < b.total - b.remainder;
  if(truncated && columns.length) columns[columns.length - 1].truncated = true;

  return {
    columns,
    total: b.total,
    remainder: b.remainder,
    truncated: truncated,
    empty: b.total === 0
  };
}

/* Renders one chip group as HTML. context is 'stack' | 'wager' | 'pot' and
   only affects styling class, never the arithmetic. */
function renderChips(amount, context, opts){
  const o = opts || {};
  const l = layout(amount, o);
  const ctx = context || 'stack';
  if(l.empty) return o.showZero
    ? '<span class="chip-group chip-' + ctx + ' chip-empty"><span class="chip-amount">$0</span></span>'
    : '';

  const cols = l.columns.map(col => {
    const chips = [];
    for(let i = 0; i < col.drawn; i++){
      chips.push('<span class="chip chip-' + col.name + '" style="bottom:' + (i * 3) + 'px"></span>');
    }
    return '<span class="chip-col' + (col.truncated ? ' chip-col-more' : '') + '">' +
           chips.join('') + '</span>';
  }).join('');

  const label = o.hideAmount ? '' : '<span class="chip-amount">$' + l.total + '</span>';
  return '<span class="chip-group chip-' + ctx + '">' + cols + label + '</span>';
}

/* Convenience wrappers — same renderer, different placement class. */
function renderStack(amount, opts){ return renderChips(amount, 'stack', opts); }
function renderWager(amount, opts){ return renderChips(amount, 'wager', opts); }
function renderPot(amount, opts){
  return renderChips(amount, 'pot', Object.assign({ maxColumns:5, maxPerColumn:6 }, opts || {}));
}

/* Reads chip visuals straight from money-state so the picture can never
   drift from the ledger. Returns per-seat stack and wager, plus the pot. */
function chipsFromMoneyState(ms, seats){
  if(!ms) return { seats:{}, pot:0 };
  const out = { seats:{}, pot:0 };
  const list = seats || ms.seats || [];
  list.forEach(s => {
    out.seats[s] = {
      stack: Math.max(0, ms.stacks[s] || 0),
      wager: Math.max(0, ms.streetContrib[s] || 0)
    };
  });
  const live = list.reduce((n,s) => n + (ms.streetContrib[s] || 0), 0);
  out.pot = Math.max(0, (ms.pot || 0) + live);
  return out;
}

exports.DENOMINATIONS = DENOMINATIONS;
exports.MAX_COLUMNS = MAX_COLUMNS;
exports.MAX_PER_COLUMN = MAX_PER_COLUMN;
exports.breakdown = breakdown;
exports.layout = layout;
exports.renderChips = renderChips;
exports.renderStack = renderStack;
exports.renderWager = renderWager;
exports.renderPot = renderPot;
exports.chipsFromMoneyState = chipsFromMoneyState;

})(typeof module !== 'undefined' ? module.exports : (window.RailChips = window.RailChips || {}));
