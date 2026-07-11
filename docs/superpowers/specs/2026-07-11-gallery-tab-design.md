# Gallery tab design

## Purpose

Add a fourth tab, "Gallery," next to Bubbles in `index.html`. It lets the
user save website links they like (in the style of a Dribbble inspiration
grid) as thumbnail + title + URL cards. It is fully independent of crypto
market data — no CoinGecko calls, no dependency on `state.markets`.

## Data model

A new `Gallery` module (own `<script>` block, same self-contained IIFE
pattern as `Portfolio` and `Analytics`) persists entries to a
`cryptofolio.gallery.v1` localStorage key as a flat array, newest-first
when rendered (stored order doesn't matter; render sorts by `createdAt`
descending):

```js
{
  id: string,        // 'g_' + Date.now().toString(36), same style as portfolio ids
  title: string,
  url: string,        // always has a protocol (see Data flow)
  thumbnail: string,  // base64 data URL, JPEG, compressed client-side
  createdAt: number,  // Date.now() at creation; preserved across edits
}
```

No collections/folders — one flat grid for all entries (per user decision;
can be revisited later if the grid grows unwieldy).

## UI

- **Nav tab**: `<button class="tab" data-view="gallery">Gallery</button>`
  added after Bubbles in `.tabs`. `VIEWS` array gains `'gallery'`.
- **View section**: `<section id="view-gallery" class="view">` added after
  `#view-bubbles`, following the same `.view` / `.view.active` show/hide
  convention as the other three views.
- **Grid**: `repeat(auto-fill, minmax(220px, 1fr))` CSS grid, gap consistent
  with other card grids in the app (`--radius`, `--border` tokens). Each
  card:
  - Thumbnail `<img>`, fixed aspect ratio (e.g. `aspect-ratio: 4/3`),
    `object-fit: cover` so mismatched source images stay tidy.
  - Title overlaid at the bottom of the thumbnail on hover (gradient
    scrim + text), matching the existing dark theme.
  - A ⋮ button (top-right corner of the card) opens a small floating menu
    with **Edit** / **Delete**, reusing the existing floating `.menu`
    pattern used for portfolio coin rows (`#row-menu`), generalized so it
    can be triggered from a gallery card instead of just a coin row.
  - Clicking the card body (not the thumbnail-corner menu) opens `url` in
    a new tab (`window.open(url, '_blank', 'noopener')`).
- **Add button**: "+ Add site" button above the grid, opens the Add/Edit
  modal.
- **Add/Edit modal**: reuses the existing `.modal` styling (like
  `tx-modal`). Fields:
  - File picker for the screenshot (`<input type="file" accept="image/*">`)
    with a live preview once selected.
  - Text input for title.
  - Text input for URL.
  - Submit button: "Add" when creating, "Save" when editing (same
    label-swap convention as the existing tx-modal Add/Update button).
  - Editing pre-fills all three fields (thumbnail preview shows the
    existing image; a new file replaces it, but re-selecting isn't
    required to save just a title/URL change).
- **Empty state**: centered message, "No saved sites yet — click **+ Add
  site** to save your first one." styled like the existing `.empty` class
  used in the Portfolio view.

## Data flow

1. User selects an image file in the modal.
2. It's drawn onto an offscreen `<canvas>`, resized so its longest side is
   ≤480px (preserving aspect ratio), then re-encoded via
   `canvas.toDataURL('image/jpeg', 0.72)`. This keeps each thumbnail to
   roughly 20–60KB instead of multi-MB originals.
3. The compressed data URL is held in memory (module-level variable) until
   the user clicks Add/Save — nothing touches localStorage until submit.
4. On submit: validate URL is non-empty; if it lacks `://`, prefix
   `https://` before storing so the card link always works. Push a new
   entry (create) or update the existing one in place (edit, preserving
   `createdAt` and `id`), then persist the whole array to localStorage and
   re-render the grid.
5. Delete: confirm via the existing `confirm()` pattern used elsewhere in
   the app (e.g. removing a coin), since accidental menu clicks are
   otherwise unrecoverable. On confirm, filter the entry out of the array,
   persist, and re-render.

Because entries render from local state with no network dependency, the
Gallery tab has no loading state — it's synchronous and instant.

## Error handling

- **Quota exceeded**: `localStorage.setItem` can throw once enough images
  accumulate. Catch it; keep the just-added/edited entry in the in-memory
  array for the current session (so the user doesn't lose what they just
  did), but show an inline error banner in the modal: "Couldn't save —
  storage may be full. Try removing some older entries." Do not silently
  swallow the failure.
- **Non-image file**: reject client-side via `file.type.startsWith('image/')`
  before attempting to draw it to canvas; show an inline validation message
  in the modal instead of attempting the compression step.
- **Missing URL**: submit is a no-op (mirrors the existing tx-modal
  pattern of just not submitting) if the URL field is empty after trim.
- **Missing title**: falls back to the URL's hostname as a default title
  (keeps the card from rendering with blank text) rather than blocking
  submission — title is nice-to-have, not a hard requirement.

## Testing / verification

Manual verification via the preview browser (no automated test suite
exists in this project):

1. Add an entry with a real image file; confirm it renders in the grid
   and persists in `localStorage.getItem('cryptofolio.gallery.v1')`.
2. Reload the page; confirm the entry survives.
3. Edit the entry's title/URL without changing the image; confirm the
   thumbnail is unchanged and the edit persists.
4. Edit the entry's image; confirm the new thumbnail replaces the old one.
5. Delete the entry; confirm the empty state reappears.
6. Confirm tab switching works and the URL hash updates to `#gallery`
   like the other views.
7. Confirm no console errors, and that switching to/from Gallery doesn't
   trigger any CoinGecko network calls.

## Scope boundaries (explicitly out of scope)

- No collections/folders/tags — flat grid only.
- No auto-screenshot generation from a URL — thumbnail is always a
  user-supplied image.
- No drag-and-drop reordering — newest-first order only.
- No import/export of gallery data.
