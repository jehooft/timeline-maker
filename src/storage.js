/* storage.js — persistence, standalone build.

   Backed by IndexedDB, with localStorage as a fallback and an in-memory map as
   the last resort. All three implement the same four operations, and nothing
   above this file learns which one it got: the interface stayed async and
   JSON-shaped throughout, which is the whole reason swapping the backend was a
   change to this file alone.

   IndexedDB is here for one reason — room. Browsers cap localStorage at a flat
   few megabytes per origin with no way to ask for more, and a timeline with a
   handful of pictures reaches that surprisingly fast: a picture is held as
   base64 text, which costs about a third more than the image itself. So a
   nominal 5 MB is really more like 3.5 MB of actual pictures. IndexedDB is
   instead granted a share of free disk, typically hundreds of megabytes
   upward, which takes the ceiling out of the user's way entirely.

   Documents written by the older localStorage build are moved across on first
   run — see `migrateBackend`, which copies and verifies everything before it
   removes anything.

   Everything else (encode/decode, the library, garbage collection, CSV/JSON
   export) is unchanged. */

import { IMP, erasWithLayers } from "./model.js";

const PREFIX = "timeline-maker:";   // localStorage only; IndexedDB has a namespace of its own
const DB_NAME = "timeline-maker";
const DB_STORE = "kv";
const DB_VERSION = 1;

const lsPresent = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
const idbPresent = typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

/* ------------------------------------------------------------- the backends

   Each is the same four operations over string values, keyed by a bare key
   ("tl:index", "img:abc"). Only localStorage adds the prefix, because it is
   the only one sharing a namespace with every other script on the origin.
   `durable` is what "Not saved" in the corner is reading. */

const memStore = new Map();
const memBackend = {
  durable: false,
  async get(k) { return memStore.has(k) ? memStore.get(k) : null; },
  async set(k, v) { memStore.set(k, v); },
  async delete(k) { memStore.delete(k); },
  async keys(p) { return [...memStore.keys()].filter((k) => k.startsWith(p)); },
};

const lsBackend = {
  durable: true,
  async get(k) { return window.localStorage.getItem(PREFIX + k); },
  async set(k, v) { window.localStorage.setItem(PREFIX + k, v); },
  async delete(k) { window.localStorage.removeItem(PREFIX + k); },
  async keys(p) {
    const out = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k.slice(PREFIX.length).startsWith(p)) out.push(k.slice(PREFIX.length));
    }
    return out;
  },
};

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = window.indexedDB.open(DB_NAME, DB_VERSION); }
    catch (err) { reject(err); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB would not open"));
    /* Another tab holding an older version open. There is no upgrade to wait
       out here, so call it unavailable and let the fallback take over rather
       than hanging the boot on a promise that may never settle. */
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
  dbPromise.catch(() => { dbPromise = null; });   // a failed open must not be cached as the answer
  return dbPromise;
}

/* An IndexedDB transaction commits as soon as the microtask queue drains with
   no request outstanding, so nothing may be awaited between opening one and
   issuing its request — hence a transaction per operation, and the result read
   from the request only once the transaction itself has completed. */
function txDone(tx, value) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value());
    tx.onerror = () => reject(tx.error || new Error("IndexedDB request failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

const idbBackend = {
  durable: true,
  async get(k) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(k);
    return txDone(tx, () => (req.result === undefined ? null : req.result));
  },
  async set(k, v) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(v, k);
    /* Resolved on commit rather than on the request succeeding: running out of
       room aborts the transaction, and reporting a save before that point
       would be exactly the kind of lie the save flag was fixed to stop telling. */
    return txDone(tx, () => undefined);
  },
  async delete(k) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(k);
    return txDone(tx, () => undefined);
  },
  async keys(p) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAllKeys();
    return txDone(tx, () => (req.result || [])
      .filter((k) => typeof k === "string" && k.startsWith(p)));
  },
};

/* ---------------------------------------------------------------- migration

   Copy everything one backend holds into another, then clear the source — but
   only once every value has been read back out of the destination and found to
   match. A half-finished move that has already deleted the original is the one
   outcome genuinely worth engineering against, so nothing is removed until the
   copy is provably complete. Throwing leaves the source untouched and fully
   intact, which is what lets the caller simply carry on using it.

   Exported for the tests: this is the only part of the swap that can lose
   data, so it is the part that gets tested directly rather than through a
   stand-in for IndexedDB. */
export async function migrateBackend(from, to) {
  const keys = await from.keys("");
  const wanted = keys.filter((k) => k !== "app:probe");   // a scratch value, not worth carrying
  if (!wanted.length) {
    for (const k of keys) await from.delete(k);
    return 0;
  }
  const copied = new Map();
  for (const k of wanted) {
    const v = await from.get(k);
    if (v === null) continue;
    await to.set(k, v);
    copied.set(k, v);
  }
  for (const [k, v] of copied) {
    if ((await to.get(k)) !== v) throw new Error("Storage move could not be verified");
  }
  for (const k of keys) await from.delete(k);
  return copied.size;
}

/* ------------------------------------------------- picking one, exactly once */
let chosen = null;
let choosing = null;
function ready() {
  if (chosen) return Promise.resolve(chosen);
  if (!choosing) {
    choosing = (async () => {
      if (idbPresent) {
        try {
          await openDB();
          if (lsPresent) await migrateBackend(lsBackend, idbBackend);
          chosen = idbBackend;
          return chosen;
        } catch (err) {
          /* Either IndexedDB is unusable, or the move could not be verified.
             Either way localStorage still holds every byte, so falling back to
             it is both safe and complete — and the move is retried next boot. */
        }
      }
      chosen = lsPresent ? lsBackend : memBackend;
      return chosen;
    })();
    choosing.catch(() => { choosing = null; });
  }
  return choosing;
}

export const isPersistent = () => (chosen ? chosen.durable : (idbPresent || lsPresent));
export function onStorageChange() { return () => {}; }   // neither store degrades mid-session
export async function probeStorage() {
  try {
    const b = await ready();
    if (!b.durable) return false;
    await b.set("app:probe", "1");
    return true;
  } catch (err) { return false; }   // quota exceeded, private-browsing lockout, etc.
}

/* What the browser says is actually left, which is the honest answer to "how
   much room do I have" — the size note beside it can only measure the document
   it has in hand. Not available everywhere, so callers must handle null. */
export async function storageEstimate() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number" || quota <= 0) return null;
    return { usage, quota };
  } catch (err) { return null; }
}

async function getJSON(key) {
  const b = await ready();
  let raw;
  try { raw = await b.get(key); } catch (err) { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }   // missing or unreadable: treat as absent
}
async function setJSON(key, value) {
  const b = await ready();
  try {
    await b.set(key, JSON.stringify(value));
    return { key, value };
  } catch (err) {
    throw new Error("Storage refused the write — it may be full.");
  }
}
async function drop(key) { const b = await ready(); await b.delete(key); }
async function keysWith(prefix) { const b = await ready(); return b.keys(prefix); }

/* ------------------------------------------------------------ serialisation */

const encDate = (d) => (d ? { t: d.t.toString(), precision: d.precision } : null);
const decDate = (d) => (d ? { t: BigInt(d.t), precision: d.precision } : null);

export function encodeDoc(doc, { withImages = false } = {}) {
  const out = {
    format: "timeline-doc",
    version: 1,
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    categories: doc.categories.map((c) => ({ ...c })),
    eras: doc.eras.map((r) => ({ ...r, start: encDate(r.start), end: encDate(r.end) })),
    events: doc.events.map((e) => ({ ...e, start: encDate(e.start), end: encDate(e.end) })),
  };
  if (withImages) {
    /* Only what an event or era still points at. Nothing in the UI ever
       removes a `doc.images` entry — picking a picture and then swapping it
       for another, or deleting the item that used one, leaves the old record
       sitting in the map — so exporting (or sizing) it verbatim would carry
       every picture ever added in the session, not just the ones in use. */
    const referenced = new Set();
    for (const it of [...doc.events, ...doc.eras]) if (it.imageId) referenced.add(it.imageId);
    out.images = {};
    for (const [id, rec] of Object.entries(doc.images || {})) if (referenced.has(id)) out.images[id] = rec;
  }
  return out;
}

/* A timeline saved before importance became a five-level scale carries the old
   `important: true/false` flag instead of `imp`. Migrated once, here, so every
   other file only ever has to know about `imp`. */
function migrateEvent(e) {
  const out = { ...e, start: decDate(e.start), end: decDate(e.end) };
  if (out.imp === undefined && out.important !== undefined) {
    if (out.important) out.imp = IMP.IMPORTANT;
    delete out.important;
  }
  return out;
}

export function decodeDoc(raw) {
  if (!raw || raw.format !== "timeline-doc") throw new Error("That file is not a timeline.");
  if (raw.version > 1) throw new Error("That file was made by a newer version of the app.");
  return {
    id: raw.id, name: raw.name || "Untitled",
    createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    categories: (raw.categories || []).map((c) => ({ ...c })),
    /* `parent` pointers from before layers existed are converted here, so the
       rest of the app only ever sees `layer`. */
    eras: erasWithLayers((raw.eras || []).map((r) => ({ ...r, start: decDate(r.start), end: decDate(r.end) }))),
    events: (raw.events || []).map(migrateEvent),
    images: raw.images || {},
  };
}

export const summarise = (doc) => ({
  id: doc.id, name: doc.name, updatedAt: new Date().toISOString(),
  events: doc.events.length, eras: doc.eras.length,
});

/* -------------------------------------------------------------- the library */

export async function loadIndex() {
  const idx = await getJSON("tl:index");
  return Array.isArray(idx) ? idx : [];
}

export async function saveDoc(doc) {
  /* Only a picture something still points at is worth a storage key.
     `doc.images` can hold a record nothing references any more — the same
     leftover `encodeDoc` now filters out of an export — and writing every one
     of those regardless, which is what this used to do, is why a picture
     picked and swapped for another, or left behind by a deleted item, stayed
     in storage forever. That is what let a modest-looking timeline exhaust a
     browser's quota far sooner than its visible size would suggest.

     This only ever writes fewer keys than before, which is always safe: a
     picture two different timelines both point at (duplicating a timeline
     shares the record rather than copying its bytes) is never dropped here,
     since it stays referenced by whichever document is being saved. Cleaning
     up a key nothing anywhere still wants is `collectGarbage`'s job — that one
     has to check the whole library before it can be sure, so it runs at boot
     and on demand rather than on every save. */
  const referenced = new Set();
  for (const it of [...doc.events, ...doc.eras]) if (it.imageId) referenced.add(it.imageId);
  const existing = new Set(await keysWith("img:"));
  for (const [id, rec] of Object.entries(doc.images || {})) {
    if (!referenced.has(id) || existing.has("img:" + id)) continue;
    try {
      await setJSON("img:" + id, rec);
      existing.add("img:" + id);
    } catch (err) { /* a picture that will not fit must not stop the timeline itself saving */ }
  }
  await setJSON("tl:doc:" + doc.id, encodeDoc(doc));
  const idx = await loadIndex();
  const entry = summarise(doc);
  const i = idx.findIndex((e) => e.id === doc.id);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  await setJSON("tl:index", idx);
  return entry;
}

export async function loadDoc(id) {
  const raw = await getJSON("tl:doc:" + id);
  if (!raw) return null;
  const doc = decodeDoc(raw);
  doc.id = id;
  const wanted = new Set();
  for (const it of [...doc.events, ...doc.eras]) if (it.imageId) wanted.add(it.imageId);
  const recs = await Promise.all([...wanted].map(async (iid) => [iid, await getJSON("img:" + iid)]));
  doc.images = {};
  for (const [iid, rec] of recs) if (rec) doc.images[iid] = rec;
  return doc;
}

export async function deleteDoc(id) {
  await drop("tl:doc:" + id);
  const idx = (await loadIndex()).filter((e) => e.id !== id);
  await setJSON("tl:index", idx);
  await collectGarbage(idx);
  return idx;
}

export async function collectGarbage(idx) {
  const live = new Set();
  for (const entry of idx) {
    const raw = await getJSON("tl:doc:" + entry.id);
    if (!raw) continue;
    for (const it of [...(raw.events || []), ...(raw.eras || [])]) if (it.imageId) live.add(it.imageId);
  }
  let freed = 0;
  for (const key of await keysWith("img:")) {
    if (!live.has(key.slice(4))) { await drop(key); freed++; }
  }
  return freed;
}

export async function loadAppState() { return (await getJSON("app:state")) || {}; }
export async function saveAppState(s) { try { await setJSON("app:state", s); } catch (err) { /* not critical */ } }

/* ------------------------------------------------------------ file download */

export function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (s) =>
  (s || "timeline").replace(/[^\w\d -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "timeline";
