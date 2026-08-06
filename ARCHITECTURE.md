# Timeline Maker — how it works

A single-page app for building interactive timelines that stay usable from one
second per pixel out to billions of years per pixel. This document is for
someone about to change the code. It covers what the app does, how the pieces
fit, and — more usefully — *why* several non-obvious decisions were made, since
most of them were forced by a bug that the obvious approach caused.

Companion documents: `timeline-app-plan.md` (the original design brief, now
partly superseded) and `timeline-app-todo.md` (delivered work and open backlog).

---

## 1. What it does

A horizontal timeline you pan and zoom freely. On it:

- **Events** — a point in time, or a span with a duration. Carry a symbol,
  colour, description, links, tags, an optional picture, and an importance
  level.
- **Eras** — broad named stretches, stacked in **layers** within a category.
  Layer 1 might be "Phanerozoic"; layer 2 "Mesozoic"; layer 3 "Jurassic".
- **Categories** — horizontal bands. Each owns its own layer stack. Two
  categories never share vertical space, so unrelated timelines can overlap in
  time without colliding on screen.
- **Pinned pictures** — an item's image shown above the axis, tethered to the
  moment it marks.

Everything is stored in the browser. Timelines can be created, renamed,
duplicated, deleted, and exported/imported as JSON (lossless) or CSV
(interchange). There is undo/redo, search, group selection and bulk editing, a
light and dark theme, keyboard navigation, and touch support.

---

## 2. Running it

```bash
npm install
npm run dev      # vite dev server
npm test         # 354 assertions across four suites, plain node, no browser
npm run build    # static files into dist/
```

Tests import the real modules, so they exercise shipped code rather than a
copy. There is no browser in the loop — they cover logic, not rendering.
Anything visual still needs a human eye or a scripted browser session.

---

## 3. File map

```
src/
  time.js        instants, the calendar, formatting, the date parser
  ticks.js       the ruler ladder and tick generation
  model.js       the document, era layers, the spatial index, packing
  cluster.js     merging items too dense to draw apart
  search.js      finding an item by name
  history.js     undo and redo
  images.js      picture intake, downscaling, external links
  storage.js     persistence, serialisation, migrations, file download
  csv.js         CSV import and export
  symbols.jsx    event glyphs
  App.jsx        viewport maths, the canvas renderer, interaction, wiring
  main.jsx       entry point
  ui/
    ItemsPanel   the contents panel (left)
    Editor       the add/edit drawer (right)
    DetailCard   the popup, and the hover preview
    ContextMenu  right-click / long-press menu
    Library      saved timelines, import and export
    SearchBox    search field and results
    ScaleRail    the zoom control
    styles.js    the entire stylesheet
```

The layering is deliberate and worth preserving: **`time.js` knows nothing
about the document, `model.js` knows nothing about drawing, and `App.jsx` is
the only file that touches a canvas.** Changing how a date is parsed means
opening one small file.

---

## 4. Time

### Instants are BigInt seconds

An instant is a signed `BigInt` count of whole seconds from the Unix epoch.
Not a `Date` (tops out at ±273,790 years) and not a float (at 13.8 Gya a double
can only resolve ~64-second steps, and drifts when you pan away and back).

The practical range is ±10¹⁸ s, about ±31.7 billion years. That is a product
decision, not a technical limit.

### Why this is fast

Exact arithmetic everywhere would be slow, and is not needed. Only a *pixel*
position is ever required:

```js
x = Number(t - viewportStart) / secondsPerPixel
```

The subtraction is exact in `BigInt`; only the *difference* — at most a few
screen-widths — becomes a float, and a float carries ~16 digits where a 4000px
screen needs about 4. One `BigInt` subtraction per visible item per frame.

### Calendar

Howard Hinnant's `civil_from_days` / `days_from_civil`, proleptic Gregorian,
UTC only, astronomical year numbering (year 0 = 1 BCE). Exact for any year in
range.

### Precision tags

A date is stored as `{ t, precision }`, where precision is one of
`second…gyr`. `t` is always the *start* of the precision bucket. This is why
"1981" displays as "1981" rather than "1 January 1981, 00:00:00".

### Deep-time dates are anchored to a fixed datum

`13.8 Gya` resolves against **1950-01-01** (the Before Present convention),
never against the current clock, and each unit is quantised to the resolution
the editor prints at.

> **Why:** anchoring to "now" made the same phrase resolve slightly later on
> every keystroke. Re-saving an era nudged its end past the start of the next
> one, and two eras written with the same phrase stopped meeting exactly.
> `parse(print(t)) === t` is a property the tests check directly.

### Ongoing spans fade

An open era, or an event flagged `ongoing`, does not run solid to the edge of
the screen. `openFadeEndT(t0)` returns an instant past *now*, proportional to
how long the thing has already run (floored at a day):

> **Why:** a fixed pixel sentinel at the screen edge made a 30-year-old event
> look like it would run for billions of years the moment you zoomed out far
> enough to see it beside deep time. A real instant recedes properly as you
> zoom.

An item that starts in the future cannot be ongoing — there is nothing to fade
from. Both the editor and the CSV importer refuse it.

---

## 5. The document

```jsonc
{
  "id": "tl_x", "name": "...",
  "categories": [ { "id": "vg", "name": "...", "color": "#4E92C8", "layers": 2 } ],
  "eras":   [ { "id": "r_arc", "cat": "vg", "layer": 0, "title": "...",
                "start": { "t": 63072000n, "precision": "year" }, "end": {...}|null,
                "color": "...", "desc": "..." } ],
  "events": [ { "id": "e4", "cat": "vg", "title": "...", "sym": "star",
                "start": {...}, "end": {...}|null, "ongoing": true,
                "imp": 3, "color": "...", "desc": "...",
                "links": [...], "tags": [...],
                "imageId": "img_x", "pinImage": true } ],
  "images": { "img_x": { "id": "...", "url": "...", "thumb": "...", "w": 1200, "h": 800 } }
}
```

Notes:

- `t` is a real `BigInt` in memory and a **string** in JSON (JSON has no
  BigInt). `encodeDoc`/`decodeDoc` in `storage.js` handle the boundary.
- Images live in their own storage keys, not inside the document, so editing
  text does not rewrite megabytes of image data.
- Absent fields mean defaults: no `imp` means Normal, no `color` means the
  category's colour, no `layer` means 0.

### Importance is a five-level scale

`IMP.TRIVIAL(0) · UNIMPORTANT(1) · NORMAL(2) · IMPORTANT(3) · CRITICAL(4)`

Each level overrules everything below it, everywhere it matters: which picture
keeps its lane when room runs out, which events merge into a cluster, search
ranking. Visually:

| Level | On the timeline |
|---|---|
| Trivial | Small; title never drawn — only in the card, on click |
| Unimportant | Slightly smaller; label hides near a stronger event |
| Normal | The default |
| Important | Halo and ring; label always drawn |
| Critical | **Two** rings; never clusters, even with other Critical events |

Because priority is a *number* rather than a flag, "Critical outranks
Important outranks Normal…" falls out of a sort, and `model.js` never needs to
know what the numbers mean.

### Era layers

**This replaced a `parent` pointer, and the change is the most important thing
to understand in the codebase.**

A category owns a stack of layers numbered from 0 at the top. An era says only
which layer it is in. **Parentage is derived, not stored:** an era's parents
are whichever eras on the layer directly above it overlap its span.

```js
parentsOf(eras, era)   // eras one layer up whose span overlaps
childrenOf(eras, era)  // eras one layer down whose span overlaps
insertLayer(eras, cat, at)   // everything at or below `at` drops one
```

Consequences the old tree could not express:

- **An era can have several parents.** A span crossing the boundary between two
  eras above belongs to both, with no ambiguity.
- **Different layers may overlap freely.** Only eras *sharing* a layer may not
  (`siblingClash`).
- **Adding a broader era is one operation.** `insertLayer` opens a gap; the new
  era takes it, and everything beneath becomes its children without a single
  pointer being rewritten.

> **Why it changed:** with pointers, adding "Phanerozoic" once "Mesozoic"
> already sat at the top level was a dead end — the only offered fix was to
> nest the *new* era under the *old* one, which is backwards.

Documents written before layers are converted on load by `erasWithLayers()`:
depth in the old tree is exactly the layer number, so it is lossless. The CSV
importer still reads a legacy `parent` column the same way.

Two more functions read structure off the dates rather than storing it:

```js
erasAround(eras, cat, t0, t1?)        // the eras a moment or span falls inside
moveErasToCategory(eras, ids, cat)    // relocate a batch without breaking a layer
```

`erasAround` is what lets the editor offer an event the colours of the eras it
sits in, next to its category's. Eras are treated as **half-open** — they run
up to their end without including it — so a point on the boundary between two
abutting eras belongs to the later one, matching how the bars are drawn.

`moveErasToCategory` exists because a layer number means nothing outside the
category it came from. Arrivals land *below* whatever the destination already
holds, keeping their own relative stacking, and anything that would still
overlap a neighbour drops one layer further. That last step is not paranoia:
two eras from *different* categories may well cover the same years, which is
the one thing that can never happen within one.

---

## 6. Rendering

**One `<canvas>`** for the timeline surface — ruler, bands, eras, bars,
symbols, labels, pinned pictures. **DOM** for everything chrome-ish: panels,
the editor, popups, dialogs. At 5,000+ items DOM nodes stall on pan; canvas
redraws only what is visible.

### The frame

`render()` in `App.jsx` is one long function, deliberately, because the order
matters and every stage feeds the next:

1. **Cull** to the viewport plus a screen-width of margin (`queryRange`).
2. **Pinned pictures** — position, lane packing, ease.
3. **Gridlines.**
4. **Per category:** era level-of-detail → era easing → strip geometry →
   cluster → pack event rows → ease rows → *then* measure the band → draw.
5. **Mask the top strip, draw pictures.**
6. **Ruler**, on top of everything.

Hit testing reuses the layout pass: every drawn thing pushes a rect into
`hits`, and a click is a reverse lookup over that list. No hidden-canvas
colour-picking.

### Redraw discipline

`invalidate()` schedules a `requestAnimationFrame`; idle costs nothing. Any
eased value that is still moving sets `animating`, which asks for another
frame. Every eased value snaps to its target once within a threshold, so this
always terminates.

### Easing

Frame-rate independent: `1 - Math.exp(-dt / tau)`, so a value settles in the
same wall time on a 60Hz and a 144Hz screen. Time constants live at the top of
`App.jsx` (`ERA_FADE`, `IMG_FADE`, `MOVE_TAU`). A value settles after roughly
4.6 τ.

State lives in refs keyed by item key, **pruned every frame** to what was
actually seen.

> **Why prune:** without it the maps grow without bound, and an item scrolling
> back into view slides in from wherever it was last left rather than appearing
> where it belongs.

`prefers-reduced-motion` turns every easing into a cut.

### Rows are eased *before* the band is measured

This ordering is load-bearing. Zoom out and two event rows merge into one: the
events glide together and the band closes up around them in the same motion.
Measuring first would snap the band shut while its contents were still moving.

### Era level of detail

Two independent rules decide whether an era draws:

1. **Family folding.** An era folds only when *every era under the same parent*
   has gone narrower than `ERA_MIN_PX`. An era with no parent never folds this
   way.

   > **Why:** per-era folding made Triassic vanish on its own while Jurassic
   > and Cretaceous beside it were still perfectly legible. Widths come from
   > durations divided by the scale, not from the culled on-screen set, so a
   > sibling scrolled off the edge still counts.

2. **`ERA_COVER` redundancy.** An era already filling the screen makes its
   ancestors redundant — they would each render as the same edge-to-edge wash —
   so they are dropped. This is separate from folding and *can* hide a
   top-layer era.

Surviving layers are renumbered to consecutive strip rows, so a folded layer
gives its vertical space back.

### Tint and boundaries go downward only

An era's background wash and its edge lines begin at **its own strip row** and
run down.

> **Why:** starting every era at the top of the band meant a narrow era three
> layers down repainted the broad eras above it, so a parent took on the colour
> of its own children.

### A span's label never outlives its bar

A bar long enough to hold its own name is labelled above it; one too short puts
the label beside the end cap, level with the bar. The wide case clamps the
label to the left edge of the screen so it stays readable while a long span
runs off it — but the clamp is bounded by `x2p - lw - 6`, the bar's own end.

> **Why:** clamping only to a minimum meant the name stayed pinned at the left
> edge long after the span itself had been panned away — a 50-year event's
> title still sitting there with 40 years of empty timeline under it. Now the
> label trails the bar off screen and stops being drawn with it. Note the order:
> `min(max(x, 10), end)`, not `max(min(x, end), 10)`.

---

## 7. Packing

Two different packers, for two genuinely different problems.

### `packRows` — event rows

Greedy interval partitioning: walk items left to right, place each in the first
row whose right edge clears it. Provably minimal rows. Tracks only each row's
right edge, which is all a strictly ordered pass needs. Has hysteresis (an item
keeps its previous row when that row still fits) to stop rows reshuffling while
panning.

### `packLanes` — pinned pictures

Vertical room above the axis is **finite**, so when the lanes fill something
must be dropped, and it should be the least important picture. That means
placing higher-priority pictures first — and the moment the pass stops being
left-to-right, a right-edge-only row is **wrong**.

So a lane here keeps its members and a candidate is tested against all of them.
Going out of order then costs nothing in layout: a lower-priority picture still
drops into any gap a higher one leaves.

> **Why this matters:** the earlier version reused `packRows`. One important
> picture at x=800 reserved the entire row, so every ordinary picture to its
> left was pushed out — with the space beside it plainly empty. This was the
> single most confusing bug in the project's history, and the first diagnosis
> of it was wrong.

`packLanes` deliberately has **no memory**. An earlier version kept the previous
lane to reduce reshuffling, and that is what stranded a picture one lane up long
after the room below it had cleared. Eased movement buys the same calm without
the staleness.

---

## 8. Clustering

Zoomed far enough out, row packing stops helping: a hundred events in one pixel
would open a hundred rows. `clusterPoints` merges items too close to
distinguish into a single counted marker.

Rules:

- **Only within the same importance level.** A point that matters is never
  buried in a pile of ones that don't — and burying a Critical event among
  Normal ones would be just as bad.
- **Critical never clusters at all**, not even with other Critical events.
- **Eras never cluster.** They are the landmarks you navigate by.
- **Spans cluster only once too narrow to read as bars** (`SPAN_MIN_PX`). Above
  that their duration still says something; below it they behave like the point
  they have become, and separate again on the way back in.

Clicking a cluster zooms **just past the point where its tightest pair stops
merging** — computed from `minGap`, the smallest interval inside the run.

> **Why not fit its extent:** the extent is about one pixel wide — that is why
> it merged. Fitting it overshot enormously; for a two-member cluster, by up to
> 20×. A second clamp stops one outlier demanding a zoom that leaves the rest
> off screen.

---

## 9. Pictures

Uploads are downscaled to 1200px on the long side and re-encoded as WebP
(~120KB from a 4MB phone photo), plus a 128px thumbnail. This is essential:
browser storage quotas are a handful of megabytes.

Pictures can also be **linked by URL** rather than copied in — free on quota,
CSV-portable, but broken if the address dies. `w`/`h` are unknown for those, so
the renderer measures the loaded element instead.

The **picture rail height is a user setting**, not a function of how many
pictures happen to be pinned. Drag the axis line itself to resize it.

> **Why:** deriving the rail height from the current contents made the entire
> timeline bob up and down on every zoom and pan as pictures came and went.

A picture that loses its lane shrinks onto the axis into a small frame marker
and pops back out when room returns — scaled about its tether point, so it
reads as folding away rather than blinking out.

---

### Orphaned pictures used to never leave storage

`doc.images` is not pruned anywhere in the UI: picking a picture and then
swapping it for another, or deleting the item that used one, leaves the old
record sitting in the map — nothing goes back and removes it. `saveDoc` used
to write **every** entry in that map to its own storage key regardless of
whether anything still pointed at it, which is what let a modest-looking
timeline exhaust a browser's ~5 MB quota far sooner than its visible size
would suggest: every abandoned picture from every editing session was still on
disk, permanently.

The fix has three parts, because a picture can be shared — duplicating a
timeline copies its events and eras but re-uses the same image ids, so two
different documents can legitimately reference one storage key:

1. **`saveDoc` only ever writes a referenced picture.** Always safe: this can
   only write *fewer* keys than the document holds, never drop one another
   document still needs.
2. **`encodeDoc(doc, { withImages: true })` filters the same way**, so a JSON
   export — and the storage-size estimate, which is built from the same call —
   never carries an abandoned picture either.
3. **Removing an already-orphaned key** needs checking the *whole* library
   first, since nothing about a single document can prove no other one still
   wants it — that's what `collectGarbage` already did, previously only on
   deleting a timeline. It now also runs, best-effort and unawaited, at boot —
   so a browser already over quota gets space back just by being reopened —
   and on demand from a **Clean up** button in the Timelines dialog, for
   whoever is over quota right now and does not want to wait for a reload.

---

## 10. Persistence

```
tl:index        the library list
tl:doc:<id>     one timeline, without pictures
img:<id>        one picture
app:state       preferences: theme, size, rail height, custom colours
```

**IndexedDB**, with localStorage as a fallback and an in-memory map as the last
resort — all three behind one async JSON interface, so nothing above
`storage.js` knows which it got. Autosave is debounced 800ms. Deleting a
timeline sweeps pictures no other timeline references.

> **Why IndexedDB:** browsers cap localStorage at a flat few megabytes per
> origin with no way to ask for more, and a picture is stored as base64 text —
> about a third larger than the image itself — so a nominal 5 MB is really more
> like 3.5 MB of pictures. IndexedDB is granted a share of free disk instead,
> routinely gigabytes. Verified at 19.6 MB of pictures against a 3.2 GB quota.

Three things that make the swap safe rather than merely bigger:

- **A transaction per operation.** IndexedDB commits as soon as the microtask
  queue drains with no request outstanding, so nothing may be awaited between
  opening a transaction and issuing its request.
- **Writes resolve on commit, not on the request succeeding.** Running out of
  room aborts the transaction; reporting a save before that point would be the
  same lie the save flag was fixed to stop telling.
- **`migrateBackend` copies, verifies, then clears.** Documents written by the
  localStorage build move across on first run. Nothing is deleted until every
  value has been read back out of the destination and matched. If anything
  fails — including a write that silently vanishes — it throws with the source
  fully intact, and `ready()` simply carries on using localStorage and retries
  next boot. This is the only part of the swap that can lose data, so it is the
  part with direct tests rather than a stand-in for IndexedDB.

The quota warning asks `navigator.storage.estimate()` and fires past 80% full.
It used to compare against a hardcoded 2.6 MB, a fair guess at "getting close"
when the ceiling was five — and nonsense once the ceiling moved into the
gigabytes. The constant survives only for browsers that will not report a
quota.

**Migrations live in `decodeDoc`** and run on every load, so the rest of the
app only ever sees current shapes:

- `important: true` → `imp: IMP.IMPORTANT`
- era `parent` pointers → `layer` numbers

Export is presented as the real backup, because browser storage can be cleared
without warning. The app warns once per session when a timeline approaches the
quota, and nags every 50 edits since the last export.

---

### Autosave asks storage, not a flag

`savedDocRef` holds **the document object that is currently in storage**. Both
the autosave effect and the save indicator answer from it:

```js
savedDocRef.current === doc     // nothing to write; the flag may say "Saved"
```

Set in exactly three places: after a successful write, after boot reads a
document, and in `adoptDoc` (whose callers have all just written or just read
the document they are adopting).

> **Why:** this replaced a one-shot `skipSave` latch, armed on boot and on
> opening a timeline, disarmed by the next run of the autosave effect. The
> latch could not distinguish "already stored" from "not yet examined", so
> anything that armed it *without* then changing `doc` — the effect never
> re-running, therefore never disarming it — left it stuck on. From that point
> every edit was skipped **silently**, because the indicator read its own state
> flag rather than storage and happily went on saying "Saved" over a document
> that had never been written. A reference to the saved document cannot get
> stuck: it is a fact, not a promise about a future render.

Two related rules fall out of the same principle:

- **Boot runs are numbered, not flagged.** StrictMode mounts, unmounts and
  remounts in development, so two boot runs race through the same awaits.
  `bootGenRef` lets either one ask "am I still the current attempt?"; the
  superseded run applies *nothing*, including `booted`, and the current one
  always reaches `setBooted(true)` however it went — so autosave can never be
  left switched off waiting on a boot that already finished.

  > A per-run `cancelled` flag could answer only "was I cancelled", which is
  > not the same question, and an unconditional `setBooted(true)` on top of it
  > was worse: a run that returned early — before reading the stored
  > preferences — switched the preferences effect on, and it wrote this
  > session's defaults straight over the saved ones. Theme, display size and
  > rail height reset themselves on load, intermittently, depending on which
  > run won the race.

- **Preferences are written only once they have been read.** Guarded on
  `prefsLoadedRef`, not merely on `booted`: a boot that failed before reaching
  them holds nothing worth saving, and keeping stale preferences is always the
  safer of the two mistakes.
- **Pending writes flush on `pagehide`/`visibilitychange`.** The debounce is
  800ms and "type something, hit F5" is a normal thing to do.

If the indicator ever says "Unsaved" and stays there, autosave is genuinely
failing — that is now a real signal rather than a guess.

---

## 11. CSV

One table holds events and eras, told apart by `type`. RFC 4180 quoting;
header row required; column order irrelevant; unknown columns ignored.

`type, title, start, end, category, layer, symbol, color, description, image,
pin_image, importance, precision, link, tags, id`

- `end` accepts the literal token **`ongoing`**.
- `importance` takes `trivial|unimportant|normal|important|critical`; the legacy
  `important: true` column is still read.
- `layer` is a number; a legacy `parent` column naming another era is resolved
  to "one layer below that era".
- `image` is a URL. Uploaded pictures cannot fit in a cell and are dropped
  honestly, with a count reported.

Bad rows are reported with line numbers and skipped; they never abort the file.

---

## 12. Undo

A stack of **whole documents**, not a diff log. Documents are small, every edit
already produces a new object (so past states share structure), and whole-state
snapshots cannot desynchronise the way a diff log can. Capped at 60. Edits
carrying the same tag within 900ms coalesce, so typing a title is one step.

Switching timelines resets the stack — undoing across documents would silently
resurrect a timeline you had moved on from.

View state (zoom, pan, rail height, display size) is deliberately *not*
undoable.

---

## 13. Group selection

Held in `multi`, a `Set` of ids, **alongside** the single `selectedId` rather
than replacing it. Three ways in:

- **Shift-drag** on the canvas sweeps a rectangle (a DOM overlay, not canvas —
  nothing to repaint).
- **Ctrl/Cmd-click** an item, on the canvas or in the panel, toggles one.
- **▣** in a category's tools takes everything in that category.

A sweep takes everything it *touches*, not only what it encloses: a span can be
wider than the screen, so demanding full enclosure would make long events
unselectable by rectangle at any useful zoom. The first Ctrl-click seeds the set
with whatever was already open, so the item you were looking at when you started
grouping is not silently left out.

While the set holds anything the detail card gives way to the actions bar — one
panel about one item, or one about several, never both. Group edits (move to a
category, set importance, delete) each go through `setDoc` **once**, so the
whole batch is a single undo step. Which is the point of doing them as a group.

Counts come off the document, not the set: an id left behind by a delete or an
undo simply stops counting, so nothing has to prune the set.

---

## 14. Testing

| Suite | Covers |
|---|---|
| `test.mjs` | calendar across ±31 Gyr, date parser, ticks at every zoom, packing, era layers, containment and bulk moves, migration, ongoing fade, clock independence |
| `test-io.mjs` | JSON and CSV round-trips field by field, malformed input, layer/importance migrations |
| `test-phase7.mjs` | undo/redo, search ranking, clustering rules |
| `test-storage.mjs` | save/load, picture lifecycle, corrupt data, quota failure, memory fallback |

Two habits worth keeping:

- **Tests assert the *reason*, not just the shape.** Several exist purely to pin
  a bug that has already been fixed once — the era abutment round-trip, the
  lane-hogging scenario, the picture that will not fit.
- **When a bug is found, the fix and a test that would have caught it land
  together.**

### Verifying rendering

There are no rendering tests. Visual behaviour has been verified by driving the
running app from a script: hit-testing to locate items, and `getImageData` to
sample pixels. Useful patterns, if you need them again:

- **Differential colour tests.** To prove the tint is downward-only, change a
  lower era's colour and assert the row above is *pixel-identical* while the era
  itself changes. Far more decisive than eyeballing.
- **Let easing settle first.** A one-unit channel difference is usually
  mid-animation noise, not a bug.
- **Thresholds are the test.** Sample either side of a predicted crossover
  (fold, cluster, span width) and check the behaviour flips where the arithmetic
  says it should.

---

## 15. Things that will bite you

- **`sizeRef` is not React state.** The renderer reads size, viewport and rail
  height from refs so dragging never waits on a re-render. If you add
  viewport-ish state, follow that pattern.
- **`render()` is called two ways** — directly from an effect on every React
  render, and from `requestAnimationFrame` via `invalidate()`. It must stay
  idempotent.
- **Category colours are hex strings, canvas colours may be CSS variables.**
  `fadeRect`/`hexA` parse hex directly and will not resolve a `var()`.
- **Era `depth` and `layer` are the same number.** `buildIndex` sets
  `depth: eraLayer(r)` because the renderer was written against `depth`. Do not
  reintroduce a separate meaning.
- **Do not rewrite source files with PowerShell.** Windows PowerShell 5.1 reads
  as ANSI and writes as UTF-8, which double-encodes every non-ASCII character
  in the file. Use the editing tools.
