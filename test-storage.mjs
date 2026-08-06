/* Exercises the persistence layer against a stand-in for localStorage. The
   real build prefers IndexedDB and keeps localStorage as its fallback (see
   storage.js's header); Node has no `window.indexedDB`, so everything here
   runs down the fallback path, which is exactly what needs to keep working
   unchanged. The IndexedDB plumbing itself is verified in a browser — faking
   it convincingly is more likely to test the fake than the code — but the
   *migration* between the two is tested directly below, because it is the one
   part of the swap that can destroy data.

   localStorage is synchronous and string-only, and its writes can throw
   (quota, private browsing), which is what most of the awkward cases below
   are about.

   This supersedes the old test-storage.mjs and test-hang.mjs from the
   artifact-bundle source: the "hang forever" bug those covered doesn't exist
   here — localStorage never fails to settle, it just throws or doesn't — so
   there's nothing left in that shape to test. */

class FakeLocalStorage {
  constructor() { this.store = new Map(); this.full = new Set(); this.writes = 0; }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) {
    if (this.full.has(k)) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
    this.writes++;
    this.store.set(k, String(v));
  }
  removeItem(k) { this.store.delete(k); }
  key(i) { return [...this.store.keys()][i] ?? null; }
  get length() { return this.store.size; }
}
const has = (ls, suffix) => [...ls.store.keys()].some((k) => k.endsWith(suffix));
const val = (ls, suffix) => { const k = [...ls.store.keys()].find((x) => x.endsWith(suffix)); return k ? ls.store.get(k) : undefined; };

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("  FAIL " + n + (x ? "  " + x : "")); } };

/* ---- main scenario: localStorage present ---- */
const ls = new FakeLocalStorage();
globalThis.window = { localStorage: ls };
const S = await import("./src/storage.js");
const { starterDoc } = await import("./src/model.js");

ok("detects a real store", S.isPersistent() === true);
ok("a working store passes the probe", (await S.probeStorage()) === true);

const img = { id: "img_a", name: "a.webp", url: "data:image/webp;base64,AAAA", thumb: "data:,", w: 800, h: 600 };
const doc = { ...starterDoc(), id: "tl_1", createdAt: "2026-01-01T00:00:00Z", images: { img_a: img } };
doc.events[0] = { ...doc.events[0], imageId: "img_a", pinImage: true };

/* ---- save ---- */
const entry = await S.saveDoc(doc);
ok("returns a library entry", entry.id === "tl_1" && entry.events === doc.events.length);
ok("writes the document", has(ls, "tl:doc:tl_1"));
ok("writes the index", has(ls, "tl:index"));
ok("stores pictures under their own key", has(ls, "img:img_a"));
ok("keeps pictures out of the document", !val(ls, "tl:doc:tl_1").includes("base64"));
ok("everything stored is a string", [...ls.store.values()].every((v) => typeof v === "string"));

/* editing text must not rewrite the image */
const before = ls.writes;
await S.saveDoc({ ...doc, name: "Renamed" });
ok("re-saving does not rewrite stored pictures", ls.writes - before === 2, "writes: " + (ls.writes - before));

/* ---- load ---- */
const back = await S.loadDoc("tl_1");
ok("loads the document", back && back.name === "Renamed");
ok("restores BigInt instants", typeof back.events[0].start.t === "bigint");
ok("instants are unchanged", back.events[0].start.t === doc.events[0].start.t);
ok("reattaches the picture", back.images.img_a && back.images.img_a.url === img.url);
ok("keeps every era on its layer", back.eras.length === doc.eras.length
   && back.eras.find((r) => r.id === "r_mes").layer === 1
   && back.eras.find((r) => r.id === "r_jur").layer === 2);
ok("missing documents return null", (await S.loadDoc("nope")) === null);

/* ---- index ---- */
const idx = await S.loadIndex();
ok("index has one entry", idx.length === 1 && idx[0].name === "Renamed", JSON.stringify(idx));

/* ---- a second timeline, sharing nothing ---- */
await S.saveDoc({ id: "tl_2", name: "Second", categories: [], eras: [], events: [], images: {} });
ok("index grows", (await S.loadIndex()).length === 2);

/* ---- delete, and orphaned pictures get swept up ---- */
const after = await S.deleteDoc("tl_1");
ok("removes the document", !has(ls, "tl:doc:tl_1"));
ok("removes it from the index", after.length === 1 && after[0].id === "tl_2");
ok("sweeps up the orphaned picture", !has(ls, "img:img_a"));

/* a picture still in use must survive the sweep */
await S.saveDoc({ ...doc, id: "tl_3" });
await S.saveDoc({ ...doc, id: "tl_4" });
await S.deleteDoc("tl_3");
ok("keeps pictures another timeline still uses", has(ls, "img:img_a"));

/* ---- REGRESSION: a picture nothing references any more must not be written ----
   `doc.images` is never pruned by the UI — picking a picture and then swapping
   it for another, or deleting the item that used one, leaves the old record
   sitting in the map. Writing every entry in that map regardless, which is
   what this used to do, is why a modest timeline could exhaust a browser's
   quota far sooner than its visible size suggested: the orphan was written to
   its own storage key and then never removed. */
{
  const lsO = new FakeLocalStorage();
  globalThis.window = { localStorage: lsO };
  const SO = await import("./src/storage.js?orphan");
  const { starterDoc: starterDocO } = await import("./src/model.js?orphan");
  const kept = { id: "img_kept", url: "data:,kept" };
  const abandoned = { id: "img_gone", url: "data:,gone" };
  const docO = { ...starterDocO(), id: "tl_o", createdAt: "2026-01-01T00:00:00Z",
    images: { img_kept: kept, img_gone: abandoned } };
  docO.events[0] = { ...docO.events[0], imageId: "img_kept" };
  // img_gone sits in doc.images but nothing references it — as if it had been
  // picked, then swapped for img_kept, before ever being saved.
  await SO.saveDoc(docO);
  ok("a referenced picture is written", has(lsO, "img:img_kept"));
  ok("an unreferenced picture in the map is never written", !has(lsO, "img:img_gone"));

  const back = await SO.loadDoc("tl_o");
  ok("the loaded document only carries what is referenced",
     Object.keys(back.images).join() === "img_kept", JSON.stringify(Object.keys(back.images)));

  const exported = SO.encodeDoc(docO, { withImages: true });
  ok("an export built from the live document drops the same orphan",
     Object.keys(exported.images).join() === "img_kept", JSON.stringify(Object.keys(exported.images)));

  /* a picture two timelines share must not be treated as orphaned by either */
  await SO.saveDoc({ ...docO, id: "tl_o2" });
  ok("a picture shared by two timelines is written for both",
     has(lsO, "img:img_kept") && (await SO.loadDoc("tl_o2")).images.img_kept.url === kept.url);

  /* storage.js reads `window.localStorage` fresh on every call rather than
     capturing it at import time, so the rest of this file — which keeps using
     the original `S`/`ls` pairing — needs the global put back exactly as it
     was before this block touched it. */
  globalThis.window = { localStorage: ls };
}

/* ---- preferences ---- */
await S.saveAppState({ lastOpenedId: "tl_4", uiScale: 1.2 });
const st = await S.loadAppState();
ok("remembers preferences", st.lastOpenedId === "tl_4" && st.uiScale === 1.2);
ok("absent preferences are an empty object", typeof (await S.loadAppState()) === "object");

/* ---- corrupt data must not take the app down ---- */
{
  const idxKey = [...ls.store.keys()].find((k) => k.endsWith("tl:index"));
  ls.store.set(idxKey, "{not json");
  ok("survives a corrupt index", Array.isArray(await S.loadIndex()));
  await S.saveDoc({ ...doc, id: "tl_4" }); // repair the index for what follows
  const docKey = [...ls.store.keys()].find((k) => k.endsWith("tl:doc:tl_4"));
  ls.store.set(docKey, "{not json");
  ok("survives a corrupt document", (await S.loadDoc("tl_4")) === null);
}

/* ---- filenames ---- */
ok("cleans up filenames", S.safeFileName("A short history of everything!") === "A-short-history-of-everything");
ok("falls back on an empty name", S.safeFileName("") === "timeline");
ok("falls back on a name of pure punctuation", S.safeFileName("///") === "timeline");

/* ---- a picture too big to store must not sink the whole save ----
   REGRESSION CHECK: the localStorage port dropped the try/catch around each
   image write that the original had (see storage.js's saveDoc). Without it,
   one oversized picture throws and the timeline itself never gets written. */
{
  const ls2 = new FakeLocalStorage();
  globalThis.window = { localStorage: ls2 };
  const S2 = await import("./src/storage.js?quota");
  const { starterDoc: starterDoc2 } = await import("./src/model.js?quota");
  const docQ = { ...starterDoc2(), id: "tl_q", createdAt: "2026-01-01T00:00:00Z",
    images: { good: { id: "good", url: "data:,good" }, bad: { id: "bad", url: "data:,bad" } } };
  docQ.events[0] = { ...docQ.events[0], imageId: "bad" };
  docQ.events[1] = { ...docQ.events[1], imageId: "good" };
  ls2.full.add("timeline-maker:img:bad");
  const entryQ = await S2.saveDoc(docQ);
  ok("a picture that will not fit does not stop the timeline saving", entryQ && entryQ.id === "tl_q");
  ok("the timeline document was written despite one image failing", has(ls2, "tl:doc:tl_q"));
  ok("the failing picture was not written", !has(ls2, "img:bad"));
  ok("the good picture was written", has(ls2, "img:good"));
}

/* ---- moving from one backend to the other ----
   The upgrade path from the localStorage build to the IndexedDB one. The
   failure worth engineering against is a half-finished move that has already
   deleted the original, so the contract is: copy everything, read all of it
   back, and only then clear the source. If anything at all goes wrong the
   source must be left whole, because the caller's recovery is simply to carry
   on using it. */
{
  const fake = (seed = {}) => {
    const m = new Map(Object.entries(seed));
    return {
      m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async set(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async keys(p) { return [...m.keys()].filter((k) => k.startsWith(p)); },
    };
  };

  const from = fake({ "tl:index": "[1]", "tl:doc:a": "{a}", "img:x": "PIC", "app:probe": "1" });
  const to = fake();
  const moved = await S.migrateBackend(from, to);
  ok("reports how many keys it moved", moved === 3, String(moved));
  ok("every document and picture arrives",
     to.m.get("tl:index") === "[1]" && to.m.get("tl:doc:a") === "{a}" && to.m.get("img:x") === "PIC");
  ok("the source is cleared once the copy is verified", from.m.size === 0);
  ok("the scratch probe value is not carried over", !to.m.has("app:probe"));

  /* nothing to move is not an error */
  ok("an empty source moves nothing", (await S.migrateBackend(fake(), fake())) === 0);

  /* a source holding only the probe still gets tidied, and still counts zero */
  const probeOnly = fake({ "app:probe": "1" });
  ok("a source holding only the probe moves nothing", (await S.migrateBackend(probeOnly, fake())) === 0);
  ok("and is still cleared", probeOnly.m.size === 0);

  /* REGRESSION SHAPE: a destination that refuses a write must cost nothing */
  {
    const src = fake({ "tl:index": "[1]", "tl:doc:a": "{a}", "img:big": "PIC" });
    const dst = fake();
    dst.set = async (k, v) => {
      if (k === "img:big") { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      dst.m.set(k, v);
    };
    let threw = false;
    try { await S.migrateBackend(src, dst); } catch (err) { threw = true; }
    ok("a refused write aborts the move", threw);
    ok("and the source still holds everything", src.m.size === 3,
       JSON.stringify([...src.m.keys()]));
  }

  /* and a destination that silently loses a write must be caught by the
     read-back, not discovered later by the user */
  {
    const src = fake({ "tl:index": "[1]", "tl:doc:a": "{a}" });
    const dst = fake();
    dst.set = async (k, v) => { if (k !== "tl:doc:a") dst.m.set(k, v); };   // accepts, stores nothing
    let threw = false;
    try { await S.migrateBackend(src, dst); } catch (err) { threw = true; }
    ok("a write that silently vanishes is caught by the read-back", threw);
    ok("and that source is intact too", src.m.size === 2);
  }
}

/* ---- IndexedDB present but unusable ----
   Private-browsing lockouts, a corrupt database, another tab holding an older
   version open: `open` can fail on a browser that has IndexedDB. When it does,
   localStorage still holds every byte — the move only clears it after the copy
   verifies — so falling back to it has to be seamless rather than a fresh
   start on top of the user's real data. */
{
  const lsB = new FakeLocalStorage();
  lsB.setItem("timeline-maker:tl:index", JSON.stringify([{ id: "tl_keep", name: "Kept" }]));
  lsB.setItem("timeline-maker:tl:doc:tl_keep", JSON.stringify({
    format: "timeline-doc", version: 1, id: "tl_keep", name: "Kept",
    categories: [], eras: [],
    events: [{ id: "e1", cat: "c", title: "Still here", start: { t: "0", precision: "year" }, end: null, imageId: "img_k" }],
  }));
  lsB.setItem("timeline-maker:img:img_k", JSON.stringify({ id: "img_k", url: "data:,kept" }));
  let openCalls = 0;
  globalThis.window = {
    localStorage: lsB,
    indexedDB: {
      open() {
        openCalls++;
        const req = {};
        /* fire asynchronously, the way a real request does */
        setTimeout(() => { req.error = new Error("nope"); if (req.onerror) req.onerror(); }, 0);
        return req;
      },
    },
  };
  const SB = await import("./src/storage.js?idbfail");
  ok("a broken IndexedDB does not count as no storage", (await SB.probeStorage()) === true);
  ok("and it did try", openCalls > 0);
  ok("the fallback still reports itself durable", SB.isPersistent() === true);
  ok("data already in localStorage is still readable",
     (await SB.loadIndex()).length === 1, JSON.stringify(await SB.loadIndex()));
  const docB = { id: "tl_fb", name: "Fallback", categories: [], eras: [], events: [], images: {} };
  await SB.saveDoc(docB);
  ok("and saving still works", (await SB.loadDoc("tl_fb")).name === "Fallback");
  /* the point of the fallback: the pre-existing timeline is still all there,
     pictures included, rather than half-moved into a database that would not open */
  const keptBack = await SB.loadDoc("tl_keep");
  ok("the existing timeline survives intact",
     keptBack && keptBack.name === "Kept" && keptBack.events[0].title === "Still here");
  ok("with its pictures still attached", keptBack.images.img_k.url === "data:,kept",
     JSON.stringify(Object.keys(keptBack.images)));
  ok("and it is still listed", (await SB.loadIndex()).some((e) => e.id === "tl_keep"));

  globalThis.window = { localStorage: ls };
}

/* ---- when there is no store at all, it falls back to memory ---- */
{
  delete globalThis.window;
  const S3 = await import("./src/storage.js?fallback");
  const { starterDoc: starterDoc3 } = await import("./src/model.js?fallback");
  ok("no window means not persistent", S3.isPersistent() === false);
  ok("the probe agrees", (await S3.probeStorage()) === false);
  const docM = { ...starterDoc3(), id: "tl_m", createdAt: "2026-01-01T00:00:00Z" };
  const entryM = await S3.saveDoc(docM);
  const backM = await S3.loadDoc("tl_m");
  ok("saving still works in memory", entryM && entryM.id === "tl_m");
  ok("loading still works in memory", backM && backM.events.length === docM.events.length);
  ok("instants survive the memory path", backM.events[0].start.t === docM.events[0].start.t);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
