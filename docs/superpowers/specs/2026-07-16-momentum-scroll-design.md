# Momentum/inertia scrolling design

## Purpose

Native browser wheel scrolling has no momentum for a physical mouse wheel —
each notch scrolls a fixed amount and stops instantly. Trackpads get
momentum from the OS itself, before the page ever sees it, but a plain
mouse wheel never does. The user wants scrolling to keep coasting for a
short moment after releasing the wheel, site-wide, including the smaller
scrollable panels (Add/Edit modals, coin detail popup, coin search
dropdown) as well as the main page.

This requires intercepting `wheel` events and manually animating the
scroll position with a decaying velocity — CSS alone (including the
`scroll-behavior: smooth` already added in an earlier change) only affects
*programmatic* scrolls (`scrollIntoView`, anchor jumps), never raw wheel
input.

## Constraint

This project is a single self-contained `index.html` file with **zero
external JS dependencies** — every feature (Bubbles' physics simulation,
Gallery, Analytics charts) is hand-rolled vanilla JS, no build step, no
CDN scripts. This feature preserves that: a small hand-rolled momentum
engine, not a library like Lenis pulled in via CDN, which would introduce
the project's first external dependency and a real architectural change
nobody asked for.

## Architecture

A new module, `MomentumScroll`, follows the exact pattern already used by
every other module in the file (`Market`, `Portfolio`, `Analytics`,
`Bubbles`, `Gallery`, `CoinPanel`): `const MomentumScroll = (() => { ...
return { init }; })();`, with `MomentumScroll.init()` added to the existing
`DOMContentLoaded` handler in app.js alongside the other modules' `init()`
calls. It attaches exactly one `wheel` listener at the document level —
no changes needed to market.js/portfolio.js/analytics.js or any HTML,
since the scroll target is resolved dynamically per wheel event rather
than requiring specific elements to be wired up individually.

## Algorithm

On each `wheel` event:

1. If `event.ctrlKey` is set (pinch-zoom gesture on trackpads/some mice),
   do nothing and let the browser handle it natively — never intercept
   zoom gestures.
2. Walk up from `event.target` through `parentElement` to find the
   nearest ancestor that is currently scrollable: computed
   `overflow-y` is `auto` or `scroll`, AND `scrollHeight > clientHeight`
   (i.e., there's actually somewhere to scroll). This generically covers
   the main page (`document.scrollingElement`, the eventual fallback if no
   ancestor matches) plus any open `.modal`, the `.side-panel` coin detail
   popup, and the `.combo-list` search dropdown — without hardcoding those
   class names, so it automatically covers any future scrollable container
   too.
3. Call `preventDefault()` on the event (suppresses the browser's default
   instant scroll for this target).
4. Add the event's `deltaY`, scaled by a tuning constant, to that target's
   velocity, stored in a `Map` keyed by the target element. A new wheel
   tick while a target is already coasting *adds* to its existing
   velocity rather than replacing it, so continued scrolling while already
   coasting accelerates naturally instead of resetting to a fresh coast.
5. If no animation loop is currently running for that target, start one
   via `requestAnimationFrame`.

Each animation frame, for every target with non-negligible velocity:

1. Apply the velocity to the target's scroll position (`scrollTop` for an
   element, or the page's scroll for `document.scrollingElement`), scaled
   by the real elapsed time since the previous frame (`performance.now()`
   delta), clamped so it can never scroll past the container's valid
   range (0 to `scrollHeight - clientHeight`).
2. Decay the velocity by a time-based factor (see Tuning below) rather
   than a fixed per-callback multiplier, so the coast takes the same
   *time* regardless of the display's refresh rate.
3. Once `Math.abs(velocity)` drops below a small threshold, stop the loop
   and remove the target from the `Map`.

## Tuning (measured from a reference video, not guessed)

The user supplied a reference screencast (`Screencast from 2026-07-16
14-33-45.webm`, a private-jet-charter marketing site with a Lenis/GSAP-
style premium scroll feel). Rather than eyeball it, every consecutive
frame pair was cross-correlated (row-profile shift matching, via a small
Python/Pillow/numpy script — `ffmpeg` extracted 250 frames at 30fps) to
get an actual measured vertical-scroll-pixels-per-frame curve across all
9 distinct scroll gestures in the clip. Findings:

- **Coast duration scales with flick strength** — a small flick decays to
  near-zero in ~5-10 frames (~150-300ms at 30fps), the largest flick in
  the clip (peak ~64px/frame at the analysis scale, several hundred real
  screen pixels in a single 33ms frame) takes ~15-25 frames (~500-800ms)
  to fully settle. This confirms a velocity/friction (momentum) model is
  the right one — it's exactly what makes coast distance/duration scale
  with input strength — rather than a fixed-duration ease-to-target
  model, which would show the same settle time regardless of flick size.
- Fitting an exponential decay to the cleanest (largest, best
  signal-to-noise) gesture gives an estimated **velocity half-life of
  roughly 120ms**.

**Concrete parameters:**

- Decay MUST be time-based (`velocity *= Math.pow(FRICTION_PER_SECOND,
  dtSeconds)` using real elapsed time between animation frames from
  `performance.now()`), not a fixed multiplier applied once per
  `requestAnimationFrame` callback. The latter is a common bug: it decays
  faster on a high-refresh-rate display (more callbacks/second) than a
  60Hz one, so the exact same flick would coast for a visibly shorter
  *time* on a 144Hz monitor. Time-based decay feels identical regardless
  of the display's refresh rate.
- `FRICTION_PER_SECOND ≈ 0.003` (i.e., if velocity were left completely
  unfed for a full second, it would already be at 0.3% of its start
  value) — derived from the measured ~120ms half-life:
  `0.5 = FRICTION_PER_SECOND^0.12`, solved for `FRICTION_PER_SECOND`.
- The wheel-delta-to-velocity scaling constant should be generous enough
  that a normal firm scroll produces a visually pronounced glide matching
  the reference's energetic feel, not a barely-noticeable one — tuned by
  trying it in the browser against the reference video side-by-side
  during implementation, since the reference's exact pixel scale doesn't
  map 1:1 onto arbitrary wheel-event `deltaY` units across browsers/OSes/
  mouse-acceleration-settings.
- These are still named constants, not hardcoded magic numbers inline —
  easy to nudge further after trying it if it still doesn't feel right.

## Known trade-off: trackpad double-momentum

Trackpads already have their own OS-level momentum: after the user lifts
their fingers, the OS keeps sending `wheel` events with shrinking deltas
on its own, before this code ever runs. There is no fully reliable,
standardized way across browsers/OSes to distinguish "this wheel event is
the OS's own synthetic momentum tail" from "this is a real physical
mouse-wheel notch" — attempting device-sniffing heuristics (e.g. delta
magnitude/frequency) is unreliable and not worth the complexity here.

Mitigation: keep the *added* synthetic momentum short and light (per the
tuning above) rather than trying to detect and skip trackpad input. The
practical effect: trackpad users get a little bit of this stacked on top
of their existing native momentum (likely barely noticeable, since it
decays quickly), while mouse-wheel users — who get none today — get a
clearly noticeable, short coast. This is an accepted, stated trade-off,
not a bug to chase further.

## Edge cases

- **`ctrl+wheel` (zoom):** explicitly excluded, per the algorithm above —
  never intercepted, browser handles it natively.
- **Overshoot:** scroll position is clamped to each container's valid
  range every frame, so momentum can never scroll past the top or bottom.
- **Bubbles view:** the Bubbles view has no page-level overflow (it fills
  the viewport). A wheel event there resolves to the main page as the
  fallback target via the ancestor walk; applying velocity to a
  non-scrollable range is a harmless no-op (clamped to a zero-width
  range). Bubbles' own pointer-based bubble dragging (pointerdown/move/up)
  is a completely separate event type, untouched by this change.
- **Multiple simultaneous targets:** tracked independently via the `Map`,
  though in practice only one target is ever actively scrolling at a time
  given the site's modal-backdrop UX (a modal blocks wheel interaction
  with the page behind it).
- **Keyboard scrolling** (arrow keys, Page Up/Down, spacebar) and **touch
  scrolling** on mobile are untouched — neither fires `wheel` events, so
  neither is affected by this change in any way.

## Interaction with existing code

Fully independent of the `scroll-behavior: smooth` CSS added earlier:
that CSS governs *programmatic* scrolls (the pagination Next/Previous
buttons' `scrollIntoView` call, any future anchor jumps), while this
module governs *direct wheel input*. They don't conflict because they're
triggered by different actions and never both act on the same scroll in
the same moment.

## Testing / verification

Manual, in the browser preview (no automated test suite exists in this
project, consistent with everything else):

1. Dispatch a synthetic `wheel` event (or a short burst of them) on the
   main page; confirm the scroll position keeps changing and decaying for
   a short period *after* the last dispatched event, rather than stopping
   instantly when the synthetic events stop.
2. Open an Add/Edit modal with enough content to scroll (or the coin
   detail popup); repeat the same check inside it.
3. Confirm a `wheel` event with `ctrlKey: true` does NOT get
   `preventDefault()`'d (check via a listener flag, since simulating real
   OS zoom isn't practical in a headless check).
4. Confirm no console errors.
5. Confirm the pagination Previous/Next buttons' existing smooth-scroll
   (`scrollIntoView`) still works unaffected.
6. Confirm scrolling near the very top or very bottom of a long list
   doesn't overshoot past the valid range.
7. Confirm that with `prefers-reduced-motion: reduce` emulated, the wheel
   listener is never attached (native instant scrolling still works, but
   no added coast).

## Accessibility: respect `prefers-reduced-motion`

The earlier `scroll-behavior: smooth` CSS change was gated behind
`@media (prefers-reduced-motion: no-preference)`. Added momentum is, if
anything, *more* relevant to that same setting — it's extra, continued
motion after the user's input has already stopped, which is exactly the
kind of effect vestibular-motion-sensitive users ask browsers/sites to
suppress. `MomentumScroll.init()` checks
`window.matchMedia('(prefers-reduced-motion: reduce)').matches` and, if
true, skips attaching the wheel listener entirely — native instant wheel
scrolling still works normally, it just never gets the added coast.

## Scope boundaries (explicitly out of scope)

- No device-type detection/sniffing to distinguish trackpad from mouse
  wheel input (see Known Trade-off above).
- No user-facing setting/toggle to disable momentum scrolling beyond the
  OS-level `prefers-reduced-motion` signal above.
