/* Round-trip tests for persistence and interchange. Data loss here is silent,
   so every field is compared, not just the count of items. */
import { starterDoc, buildIndex, siblingClash } from "./src/model.js";
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

  /* the era hierarchy has to survive being flattened into a table */
  const nameOf = new Map(res.eras.map(r => [r.id, r.title]));
  const srcName = new Map(doc.eras.map(r => [r.id, r.title]));
  let tree = [];
  for (const src of doc.eras) {
    const got = res.eras.find(r => r.id === src.id);
    const wanted = src.parent ? srcName.get(src.parent) : null;
    const actual = got.parent ? nameOf.get(got.parent) : null;
    if (wanted !== actual) tree.push(src.title + ": wanted " + wanted + ", got " + actual);
  }
  ok("CSV preserves the era tree", tree.length === 0, tree.slice(0, 3).join(" | "));
  ok("CSV era tree still validates",
     res.eras.filter(r => siblingClash(res.eras, r)).length === 0);
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
  ok("nests by parent title", res.eras.find(r => r.title === "Bronze Age").parent
     === res.eras.find(r => r.title === "Ancient").id);
  ok("reads BCE dates", fmtInstant(res.eras[0].start.t, "year") === "3000 BCE",
     fmtInstant(res.eras[0].start.t, "year"));
  ok("reads deep time", res.events.find(e => e.title === "Deep one").start.precision === "myr");
  ok("splits tags", res.events.find(e => e.title === "Fall of Rome").tags.join() === "rome,politics");
  ok("reads the important column", (() => {
    const r2 = importCSV("title,start,important\nA,1990,true\nB,1991,\n",
      { categories: [], events: [], eras: [] });
    return r2.events[0].important === true && !r2.events[1].important;
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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
