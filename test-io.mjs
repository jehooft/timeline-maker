/* Round-trip tests for persistence and interchange. Data loss here is silent,
   so every field is compared, not just the count of items. */
import { starterDoc, buildIndex, siblingClash, parentsOf } from "./src/model.js";
import { encodeDoc, decodeDoc, summarise } from "./src/storage.js";
import { importCSV, exportCSV, parseCSV, countsDroppedImages } from "./src/csv.js";
import { fmtInstant } from "./src/time.js";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("  FAIL " + n + (x ? "  " + x : "")); } };

const doc = { ...starterDoc(), id: "tl_1", createdAt: "2026-01-01T00:00:00Z" };

/* ---- 1. JSON: encode -> JSON text -> decode must be identical ---- */
{
  const text = JSON.stringify(encodeDoc(doc, { withImages: true }));
  const back = decodeDoc(JSON.parse(text));
  ok("JSON keeps every event", back.events.length === doc.events.length);
  ok("JSON keeps every era", back.eras.length === doc.eras.length);
  ok("JSON keeps categories", back.categories.length === doc.categories.length);
  ok("JSON keeps the name", back.name === doc.name);

  let bad = [];
  const cmp = (a, b, kind) => {
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.id !== y.id) bad.push(kind + " id");
      if (x.title !== y.title) bad.push(kind + " title " + x.title);
      if (x.start.t !== y.start.t) bad.push(kind + " start " + x.title + " off by " + Number(y.start.t - x.start.t));
      if (x.start.precision !== y.start.precision) bad.push(kind + " precision " + x.title);
      if (!!x.end !== !!y.end) bad.push(kind + " end presence " + x.title);
      if (x.end && x.end.t !== y.end.t) bad.push(kind + " end " + x.title);
      if ((x.desc || "") !== (y.desc || "")) bad.push(kind + " desc " + x.title);
      if ((x.color || "") !== (y.color || "")) bad.push(kind + " color " + x.title);
      if ((x.parent || null) !== (y.parent || null)) bad.push(kind + " parent " + x.title);
      if ((x.sym || "") !== (y.sym || "")) bad.push(kind + " symbol " + x.title);
      if (!!x.important !== !!y.important) bad.push(kind + " important " + x.title);
      if ((x.tags || []).join() !== (y.tags || []).join()) bad.push(kind + " tags " + x.title);
    }
  };
  cmp(doc.events, back.events, "event");
  cmp(doc.eras, back.eras, "era");
  ok("JSON preserves every field exactly", bad.length === 0, bad.slice(0, 4).join(" | "));

  /* BigInt has to survive JSON, which has no BigInt */
  ok("instants survive as BigInt", typeof back.events[0].start.t === "bigint");
  ok("deep-time instants are exact",
     back.events.find(e => e.id === "d1").start.t === doc.events.find(e => e.id === "d1").start.t);

  /* the era tree still validates after a round trip */
  const clashes = back.eras.filter(r => siblingClash(back.eras, r));
  ok("era tree is still valid after JSON", clashes.length === 0, clashes.map(r=>r.title).join(", "));
}

/* ---- 2. rejects junk rather than corrupting itself ---- */
{
  const bad = [null, {}, { format: "something-else" }, { format: "timeline-doc", version: 99 }];
  let caught = 0;
  for (const b of bad) { try { decodeDoc(b); } catch (e) { caught++; } }
  ok("bad files are refused with a message", caught === bad.length, caught + "/" + bad.length);
}

/* ---- 3. CSV: export -> import must rebuild the same timeline ---- */
{
  const csv = exportCSV(doc);
  const empty = { categories: [], events: [], eras: [] };
  const res = importCSV(csv, empty);
  ok("CSV has no import errors", res.errors.length === 0, res.errors.slice(0, 3).join(" | "));
  ok("CSV keeps every event", res.events.length === doc.events.length,
     res.events.length + " vs " + doc.events.length);
  ok("CSV keeps every era", res.eras.length === doc.eras.length);
  ok("CSV recreates the categories", res.categories.length === doc.categories.length);

  const byId = new Map([...res.events, ...res.eras].map(i => [i.id, i]));
  let drift = [];
  for (const src of [...doc.events, ...doc.eras]) {
    const got = byId.get(src.id);
    if (!got) { drift.push("missing " + src.title); continue; }
    if (got.title !== src.title) drift.push("title " + src.title);
    if (got.start.t !== src.start.t) drift.push("start " + src.title + " off " + Number(got.start.t - src.start.t));
    if (!!got.end !== !!src.end) drift.push("end presence " + src.title);
    if (got.end && got.end.t !== src.end.t) drift.push("end " + src.title);
    if ((got.desc || "") !== (src.desc || "")) drift.push("desc " + src.title);
    if ((got.tags || []).join() !== (src.tags || []).join()) drift.push("tags " + src.title);
    if (!!got.important !== !!src.important) drift.push("important " + src.title);
  }
  ok("CSV round-trips every instant and field", drift.length === 0, drift.slice(0, 4).join(" | "));

  /* the layer stack has to survive being flattened into a table */
  let tree = [];
  for (const src of doc.eras) {
    const got = res.eras.find(r => r.id === src.id);
    if ((got.layer || 0) !== (src.layer || 0)) {
      tree.push(src.title + ": wanted layer " + src.layer + ", got " + got.layer);
    }
  }
  ok("CSV preserves every era's layer", tree.length === 0, tree.slice(0, 3).join(" | "));
  ok("and the layers still validate",
     res.eras.filter(r => siblingClash(res.eras, r)).length === 0);
  /* parentage is derived, so it has to come back identical without being stored */
  ok("derived parentage survives the round trip",
     doc.eras.every((src) => {
       const a = parentsOf(doc.eras, src).map(r => r.id).sort().join();
       const b = parentsOf(res.eras, res.eras.find(r => r.id === src.id)).map(r => r.id).sort().join();
       return a === b;
     }));
}

/* ---- 4. the CSV parser itself ---- */
{
  const rows = parseCSV('a,b,c\n1,"two, with comma",3\n4,"say ""hi""",6\n7,"multi\nline",9\n');
  ok("parses a plain row", rows[1][0] === "1" && rows[1][2] === "3");
  ok("parses a quoted comma", rows[1][1] === "two, with comma", rows[1][1]);
  ok("parses a doubled quote", rows[2][1] === 'say "hi"', rows[2][1]);
  ok("parses a newline inside quotes", rows[3][1] === "multi\nline", JSON.stringify(rows[3][1]));
  ok("skips blank lines", parseCSV("a,b\n\n\n1,2\n").length === 2);
  ok("handles CRLF", parseCSV("a,b\r\n1,2\r\n")[1][1] === "2");
  ok("handles a BOM", parseCSV("\uFEFFtitle,start\nx,1990\n")[0][0] === "title");
}

/* ---- 5. hand-written CSV, the way someone would actually type it ---- */
{
  const hand = [
    "type,title,start,end,category,parent,symbol,color,description,tags",
    "era,Ancient,3000 BCE,476,History,,,#A184C4,The long stretch,",
    "era,Bronze Age,3000 BCE,1200 BCE,History,Ancient,,,,",
    "event,Fall of Rome,476-09-04,,History,,flag,,Deposition of the last emperor,rome; politics",
    "event,A span,1900,1950,History,,ring,,,",
    "event,Deep one,66 Mya,,Geology,,cross,,Impact,",
  ].join("\n");
  const res = importCSV(hand, { categories: [], events: [], eras: [] });
  ok("hand-written CSV imports cleanly", res.errors.length === 0, res.errors.join(" | "));
  ok("creates categories it has not seen", res.categories.length === 2,
     res.categories.map(c => c.name).join(","));
  /* the legacy `parent` column still reads: a named parent just means one
     layer below whatever it names */
  ok("a named parent puts the era one layer down",
     res.eras.find(r => r.title === "Bronze Age").layer
     === res.eras.find(r => r.title === "Ancient").layer + 1);
  ok("reads BCE dates", fmtInstant(res.eras[0].start.t, "year") === "3000 BCE",
     fmtInstant(res.eras[0].start.t, "year"));
  ok("reads deep time", res.events.find(e => e.title === "Deep one").start.precision === "myr");
  ok("splits tags", res.events.find(e => e.title === "Fall of Rome").tags.join() === "rome,politics");
  ok("reads the legacy important column as Important", (() => {
    const r2 = importCSV("title,start,important\nA,1990,true\nB,1991,\n",
      { categories: [], events: [], eras: [] });
    return r2.events[0].imp === 3 && r2.events[1].imp === undefined;
  })());
  ok("reads the importance column", (() => {
    const r3 = importCSV("title,start,importance\nA,1990,critical\nB,1991,trivial\nC,1992,normal\n",
      { categories: [], events: [], eras: [] });
    return r3.events[0].imp === 4 && r3.events[1].imp === 0 && r3.events[2].imp === undefined;
  })());
  ok("keeps a blank end as a point", res.events.find(e => e.title === "Fall of Rome").end === null);
  ok("keeps a filled end as a span", res.events.find(e => e.title === "A span").end !== null);
  ok("indexes cleanly", buildIndex({ ...res, categories: res.categories }).items.length === 5);
}

/* ---- 6. bad rows are reported, not swallowed, and do not stop the good ones ---- */
{
  const messy = [
    "type,title,start",
    "event,Good one,1990",
    "event,,1991",
    "event,No date,",
    "event,Bad date,not-a-date",
    "event,Another good,1992",
  ].join("\n");
  const res = importCSV(messy, { categories: [], events: [], eras: [] });
  ok("good rows still import", res.events.length === 2, res.events.map(e=>e.title).join(","));
  ok("every bad row is reported", res.errors.length === 3, res.errors.join(" | "));
  ok("errors name the line number", res.errors.every(e => /Row \d+/.test(e)));
  let threw = false;
  try { importCSV("nothing,useful\n1,2\n", { categories: [], events: [], eras: [] }); }
  catch (e) { threw = true; }
  ok("a file with no title column is refused", threw);
}

/* ---- 7. the library summary ---- */
{
  const s = summarise(doc);
  ok("summary counts match", s.events === doc.events.length && s.eras === doc.eras.length);
  ok("summary carries id and name", s.id === "tl_1" && s.name === doc.name);
}

/* ---- 8. pictures by link, and outbound links ----
   CSV cannot hold an uploaded picture, but it can hold the address of one that
   already lives somewhere. Those must survive a round trip; embedded ones must
   be dropped honestly rather than turned into a broken reference. */
{
  const linked = { id: "img_x", name: "dk.png", url: "https://example.com/dk.png",
    thumb: "https://example.com/dk.png", w: null, h: null, external: true };
  const uploaded = { id: "img_u", name: "u.webp", url: "data:image/webp;base64,AAAA",
    thumb: "data:,", w: 10, h: 10 };
  const d2 = { ...doc, images: { img_x: linked, img_u: uploaded } };
  d2.events = d2.events.map((e, i) => (
    i === 0 ? { ...e, imageId: "img_x", pinImage: true,
      links: ["https://a.example/one", "https://b.example/two"] }
      : i === 1 ? { ...e, imageId: "img_u", pinImage: true } : e));

  const csv = exportCSV(d2);
  ok("CSV carries a linked picture's address", csv.includes("https://example.com/dk.png"));
  ok("CSV never carries embedded picture data", !csv.includes("base64"));
  ok("uploads that cannot travel are counted", countsDroppedImages(d2) === 1,
     String(countsDroppedImages(d2)));

  const back = importCSV(csv, { categories: [], events: [], eras: [] });
  ok("the round trip is clean", back.errors.length === 0, back.errors.slice(0, 3).join(" | "));
  const first = back.events.find((e) => e.id === d2.events[0].id);
  ok("links survive in order",
     (first.links || []).join() === "https://a.example/one,https://b.example/two",
     JSON.stringify(first.links));
  ok("a linked picture comes back", !!first.imageId && !!back.images[first.imageId]);
  ok("with its address intact", back.images[first.imageId].url === "https://example.com/dk.png");
  ok("still marked as a link, not a copy", back.images[first.imageId].external === true);
  ok("and still pinned", first.pinImage === true);

  const second = back.events.find((e) => e.id === d2.events[1].id);
  ok("an uploaded picture is dropped, not faked", !second.imageId);
  ok("and its pin goes with it", !second.pinImage);

  /* one record per address, however many rows use it */
  const dup = importCSV(
    "title,start,image\nA,1990,https://x.example/p.png\nB,1991,https://x.example/p.png\n",
    { categories: [], events: [], eras: [] });
  ok("the same address makes one record", Object.keys(dup.images).length === 1,
     String(Object.keys(dup.images).length));
  ok("and both rows point at it", dup.events[0].imageId === dup.events[1].imageId);

  /* eras carry pictures too — this was an event-only column before */
  const eraImg = importCSV(
    "type,title,start,end,image,pin_image\nera,Ancient,1000,1200,https://y.example/e.png,true\n",
    { categories: [], events: [], eras: [] });
  ok("an era can carry a linked picture", !!eraImg.eras[0].imageId);
  ok("and can pin it", eraImg.eras[0].pinImage === true);

  /* a bad address is reported rather than swallowed */
  const badImg = importCSV("title,start,image\nA,1990,not-a-url\n",
    { categories: [], events: [], eras: [] });
  ok("a bad address is reported", badImg.errors.length === 1, badImg.errors.join(" | "));
  ok("but the row itself still imports", badImg.events.length === 1);
  ok("with no picture attached", !badImg.events[0].imageId);

  /* pinning without a picture is meaningless and must not be recorded */
  const noImg = importCSV("title,start,pin_image\nA,1990,true\n",
    { categories: [], events: [], eras: [] });
  ok("a pin with nothing to pin is ignored", !noImg.events[0].pinImage);
}

/* ---- 9. ongoing spans through CSV ----
   "ongoing" is a literal token for the end column, not a date — it marks an
   event span as still running, the freedom eras already had from a blank end. */
{
  const csv = "title,start,end\nStill going,1990,ongoing\nDone,1990,2000\nPoint,1990,\n";
  const res = importCSV(csv, { categories: [], events: [], eras: [] });
  ok("no import errors", res.errors.length === 0, res.errors.join(" | "));
  const going = res.events.find((e) => e.title === "Still going");
  ok("marks the event ongoing", going.ongoing === true);
  ok("and leaves it with no end", going.end === null);
  const done = res.events.find((e) => e.title === "Done");
  ok("a real end date is not treated as the token", done.ongoing === undefined && done.end !== null);
  const point = res.events.find((e) => e.title === "Point");
  ok("a blank end is still just a point", point.ongoing === undefined && point.end === null);

  /* a future start cannot be ongoing */
  const future = importCSV("title,start,end\nNot yet,2999,ongoing\n",
    { categories: [], events: [], eras: [] });
  ok("a future ongoing event is refused", future.events.length === 0 && future.errors.length === 1,
     JSON.stringify(future.errors));
  const futureEra = importCSV("type,title,start,end\nera,Not yet,2999,\n",
    { categories: [], events: [], eras: [] });
  ok("a future open era is refused the same way",
     futureEra.eras.length === 0 && futureEra.errors.length === 1);

  /* round trip: export must write "ongoing", not leave it blank */
  const doc2 = { ...starterDoc(), id: "tl_og", createdAt: "2026-01-01T00:00:00Z" };
  doc2.events = [{ ...doc2.events[0], end: null, ongoing: true }];
  const out = exportCSV(doc2);
  const eventLine = out.split("\n").find((l) => l.startsWith("event,"));
  ok("export writes the literal token", /,ongoing,/.test(eventLine), eventLine);
  const back = importCSV(out, { categories: [], events: [], eras: [] });
  ok("and it survives the round trip", back.events[0].ongoing === true && back.events[0].end === null);
}

/* ---- 10. importance survives JSON, including the legacy migration ---- */
{
  const doc3 = { ...starterDoc(), id: "tl_imp", createdAt: "2026-01-01T00:00:00Z" };
  doc3.events = [{ ...doc3.events[0], imp: 4 }, { ...doc3.events[1] }];
  const back = decodeDoc(JSON.parse(JSON.stringify(encodeDoc(doc3))));
  ok("an explicit level round-trips", back.events[0].imp === 4);
  ok("no level at all stays absent, not defaulted", back.events[1].imp === undefined);

  /* a save from before the five-level scale existed */
  const legacy = { format: "timeline-doc", version: 1, id: "tl_old", categories: [],
    eras: [], events: [
      { id: "e1", start: { t: "0", precision: "second" }, end: null, important: true },
      { id: "e2", start: { t: "0", precision: "second" }, end: null, important: false },
      { id: "e3", start: { t: "0", precision: "second" }, end: null },
    ] };
  const migrated = decodeDoc(legacy);
  ok("important:true becomes Important", migrated.events[0].imp === 3);
  ok("important:false becomes unset (Normal by default)", migrated.events[1].imp === undefined);
  ok("no flag at all stays unset too", migrated.events[2].imp === undefined);
  ok("the legacy field itself is gone", !("important" in migrated.events[0]));
}

/* ---- 11. era layers through JSON, including the legacy tree ---- */
{
  const doc4 = { ...starterDoc(), id: "tl_lay", createdAt: "2026-01-01T00:00:00Z" };
  const back = decodeDoc(JSON.parse(JSON.stringify(encodeDoc(doc4))));
  ok("layers round-trip", doc4.eras.every((src) =>
    back.eras.find((r) => r.id === src.id).layer === src.layer));

  /* a timeline saved before layers existed, carrying parent pointers */
  const legacy = { format: "timeline-doc", version: 1, id: "tl_old",
    categories: [{ id: "c", name: "C", color: "#fff" }], events: [],
    eras: [
      { id: "p", cat: "c", parent: null, title: "Top",
        start: { t: "0", precision: "year" }, end: { t: "1000", precision: "year" } },
      { id: "m", cat: "c", parent: "p", title: "Middle",
        start: { t: "100", precision: "year" }, end: { t: "400", precision: "year" } },
      { id: "j", cat: "c", parent: "m", title: "Deep",
        start: { t: "150", precision: "year" }, end: { t: "300", precision: "year" } },
    ] };
  const conv = decodeDoc(legacy);
  ok("loading an old document assigns layers", conv.eras.map((r) => r.id + ":" + r.layer).join() === "p:0,m:1,j:2",
     conv.eras.map((r) => r.id + ":" + r.layer).join());
  ok("and drops the old pointers", conv.eras.every((r) => !("parent" in r)));
  ok("parentage still comes out the same",
     parentsOf(conv.eras, conv.eras.find((r) => r.id === "j")).map((r) => r.id).join() === "m");
}

/* ---- 12. the CSV layer column ---- */
{
  const csv = [
    "type,title,start,end,category,layer",
    "era,Broad,1000,2000,Hist,0",
    "era,Narrow,1200,1500,Hist,1",
    "era,Also narrow,1500,1800,Hist,1",
  ].join("\n");
  const res = importCSV(csv, { categories: [], events: [], eras: [] });
  ok("layers import cleanly", res.errors.length === 0, res.errors.join(" | "));
  ok("the layer column is read", res.eras.map((r) => r.layer).join() === "0,1,1");
  ok("parentage falls out of the layers",
     parentsOf(res.eras, res.eras.find((r) => r.title === "Narrow")).map((r) => r.title).join() === "Broad");

  /* export writes the number back, and it survives a second trip */
  const doc5 = { categories: res.categories, eras: res.eras, events: [], images: {}, name: "L" };
  const back2 = importCSV(exportCSV(doc5), { categories: [], events: [], eras: [] });
  ok("layers survive an export/import round trip",
     back2.eras.map((r) => r.layer).sort().join() === "0,1,1",
     back2.eras.map((r) => r.title + ":" + r.layer).join());

  /* eras sharing a layer may not overlap, but different layers may */
  const narrow = res.eras.find((r) => r.title === "Narrow");
  const rival = { id: "x", cat: narrow.cat, layer: 1, start: narrow.start, end: narrow.end };
  ok("a same-layer overlap is still a clash", siblingClash(res.eras, rival) !== null);
  ok("the very same span on another layer is free",
     siblingClash(res.eras, { ...rival, layer: 3 }) === null);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
