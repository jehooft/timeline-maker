/* csv.js — the interchange format from section 13.2 of the plan.

   One table holds events and eras, told apart by the `type` column. Dates use
   the same grammar the editor accepts, so a spreadsheet is a perfectly good
   place to draft a timeline. Pictures cannot ride along in CSV; JSON is the
   lossless format. */

import { parseDateInput, instantToInput } from "./time.js";
import { uid, PALETTE } from "./model.js";
import { externalImage } from "./images.js";

export const CSV_COLUMNS = ["type", "title", "start", "end", "category", "parent",
  "symbol", "color", "description", "image", "pin_image", "important", "precision",
  "link", "tags", "id"];

/* ------------------------------------------------------------------ reading */

/* RFC 4180: quoted fields may contain commas, newlines and doubled quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const truthy = (s) => /^(1|true|yes|y)$/i.test(String(s).trim());

export function importCSV(text, doc) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("That file is empty.");

  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!head.includes("title") || !head.includes("start")) {
    throw new Error("The header row needs at least a 'title' and a 'start' column.");
  }
  const col = (r, name) => {
    const i = head.indexOf(name);
    return i >= 0 && r[i] !== undefined ? r[i].trim() : "";
  };

  const categories = doc.categories.map((c) => ({ ...c }));
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const events = [], eras = [], errors = [];
  const pendingParents = [];
  /* Linked pictures are shared by URL, so the same address used on twenty rows
     produces one record rather than twenty. */
  const images = {};
  const imageByUrl = new Map();

  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const title = col(r, "title");
    if (!title) { errors.push("Row " + line + ": no title"); return; }

    const startRaw = col(r, "start");
    const start = parseDateInput(startRaw);
    if (!start) { errors.push('Row ' + line + ': cannot read the start date "' + startRaw + '"'); return; }

    const endRaw = col(r, "end");
    let end = null;
    if (endRaw) {
      end = parseDateInput(endRaw);
      if (!end) { errors.push('Row ' + line + ': cannot read the end date "' + endRaw + '"'); return; }
      if (end.t < start.t) { errors.push("Row " + line + ": the end falls before the start"); return; }
    }

    const precOverride = col(r, "precision").toLowerCase();
    if (precOverride && precOverride !== "auto") {
      start.precision = precOverride;
      if (end) end.precision = precOverride;
    }

    const catName = col(r, "category") || "Uncategorised";
    let cat = byName.get(catName.toLowerCase());
    if (!cat) {
      cat = { id: uid("cat"), name: catName, color: PALETTE[categories.length % PALETTE.length] };
      categories.push(cat);
      byName.set(catName.toLowerCase(), cat);
    }

    const isEra = col(r, "type").toLowerCase() === "era";
    const item = {
      id: col(r, "id") || uid(isEra ? "r" : "e"),
      cat: cat.id, title, start, end,
      desc: col(r, "description"),
      tags: col(r, "tags").split(/[;,]/).map((s) => s.trim()).filter(Boolean),
    };
    const color = col(r, "color");
    if (/^#[0-9a-f]{6}$/i.test(color)) item.color = color;

    const links = col(r, "link").split(/[;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (links.length) item.links = links;

    const imgUrl = col(r, "image");
    if (imgUrl) {
      let rec = imageByUrl.get(imgUrl);
      if (!rec) {
        try {
          rec = externalImage(imgUrl, title);
          imageByUrl.set(imgUrl, rec);
          images[rec.id] = rec;
        } catch (err) {
          errors.push("Row " + line + ": " + err.message);
          rec = null;
        }
      }
      if (rec) item.imageId = rec.id;
    }

    /* Eras carry pinned pictures too, so this is not an event-only column. */
    if (item.imageId && truthy(col(r, "pin_image"))) item.pinImage = true;

    if (isEra) {
      const p = col(r, "parent");
      if (p) pendingParents.push([item, p, cat.id]);
      item.parent = null;
      eras.push(item);
    } else {
      item.sym = col(r, "symbol") || "dot";
      if (truthy(col(r, "important"))) item.important = true;
      events.push(item);
    }
  });

  /* parents may be given by id or by title, and may appear later in the file */
  for (const [item, ref, catId] of pendingParents) {
    const match = eras.find((r) => r.id === ref)
      || eras.find((r) => r.cat === catId && r.title.toLowerCase() === ref.toLowerCase())
      || doc.eras.find((r) => r.id === ref)
      || doc.eras.find((r) => r.cat === catId && r.title.toLowerCase() === ref.toLowerCase());
    if (match) item.parent = match.id;
    else errors.push('Cannot find an era called "' + ref + '" to nest "' + item.title + '" inside');
  }

  return { categories, events, eras, images, errors };
}

/* ------------------------------------------------------------------ writing */

const esc = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/* Only linked pictures survive a CSV round trip. An uploaded one lives as
   embedded image data, which a spreadsheet cell cannot hold — those need JSON. */
export const linkedImageURL = (doc, it) => {
  const rec = it.imageId ? (doc.images || {})[it.imageId] : null;
  return rec && rec.external ? rec.url : "";
};
export const countsDroppedImages = (doc) =>
  [...doc.events, ...doc.eras].filter((it) => it.imageId && !linkedImageURL(doc, it)).length;

export function exportCSV(doc) {
  const catName = new Map(doc.categories.map((c) => [c.id, c.name]));
  const eraTitle = new Map(doc.eras.map((r) => [r.id, r.title]));
  const lines = [CSV_COLUMNS.join(",")];

  const row = (it, type) => lines.push([
    type,
    it.title,
    instantToInput(it.start.t, it.start.precision),
    it.end ? instantToInput(it.end.t, it.end.precision) : "",
    catName.get(it.cat) || "",
    type === "era" && it.parent ? eraTitle.get(it.parent) || "" : "",
    type === "event" ? it.sym || "dot" : "",
    it.color || "",
    it.desc || "",
    linkedImageURL(doc, it),
    it.pinImage ? "true" : "",
    type === "event" && it.important ? "true" : "",
    it.start.precision,
    (it.links || []).join("; "),
    (it.tags || []).join("; "),
    it.id,
  ].map(esc).join(","));

  doc.eras.forEach((r) => row(r, "era"));
  doc.events.forEach((e) => row(e, "event"));
  return lines.join("\n") + "\n";
}
