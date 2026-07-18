# Per-coin transaction ledger + Portfolio translation

## Purpose

Two additions to the Portfolio tab of the single-file `index.html` crypto
tracker, both modeled on CoinGecko's portfolio UI (three reference
screenshots supplied by the user):

1. **Transaction ledger.** Replace the current one-record-per-coin holding
   (`{ coinId, amount, buyPrice }`) with a list of individual Buy/Sell/
   Transfer transactions. A new "Transaction Overview" drill-down (reached
   from a row's ⋮ menu → "View transactions") shows per-coin stat cards, a
   transactions table, and an Add/Edit Transaction modal with Buy/Sell/
   Transfer tabs.
2. **Translation.** A language dropdown, shown only on the Portfolio page,
   that translates the page's own static UI labels (not coin names, numbers,
   or dates) using the free, keyless MyMemory translation API.

## Constraint

Single self-contained `index.html`, no build step. The project was
zero-external-JS-dependency until GSAP/ScrollSmoother was added deliberately
in the previous change; this feature adds no new *script* dependency — the
translation feature calls a REST API with `fetch`, it does not load a
library. All new code follows the existing `const Module = (() => { ...
return { ... }; })();` IIFE pattern and the existing modal / table / combo /
pagination styling already in the file.

---

## Part 1 — Transaction ledger

### Data model

Each holding stores a transaction list instead of a running total:

```js
// Portfolio holding (was: { coinId, amount, buyPrice })
{
  coinId: 'solana',
  transactions: [
    {
      id,            // unique string (Date.now()+random), stable key for edit/delete
      type,          // 'buy' | 'sell' | 'transfer'
      quantity,      // number, coin units, always positive
      pricePerCoin,  // number, USD; 0 for transfers
      fees,          // number, USD; default 0
      date,          // epoch ms
      direction,     // 'in' | 'out'  — ONLY for type 'transfer'; omitted otherwise
      notes,         // string, may be ''
    }
  ]
}
```

Persistence key stays `cryptofolio.portfolios.v1` (no version bump — see
Migration; a bump would discard existing users' data).

### Derivation — the seam that keeps the change contained

The existing code reads `h.amount` and `h.buyPrice` in many places
(`rowHTML`, `renderSummary`, the sort comparator, the Overview merge in
`currentHoldings()`, Analytics `buildSeries`, the top-performer logic). Rather
than rewrite every consumer, a single pure function derives those same two
fields from the transaction list:

```js
function deriveHolding(h) {
  // Walk transactions oldest-first. Weighted-average cost basis.
  let amount = 0, avgCost = 0, realizedPnl = 0;
  const txs = [...(h.transactions || [])].sort((a, b) => a.date - b.date);
  for (const t of txs) {
    if (t.type === 'buy') {
      const newAmount = amount + t.quantity;
      // fold fees into cost basis
      const addedCost = t.quantity * t.pricePerCoin + (t.fees || 0);
      avgCost = newAmount > 0 ? (amount * avgCost + addedCost) / newAmount : 0;
      amount = newAmount;
    } else if (t.type === 'sell') {
      const sellQty = Math.min(t.quantity, amount); // never sell more than held
      realizedPnl += (t.pricePerCoin - avgCost) * sellQty - (t.fees || 0);
      amount -= sellQty;
      // avgCost unchanged for the remainder (weighted-average method)
    } else if (t.type === 'transfer') {
      amount += (t.direction === 'out' ? -t.quantity : t.quantity);
      if (amount < 0) amount = 0;
      // transfers don't change avgCost or realize P&L
    }
  }
  return { coinId: h.coinId, transactions: h.transactions || [],
           amount, buyPrice: avgCost, realizedPnl };
}
```

`currentHoldings()` maps every holding through `deriveHolding` before
returning, so every existing consumer keeps seeing `.amount` and `.buyPrice`
and needs no change. The Overview-merge branch keeps its existing
weighted-average combine, fed by derived per-portfolio values.

`buyPrice` deliberately means **average net cost** (fees folded in), which is
exactly the "Average Net Cost" stat card in the screenshot. Cost basis is not
reduced by transfers-out (a transfer moves coins, it is not a sale), so a
partial transfer-out then leaves avgCost intact on the remainder — matching
the weighted-average intent.

### Migration (first load after this ships)

On `load()`, any holding that has `amount`/`buyPrice` but no `transactions`
array is upgraded in place to a single synthetic transaction:

```js
{ id: genId(), type: 'buy', quantity: h.amount, pricePerCoin: h.buyPrice,
  fees: 0, date: Date.now(), notes: '' }
```

then `amount`/`buyPrice` are deleted from the stored object. This runs once;
the upgraded shape is written back to localStorage so it never re-runs. A
holding with `amount <= 0` (shouldn't normally exist) migrates to an empty
transaction list. This preserves every existing user's portfolio exactly:
derived amount/avgCost of the synthetic buy equal the old stored values.

### Transaction Overview — a drill-down state inside the Portfolio view

Not a new top-level tab and not a modal. A third rendering state of the
existing Portfolio view, parallel to the current Coins / Analytics sub-tabs
but reached only via "View transactions" (there is no always-visible tab for
it — you drill in from a specific coin and back out via the breadcrumb). It
lives inside `#view-portfolio` so it inherits the ScrollSmoother wrapper and
all existing view plumbing.

Portfolio module gains a mode variable, e.g. `txCoinId` (null = normal
Coins/Analytics view; set = showing that coin's Transaction Overview). Setting
it re-renders Portfolio into the overview layout; clearing it (breadcrumb
click, or switching portfolios/tabs) returns to normal.

Layout, matching the screenshot top-to-bottom:

- **Breadcrumb:** `Cryptocurrencies  ›  ⭐ <Portfolio name>  ›  <Coin>
  Transaction Overview`. The middle crumb returns to the Coins list; the
  first crumb also returns to the Coins list (there is no separate
  "Cryptocurrencies" page in this app).
- **Coin header:** logo + name + symbol, live price, 24h % change (reusing
  the existing `pctSpan`/`fmtUSD` formatters).
- **Five stat cards:** Holdings Value (`amount × price`), Holdings
  (`amount SYM`), Total Cost (sum of buy costs still in the position =
  `amount × avgCost`), Average Net Cost (`avgCost`, with the ⓘ affordance as
  static text/title — no popover, YAGNI), Total Profit/Loss
  (`unrealized + realized`, where unrealized = `(price − avgCost) × amount`).
  Cards reuse the existing `.card` styling from the summary row.
- **Transactions table** — columns exactly per screenshot: Type, Price,
  Quantity, Date & Time, Fees, Cost, Proceeds, PNL, Notes, Actions.
  - Type: colored label (Buy green, Sell red, Transfer muted).
  - Quantity: signed (`+2.0` for buy/transfer-in, `−1.0` for sell/
    transfer-out) — the screenshot shows `+` signs.
  - Cost: `quantity × price + fees` for buys; blank/`—` for sells.
  - Proceeds: `quantity × price − fees` for sells; blank/`—` for buys.
  - PNL: per-row. Buy → unrealized `(price − pricePerCoin) × quantity − fees`.
    Sell → realized `(pricePerCoin − avgCostAtThatPointInLedger) × quantity −
    fees`. Transfer → `—`. (Computing the sell's avg-cost-at-that-point
    requires walking the ledger up to that transaction; `deriveHolding` is
    extended to optionally return per-transaction annotations for the table,
    or a sibling function `annotateTransactions(h)` returns the rows with
    computed Cost/Proceeds/PNL — chosen at implementation time, but the math
    is fixed here.)
  - Notes: the note text, or blank.
  - Actions: edit (✏️) and delete (🗑) per row.
  - Sorted newest-first (screenshot shows most-recent buy on top).
  - Pagination: reuse the existing pagination pattern already in the Market
    table (Prev / "Page N of M" / Next), NOT a rows-per-page dropdown. Only
    paginate when the count exceeds a page size (e.g. 50); most coins have a
    handful of transactions, so pagination usually won't render.
- **"+ Add transaction" button** in the Transactions header → opens the
  Add/Edit Transaction modal pre-scoped to this coin.

Deleting the last transaction of a coin leaves an empty-transaction holding
(amount 0); the existing "Remove coin" flow still deletes the whole holding.
A coin with 0 amount but existing transactions still shows in the overview
(so you can see your closed-position history) but the Coins-list behavior for
zero-amount holdings is unchanged from today.

### Add / Edit Transaction modal

Replaces today's simple "add/edit holding" modal (`#tx-modal`, which
currently takes a single amount + buy price). New modal matches the
screenshot:

- **Three tabs:** Buy · Sell · Transfer (segmented control, Buy default).
- **Buy/Sell fields:** coin selector (reuse existing combo box; locked to the
  current coin when opened from the overview, selectable when opened via the
  row ＋/menu), Quantity + unit, Price per coin + "Use Market" link that fills
  the live price from `coinById(coinId).current_price`, Date & Time
  (`<input type="datetime-local">`, defaulting to now), collapsible "Fees &
  Notes (Optional)" section (fee amount + notes text).
- **Transfer fields:** coin selector, a direction toggle (In / Out),
  Quantity, Date & Time, optional Notes. No price, no fees (transfer is a
  wallet move, not a priced trade — scoped down deliberately; the screenshots
  show Buy/Sell/Transfer tabs but only detail Buy, so Transfer stays minimal).
- **Submit** appends (or, in edit mode, replaces) a transaction on the coin's
  holding, persists, re-derives, re-renders the overview and the underlying
  Coins summary. Validation: quantity > 0; price ≥ 0 (buys/sells); a
  transfer-out cannot exceed current holdings (clamp or reject — reject with
  inline message).

### Row ⋮ menu

`#row-menu` gains "View transactions" (per screenshot: "Remove coin" and
"View transactions"; the current "Edit holding" item is removed — editing now
happens per-transaction inside the overview). Final menu:

```
View transactions
Remove coin        (danger)
```

Clicking "View transactions" sets `txCoinId` and re-renders.

### Consumers that keep working unchanged (via the derivation seam)

`rowHTML`, `renderSummary`, the Coins sort comparator, Analytics
`buildSeries`/`renderCategories`, `CoinPanel` — all read `.amount`/`.buyPrice`
off the derived holdings and are untouched. The Overview cross-portfolio merge
stays, fed derived values. `holdingsSignature()` (used to cache analytics)
changes to hash the transaction lists instead of amount/buyPrice, so edits
invalidate the cache.

---

## Part 2 — Portfolio translation (MyMemory API)

### Verified facts (live-tested during design)

- Endpoint: `https://api.mymemory.translated.net/get?q=<text>&langpair=en|<lang>`
- Keyless, free. CORS confirmed open: response carries
  `access-control-allow-origin: *` (tested live with `curl -D -`).
- Response shape: `{ responseData: { translatedText, match }, responseStatus,
  quotaFinished, matches: [...] }`. Use `responseData.translatedText`.
- Free quota: ~5,000 chars/day/IP anonymous (50,000 with an `de=<email>`
  param — not used here to avoid embedding an email in a public repo).
- Limits: 500 bytes per single `q`. Our strings are short UI labels, well
  under this.

### Scope — what gets translated

Only the Portfolio page's **static chrome**, explicitly enumerated so the set
is finite and cacheable: sub-tab labels (Coins, Analytics, Insights), the
action buttons (＋ Add coin, − Remove coin, + New Portfolio, + Add
transaction), stat-card titles (Current Balance, 24h Portfolio Change, Total
Profit / Loss, Top Performer, Holdings Value, Holdings, Total Cost, Average
Net Cost), table column headers, the transaction-overview labels, the row-menu
items, modal labels/tab names, and the empty-state sentences.

**Never translated:** coin names, ticker symbols, all numbers, prices, dates,
percentages. Implemented by translating only a curated list of known label
strings (see below), never DOM-walking arbitrary text — so numbers and coin
names are structurally out of scope, matching how real crypto sites behave
(Bitcoin is "Bitcoin" in every language).

### Mechanism — dictionary of known strings, not DOM translation

A registry maps each translatable UI string to the element(s) that display
it. The cleanest implementation for a hand-rolled file: mark translatable
elements with a `data-i18n="<key>"` attribute whose value is the canonical
English string, then a `Translate` module:

1. Collects the unique set of `data-i18n` English strings present.
2. On language change to `<lang>` (non-English):
   - For each string, check `localStorage` cache
     (`cryptofolio.i18n.<lang>.<hash>`); use it if present.
   - For cache misses, fetch translations **through the existing serial
     request queue** (the same `enqueue()` used for CoinGecko, so we never
     burst), one `q` per request, writing each result to cache.
   - Apply: set each `data-i18n` element's text to its translated value.
3. Switching back to English (default) restores the original `data-i18n`
   values (kept in memory) with no network calls.

Language dropdown: a small `<select>` rendered only in the Portfolio view's
header area (e.g. beside the portfolio actions), offering English plus a
short fixed list (e.g. Spanish, French, German, Italian, Portuguese,
Japanese) — a curated list, not "any language", keeping the cached string
count bounded. Selected language persists in localStorage
(`cryptofolio.i18n.lang`) and re-applies on load if the Portfolio view is
shown.

### Failure handling

- A failed/timed-out translation request leaves that string in English (no
  throw, no blocking) — partial translation is acceptable and degrades
  gracefully.
- If `quotaFinished: true` comes back, stop issuing further requests for that
  session and keep whatever was already translated/cached; log a console
  warning, no user-facing error modal (consistent with the app's existing
  quiet-degradation style for CoinGecko backoff).
- Re-translation on later visits is cache-served, so normal use stays far
  under quota.

### Why only the Portfolio page

The user asked for translation "only on the my portfolio page." Scoping the
`data-i18n` attributes to Portfolio markup (and only rendering the language
dropdown there) satisfies this directly; Market/Bubbles/Gallery are untouched.

---

## Files touched

- `index.html` only. New CSS (breadcrumb, stat-card grid for the overview,
  transaction table, transfer toggle, language select), new markup
  (transaction-overview container inside `#view-portfolio`, revised
  `#tx-modal` with Buy/Sell/Transfer tabs, `data-i18n` attributes, language
  `<select>`), and new JS in the `Portfolio` module plus a new `Translate`
  module wired into the existing `DOMContentLoaded` init.

## Testing / verification (browser preview, no automated suite — consistent with the project)

1. Migration: load with an existing single-record portfolio (seed the old
   `{coinId,amount,buyPrice}` shape) → holdings still show identical
   amount/value/PNL; stored shape is upgraded to a synthetic buy.
2. Add a Buy, then a Sell, then a Transfer-out on one coin → amount, avg cost,
   realized P&L, and every stat card match hand-calculated values.
3. Row ⋮ → View transactions opens the overview; breadcrumb returns to Coins.
4. Add/Edit/Delete a transaction re-derives and re-renders both the overview
   and the Coins summary correctly.
5. "Use Market" fills the current live price; datetime defaults to now.
6. Transfer-out exceeding holdings is rejected with an inline message.
7. Overview pagination appears only past the page-size threshold.
8. Language dropdown (Portfolio only) translates static labels, leaves coin
   names/numbers/dates intact, caches to localStorage, and switching back to
   English restores instantly with no network call. Verify via
   `preview_network` that repeat switches are cache-served.
9. No console errors; Market/Bubbles/Gallery unaffected; ScrollSmoother +
   table-fit from prior changes still intact.

## Scope boundaries (explicitly out of scope)

- No FIFO/LIFO or per-lot cost basis; weighted-average only.
- Transfers carry no price/fees and are not taxable events.
- The Average Net Cost ⓘ is static (no popover).
- Translation covers a curated language list and a curated static-label set,
  not arbitrary/any language or arbitrary page text.
- No CSV import/export of transactions (not requested).
