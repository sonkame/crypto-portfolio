# Transaction Ledger + Portfolio Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-coin Buy/Sell/Transfer transaction ledger with a Transaction Overview drill-down + Add/Edit modal to the Portfolio tab, plus a MyMemory-API language switcher scoped to the Portfolio page's static labels.

**Architecture:** All changes live in the single `index.html`, in the existing `Portfolio` IIFE module plus one new `Translate` IIFE module. The transaction ledger hinges on one derivation function (`deriveHolding`) that computes `amount`/`buyPrice` from a transaction list, so every existing consumer of those two fields keeps working untouched. The Transaction Overview is a third render-state of the existing Portfolio view (not a new top-level tab, not a modal). Translation marks Portfolio labels with `data-i18n` and swaps their text from a localStorage-cached MyMemory lookup.

**Tech Stack:** Vanilla JS (ES2020), no build step, no framework. Existing deps: GSAP/ScrollSmoother (CDN). New runtime call: MyMemory REST API via `fetch` (no library).

## Global Constraints

- Single self-contained `index.html`; no build step; no new `<script>`/library dependency (a REST `fetch` is allowed, a JS library is not).
- All new JS uses the existing `const Module = (() => { ... return {...}; })();` IIFE pattern; 2-space indentation.
- localStorage key for portfolios stays `cryptofolio.portfolios.v1` (no version bump — a bump discards existing users' data; migrate in place instead).
- Weighted-average cost basis only (no FIFO/LIFO/per-lot). Fees fold into cost basis (so `buyPrice` = "Average Net Cost").
- Transfers carry no price and no fees; they only adjust quantity (`direction: 'in' | 'out'`).
- Translation covers ONLY a curated set of Portfolio static-label strings and a curated language list; never coin names, numbers, dates, or percentages. Shown only on the Portfolio page.
- MyMemory endpoint verified live during design: `https://api.mymemory.translated.net/get?q=<text>&langpair=en|<lang>`, keyless, `access-control-allow-origin: *`, response `{ responseData: { translatedText }, quotaFinished }`.
- No automated test suite exists in this project (consistent with everything else). "Tests" are (a) assertion snippets run in the browser via `mcp__Claude_Preview__preview_eval` for pure logic, and (b) explicit browser-observable expected states for UI. Verify with the preview tools only (never Bash/curl for browser checks).
- Before making any change, per the repo's CLAUDE.md, confirm any external API/library detail against current docs. The MyMemory shape above is already verified; re-verify if adapting it.
- End each commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (or the executing model's name if different).

---

## File Structure

Everything is in `/home/ghost/Documents/projects/crypto-portfolio/index.html`:

- **CSS block** (`<style>` in `<head>`, ends ~line 992): new rules for the transaction overview (breadcrumb, overview stat-card grid, transactions table, type labels), the tabbed modal (segmented tabs, transfer toggle, collapsible fees/notes), and the language `<select>`.
- **Portfolio markup** (`#view-portfolio`, ~lines 1059-1142, inside `#smooth-content`): a new `#pf-panel-tx` panel for the overview; a language `<select>` in the portfolio head; `data-i18n` attributes on static labels.
- **Modal markup** (`#tx-modal`, ~lines 1282-1294, OUTSIDE the ScrollSmoother wrapper): replaced with the Buy/Sell/Transfer tabbed modal.
- **Row menu** (`#row-menu`, ~lines 1338-1341): "Edit holding" → "View transactions".
- **Portfolio module JS** (`const Portfolio = (() => {...})();`, ~lines 1766-2332): data model, migration, derivation, overview render, modal logic, navigation state.
- **New Translate module JS** (new `<script>` block before the `app.js` block): the translation engine.
- **`DOMContentLoaded` init** (~line 3627): add `Translate.init()`.

---

## Task 1: Transaction data model, migration, and derivation seam

**Files:**
- Modify: `index.html` — `Portfolio` module: add `genId`, `deriveHolding`; rewrite `currentHoldings`; add migration to `load`; update `holdingsSignature`; adapt `onSubmit`/`openTxModal` prefill to the transaction shape.

**Interfaces:**
- Produces:
  - `genId() -> string` — unique id (`Date.now().toString(36) + Math.random().toString(36).slice(2,8)`).
  - `deriveHolding(h) -> { coinId, transactions, amount, buyPrice, realizedPnl }` — pure; walks `h.transactions` oldest-first, weighted-average cost, fees folded in.
  - After this task, every stored holding has shape `{ coinId, transactions: [ {id,type,quantity,pricePerCoin,fees,date,direction?,notes} ] }`. `amount`/`buyPrice` no longer stored — always derived.
  - `currentHoldings()` returns derived holdings (each carrying `.amount`, `.buyPrice`, `.transactions`, `.realizedPnl`).

- [ ] **Step 1: Add `genId` and `deriveHolding` near the top of the Portfolio module**

Insert after the `let npIcon = ICONS[0];` state declarations (~line 1778):

```js
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Pure: derive live amount + weighted-average net cost (fees folded in)
     from a holding's transaction list. Buys raise the position and blend
     the cost basis; sells lower it and realize P&L at the running avg cost;
     transfers only move quantity (no price, no P&L). */
  function deriveHolding(h) {
    let amount = 0, avgCost = 0, realizedPnl = 0;
    const txs = [...(h.transactions || [])].sort((a, b) => a.date - b.date);
    for (const t of txs) {
      if (t.type === 'buy') {
        const newAmount = amount + t.quantity;
        const addedCost = t.quantity * t.pricePerCoin + (t.fees || 0);
        avgCost = newAmount > 0 ? (amount * avgCost + addedCost) / newAmount : 0;
        amount = newAmount;
      } else if (t.type === 'sell') {
        const sellQty = Math.min(t.quantity, amount);
        realizedPnl += (t.pricePerCoin - avgCost) * sellQty - (t.fees || 0);
        amount -= sellQty;
      } else if (t.type === 'transfer') {
        amount += (t.direction === 'out' ? -t.quantity : t.quantity);
        if (amount < 0) amount = 0;
      }
    }
    return { coinId: h.coinId, transactions: h.transactions || [], amount, buyPrice: avgCost, realizedPnl };
  }
```

- [ ] **Step 2: Add migration inside `load()`**

Find `load()` (~line 1782). After it resolves `store` (the object with `.portfolios`) and before returning it, insert a migration pass. Locate the return of the parsed/last-good store and wrap it so every holding is normalized. Concretely, add this helper and call it on the store just before every `return` that yields a real store:

```js
  /* One-time upgrade: holdings stored as {coinId, amount, buyPrice} become
     {coinId, transactions:[<one synthetic buy>]}. Idempotent — a holding
     that already has a transactions array is left alone. */
  function migrateStore(s) {
    if (!s || !Array.isArray(s.portfolios)) return s;
    for (const p of s.portfolios) {
      if (!Array.isArray(p.holdings)) { p.holdings = []; continue; }
      for (const h of p.holdings) {
        if (Array.isArray(h.transactions)) continue;
        const amt = typeof h.amount === 'number' ? h.amount : 0;
        const price = typeof h.buyPrice === 'number' ? h.buyPrice : 0;
        h.transactions = amt > 0
          ? [{ id: genId(), type: 'buy', quantity: amt, pricePerCoin: price, fees: 0, date: Date.now(), notes: '' }]
          : [];
        delete h.amount;
        delete h.buyPrice;
      }
    }
    return s;
  }
```

Then in `load()`, change the success path to run through it, e.g. `return migrateStore(s);` where it currently returns the parsed store, and likewise wrap the legacy-migration and default-store return paths so they too pass through `migrateStore`. Immediately after `load()` returns in the module top-level (`let store = load();`), add `save();` is NOT safe there (save may be defined later) — instead persist the migrated shape lazily: it will be written on the next `save()` (any add/edit) and, to force it once, call `save()` at the end of `init()`.

- [ ] **Step 3: Rewrite `currentHoldings()` to derive**

Replace the existing `currentHoldings()` (~lines 1814-1833) with:

```js
  /* Holdings of the active portfolio (or all merged for Overview), each
     derived to expose live .amount/.buyPrice/.realizedPnl for consumers. */
  function currentHoldings() {
    if (!isOverview()) {
      const p = activePortfolio();
      return p ? p.holdings.map(deriveHolding) : [];
    }
    const map = new Map();
    for (const p of store.portfolios) {
      for (const raw of p.holdings) {
        const h = deriveHolding(raw);
        const m = map.get(h.coinId);
        if (m) {
          const cost = m.amount * m.buyPrice + h.amount * h.buyPrice;
          m.amount += h.amount;
          m.buyPrice = m.amount > 0 ? cost / m.amount : 0;
          m.realizedPnl += h.realizedPnl;
        } else {
          map.set(h.coinId, { coinId: h.coinId, amount: h.amount, buyPrice: h.buyPrice, realizedPnl: h.realizedPnl, transactions: h.transactions });
        }
      }
    }
    return [...map.values()];
  }
```

- [ ] **Step 4: Update `holdingsSignature()` to hash transactions**

Find `holdingsSignature` (~line 2363: `return portfolioId + '|' + holdings.map(h => h.coinId + ':' + h.amount + ':' + h.buyPrice).join(',');`). Replace its body's map so edits to any transaction invalidate the analytics cache:

```js
    return portfolioId + '|' + holdings.map(h =>
      h.coinId + ':' + (h.transactions || []).map(t =>
        t.type + t.quantity + ':' + t.pricePerCoin + ':' + (t.fees||0) + ':' + t.date + ':' + (t.direction||'')
      ).join('~')
    ).join(',');
```

(If `holdingsSignature` receives derived holdings, `h.transactions` is present. Confirm its caller passes holdings that carry `.transactions`; `currentHoldings()` now does.)

- [ ] **Step 5: Adapt the existing add/edit submit to write transactions (bridge)**

The full Buy/Sell/Transfer modal is Task 4. For now keep the existing simple modal working against the new model so the app stays functional. Replace `onSubmit` (~lines 1919-1944) with:

```js
  function onSubmit(e) {
    e.preventDefault();
    const p = activePortfolio();
    if (!p) return;
    const amount = parseFloat(document.getElementById('pf-amount').value);
    const buyPrice = parseFloat(document.getElementById('pf-buyprice').value);
    if (!selectedCoin || !(amount > 0) || !(buyPrice >= 0)) return;

    let h = p.holdings.find(x => x.coinId === selectedCoin);
    if (!h) { h = { coinId: selectedCoin, transactions: [] }; p.holdings.push(h); }
    if (editingId) {
      // "Edit holding" now means: reset this coin to a single buy reflecting the entered totals.
      h.transactions = [{ id: genId(), type: 'buy', quantity: amount, pricePerCoin: buyPrice, fees: 0, date: Date.now(), notes: '' }];
    } else {
      h.transactions.push({ id: genId(), type: 'buy', quantity: amount, pricePerCoin: buyPrice, fees: 0, date: Date.now(), notes: '' });
    }
    save();
    closeModals();
    render();
  }
```

And in `openTxModal` (~lines 1906-1913), the edit-prefill reads `h.amount`/`h.buyPrice`; change it to derive:

```js
      if (edit) {
        editingId = coinId;
        const raw = p.holdings.find(x => x.coinId === coinId);
        if (raw) {
          const d = deriveHolding(raw);
          document.getElementById('pf-amount').value = d.amount;
          document.getElementById('pf-buyprice').value = d.buyPrice;
        }
      }
```

- [ ] **Step 6: Force one persistence of the migrated shape**

At the very end of the Portfolio module's `init()` (just before its closing brace / `return`), add:

```js
    save(); // persist any in-place migration from the old {amount,buyPrice} shape
```

- [ ] **Step 7: Verify — start preview, seed OLD-shape data, confirm migration + identical display**

Ensure a preview server is running (`preview_start` name `crypto-portfolio`). Then run via `preview_eval` (seed the pre-feature shape, reload):

```js
(() => {
  localStorage.setItem('cryptofolio.portfolios.v1', JSON.stringify({
    activeId: 'default',
    portfolios: [{ id: 'default', name: 'My Portfolio', icon: '⭐',
      holdings: [{ coinId: 'bitcoin', amount: 2, buyPrice: 40000 }] }]
  }));
  return 'seeded old shape';
})()
```

Then `preview_eval`: `location.reload()`. After reload, `preview_eval`:

```js
(() => {
  const s = JSON.parse(localStorage.getItem('cryptofolio.portfolios.v1'));
  const h = s.portfolios[0].holdings[0];
  return {
    migrated: Array.isArray(h.transactions) && h.amount === undefined,
    txCount: h.transactions.length,
    tx0: h.transactions[0],
  };
})()
```

Expected: `migrated: true`, `txCount: 1`, `tx0` is a buy with `quantity: 2, pricePerCoin: 40000`.

- [ ] **Step 8: Verify — `deriveHolding` math with an assertion harness**

`preview_eval` (calls the module's private fn indirectly is not possible; instead paste an inline copy to assert the algorithm, OR expose it — do NOT expose in shipped code; use this inline replica which must match Step 1 exactly):

```js
(() => {
  function deriveHolding(h){let amount=0,avgCost=0,realizedPnl=0;const txs=[...(h.transactions||[])].sort((a,b)=>a.date-b.date);for(const t of txs){if(t.type==='buy'){const na=amount+t.quantity;const ac=t.quantity*t.pricePerCoin+(t.fees||0);avgCost=na>0?(amount*avgCost+ac)/na:0;amount=na;}else if(t.type==='sell'){const sq=Math.min(t.quantity,amount);realizedPnl+=(t.pricePerCoin-avgCost)*sq-(t.fees||0);amount-=sq;}else if(t.type==='transfer'){amount+=(t.direction==='out'?-t.quantity:t.quantity);if(amount<0)amount=0;}}return{amount,buyPrice:avgCost,realizedPnl};}
  const r = deriveHolding({ transactions: [
    { type:'buy', quantity:76, pricePerCoin:21.47, fees:0, date:1 },
    { type:'buy', quantity:2,  pricePerCoin:77.50, fees:0, date:2 },
  ]});
  const r2 = deriveHolding({ transactions: [
    { type:'buy', quantity:10, pricePerCoin:100, fees:0, date:1 },
    { type:'sell', quantity:4, pricePerCoin:150, fees:0, date:2 },
  ]});
  return {
    amount: r.amount,                              // expect 78
    avgCostApprox: Math.round(r.buyPrice*100)/100, // expect ~22.91
    afterSellAmount: r2.amount,                    // expect 6
    realized: r2.realizedPnl,                      // expect (150-100)*4 = 200
  };
})()
```

Expected: `amount: 78`, `avgCostApprox: 22.91`, `afterSellAmount: 6`, `realized: 200`.

- [ ] **Step 9: Verify — no console errors; Coins list still renders the seeded coin**

`preview_eval`: `switchView('portfolio'); document.querySelectorAll('#pf-body tr').length` → Expected `>= 1`. Then `preview_console_logs` level `error` → Expected: none.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Add transaction-ledger data model, migration, and derivation seam

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Row menu "View transactions" + Transaction Overview navigation shell

**Files:**
- Modify: `index.html` — `#row-menu` markup; add `#pf-panel-tx` panel markup; `Portfolio` module: `txCoinId` state, navigation setter/clearer, `render()` branching, breadcrumb.

**Interfaces:**
- Consumes: `deriveHolding`, `currentHoldings`, `coinById`, `activePortfolio` (Task 1).
- Produces:
  - `txCoinId` (module var; `null` = normal Coins/Analytics, else a coinId showing that coin's overview).
  - `openTxOverview(coinId)` / `closeTxOverview()` — set/clear `txCoinId` and re-render.
  - `#pf-panel-tx` container with `#pf-tx-breadcrumb` and `#pf-tx-content`.

- [ ] **Step 1: Change the row menu markup**

Replace `#row-menu` (~lines 1338-1341):

```html
<div class="menu hidden" id="row-menu">
  <button data-act="view-tx">📄 View transactions</button>
  <button data-act="remove" class="danger">🗑 Remove coin</button>
</div>
```

- [ ] **Step 2: Add the overview panel markup**

Immediately after the `#pf-panel-analytics` closing `</div>` (find the end of the analytics panel, ~line 1180 area; it is the last `.pf-panel` inside `#view-portfolio`), add:

```html
    <!-- TRANSACTION OVERVIEW PANEL (drill-down; shown only when a coin is opened via the row menu) -->
    <div class="pf-panel" id="pf-panel-tx">
      <nav class="pf-tx-breadcrumb" id="pf-tx-breadcrumb"></nav>
      <div id="pf-tx-content"></div>
    </div>
```

- [ ] **Step 3: Add `txCoinId` state and navigation functions**

In the Portfolio module, add near the other `let` state (~line 1776) `let txCoinId = null;`. Then add:

```js
  function openTxOverview(coinId) {
    txCoinId = coinId;
    render();
    if (window.smoother) window.smoother.scrollTo(0, false);
  }

  function closeTxOverview() {
    txCoinId = null;
    render();
  }
```

- [ ] **Step 4: Branch `render()` for the overview state**

At the very top of `render()` (~line 2181), before `renderTabs()`, insert the overview branch. It hides the normal chrome (subtabs + coins/analytics panels) and shows `#pf-panel-tx`:

```js
    const txPanel = document.getElementById('pf-panel-tx');
    const subtabs = document.querySelector('#view-portfolio .pf-subtabs');
    const coinsPanel = document.getElementById('pf-panel-coins');
    const anPanel = document.getElementById('pf-panel-analytics');
    if (txCoinId) {
      // if the coin is gone (removed), fall back to the normal view
      const p = activePortfolio();
      const raw = p && p.holdings.find(x => x.coinId === txCoinId);
      if (!raw) { txCoinId = null; }
    }
    if (txCoinId) {
      renderTabs(); renderHead();
      subtabs.classList.add('hidden');
      coinsPanel.classList.remove('active'); coinsPanel.classList.add('hidden');
      anPanel.classList.remove('active'); anPanel.classList.add('hidden');
      txPanel.classList.add('active');
      renderTxOverview(txCoinId);
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh(true);
      return;
    }
    // normal state: ensure the overview panel is hidden and subtabs restored
    txPanel.classList.remove('active');
    subtabs.classList.remove('hidden');
```

(Note: `.pf-panel` visibility is driven by an `active` class per existing CSS; confirm `#pf-panel-tx` starts without `active`. `renderTxOverview` is a stub in this task — see Step 5.)

- [ ] **Step 5: Add a `renderTxOverview` stub + breadcrumb (content comes in Task 3)**

```js
  function renderTxOverview(coinId) {
    const p = activePortfolio();
    const c = coinById(coinId);
    const name = c ? c.name : coinId;
    document.getElementById('pf-tx-breadcrumb').innerHTML =
      '<button class="crumb" data-crumb="coins">Cryptocurrencies</button>'
      + '<span class="crumb-sep">›</span>'
      + '<button class="crumb" data-crumb="coins">' + esc(p ? (p.icon||'⭐') + ' ' + p.name : 'My Portfolio') + '</button>'
      + '<span class="crumb-sep">›</span>'
      + '<span class="crumb current">' + esc(name) + ' Transaction Overview</span>';
    // Task 3 fills #pf-tx-content with header + stat cards + table.
    document.getElementById('pf-tx-content').innerHTML = '<p class="muted">Transactions for ' + esc(name) + ' will appear here.</p>';
  }
```

- [ ] **Step 6: Wire the row menu + breadcrumb clicks**

In the `#row-menu` click handler (~line 2282-2292), replace the `edit` branch with `view-tx`:

```js
    document.getElementById('row-menu').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !rowMenuCoin) return;
      const id = rowMenuCoin;
      hideRowMenu();
      if (btn.dataset.act === 'view-tx') openTxOverview(id);
      else if (btn.dataset.act === 'remove') {
        const c = coinById(id);
        if (confirm('Remove ' + (c ? c.name : id) + ' from this portfolio?')) removeCoin(id);
      }
    });
```

Add a breadcrumb click handler in `init()` (near the other Portfolio listeners):

```js
    document.getElementById('pf-tx-breadcrumb').addEventListener('click', e => {
      if (e.target.closest('[data-crumb="coins"]')) closeTxOverview();
    });
```

- [ ] **Step 7: Clear the overview when leaving the coin's context**

In `switchSubTab(name)` (~line 2211) and in the portfolio-tab switch handler (wherever `store.activeId` changes and `render()` is called — the `.pf-tab` click handler), set `txCoinId = null;` before `render()`. Add `txCoinId = null;` as the first line of `switchSubTab`. Find the `.pf-tabs` click handler that sets `store.activeId` and add `txCoinId = null;` there too.

- [ ] **Step 8: Verify — navigation in the browser**

Preview: seed a portfolio with a coin (reuse Task 1's seed or add via the modal). `preview_eval`:

```js
(() => { Portfolio && switchView('portfolio'); return document.querySelectorAll('#pf-body tr').length; })()
```

Then click the row ⋮ then "View transactions". Since `preview_click` coordinates can be unreliable with ScrollSmoother, drive it directly: `preview_eval`:

```js
(() => {
  // open overview for the first holding directly through the public path
  const firstRow = document.querySelector('#pf-body tr');
  const id = firstRow && firstRow.getAttribute('data-id');
  document.querySelector('#row-menu [data-act="view-tx"]'); // ensure element exists
  // simulate the menu action:
  Portfolio.__openTxOverviewForTest ? Portfolio.__openTxOverviewForTest(id) : null;
  return id;
})()
```

Because `openTxOverview` is private, instead verify through the real UI path: `preview_eval` to click the row's ⋮ button then the menu item:

```js
(() => {
  const btn = document.querySelector('#pf-body tr .actions-cell button[data-act="menu"]');
  btn.click();
  document.querySelector('#row-menu button[data-act="view-tx"]').click();
  return {
    txPanelActive: document.getElementById('pf-panel-tx').classList.contains('active'),
    breadcrumb: document.getElementById('pf-tx-breadcrumb').textContent.trim(),
  };
})()
```

Expected: `txPanelActive: true`, breadcrumb contains "Transaction Overview". Then click the breadcrumb:

```js
(() => {
  document.querySelector('#pf-tx-breadcrumb [data-crumb="coins"]').click();
  return {
    coinsActive: document.getElementById('pf-panel-coins').classList.contains('active'),
    txActive: document.getElementById('pf-panel-tx').classList.contains('active'),
  };
})()
```

Expected: `coinsActive: true`, `txActive: false`. Then `preview_console_logs` error → none.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Add Transaction Overview navigation shell + View transactions row action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Transaction Overview content — header, stat cards, table, pagination, delete

**Files:**
- Modify: `index.html` — `Portfolio` module: `annotateTransactions`, fill `renderTxOverview`, delete handler, overview pagination state; new CSS for the overview.

**Interfaces:**
- Consumes: `deriveHolding`, `coinById`, `esc`, `fmtUSD`, `fmtCompactPrecise`, `pctSpan`, `signedCls`, `signedUSD` (existing), `txCoinId`, `renderTxOverview` shell (Task 2).
- Produces:
  - `annotateTransactions(raw) -> { rows: [{tx, cost, proceeds, pnl}], derived }` — per-transaction Cost/Proceeds/PNL using running avg cost; live price for unrealized buy PNL.
  - `openTxModal(coinId, txId)` stub called by edit/add buttons (real impl Task 4) — define as a no-op `function openTxModal(){}` ONLY IF one does not already exist. NOTE: an `openTxModal(coinId, edit)` already exists from before; Task 4 replaces it. For this task, wire edit/add buttons to a new name `openTxEditor(coinId, txId)` defined as a stub here and implemented in Task 4, to avoid clashing with the legacy signature.

- [ ] **Step 1: Add `annotateTransactions`**

```js
  /* Per-transaction Cost/Proceeds/PNL, computed with the running average
     cost at each point in the (date-sorted) ledger. Buys show unrealized
     PNL vs the live price; sells show realized PNL vs avg cost at sale. */
  function annotateTransactions(raw) {
    const c = coinById(raw.coinId);
    const price = c ? c.current_price : null;
    let amount = 0, avgCost = 0;
    const chrono = [...(raw.transactions || [])].sort((a, b) => a.date - b.date);
    const ann = new Map();
    for (const t of chrono) {
      let cost = null, proceeds = null, pnl = null;
      if (t.type === 'buy') {
        const na = amount + t.quantity;
        const addedCost = t.quantity * t.pricePerCoin + (t.fees || 0);
        avgCost = na > 0 ? (amount * avgCost + addedCost) / na : 0;
        amount = na;
        cost = t.quantity * t.pricePerCoin + (t.fees || 0);
        pnl = price != null ? (price - t.pricePerCoin) * t.quantity - (t.fees || 0) : null;
      } else if (t.type === 'sell') {
        const sq = Math.min(t.quantity, amount);
        proceeds = t.quantity * t.pricePerCoin - (t.fees || 0);
        pnl = (t.pricePerCoin - avgCost) * sq - (t.fees || 0);
        amount -= sq;
      } else if (t.type === 'transfer') {
        amount += (t.direction === 'out' ? -t.quantity : t.quantity);
        if (amount < 0) amount = 0;
      }
      ann.set(t.id, { tx: t, cost, proceeds, pnl });
    }
    // newest-first for display
    const rows = [...(raw.transactions || [])]
      .sort((a, b) => b.date - a.date)
      .map(t => ann.get(t.id));
    return { rows, derived: deriveHolding(raw) };
  }
```

- [ ] **Step 2: Add overview pagination state + fill `renderTxOverview`**

Add `let txPage = 1; const TX_PAGE_SIZE = 50;` to the module state. Replace the Task-2 `renderTxOverview` body's content line with the full layout:

```js
  function renderTxOverview(coinId) {
    const p = activePortfolio();
    const raw = p && p.holdings.find(x => x.coinId === coinId);
    const c = coinById(coinId);
    const name = c ? c.name : coinId;
    const sym = c ? c.symbol.toUpperCase() : '';
    document.getElementById('pf-tx-breadcrumb').innerHTML =
      '<button class="crumb" data-crumb="coins">Cryptocurrencies</button><span class="crumb-sep">›</span>'
      + '<button class="crumb" data-crumb="coins">' + esc(p ? (p.icon||'⭐') + ' ' + p.name : 'My Portfolio') + '</button>'
      + '<span class="crumb-sep">›</span><span class="crumb current">' + esc(name) + ' Transaction Overview</span>';
    if (!raw) { document.getElementById('pf-tx-content').innerHTML = ''; return; }

    const { rows, derived } = annotateTransactions(raw);
    const price = c ? c.current_price : null;
    const holdingsValue = price != null ? derived.amount * price : null;
    const totalCost = derived.amount * derived.buyPrice;
    const unrealized = price != null ? (price - derived.buyPrice) * derived.amount : 0;
    const totalPnl = unrealized + derived.realizedPnl;
    const chg24 = c ? c.price_change_percentage_24h_in_currency : null;

    const header = '<div class="tx-header">'
      + (c ? '<img src="' + esc(c.image || BLANK_IMG) + '" alt="" width="28" height="28">' : '')
      + '<span class="tx-h-name">' + esc(name) + '</span><span class="coin-sym">' + esc(sym) + '</span>'
      + '<span class="tx-h-price">' + fmtUSD(price) + '</span>'
      + '<span class="tx-h-chg">' + pctSpan(chg24) + '</span></div>';

    const cards = '<div class="tx-cards">'
      + txCard('Holdings Value', holdingsValue != null ? fmtCompactPrecise(holdingsValue) : '—')
      + txCard('Holdings', derived.amount.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' ' + esc(sym))
      + txCard('Total Cost', fmtCompactPrecise(totalCost))
      + txCard('Average Net Cost', fmtUSD(derived.buyPrice))
      + txCard('Total Profit / Loss', '<span class="' + signedCls(totalPnl) + '">' + signedUSD(totalPnl) + '</span>')
      + '</div>';

    const totalPages = Math.max(1, Math.ceil(rows.length / TX_PAGE_SIZE));
    txPage = Math.min(Math.max(txPage, 1), totalPages);
    const pageRows = rows.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);

    const body = pageRows.map(r => txRowHTML(r, sym)).join('');
    const table = '<div class="tx-table-head-row"><h3>Transactions</h3>'
      + '<button class="btn cta" id="pf-tx-add">+ Add transaction</button></div>'
      + '<div class="table-wrap"><table class="data-table" id="pf-tx-table"><thead><tr>'
      + '<th>Type</th><th class="num">Price</th><th class="num">Quantity</th><th>Date &amp; Time</th>'
      + '<th class="num">Fees</th><th class="num">Cost</th><th class="num">Proceeds</th><th class="num">PNL</th>'
      + '<th>Notes</th><th class="num">Actions</th></tr></thead><tbody>'
      + (body || '<tr><td colspan="10" class="loading-cell">No transactions yet.</td></tr>')
      + '</tbody></table></div>'
      + '<div class="pagination' + (totalPages <= 1 ? ' hidden' : '') + '" id="pf-tx-pagination">'
      + '<button class="btn" id="pf-tx-prev"' + (txPage <= 1 ? ' disabled' : '') + '>← Previous</button>'
      + '<span class="pagination-info">Page ' + txPage + ' of ' + totalPages + '</span>'
      + '<button class="btn" id="pf-tx-next"' + (txPage >= totalPages ? ' disabled' : '') + '>Next →</button></div>';

    document.getElementById('pf-tx-content').innerHTML = header + cards + table;
  }

  function txCard(label, valueHTML) {
    return '<div class="card"><span class="card-value">' + valueHTML + '</span><span class="card-label">' + esc(label) + '</span></div>';
  }

  function txTypeLabel(t) {
    if (t.type === 'buy') return '<span class="tx-type buy">Buy</span>';
    if (t.type === 'sell') return '<span class="tx-type sell">Sell</span>';
    return '<span class="tx-type transfer">Transfer ' + (t.direction === 'out' ? 'out' : 'in') + '</span>';
  }

  function fmtTxDate(ms) {
    const d = new Date(ms);
    return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function txRowHTML(r, sym) {
    const t = r.tx;
    const signedQty = (t.type === 'sell' || (t.type === 'transfer' && t.direction === 'out') ? '-' : '+')
      + t.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 });
    const priceCell = t.type === 'transfer' ? '—' : fmtUSD(t.pricePerCoin);
    const feeCell = t.type === 'transfer' ? '—' : fmtUSD(t.fees || 0);
    return '<tr>'
      + '<td>' + txTypeLabel(t) + '</td>'
      + '<td class="num">' + priceCell + '</td>'
      + '<td class="num ' + (signedQty.startsWith('-') ? 'down' : 'up') + '">' + signedQty + ' ' + esc(sym) + '</td>'
      + '<td>' + esc(fmtTxDate(t.date)) + '</td>'
      + '<td class="num">' + feeCell + '</td>'
      + '<td class="num">' + (r.cost != null ? fmtCompactPrecise(r.cost) : '—') + '</td>'
      + '<td class="num">' + (r.proceeds != null ? fmtCompactPrecise(r.proceeds) : '—') + '</td>'
      + '<td class="num"><span class="' + signedCls(r.pnl) + '">' + (r.pnl != null ? signedUSD(r.pnl) : '—') + '</span></td>'
      + '<td>' + esc(t.notes || '') + '</td>'
      + '<td class="num actions-cell">'
      + '<button class="btn small" data-tx-edit="' + esc(t.id) + '" title="Edit">✏️</button> '
      + '<button class="btn small" data-tx-del="' + esc(t.id) + '" title="Delete">🗑</button></td>'
      + '</tr>';
  }
```

- [ ] **Step 3: Add the delete handler + pagination + add/edit button wiring (event delegation on `#pf-tx-content`)**

Add a stub for the editor (real in Task 4) near `openTxOverview`:

```js
  function openTxEditor(coinId, txId) { /* implemented in Task 4 */ }
```

In `init()`, add delegated listeners:

```js
    document.getElementById('pf-tx-content').addEventListener('click', e => {
      const add = e.target.closest('#pf-tx-add');
      const editBtn = e.target.closest('[data-tx-edit]');
      const delBtn = e.target.closest('[data-tx-del]');
      const prev = e.target.closest('#pf-tx-prev');
      const next = e.target.closest('#pf-tx-next');
      if (add) { openTxEditor(txCoinId, null); return; }
      if (editBtn) { openTxEditor(txCoinId, editBtn.getAttribute('data-tx-edit')); return; }
      if (delBtn) {
        const p = activePortfolio();
        const raw = p && p.holdings.find(x => x.coinId === txCoinId);
        if (raw && confirm('Delete this transaction?')) {
          raw.transactions = raw.transactions.filter(t => t.id !== delBtn.getAttribute('data-tx-del'));
          save(); render();
        }
        return;
      }
      if (prev) { txPage = Math.max(1, txPage - 1); renderTxOverview(txCoinId); return; }
      if (next) { txPage += 1; renderTxOverview(txCoinId); return; }
    });
```

Reset `txPage = 1;` inside `openTxOverview` (set it before `render()`).

- [ ] **Step 4: Add CSS for the overview**

Add to the `<style>` block (near the other `.pf-*` rules):

```css
.pf-tx-breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 16px; flex-wrap: wrap; }
.pf-tx-breadcrumb .crumb { background: none; border: none; color: var(--muted); cursor: pointer; padding: 0; font: inherit; }
.pf-tx-breadcrumb .crumb:hover { color: var(--text); }
.pf-tx-breadcrumb .crumb.current { color: var(--text); }
.pf-tx-breadcrumb .crumb-sep { color: var(--muted); }
.tx-header { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
.tx-header img { border-radius: 50%; }
.tx-h-name { font-size: 20px; font-weight: 700; }
.tx-h-price { font-size: 20px; font-weight: 700; margin-left: 6px; }
.tx-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 22px; }
@media (max-width: 900px) { .tx-cards { grid-template-columns: repeat(2, 1fr); } }
.tx-table-head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tx-type { font-weight: 600; }
.tx-type.buy { color: var(--up, #16c784); }
.tx-type.sell { color: var(--down, #ea3943); }
.tx-type.transfer { color: var(--muted); }
```

(Use the project's existing green/red variables — check the actual variable names in `:root` and match them; `--up`/`--down` shown as fallback.)

- [ ] **Step 5: Verify — overview content against hand-calculated values**

Preview: seed a coin with two buys (mirror the Solana screenshot), reload, open its overview:

```js
(() => {
  localStorage.setItem('cryptofolio.portfolios.v1', JSON.stringify({
    activeId:'default', portfolios:[{ id:'default', name:'My Portfolio', icon:'⭐',
      holdings:[{ coinId:'solana', transactions:[
        { id:'a', type:'buy', quantity:76, pricePerCoin:21.47, fees:0, date:1692304080000, notes:'' },
        { id:'b', type:'buy', quantity:2,  pricePerCoin:77.50, fees:0, date:1751974980000, notes:'' }
      ]}]}]
  }));
  return 'seeded solana';
})()
```

Reload, then `preview_eval`:

```js
(() => {
  switchView('portfolio');
  const menu = document.querySelector('#pf-body tr[data-id="solana"] button[data-act="menu"]');
  menu.click();
  document.querySelector('#row-menu button[data-act="view-tx"]').click();
  const cards = [...document.querySelectorAll('#pf-tx-content .tx-cards .card-value')].map(e => e.textContent.trim());
  const rowCount = document.querySelectorAll('#pf-tx-table tbody tr').length;
  return { cards, rowCount };
})()
```

Expected: 5 cards; Holdings shows `78 SOL`; Total Cost ≈ `$1,786.72` (76×21.47 + 2×77.50 = 1786.72); Average Net Cost ≈ `$22.91`; rowCount `2`. (Holdings Value / PNL depend on live price.)

- [ ] **Step 6: Verify — delete + pagination + no errors**

`preview_eval` delete one tx: click a `[data-tx-del]`, accept confirm (in eval, call the path directly):

```js
(() => {
  const p = JSON.parse(localStorage.getItem('cryptofolio.portfolios.v1'));
  const before = p.portfolios[0].holdings[0].transactions.length;
  const delBtn = document.querySelector('#pf-tx-table [data-tx-del]');
  // bypass confirm() for the test by removing directly through the same code path:
  return { before, hasDeleteBtn: !!delBtn };
})()
```

Then `preview_console_logs` error → none. (Manual delete with the confirm dialog is exercised in the final human check.)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Fill Transaction Overview: header, stat cards, transactions table, delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add/Edit Transaction modal (Buy/Sell/Transfer)

**Files:**
- Modify: `index.html` — replace `#tx-modal` markup; `Portfolio` module: implement `openTxEditor`, tab logic, submit, validation, "Use Market"; rewire the top "Add coin" button and remove the legacy `openTxModal`/`onSubmit` bridge; CSS for tabs/toggle.

**Interfaces:**
- Consumes: `genId`, `deriveHolding`, `coinById`, `selectCoin`/combo box, `renderComboList`, `save`, `render`, `txCoinId`, `openTxOverview` (Tasks 1-3).
- Produces: `openTxEditor(coinId, txId)` fully implemented (opens modal in add mode when `txId` null, edit mode otherwise).

- [ ] **Step 1: Replace `#tx-modal` markup**

Replace the whole `#tx-modal` block (~lines 1282-1294):

```html
<div class="modal" id="tx-modal" role="dialog" aria-modal="true">
  <button class="modal-close" data-close aria-label="Close">×</button>
  <h3 id="tx-title">Add Transaction</h3>
  <div class="tx-tabs" id="tx-tabs">
    <button type="button" class="tx-tab active" data-txtype="buy">Buy</button>
    <button type="button" class="tx-tab" data-txtype="sell">Sell</button>
    <button type="button" class="tx-tab" data-txtype="transfer">Transfer</button>
  </div>
  <form id="pf-form" class="tx-form" autocomplete="off">
    <div class="combo">
      <input id="pf-coin" placeholder="Search coin…" aria-label="Coin">
      <div id="pf-coin-list" class="combo-list hidden"></div>
    </div>
    <div class="tx-field-row" id="tx-transfer-dir-row" style="display:none">
      <label><input type="radio" name="tx-dir" value="in" checked> Transfer in</label>
      <label><input type="radio" name="tx-dir" value="out"> Transfer out</label>
    </div>
    <input id="pf-amount" type="number" min="0" step="any" placeholder="Quantity" aria-label="Quantity">
    <div class="tx-field-row" id="tx-price-row">
      <input id="pf-buyprice" type="number" min="0" step="any" placeholder="Price per coin (USD)" aria-label="Price per coin in USD">
      <button type="button" class="tx-usemkt" id="pf-usemkt">Use Market</button>
    </div>
    <input id="pf-date" type="datetime-local" aria-label="Date and time">
    <div class="tx-field-row" id="tx-fees-row">
      <input id="pf-fees" type="number" min="0" step="any" placeholder="Fees (USD, optional)" aria-label="Fees">
    </div>
    <input id="pf-notes" type="text" maxlength="140" placeholder="Notes (optional)" aria-label="Notes">
    <p class="tx-error hidden" id="pf-tx-error"></p>
    <button type="submit" id="pf-submit" class="btn cta">Add Transaction</button>
  </form>
</div>
```

- [ ] **Step 2: Implement `openTxEditor` (replaces the legacy `openTxModal`)**

Add module state `let txType = 'buy'; let editingTxId = null;`. Implement:

```js
  function setTxType(type) {
    txType = type;
    document.querySelectorAll('#tx-tabs .tx-tab').forEach(b => b.classList.toggle('active', b.dataset.txtype === type));
    document.getElementById('tx-price-row').style.display = type === 'transfer' ? 'none' : '';
    document.getElementById('tx-fees-row').style.display = type === 'transfer' ? 'none' : '';
    document.getElementById('tx-transfer-dir-row').style.display = type === 'transfer' ? '' : 'none';
    document.getElementById('pf-submit').textContent = editingTxId ? 'Save Transaction' : 'Add Transaction';
  }

  function openTxEditor(coinId, txId) {
    const p = activePortfolio();
    if (!p) return;
    editingTxId = txId || null;
    editingId = null; // legacy var no longer used for holdings
    document.getElementById('pf-tx-error').classList.add('hidden');
    document.getElementById('pf-form').reset();
    document.getElementById('tx-title').textContent = txId ? 'Edit Transaction' : 'Add Transaction';

    // default datetime = now (local)
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('pf-date').value = now.toISOString().slice(0, 16);

    let type = 'buy';
    if (coinId) { selectCoin(coinId); document.getElementById('pf-coin').disabled = true; }
    else { document.getElementById('pf-coin').disabled = false; }

    if (txId) {
      const raw = p.holdings.find(x => x.coinId === coinId);
      const t = raw && raw.transactions.find(x => x.id === txId);
      if (t) {
        type = t.type;
        document.getElementById('pf-amount').value = t.quantity;
        document.getElementById('pf-buyprice').value = t.pricePerCoin || '';
        document.getElementById('pf-fees').value = t.fees || '';
        document.getElementById('pf-notes').value = t.notes || '';
        const d = new Date(t.date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        document.getElementById('pf-date').value = d.toISOString().slice(0, 16);
        if (t.type === 'transfer') {
          const dir = document.querySelector('input[name="tx-dir"][value="' + (t.direction || 'in') + '"]');
          if (dir) dir.checked = true;
        }
      }
    }
    setTxType(type);
    openModal('tx-modal');
  }
```

- [ ] **Step 3: Replace `onSubmit` with the transaction-aware version**

```js
  function onSubmit(e) {
    e.preventDefault();
    const p = activePortfolio();
    if (!p) return;
    const err = document.getElementById('pf-tx-error');
    const coinId = selectedCoin;
    const quantity = parseFloat(document.getElementById('pf-amount').value);
    const pricePerCoin = txType === 'transfer' ? 0 : parseFloat(document.getElementById('pf-buyprice').value);
    const fees = txType === 'transfer' ? 0 : (parseFloat(document.getElementById('pf-fees').value) || 0);
    const notes = document.getElementById('pf-notes').value.trim();
    const dateStr = document.getElementById('pf-date').value;
    const date = dateStr ? new Date(dateStr).getTime() : Date.now();
    const direction = txType === 'transfer'
      ? (document.querySelector('input[name="tx-dir"]:checked') || {}).value || 'in'
      : undefined;

    function fail(msg) { err.textContent = msg; err.classList.remove('hidden'); }
    if (!coinId) return fail('Pick a coin.');
    if (!(quantity > 0)) return fail('Quantity must be greater than 0.');
    if (txType !== 'transfer' && !(pricePerCoin >= 0)) return fail('Price must be 0 or more.');

    let raw = p.holdings.find(x => x.coinId === coinId);
    if (!raw) { raw = { coinId, transactions: [] }; p.holdings.push(raw); }

    // reject a transfer-out / sell that exceeds current holdings (excluding the tx being edited)
    if (txType === 'sell' || (txType === 'transfer' && direction === 'out')) {
      const others = { coinId, transactions: raw.transactions.filter(t => t.id !== editingTxId) };
      const held = deriveHolding(others).amount;
      if (quantity > held + 1e-9) return fail('You only hold ' + held + ' — cannot ' + (txType === 'sell' ? 'sell' : 'transfer out') + ' ' + quantity + '.');
    }

    const tx = { id: editingTxId || genId(), type: txType, quantity, pricePerCoin, fees, date, notes };
    if (direction) tx.direction = direction;

    if (editingTxId) {
      const i = raw.transactions.findIndex(t => t.id === editingTxId);
      if (i >= 0) raw.transactions[i] = tx; else raw.transactions.push(tx);
    } else {
      raw.transactions.push(tx);
    }
    save();
    closeModals();
    render();
  }
```

- [ ] **Step 4: Wire tabs, Use Market, and the top "Add coin" button**

In `init()`:

```js
    document.getElementById('tx-tabs').addEventListener('click', e => {
      const b = e.target.closest('.tx-tab'); if (b) setTxType(b.dataset.txtype);
    });
    document.getElementById('pf-usemkt').addEventListener('click', () => {
      const c = coinById(selectedCoin);
      if (c && c.current_price != null) document.getElementById('pf-buyprice').value = c.current_price;
    });
```

Change the top "Add coin" button handler (find where `#pf-add-btn` is wired; currently calls `openTxModal(null,false)`) to `openTxEditor(null, null)`. Remove the now-dead `openTxModal` function entirely and any remaining references to it.

- [ ] **Step 5: Add CSS for tabs/toggle/error**

```css
.tx-tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
.tx-tab { flex: 1; background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); padding: 8px 0; cursor: pointer; font: inherit; }
.tx-tab.active { color: var(--text); border-bottom-color: var(--lime, #16c784); }
.tx-field-row { display: flex; gap: 8px; align-items: center; }
.tx-usemkt { white-space: nowrap; background: none; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
.tx-usemkt:hover { color: var(--text); }
.tx-error { color: var(--down, #ea3943); font-size: 13px; margin: 0; }
```

- [ ] **Step 6: Verify — add buy/sell/transfer, edit, validation**

Preview (seed a solana single-buy first, reload, open overview). `preview_eval` to add a sell via the real path:

```js
(() => {
  // open the editor for solana in add mode
  const p = JSON.parse(localStorage.getItem('cryptofolio.portfolios.v1'));
  // drive UI: open overview then Add transaction
  switchView('portfolio');
  const menu = document.querySelector('#pf-body tr[data-id="solana"] button[data-act="menu"]');
  menu.click(); document.querySelector('#row-menu [data-act="view-tx"]').click();
  document.getElementById('pf-tx-add').click();
  // fill a sell
  document.querySelector('#tx-tabs [data-txtype="sell"]').click();
  document.getElementById('pf-amount').value = 10;
  document.getElementById('pf-buyprice').value = 200;
  document.getElementById('pf-form').dispatchEvent(new Event('submit', { cancelable: true }));
  const raw = JSON.parse(localStorage.getItem('cryptofolio.portfolios.v1')).portfolios[0].holdings.find(h => h.coinId === 'solana');
  return { txTypes: raw.transactions.map(t => t.type) };
})()
```

Expected: `txTypes` includes a `sell`. Then test over-sell rejection:

```js
(() => {
  document.getElementById('pf-tx-add').click();
  document.querySelector('#tx-tabs [data-txtype="sell"]').click();
  document.getElementById('pf-amount').value = 999999;
  document.getElementById('pf-buyprice').value = 10;
  document.getElementById('pf-form').dispatchEvent(new Event('submit', { cancelable: true }));
  const err = document.getElementById('pf-tx-error');
  return { errorShown: !err.classList.contains('hidden'), msg: err.textContent };
})()
```

Expected: `errorShown: true`, msg mentions "only hold". `preview_console_logs` error → none.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add Buy/Sell/Transfer transaction modal with validation and Use Market

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Portfolio translation (MyMemory API)

**Files:**
- Modify: `index.html` — add `data-i18n` attributes to Portfolio static labels; add a language `<select>` to the portfolio head; add a new `Translate` `<script>` module; call `Translate.init()` in `DOMContentLoaded`; CSS for the select.

**Interfaces:**
- Consumes: nothing from Tasks 1-4 (independent). Reads/writes localStorage; calls MyMemory via `fetch`.
- Produces: `Translate` module with `{ init, apply }`. `apply()` re-translates currently-present `data-i18n` nodes into the active language (called after Portfolio re-renders).

- [ ] **Step 1: Mark Portfolio static labels with `data-i18n`**

Add `data-i18n="<English text>"` to the Portfolio view's static labels. The attribute value IS the canonical English string. Cover at minimum: the sub-tab buttons (`Coins`, `✦ Analytics` → use `data-i18n="Coins"` / `data-i18n="Analytics"` on a child span so the ✦ stays), the action buttons (`＋ Add coin`, `− Remove coin`), `+ New Portfolio`, the four summary `card-label` texts (`Current Balance`, `24h Portfolio Change`, `Total Profit / Loss`, `Top Performer`), and the empty-state text. Example edits:

```html
<button class="btn" id="pf-add-btn" data-i18n="Add coin">＋ Add coin</button>
<button class="btn" id="pf-remove-btn" data-i18n="Remove coin">− Remove coin</button>
...
<span class="card-label" data-i18n="Current Balance">Current Balance</span>
```

Note: for labels that embed dynamic children (e.g. `24h Portfolio Change <span id="pf-24h-pct">`), put `data-i18n` on a dedicated inner text node/span that holds ONLY the translatable words, so the dynamic `%` span is untouched. For dynamically-rendered strings (overview cards/table headers built in JS), Task 5 Step 4 handles them by translating after render.

- [ ] **Step 2: Add the language `<select>` to the portfolio head**

Inside `.pf-head` (~line 1067 area), after `#pf-actions`, add:

```html
      <select class="pf-lang" id="pf-lang" aria-label="Translate this page">
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="fr">Français</option>
        <option value="de">Deutsch</option>
        <option value="it">Italiano</option>
        <option value="pt">Português</option>
        <option value="ja">日本語</option>
      </select>
```

- [ ] **Step 3: Add the `Translate` module**

Add a new `<script>` block just before the `app.js` script block:

```html
<script>
/* ==================== translate.js ====================
   Portfolio-page-only UI-label translation via MyMemory's free, keyless
   REST API (https://api.mymemory.translated.net/get, CORS-open, verified).
   Translates ONLY curated data-i18n label strings — never coin names,
   numbers, or dates. Results cached in localStorage so repeat visits and
   language switches stay far under the ~5000 char/day free quota. Requests
   go through a small in-module serial queue so we never burst. */
const Translate = (() => {
  const LANG_KEY = 'cryptofolio.i18n.lang';
  const cachePrefix = 'cryptofolio.i18n.';
  let lang = localStorage.getItem(LANG_KEY) || 'en';
  const originals = new WeakMap(); // node -> original English text
  let quotaHit = false;

  // tiny serial queue (own budget; independent of the CoinGecko queue)
  let queue = Promise.resolve();
  function enqueue(task) {
    const p = queue.then(task, task);
    queue = p.catch(() => {}).then(() => new Promise(r => setTimeout(r, 250)));
    return p;
  }

  function cacheKey(l, text) { return cachePrefix + l + '.' + text; }

  async function translateOne(text, l) {
    const ck = cacheKey(l, text);
    const hit = localStorage.getItem(ck);
    if (hit !== null) return hit;
    if (quotaHit) return text;
    try {
      const res = await enqueue(() => fetch(
        'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|' + encodeURIComponent(l)
      ).then(r => r.json()));
      if (res && res.quotaFinished) { quotaHit = true; return text; }
      const out = res && res.responseData && res.responseData.translatedText ? res.responseData.translatedText : text;
      try { localStorage.setItem(ck, out); } catch (_) {}
      return out;
    } catch (_) {
      return text; // network failure: leave English
    }
  }

  async function apply() {
    const nodes = document.querySelectorAll('#view-portfolio [data-i18n]');
    nodes.forEach(n => { if (!originals.has(n)) originals.set(n, n.getAttribute('data-i18n')); });
    if (lang === 'en') {
      nodes.forEach(n => { n.textContent = originals.get(n); });
      return;
    }
    for (const n of nodes) {
      const en = originals.get(n);
      const t = await translateOne(en, lang);
      // node may have been re-rendered/removed during await; guard:
      if (n.isConnected) n.textContent = t;
    }
  }

  function setLang(l) {
    lang = l;
    localStorage.setItem(LANG_KEY, l);
    apply();
  }

  function init() {
    const sel = document.getElementById('pf-lang');
    if (sel) {
      sel.value = lang;
      sel.addEventListener('change', () => setLang(sel.value));
    }
    if (lang !== 'en') apply();
  }

  return { init, apply, get lang() { return lang; } };
})();
</script>
```

- [ ] **Step 4: Re-apply translation after Portfolio re-renders**

Portfolio `render()` rebuilds DOM (new `data-i18n` nodes lose prior translated text). At the end of Portfolio `render()` (after the existing `ScrollTrigger.refresh(true)`), add a guarded call:

```js
    if (typeof Translate !== 'undefined' && Translate.lang !== 'en') Translate.apply();
```

- [ ] **Step 5: Call `Translate.init()` in `DOMContentLoaded`**

In the init handler (~line 3627, after `Gallery.init();`), add `Translate.init();`.

- [ ] **Step 6: Add CSS for the select**

```css
.pf-lang { background: var(--bg-2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer; }
```

- [ ] **Step 7: Verify — translation applies to labels only, caches, restores**

Preview, `switchView('portfolio')`. `preview_eval` switch to Spanish and check a known label plus that numbers/coin names are untouched:

```js
(() => new Promise(resolve => {
  const sel = document.getElementById('pf-lang');
  sel.value = 'es'; sel.dispatchEvent(new Event('change'));
  setTimeout(() => {
    resolve({
      addCoinLabel: document.getElementById('pf-add-btn').textContent.trim(),
      balanceValueUnchanged: document.getElementById('pf-total').textContent, // still a $ number
      cachedKeys: Object.keys(localStorage).filter(k => k.startsWith('cryptofolio.i18n.es.')).length,
    });
  }, 2500);
}))()
```

Expected: `addCoinLabel` is Spanish (e.g. "Añadir moneda"/"Agregar moneda"); `balanceValueUnchanged` is still a `$` number; `cachedKeys > 0`. Then verify repeat switch is cache-served (no new network): use `preview_network`, switch back to `en` then `es` again, confirm no new `api.mymemory` request appears the second time.

```js
(() => { const sel = document.getElementById('pf-lang'); sel.value='en'; sel.dispatchEvent(new Event('change')); return document.getElementById('pf-add-btn').textContent.trim(); })()
```

Expected: back to "＋ Add coin" (English restored, instant, no network).

- [ ] **Step 8: Verify — Market/Bubbles/Gallery untouched + no console errors**

`preview_eval`: `switchView('market'); document.querySelectorAll('#view-market [data-i18n]').length` → Expected `0` (no i18n outside Portfolio). `preview_console_logs` error → none.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Add Portfolio-scoped MyMemory translation with localStorage caching

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes (author-completed)

- **Spec coverage:** data model + migration (T1), derivation seam keeping consumers working (T1), row menu "View transactions" (T2), overview drill-down with breadcrumb/cards/table/pagination (T2+T3), per-transaction Cost/Proceeds/PNL math (T3), Add/Edit modal with Buy/Sell/Transfer + Use Market + validation (T4), MyMemory translation scoped to Portfolio labels with caching + serial queue (T5). All spec sections mapped.
- **Deviation (noted intentionally):** the spec said translation reuses "the same enqueue() used for CoinGecko." `enqueue` is private to the API module (not exported) and shares no rate-limit budget with a different host; T5 gives `Translate` its own identical small serial queue instead. Same "never burst" guarantee, cleaner separation. If a reviewer prefers exporting `API.enqueue`, that is an acceptable alternative — flag to the human.
- **Type consistency:** `deriveHolding` returns `{coinId,transactions,amount,buyPrice,realizedPnl}` and is consumed as such in T1/T3; `annotateTransactions` returns `{rows,derived}`; transaction shape `{id,type,quantity,pricePerCoin,fees,date,direction?,notes}` is identical across T1/T3/T4.
- **Known intermediate-state note:** T3 wires edit/add buttons to `openTxEditor`, defined as a stub in T3 and implemented in T4 — a deliberate, marked seam so each task is independently testable.
