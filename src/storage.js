/* storage.js — persistence, standalone build.

   Same shape as the Claude version, but backed by localStorage instead of
   window.storage. localStorage is synchronous and string-only, so this wraps
   it in the same async, JSON-shaped interface the rest of the app expects —
   nothing above this file needs to know which backend it's talking to.

   Everything else (encode/decode, the library, garbage collection, CSV/JSON
   export) is identical to the Claude build. */

const PREFIX = "timeline-maker:";

const present = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const mem = new Map();
const backend = present ? {
  get: (k) => (window.localStorage.getItem(PREFIX + k)),
  set: (k, v) => { window.localStorage.setItem(PREFIX + k, v); },
  delete: (k) => { window.localStorage.removeItem(PREFIX + k); },
  keys: (p) => {
    const out = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k.slice(PREFIX.length).startsWith(p)) out.push(k.slice(PREFIX.length));
    }
    return out;
  },
} : {
  get: (k) => (mem.has(k) ? mem.get(k) : null),
  set: (k, v) => { mem.set(k, v); },
  delete: (k) => { mem.delete(k); },
  keys: (p) => [...mem.keys()].filter((k) => k.startsWith(p)),
};

export const isPersistent = () => present;
export function onStorageChange() { return () => {}; }   // localStorage does not degrade mid-session
export async function probeStorage() {
  if (!present) return false;
  try {
    window.localStorage.setItem(PREFIX + "app:probe", "1");
    return true;
  } catch (err) { return false; }   // quota exceeded, private-browsing lockout, etc.
}

async function getJSON(key) {
  const raw = backend.get(key);
  return raw ? JSON.parse(raw) : null;
}
async function setJSON(key, value) {
  try {
    backend.set(key, JSON.stringify(value));
    return { key, value };
  } catch (err) {
    throw new Error("Storage refused the write — it may be full.");
  }
}
async function drop(key) { backend.delete(key); }
async function keysWith(prefix) { return backend.keys(prefix); }

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
  if (withImages) out.images = doc.images || {};
  return out;
}

export function decodeDoc(raw) {
  if (!raw || raw.format !== "timeline-doc") throw new Error("That file is not a timeline.");
  if (raw.version > 1) throw new Error("That file was made by a newer version of the app.");
  return {
    id: raw.id, name: raw.name || "Untitled",
    createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    categories: (raw.categories || []).map((c) => ({ ...c })),
    eras: (raw.eras || []).map((r) => ({ ...r, start: decDate(r.start), end: decDate(r.end) })),
    events: (raw.events || []).map((e) => ({ ...e, start: decDate(e.start), end: decDate(e.end) })),
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
  const existing = new Set(await keysWith("img:"));
  for (const [id, rec] of Object.entries(doc.images || {})) {
    if (!existing.has("img:" + id)) await setJSON("img:" + id, rec);
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
