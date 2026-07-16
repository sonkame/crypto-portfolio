# Momentum Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wheel scrolling coast for a short moment after release, site-wide, matching the feel measured from a user-supplied reference video.

**Architecture:** One new self-contained module, `MomentumScroll`, added as its own `<script>` block in `index.html`, following the exact `const X = (() => {...; return {init};})();` pattern already used by every other module in the file. It attaches a single `wheel` listener at the document level and resolves the correct scroll target (main page or whichever scrollable panel is under the cursor) dynamically per event — no other file/module needs to change.

**Tech Stack:** Plain vanilla JS (no libraries — this project has zero external JS dependencies by design), `requestAnimationFrame`, `wheel`/`WheelEvent`, `matchMedia`.

## Global Constraints

- Zero external dependencies — hand-rolled JS only, no CDN scripts, no build step (per spec's Constraint section).
- Decay MUST be time-based (`performance.now()` deltas), never a fixed multiplier applied once per `requestAnimationFrame` callback — the latter decays faster on high-refresh-rate displays (spec's Tuning section).
- `FRICTION_PER_SECOND ≈ 0.003` (measured ~120ms velocity half-life from the reference video — spec's Tuning section). This is a starting point in a named constant, not a value to treat as final without trying it.
- `ctrl+wheel` (zoom gesture) must never be intercepted (spec's Edge cases).
- Scroll position must be clamped to each target's valid range every frame — never overshoot top/bottom (spec's Edge cases).
- Must respect `prefers-reduced-motion: reduce` by never attaching the wheel listener at all (spec's Accessibility section) — same precedent as the earlier `scroll-behavior: smooth` CSS change.
- No device-type sniffing to distinguish trackpad from mouse wheel (spec's Known Trade-off — explicitly out of scope).
- No user-facing toggle to disable this beyond the OS-level `prefers-reduced-motion` signal (spec's Scope boundaries).

---

## Task 1: MomentumScroll module

**Files:**
- Modify: `index.html` (one new `<script>` block, one line added to the existing `DOMContentLoaded` handler)

**Interfaces:**
- Consumes: nothing from other modules — fully self-contained, only touches DOM/browser APIs (`document`, `window`, `getComputedStyle`, `requestAnimationFrame`, `performance.now`, `matchMedia`).
- Produces: `MomentumScroll.init()` — call once from the existing `DOMContentLoaded` handler in app.js. No other module calls into `MomentumScroll` at all after that.

- [ ] **Step 1: Add the new `<script>` block for the module**

Find this exact block (the boundary between gallery.js and app.js — currently lines 3255-3258):

```html
  return { init };
})();
</script>

<script>
/* ==================== app.js ====================
```

Replace it with:

```html
  return { init };
})();
</script>

<script>
/* ==================== momentum.js ====================
   Adds a short momentum/coast after releasing the mouse wheel. Native
   wheel scrolling has no inertia for a physical mouse wheel — only
   trackpads get that, from the OS, before the page ever sees it. Hand-
   rolled (no library) to keep this project's zero-external-JS-dependency
   property. Tuning constants come from cross-correlating frames of a
   user-supplied reference video, not a guess — see
   docs/superpowers/specs/2026-07-16-momentum-scroll-design.md. */
const MomentumScroll = (() => {
  const FRICTION_PER_SECOND = 0.003; // velocity multiplier if left unfed for a full second (~120ms half-life, measured)
  const DELTA_TO_VELOCITY = 25;      // wheel deltaY -> px/second velocity; starting point, tune by feel against the reference video
  const MAX_VELOCITY = 9000;         // px/second cap so one huge flick can't launch an absurd coast
  const STOP_THRESHOLD = 15;         // px/second below which a coast is considered finished

  const targets = new Map(); // scrollable element (or the page) -> { velocity: px/second, lastTime: ms }

  function isScrollable(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll';
    return canScrollY && el.scrollHeight > el.clientHeight;
  }

  /* Walks up from the wheel event's target to the nearest scrollable
     ancestor. Generically covers any open .modal, .side-panel, or
     .combo-list without hardcoding those class names, plus the main
     page as the fallback when nothing else matches. */
  function resolveTarget(e) {
    let el = e.target;
    while (el && el !== document.body) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function isPageTarget(target) {
    return target === document.scrollingElement || target === document.documentElement;
  }

  function scrollRange(target) {
    const max = isPageTarget(target)
      ? document.documentElement.scrollHeight - window.innerHeight
      : target.scrollHeight - target.clientHeight;
    return Math.max(0, max);
  }

  function currentTop(target) {
    return isPageTarget(target) ? window.scrollY : target.scrollTop;
  }

  function setTop(target, top) {
    if (isPageTarget(target)) window.scrollTo(0, top);
    else target.scrollTop = top;
  }

  function step(target, now) {
    const state = targets.get(target);
    if (!state) return;
    const dtSeconds = Math.max(0, (now - state.lastTime) / 1000);
    state.lastTime = now;

    const max = scrollRange(target);
    const top = Math.min(Math.max(currentTop(target) + state.velocity * dtSeconds, 0), max);
    setTop(target, top);

    state.velocity *= Math.pow(FRICTION_PER_SECOND, dtSeconds);

    if (Math.abs(state.velocity) < STOP_THRESHOLD || max <= 0) {
      targets.delete(target);
      return;
    }
    requestAnimationFrame(t => step(target, t));
  }

  function onWheel(e) {
    if (e.ctrlKey) return; // pinch-zoom gesture - never intercept
    const target = resolveTarget(e);
    if (scrollRange(target) <= 0) return; // nothing to scroll here, let the event pass through

    e.preventDefault();

    let state = targets.get(target);
    const isNewCoast = !state;
    if (isNewCoast) {
      state = { velocity: 0, lastTime: performance.now() };
      targets.set(target, state);
    }
    state.velocity += e.deltaY * DELTA_TO_VELOCITY;
    state.velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, state.velocity));

    if (isNewCoast) {
      requestAnimationFrame(t => step(target, t));
    }
  }

  function init() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.addEventListener('wheel', onWheel, { passive: false });
  }

  return { init };
})();
</script>

<script>
/* ==================== app.js ====================
```

- [ ] **Step 2: Wire `MomentumScroll.init()` into the existing `DOMContentLoaded` handler**

Find this exact block (currently lines 3620-3626):

```js
document.addEventListener('DOMContentLoaded', () => {
  Market.init();
  Portfolio.init();
  Analytics.init();
  Bubbles.init();
  CoinPanel.init();
  Gallery.init();
```

Replace it with:

```js
document.addEventListener('DOMContentLoaded', () => {
  Market.init();
  Portfolio.init();
  Analytics.init();
  Bubbles.init();
  CoinPanel.init();
  Gallery.init();
  MomentumScroll.init();
```

- [ ] **Step 3: Verify the coast happens and outlasts the wheel input**

Start (or confirm running) the preview server for this project (`crypto-portfolio`, port 8787), reload, and run in the preview browser:

```js
(async () => {
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 50));
  for (let i = 0; i < 5; i++) {
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 16));
  }
  const rightAfter = window.scrollY;
  await new Promise(r => setTimeout(r, 250));
  const afterCoast = window.scrollY;
  return { rightAfter, afterCoast, keptMovingAfterEventsStopped: afterCoast > rightAfter };
})()
```

Expected: `keptMovingAfterEventsStopped: true`, and `afterCoast` meaningfully greater than `rightAfter` — the page kept scrolling down after the last synthetic wheel event, not stopping instantly.

- [ ] **Step 4: Verify `ctrl+wheel` is never intercepted**

```js
(() => {
  window.scrollTo(0, 0);
  const zoomEvent = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
  document.dispatchEvent(zoomEvent);
  const normalEvent = new WheelEvent('wheel', { deltaY: 100, ctrlKey: false, bubbles: true, cancelable: true });
  document.dispatchEvent(normalEvent);
  return { ctrlWheelPrevented: zoomEvent.defaultPrevented, normalWheelPrevented: normalEvent.defaultPrevented };
})()
```

Expected: `{ ctrlWheelPrevented: false, normalWheelPrevented: true }`.

- [ ] **Step 5: Verify momentum works inside a scrollable panel (not just the main page)**

The coin detail popup (`#coin-panel`, class `.side-panel`) is the easiest target to open without needing portfolio data. Open it for any market coin, then dispatch wheel events targeting an element inside it:

```js
(async () => {
  document.querySelector('.tab[data-view="market"]').click();
  await new Promise(r => setTimeout(r, 500));
  document.querySelector('#market-body tr[data-id]').click(); // opens the coin detail popup
  await new Promise(r => setTimeout(r, 300));
  const panel = document.getElementById('coin-panel');
  const inner = panel.querySelector('.sp-stats') || panel; // any element inside the panel
  panel.scrollTop = 0;
  for (let i = 0; i < 5; i++) {
    inner.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 16));
  }
  const rightAfter = panel.scrollTop;
  await new Promise(r => setTimeout(r, 250));
  const afterCoast = panel.scrollTop;
  return { rightAfter, afterCoast, coastedInPanel: afterCoast >= rightAfter };
})()
```

Expected: `coastedInPanel: true` if the panel has enough content to scroll (if `rightAfter` and `afterCoast` are both `0`, the panel's content doesn't overflow at the current viewport size — resize the preview to a smaller height with `preview_resize` and retry rather than treating that as a failure).

- [ ] **Step 6: Verify no overshoot past the top of the page**

```js
(async () => {
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 50));
  for (let i = 0; i < 5; i++) {
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 16));
  }
  await new Promise(r => setTimeout(r, 300));
  return { scrollY: window.scrollY }; // must never go negative
})()
```

Expected: `scrollY: 0` (clamped, never negative).

- [ ] **Step 7: Verify a wheel event over the Bubbles view is a harmless no-op**

The Bubbles view fills the viewport with no page-level overflow, so a wheel event there should resolve to the main page as the fallback target and do nothing observable (per the spec's Edge cases). Confirm it doesn't throw and doesn't fight with Bubbles' own pointer-based dragging:

```js
(async () => {
  document.querySelector('.tab[data-view="bubbles"]').click();
  await new Promise(r => setTimeout(r, 300));
  const canvas = document.getElementById('bubbles-canvas');
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 100));
  return { stillOnBubblesView: document.getElementById('view-bubbles').classList.contains('active') };
})()
```

Expected: `stillOnBubblesView: true`, no thrown error (check console after, per Step 8 below).

- [ ] **Step 8: Verify no console errors and no regression to the existing pagination scroll**

Run: `preview_console_logs` with `level: "error"`
Expected: `No console logs.`

Then confirm the Market table's existing Previous/Next pagination (added in an earlier change) still works:

```js
(() => {
  document.querySelector('.tab[data-view="market"]').click();
  document.getElementById('market-next').click();
  return document.getElementById('market-page-info').textContent;
})()
```

Expected: `"Page 2 of X"` (whatever `X` currently is) — confirms the pagination buttons' own `scrollIntoView` call still runs without error alongside the new wheel listener.

- [ ] **Step 9: Verify `prefers-reduced-motion: reduce` disables the listener**

This is a real testing limitation worth being upfront about: the available preview tooling's `preview_resize` supports emulating `colorScheme` (light/dark) but does not document a way to emulate `prefers-reduced-motion` before scripts run, and injecting a `matchMedia` stub via `preview_eval` *after* `MomentumScroll.init()` has already attached its real listener doesn't retroactively undo that attachment. If the preview tooling has no reliable way to emulate this end-to-end, fall back to a direct source read instead of a live browser check:

```bash
grep -n "prefers-reduced-motion" index.html
```

Expected: the line inside `MomentumScroll`'s `init()` — `if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;` — appears before the `document.addEventListener('wheel', ...)` call, confirming the guard is in place even if it can't be exercised live in this environment.

- [ ] **Step 10: Tune `DELTA_TO_VELOCITY` by feel against the reference video**

`DELTA_TO_VELOCITY = 25` is a starting point (per the spec: wheel `deltaY` units don't map 1:1 onto the reference video's measured pixel scale across browsers/OSes/mouse-acceleration-settings, so this needs an in-browser feel check, not just the math from Step 3). In the preview browser, manually scroll the Market table (a real user gesture, not a synthetic dispatch, since `WheelEvent`'s constructor `deltaY` doesn't always match what a real mouse/trackpad reports) and compare the coast to `Screencast from 2026-07-16 14-33-45.webm`. If it feels too weak or too strong, adjust `DELTA_TO_VELOCITY` up or down and reload. Record whatever final value felt right in the implementation report.

- [ ] **Step 11: Commit**

```bash
cd /home/ghost/Documents/projects/crypto-portfolio
git add index.html
git commit -m "$(cat <<'EOF'
Add momentum/inertia scrolling on mouse wheel release

Native wheel scrolling has no inertia for a physical mouse wheel;
only trackpads get that from the OS. Hand-rolled (no library, keeps
this project's zero-JS-dependency property) wheel interceptor that
accumulates velocity per scrollable target and decays it over real
elapsed time (not per-animation-frame-callback, which would decay
faster on high-refresh-rate displays). Tuning constants are derived
from cross-correlating frames of a user-supplied reference video
(~120ms measured velocity half-life), not guessed. Respects
prefers-reduced-motion by never attaching the listener.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
