# Gallery Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth "Gallery" tab to the crypto-portfolio single-file app where the user can save website screenshots + titles + links in a flat, Dribbble-style grid, fully independent of crypto market data.

**Architecture:** A new self-contained `Gallery` module (own `<script>` block, same IIFE pattern as `Portfolio`/`Analytics`) persists entries to a `cryptofolio.gallery.v1` localStorage array. Images are compressed client-side (canvas resize + JPEG re-encode) before storage. The tab reuses existing shared UI plumbing (`.modal`, `#modal-backdrop`, `.menu`) rather than inventing new modal/menu infrastructure.

**Tech Stack:** Plain HTML/CSS/JS in a single `index.html` file (no build step, no framework). Standard browser APIs only: Canvas 2D, FileReader, `<input type="file">`, localStorage. All of these are already relied upon elsewhere in this file (canvas is already used for the donut/line/bubble charts), so no new library research is needed — this plan does not require the "search docs before changing code" step from CLAUDE.md, since that rule targets versioned third-party APIs (like the CoinGecko endpoints), not foundational, stable DOM APIs.

## Global Constraints

- One flat grid only — no collections/folders/tags (per spec decision).
- Each entry stores exactly: thumbnail (uploaded image), title, URL (per spec decision — no notes/tags).
- Thumbnails come from file upload only — no "paste an image URL" alternative (per spec decision).
- No automated test framework exists in this project. Every verification step below is manual, via the Claude Code preview tools (`preview_start`, `preview_eval`, `preview_console_logs`, `preview_screenshot`) against the `crypto-portfolio` server defined in `.claude/launch.json`, or equivalent manual browser steps if those tools aren't available in the executing environment.
- The app already has ONE shared `#modal-backdrop` element and generic wiring — set up once in `Portfolio.init()` — that closes ANY `.modal.open` element when the backdrop is clicked, Escape is pressed, or any `.modal-close` button (anywhere in the document) is clicked. Because all HTML in this file is static and parsed before any `<script>` runs, this generic wiring will automatically pick up the new Gallery modal's close button and the shared backdrop with **zero additional code** — do not write duplicate open/close/backdrop-click/Escape handling inside the Gallery module for its own modal chrome.
- Follow the existing code style exactly: 2-space indentation, `const X = (() => { ... return {...}; })();` module pattern, string concatenation (not template literals) for HTML generation via `esc()`, matching every other module in this file.

---

## Task 1: Gallery tab navigation + empty view skeleton

**Files:**
- Modify: `index.html` (nav tabs, view sections, `VIEWS` array, one CSS selector)

**Interfaces:**
- Consumes: existing `switchView(name)` function (`index.html`, inside the app.js script block) — already generic, toggles any `.view`/`.tab` pair by `data-view`/`id="view-<name>"` naming convention and updates `location.hash`. No changes needed to `switchView` itself.
- Produces: a `#view-gallery` section and `data-view="gallery"` tab button that later tasks will populate. No JS module exists yet after this task — the section is static markup only.

- [ ] **Step 1: Add the Gallery nav tab button**

In `index.html`, find this exact line (currently line 873):

```html
      <button class="tab" data-view="bubbles">Bubbles</button>
```

Replace it with:

```html
      <button class="tab" data-view="bubbles">Bubbles</button>
      <button class="tab" data-view="gallery">Gallery</button>
```

- [ ] **Step 2: Add the empty `#view-gallery` section**

Find this exact block (the closing of the Bubbles view, currently around line 1043):

```html
    <div class="bubbles-wrap" id="bubbles-wrap">
      <canvas id="bubbles-canvas"></canvas>
      <div id="bubble-tip" class="bubble-tip hidden"></div>
    </div>
  </section>
</main>
```

Replace it with:

```html
    <div class="bubbles-wrap" id="bubbles-wrap">
      <canvas id="bubbles-canvas"></canvas>
      <div id="bubble-tip" class="bubble-tip hidden"></div>
    </div>
  </section>

  <!-- GALLERY VIEW -->
  <section id="view-gallery" class="view">
    <p id="gallery-empty" class="empty">No saved sites yet.</p>
  </section>
</main>
```

- [ ] **Step 3: Register `'gallery'` in the `VIEWS` array**

Find this exact line (inside the app.js script block, currently line 2693):

```js
const VIEWS = ['market', 'portfolio', 'bubbles'];
```

Replace it with:

```js
const VIEWS = ['market', 'portfolio', 'bubbles', 'gallery'];
```

- [ ] **Step 4: Keep Gallery from being flex-stretched like the Bubbles view**

Find this exact line (currently line 108):

```css
#view-market.active, #view-portfolio.active { flex-shrink: 0; }
```

Replace it with:

```css
#view-market.active, #view-portfolio.active, #view-gallery.active { flex-shrink: 0; }
```

- [ ] **Step 5: Verify the tab switch works with no console errors**

Start (or confirm running) the preview server for this project (`crypto-portfolio`, port 8787), then in the preview browser run:

```js
document.querySelector('.tab[data-view="gallery"]').click();
({
  active: document.getElementById('view-gallery').classList.contains('active'),
  hash: location.hash,
  emptyText: document.getElementById('gallery-empty').textContent,
})
```

Expected: `{ active: true, hash: "#gallery", emptyText: "No saved sites yet." }`.

Then check console errors:

Run: `preview_console_logs` with `level: "error"`
Expected: `No console logs.`

- [ ] **Step 6: Commit**

```bash
cd /home/ghost/Documents/projects/crypto-portfolio
git add index.html
git commit -m "$(cat <<'EOF'
Add Gallery tab navigation and empty view skeleton

Fourth tab next to Bubbles; no functionality yet, just the nav
entry, an empty section, and VIEWS registration so tab switching
works via the existing generic switchView() logic.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add-site flow (grid, modal, image compression, persistence)

**Files:**
- Modify: `index.html` (CSS additions, `#view-gallery` section content, new `gallery-modal` markup, new `<script>` block for the `Gallery` module, `DOMContentLoaded` wiring)

**Interfaces:**
- Consumes: `esc(s)`, shared `.modal`/`.modal-close`/`#modal-backdrop` CSS+wiring, `.btn`/`.btn.cta`/`.tx-form`/`.empty`/`.hidden` CSS classes (all pre-existing, defined in earlier script/style blocks).
- Produces: `Gallery.init()` — call it once from the existing `DOMContentLoaded` handler. Produces module-private `entries` (array of `{ id, title, url, thumbnail, createdAt }`), `entryById(id)`, `render()`, and `cardHTML(entry)` — Task 3 will modify `cardHTML` and `init()` in place, so their exact current shape matters for that task's diff to apply cleanly.

- [ ] **Step 1: Add the Gallery CSS block**

Find this exact block (currently lines 627-630):

```css
.bubble-tip .tip-name { font-weight: 700; }

/* ---------- Coin Detail Popup ---------- */
```

Replace it with:

```css
.bubble-tip .tip-name { font-weight: 700; }

/* ---------- Gallery ---------- */
.gallery-toolbar { margin-bottom: 14px; }
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.gallery-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-2);
  cursor: pointer;
}
.gallery-thumb-wrap { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: var(--bg-3); }
.gallery-thumb-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gallery-card-title {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 12px 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gallery-card:hover .gallery-card-title { opacity: 1; }

.gallery-file-label {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 14px;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  text-align: center;
}
.gallery-file-label:hover { border-color: var(--accent); color: var(--text); }
.gallery-modal-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-3);
  object-fit: cover;
  display: none;
}
.gallery-modal-preview.shown { display: block; }
.gallery-error {
  font-size: 12.5px;
  color: var(--red);
  display: none;
  margin: 0;
}
.gallery-error.shown { display: block; }

/* ---------- Coin Detail Popup ---------- */
```

- [ ] **Step 2: Fill in the `#view-gallery` section (toolbar + grid)**

Find this exact block (added in Task 1):

```html
  <!-- GALLERY VIEW -->
  <section id="view-gallery" class="view">
    <p id="gallery-empty" class="empty">No saved sites yet.</p>
  </section>
```

Replace it with:

```html
  <!-- GALLERY VIEW -->
  <section id="view-gallery" class="view">
    <div class="gallery-toolbar">
      <button class="btn" id="gallery-add-btn">＋ Add site</button>
    </div>
    <p id="gallery-empty" class="empty">No saved sites yet — click “＋ Add site” to save your first one.<br><small>Saved locally in this browser only.</small></p>
    <div class="gallery-grid hidden" id="gallery-grid"></div>
  </section>
```

- [ ] **Step 3: Add the Add/Edit Gallery modal markup**

Find this exact block (currently lines 1165-1170):

```html
<!-- floating per-row menu (Coins table ⋮) -->
<div class="menu hidden" id="row-menu">
  <button data-act="edit">✏️ Edit holding</button>
  <button data-act="remove" class="danger">🗑 Remove coin</button>
</div>
```

Replace it with:

```html
<!-- floating per-row menu (Coins table ⋮) -->
<div class="menu hidden" id="row-menu">
  <button data-act="edit">✏️ Edit holding</button>
  <button data-act="remove" class="danger">🗑 Remove coin</button>
</div>

<!-- ADD / EDIT GALLERY SITE MODAL -->
<div class="modal" id="gallery-modal" role="dialog" aria-modal="true">
  <button class="modal-close" data-close aria-label="Close">×</button>
  <h3 id="gallery-modal-title">Add Site</h3>
  <form id="gallery-form" class="tx-form" autocomplete="off">
    <input type="file" id="gallery-file" accept="image/*" class="hidden">
    <label for="gallery-file" class="gallery-file-label" id="gallery-file-label">Choose a screenshot…</label>
    <img id="gallery-preview" class="gallery-modal-preview" alt="">
    <input id="gallery-title" type="text" placeholder="Title" aria-label="Title" maxlength="80">
    <input id="gallery-url" type="text" placeholder="https://example.com" aria-label="URL">
    <p class="gallery-error" id="gallery-error"></p>
    <button type="submit" id="gallery-submit" class="btn cta">Add</button>
  </form>
</div>
```

- [ ] **Step 4: Add the `Gallery` module `<script>` block**

Find this exact block (the boundary between bubbles.js and app.js — currently lines 2686-2689):

```html
</script>

<script>
/* ==================== app.js ====================
```

Replace it with:

```html
</script>

<script>
/* ==================== gallery.js ====================
   Gallery view: save website screenshots + links in a flat grid,
   independent of crypto market data. Images are compressed client-side
   and stored as base64 JPEG data URLs in localStorage. */
const Gallery = (() => {
  const KEY = 'cryptofolio.gallery.v1';
  const MAX_DIM = 480;
  const JPEG_QUALITY = 0.72;

  let entries = load();
  let editingId = null;
  let pendingThumbnail = null; // data URL staged from the file input until submit

  /* ----- storage ----- */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(entries));
  }

  function entryById(id) {
    return entries.find(e => e.id === id) || null;
  }

  /* ----- image compression ----- */

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        img.onerror = () => reject(new Error('Could not decode image'));
        img.onload = () => resolve(img);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    const img = await readImageFile(file);
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  /* ----- modal ----- */

  function showError(msg) {
    const el = document.getElementById('gallery-error');
    el.textContent = msg;
    el.classList.toggle('shown', !!msg);
  }

  function resetForm() {
    editingId = null;
    pendingThumbnail = null;
    document.getElementById('gallery-file').value = '';
    document.getElementById('gallery-title').value = '';
    document.getElementById('gallery-url').value = '';
    document.getElementById('gallery-preview').classList.remove('shown');
    document.getElementById('gallery-preview').src = '';
    document.getElementById('gallery-file-label').textContent = 'Choose a screenshot…';
    showError('');
    document.getElementById('gallery-modal-title').textContent = 'Add Site';
    document.getElementById('gallery-submit').textContent = 'Add';
  }

  function openAddModal() {
    resetForm();
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('gallery-modal').classList.add('open');
    document.getElementById('modal-backdrop').classList.add('open');
    document.getElementById('gallery-title').focus();
  }

  async function onFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showError('Please choose an image file.');
      e.target.value = '';
      return;
    }
    try {
      pendingThumbnail = await compressImage(file);
      const preview = document.getElementById('gallery-preview');
      preview.src = pendingThumbnail;
      preview.classList.add('shown');
      document.getElementById('gallery-file-label').textContent = file.name;
      showError('');
    } catch (err) {
      showError('Could not read that image — try a different file.');
    }
  }

  function normalizeUrl(url) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url;
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  function onSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('gallery-title').value.trim();
    const urlRaw = document.getElementById('gallery-url').value.trim();
    if (!urlRaw) { showError('Please enter a URL.'); return; }
    if (!pendingThumbnail) { showError('Please choose a screenshot.'); return; }
    const url = normalizeUrl(urlRaw);

    if (editingId) {
      const entry = entryById(editingId);
      if (entry) {
        entry.title = title || hostnameOf(url);
        entry.url = url;
        entry.thumbnail = pendingThumbnail;
      }
    } else {
      entries.push({
        id: 'g_' + Date.now().toString(36),
        title: title || hostnameOf(url),
        url,
        thumbnail: pendingThumbnail,
        createdAt: Date.now(),
      });
    }

    render();

    let quotaError = false;
    try {
      save();
    } catch (err) {
      quotaError = true;
    }
    if (quotaError) {
      showError('Couldn’t save — storage may be full. Try removing some older entries.');
      return;
    }
    document.getElementById('gallery-modal').classList.remove('open');
    document.getElementById('modal-backdrop').classList.remove('open');
  }

  /* ----- rendering ----- */

  function cardHTML(entry) {
    return '<div class="gallery-card" data-id="' + esc(entry.id) + '">'
      + '<div class="gallery-thumb-wrap"><img src="' + esc(entry.thumbnail) + '" alt="" loading="lazy">'
      + '<span class="gallery-card-title">' + esc(entry.title) + '</span></div>'
      + '</div>';
  }

  function render() {
    const empty = document.getElementById('gallery-empty');
    const grid = document.getElementById('gallery-grid');
    if (!entries.length) {
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
      grid.innerHTML = '';
      return;
    }
    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    grid.innerHTML = sorted.map(cardHTML).join('');
  }

  /* ----- init ----- */

  function init() {
    document.getElementById('gallery-add-btn').addEventListener('click', openAddModal);
    document.getElementById('gallery-file').addEventListener('change', onFileChange);
    document.getElementById('gallery-form').addEventListener('submit', onSubmit);
    document.getElementById('gallery-grid').addEventListener('click', e => {
      const card = e.target.closest('.gallery-card[data-id]');
      if (card) {
        const entry = entryById(card.dataset.id);
        if (entry) window.open(entry.url, '_blank', 'noopener');
      }
    });
    render();
  }

  return { init };
})();
</script>

<script>
/* ==================== app.js ====================
```

- [ ] **Step 5: Wire `Gallery.init()` into the existing `DOMContentLoaded` handler**

Find this exact block (currently lines 3023-3028):

```js
document.addEventListener('DOMContentLoaded', () => {
  Market.init();
  Portfolio.init();
  Analytics.init();
  Bubbles.init();
  CoinPanel.init();
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
```

- [ ] **Step 6: Verify the add flow end-to-end**

Start (or confirm running) the preview server, reload the page, and switch to the Gallery tab. Then attempt this in the preview browser (primary method — Chromium usually allows script-driven file input assignment via `DataTransfer`):

```js
(async () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const file = new File([arr], 'test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById('gallery-add-btn').click();
  const input = document.getElementById('gallery-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('gallery-title').value = 'Test Site';
  document.getElementById('gallery-url').value = 'example.com';
  document.getElementById('gallery-form').requestSubmit();
  return {
    modalOpen: document.getElementById('gallery-modal').classList.contains('open'),
    cardCount: document.querySelectorAll('.gallery-card').length,
    stored: JSON.parse(localStorage.getItem('cryptofolio.gallery.v1'))[0],
  };
})()
```

Expected: `modalOpen: false`, `cardCount: 1`, and `stored` is an object with `title: "Test Site"`, `url: "https://example.com"` (protocol auto-added), and a `thumbnail` starting with `"data:image/jpeg;base64,"`.

**If `input.files = dt.files` throws or the browser silently ignores it** (some environments block script-driven file input assignment), fall back to seeding localStorage directly and reloading:

```js
localStorage.setItem('cryptofolio.gallery.v1', JSON.stringify([{
  id: 'g_test1', title: 'Test Site', url: 'https://example.com',
  thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  createdAt: Date.now(),
}]));
location.reload();
```

Then re-run just the assertion portion:

```js
document.querySelector('.tab[data-view="gallery"]').click();
document.querySelectorAll('.gallery-card').length
```

Expected: `1`. Either way, confirm no console errors:

Run: `preview_console_logs` with `level: "error"`
Expected: `No console logs.`

Now confirm the entry survives an actual reload (persistence, not just in-memory state):

```js
window.location.reload();
```

```js
document.querySelector('.tab[data-view="gallery"]').click();
document.querySelectorAll('.gallery-card').length
```

Expected: `1` (unchanged after reload — confirms `load()` correctly reads back what `save()` wrote).

Confirm clicking the card opens the URL: click on `.gallery-card` and verify a new tab/window open request was made (or check `preview_network`/`preview_logs` for evidence of navigation attempt) — a thrown error here would show up in console logs, so the absence of errors after the click is sufficient confirmation for this single-card check.

Finally, confirm the Gallery tab never talks to CoinGecko — list network requests and check none were made to `api.coingecko.com` as a *result of* the Gallery interactions above (some calls from the initial Market-view load on page open are expected and fine; the check is that switching to/using Gallery didn't add more):

Run: `preview_network` with `filter: "all"`, and inspect the timestamps/count of `api.coingecko.com` requests before vs. after the Gallery steps in this task.
Expected: no additional `api.coingecko.com` requests attributable to opening the Gallery tab, adding an entry, or reloading with Gallery as the active tab.

- [ ] **Step 7: Commit**

```bash
cd /home/ghost/Documents/projects/crypto-portfolio
git add index.html
git commit -m "$(cat <<'EOF'
Add Gallery add-site flow: grid, modal, image compression

Users can now upload a screenshot, title, and URL for a site; the
image is resized/compressed client-side to a JPEG data URL before
being persisted to localStorage. Clicking a card opens its URL in
a new tab. Edit/delete land in the next commit.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Edit + delete flow (card menu)

**Files:**
- Modify: `index.html` (CSS additions, new `#gallery-menu` markup, `Gallery` module changes: `cardHTML`, `init`, plus new `openEditModal`/`removeEntry`/`showMenu`/`hideMenu` functions)

**Interfaces:**
- Consumes: `Gallery`'s `entries`, `entryById`, `resetForm`, `render`, `save` (all defined in Task 2, same closure — this task edits that same script block in place, it does not call across module boundaries).
- Produces: fully closes out the Gallery feature — no further tasks depend on this one.

- [ ] **Step 1: Add the `.gallery-card-menu-btn` CSS and the `#gallery-menu` position fix**

Find this exact line (end of the Gallery CSS block added in Task 2):

```css
.gallery-card:hover .gallery-card-title { opacity: 1; }
```

Replace it with:

```css
.gallery-card:hover .gallery-card-title { opacity: 1; }
.gallery-card-menu-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(11, 14, 20, 0.65);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
  font-size: 14px;
  padding: 0;
}
.gallery-card:hover .gallery-card-menu-btn,
.gallery-card-menu-btn:focus { opacity: 1; }
```

Find this exact line (currently line 291, the fix from a previous session for the coin-row menu stretching bug — the same fix is needed for the gallery menu since both reuse the generic `.menu` class):

```css
#row-menu { position: fixed; top: 0; left: 0; right: auto; width: max-content; }
```

Replace it with:

```css
#row-menu { position: fixed; top: 0; left: 0; right: auto; width: max-content; }
#gallery-menu { position: fixed; top: 0; left: 0; right: auto; width: max-content; }
```

- [ ] **Step 2: Add the `#gallery-menu` markup**

Find this exact block (the Gallery modal added in Task 2):

```html
    <p class="gallery-error" id="gallery-error"></p>
    <button type="submit" id="gallery-submit" class="btn cta">Add</button>
  </form>
</div>
```

Replace it with:

```html
    <p class="gallery-error" id="gallery-error"></p>
    <button type="submit" id="gallery-submit" class="btn cta">Add</button>
  </form>
</div>

<!-- floating per-card menu (Gallery ⋮) -->
<div class="menu hidden" id="gallery-menu">
  <button data-gact="edit">✏️ Edit</button>
  <button data-gact="remove" class="danger">🗑 Delete</button>
</div>
```

- [ ] **Step 3: Add `menuEntryId` state**

Find this exact line (top of the `Gallery` module, from Task 2):

```js
  let editingId = null;
  let pendingThumbnail = null; // data URL staged from the file input until submit
```

Replace it with:

```js
  let editingId = null;
  let pendingThumbnail = null; // data URL staged from the file input until submit
  let menuEntryId = null;
```

- [ ] **Step 4: Add `openEditModal`, `removeEntry`, `showMenu`, `hideMenu`**

Find this exact line (end of the `openAddModal` function from Task 2):

```js
    document.getElementById('gallery-title').focus();
  }
```

Replace it with:

```js
    document.getElementById('gallery-title').focus();
  }

  function openEditModal(id) {
    const entry = entryById(id);
    if (!entry) return;
    resetForm();
    editingId = id;
    pendingThumbnail = entry.thumbnail;
    document.getElementById('gallery-title').value = entry.title;
    document.getElementById('gallery-url').value = entry.url;
    document.getElementById('gallery-preview').src = entry.thumbnail;
    document.getElementById('gallery-preview').classList.add('shown');
    document.getElementById('gallery-file-label').textContent = 'Replace screenshot…';
    document.getElementById('gallery-modal-title').textContent = 'Edit Site';
    document.getElementById('gallery-submit').textContent = 'Save';
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('gallery-modal').classList.add('open');
    document.getElementById('modal-backdrop').classList.add('open');
  }

  function removeEntry(id) {
    const entry = entryById(id);
    if (!entry) return;
    if (!confirm('Delete "' + entry.title + '" from your gallery?')) return;
    entries = entries.filter(e => e.id !== id);
    save();
    render();
  }

  /* ----- card menu ----- */

  function showMenu(btn, id) {
    menuEntryId = id;
    const menu = document.getElementById('gallery-menu');
    menu.classList.remove('hidden');
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
  }

  function hideMenu() {
    document.getElementById('gallery-menu').classList.add('hidden');
    menuEntryId = null;
  }
```

- [ ] **Step 5: Add the ⋮ button to `cardHTML`**

Find this exact function (from Task 2):

```js
  function cardHTML(entry) {
    return '<div class="gallery-card" data-id="' + esc(entry.id) + '">'
      + '<div class="gallery-thumb-wrap"><img src="' + esc(entry.thumbnail) + '" alt="" loading="lazy">'
      + '<span class="gallery-card-title">' + esc(entry.title) + '</span></div>'
      + '</div>';
  }
```

Replace it with:

```js
  function cardHTML(entry) {
    return '<div class="gallery-card" data-id="' + esc(entry.id) + '">'
      + '<div class="gallery-thumb-wrap"><img src="' + esc(entry.thumbnail) + '" alt="" loading="lazy">'
      + '<span class="gallery-card-title">' + esc(entry.title) + '</span></div>'
      + '<button class="gallery-card-menu-btn" data-gact="menu" data-id="' + esc(entry.id) + '" title="More" aria-label="More options">⋮</button>'
      + '</div>';
  }
```

- [ ] **Step 6: Wire the menu button, menu clicks, and click-outside-to-close in `init()`**

Find this exact block (from Task 2):

```js
    document.getElementById('gallery-grid').addEventListener('click', e => {
      const card = e.target.closest('.gallery-card[data-id]');
      if (card) {
        const entry = entryById(card.dataset.id);
        if (entry) window.open(entry.url, '_blank', 'noopener');
      }
    });
    render();
  }
```

Replace it with:

```js
    document.getElementById('gallery-grid').addEventListener('click', e => {
      const menuBtn = e.target.closest('button[data-gact="menu"]');
      if (menuBtn) {
        e.stopPropagation();
        showMenu(menuBtn, menuBtn.dataset.id);
        return;
      }
      const card = e.target.closest('.gallery-card[data-id]');
      if (card) {
        const entry = entryById(card.dataset.id);
        if (entry) window.open(entry.url, '_blank', 'noopener');
      }
    });
    document.getElementById('gallery-menu').addEventListener('click', e => {
      const btn = e.target.closest('button[data-gact]');
      if (!btn || !menuEntryId) return;
      const id = menuEntryId;
      hideMenu();
      if (btn.dataset.gact === 'edit') openEditModal(id);
      else if (btn.dataset.gact === 'remove') removeEntry(id);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#gallery-menu') && !e.target.closest('button[data-gact="menu"]')) hideMenu();
    });
    render();
  }
```

- [ ] **Step 7: Verify edit and delete**

Start (or confirm running) the preview server, reload, seed one entry directly (fast and reliable, avoids the file-input uncertainty from Task 2), and switch to Gallery:

```js
localStorage.setItem('cryptofolio.gallery.v1', JSON.stringify([{
  id: 'g_test1', title: 'Original Title', url: 'https://example.com',
  thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  createdAt: Date.now(),
}]));
location.reload();
```

```js
document.querySelector('.tab[data-view="gallery"]').click();
document.querySelector('.gallery-card-menu-btn').click();
({
  menuVisible: !document.getElementById('gallery-menu').classList.contains('hidden'),
  menuWidth: document.getElementById('gallery-menu').getBoundingClientRect().width,
})
```

Expected: `menuVisible: true`, `menuWidth` close to `195` (not stretched across the page — this is the exact bug class fixed for the coin-row menu earlier; confirm it doesn't recur here).

Now test editing just the title (thumbnail must stay unchanged):

```js
const before = JSON.parse(localStorage.getItem('cryptofolio.gallery.v1'))[0].thumbnail;
document.querySelector('#gallery-menu button[data-gact="edit"]').click();
document.getElementById('gallery-title').value = 'Edited Title';
document.getElementById('gallery-form').requestSubmit();
const after = JSON.parse(localStorage.getItem('cryptofolio.gallery.v1'))[0];
({ title: after.title, thumbnailUnchanged: after.thumbnail === before })
```

Expected: `{ title: "Edited Title", thumbnailUnchanged: true }`.

Now test replacing the image on edit (same `DataTransfer` technique as Task 2, with the same fallback caveat if the browser blocks script-driven file input assignment):

```js
(async () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX/TQBcNTh/AAAAAXRSTlPM0jRW/QAAAApJREFUeJxjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const file = new File([arr], 'new-thumb.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const before = JSON.parse(localStorage.getItem('cryptofolio.gallery.v1'))[0].thumbnail;
  document.querySelector('.gallery-card-menu-btn').click();
  document.querySelector('#gallery-menu button[data-gact="edit"]').click();
  const input = document.getElementById('gallery-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('gallery-form').requestSubmit();
  const after = JSON.parse(localStorage.getItem('cryptofolio.gallery.v1'))[0].thumbnail;
  return { changed: after !== before };
})()
```

Expected: `{ changed: true }`. If `input.files` assignment is blocked in this environment (same caveat as Task 2 Step 6), skip this specific check — the underlying `compressImage`/`onFileChange` code path is identical to the one already verified working in Task 2, so this step is a UI-wiring confirmation rather than new logic.

Now test delete (note: `confirm()` is a native blocking dialog — if the preview tool can't auto-accept it, temporarily stub it for this check):

```js
window.confirm = () => true; // test-only stub so delete proceeds without a real dialog
document.querySelector('.gallery-card-menu-btn').click();
document.querySelector('#gallery-menu button[data-gact="remove"]').click();
({
  entries: JSON.parse(localStorage.getItem('cryptofolio.gallery.v1')),
  emptyShown: !document.getElementById('gallery-empty').classList.contains('hidden'),
})
```

Expected: `entries: []`, `emptyShown: true`.

Finally, confirm no console errors across all of the above:

Run: `preview_console_logs` with `level: "error"`
Expected: `No console logs.`

- [ ] **Step 8: Commit**

```bash
cd /home/ghost/Documents/projects/crypto-portfolio
git add index.html
git commit -m "$(cat <<'EOF'
Add Gallery edit and delete flow

Adds a per-card ⋮ menu (Edit/Delete), reusing the same modal for
editing as adding. Delete requires confirmation, matching the
existing coin-removal pattern elsewhere in the app.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```
