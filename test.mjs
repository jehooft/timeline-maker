import * as T from "./src/time.js";
import * as K from "./src/ticks.js";
import * as MD from "./src/model.js";
const M = { ...T, ...K, ...MD };
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; } else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
};

/* ---- 1. calendar round-trip, including negative and huge years ---- */
const dates = [
  [1970,1,1,0,0,0],[2026,7,26,12,0,0],[1969,7,20,20,17,40],[2000,2,29,23,59,59],
  [1900,3,1,0,0,0],[1,1,1,0,0,0],[0,1,1,0,0,0],[-1,12,31,23,59,59],[-2559,1,1,0,0,0],
  [-9674,6,15,0,0,0],[-4536000000,1,1,0,0,0],[31000000000,12,31,0,0,0],[-45000,7,4,5,6,7],
];
for (const [y,mo,d,hh,mi,ss] of dates) {
  const t = M.tFromCivil(y,mo,d,hh,mi,ss);
  const c = M.civilFromT(t);
  ok("roundtrip "+y+"-"+mo+"-"+d, c.y===y&&c.m===mo&&c.d===d&&c.hh===hh&&c.mm===mi&&c.ss===ss,
     JSON.stringify(c));
}
/* known anchors */
ok("epoch is 0", M.tFromCivil(1970,1,1) === 0n);
ok("1 day later", M.tFromCivil(1970,1,2) === 86400n);
ok("leap 2000 exists", M.civilFromT(M.tFromCivil(2000,2,29)).d === 29);
ok("1900 not leap", M.civilFromT(M.tFromCivil(1900,2,28)+86400n).m === 3);
ok("2024-02-29 valid", M.civilFromT(M.tFromCivil(2024,2,29)).d === 29);
/* day count sanity against a known Julian-day anchor: 2000-01-01 = day 10957 */
ok("2000-01-01 day number", M.daysFromCivil(2000,1,1) === 10957, String(M.daysFromCivil(2000,1,1)));

/* ---- 2. monotonicity across the whole range ---- */
let mono = true, prev = null;
for (let y = -4600000000; y < 4e9; y += 137000000) {
  const t = M.tFromCivil(Math.round(y),1,1);
  if (prev !== null && t <= prev) mono = false;
  prev = t;
}
ok("time is monotonic in year across ±4.6 Gyr", mono);

/* ---- 3. the date parser ---- */
const cases = [
  ["1981", "year"], ["1981-07", "month"], ["1981-07-09", "day"],
  ["1981-07-09T14:30", "minute"], ["1981-07-09T14:30:05", "second"],
  ["1969-07-20 20:17:40", "second"], ["44 BCE", "year"], ["-44", "year"],
  ["1200 AD", "year"], ["13.8 Gya", "gyr"], ["2.5 Mya", "myr"], ["12 kya", "kyr"],
  ["4.54e9 ya", "year"], ["10000 BP", "year"], ["now", "second"], ["-2559-01-01", "day"],
];
for (const [s, prec] of cases) {
  const r = M.parseDateInput(s);
  ok("parse " + s, r && r.precision === prec, r ? "got " + r.precision : "got null");
}
ok("44 BCE is astronomical year -43", M.civilFromT(M.parseDateInput("44 BCE").t).y === -43);
ok("13.8 Gya is deep past", M.parseDateInput("13.8 Gya").t < -4e17);
ok("rejects gibberish", M.parseDateInput("hello") === null);
ok("rejects month 13", M.parseDateInput("1981-13-01") === null);
ok("rejects bare huge number", M.parseDateInput("13800000000") === null);
ok("BP is relative to 1950", Math.abs(Number(M.parseDateInput("0 BP").t - M.tFromCivil(1950,1,1))) < 2);

/* ---- 4. editor round-trip: instantToInput -> parseDateInput ---- */
for (const [s, prec] of cases) {
  if (s === "now") continue;
  const a = M.parseDateInput(s);
  const back = M.parseDateInput(M.instantToInput(a.t, a.precision));
  const tol = prec === "gyr" ? 3.2e13 : prec === "myr" ? 3.2e11 : prec === "kyr" ? 3.2e10 : 1;
  ok("editor round-trip " + s, back && back.precision === a.precision &&
     Math.abs(Number(back.t - a.t)) <= tol,
     back ? "delta " + Number(back.t - a.t) + " prec " + back.precision : "null");
}

/* ---- 5. ticks: ascending, aligned, bounded count, at every scale ---- */
const centre = M.tFromCivil(1990,1,1);
let tickProblems = [];
for (let e = -2; e <= 15; e += 0.5) {
  const spp = Math.pow(10, e);
  const step = M.pickStep(140 * spp);
  const half = BigInt(Math.round(spp * 800));
  const t0 = centre - half, t1 = centre + half;
  const ticks = M.majorTicks(step, t0, t1);
  if (ticks.length < 2) { tickProblems.push("spp 1e" + e + " gave " + ticks.length + " ticks"); continue; }
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i] <= ticks[i-1]) { tickProblems.push("non-ascending at spp 1e" + e); break; }
  }
  if (ticks.length > 200) tickProblems.push("spp 1e" + e + " gave " + ticks.length + " ticks");
  const lbl = M.tickLabel(ticks[Math.floor(ticks.length/2)], step);
  if (!lbl || lbl === "undefined" || lbl.includes("NaN")) tickProblems.push("bad label at spp 1e" + e + ": " + lbl);
}
ok("ticks well-formed at every scale", tickProblems.length === 0, tickProblems.join(" | "));

/* ticks in deep time and far future */
for (const anchor of [M.tFromCivil(-4500000000,1,1), M.tFromCivil(300000,1,1), 0n]) {
  for (const spp of [1e10, 1e13, 1e15, 1, 0.01]) {
    const step = M.pickStep(140 * spp);
    const half = BigInt(Math.round(spp * 800));
    const ticks = M.majorTicks(step, anchor - half, anchor + half);
    ok("ticks near " + anchor + " @spp " + spp, ticks.length >= 2 && ticks.length < 400, "n=" + ticks.length);
  }
}

/* year ticks land on year boundaries */
{
  const step = M.pickStep(140 * 3e6);
  const ticks = M.majorTicks(step, M.tFromCivil(1900,1,1), M.tFromCivil(2000,1,1));
  ok("year ticks land on 1 Jan", ticks.every(t => { const c = M.civilFromT(t); return c.m===1&&c.d===1&&c.hh===0; }));
}

/* ---- 6. row packing: no overlaps inside a row, hysteresis respected ---- */
function overlapCheck(items, gutter) {
  const rows = {};
  for (const it of items) (rows[it.row] = rows[it.row] || []).push(it);
  for (const r of Object.values(rows)) {
    r.sort((a,b)=>a.x0-b.x0);
    for (let i=1;i<r.length;i++) if (r[i].x0 < r[i-1].x1 + gutter - 1e-9) return false;
  }
  return true;
}
const rnd = (seed) => { let s = seed; return () => (s = (s*1103515245+12345) % 2147483648) / 2147483648; };
{
  const r = rnd(42);
  const items = Array.from({length: 300}, (_, i) => {
    const x0 = r()*4000, len = r()*380;
    return { key: "k"+i, x0, x1: x0+len };
  });
  const packed = M.packRows(items, 10, null);
  ok("packing has no overlaps", overlapCheck(packed.items, 10));
  ok("packing uses a sane row count", packed.rows > 0 && packed.rows < 120, "rows=" + packed.rows);

  /* hysteresis: nudge everything slightly, rows should mostly stay put */
  const prev = new Map(packed.items.map(i => [i.key, i.row]));
  const shifted = packed.items.map(i => ({ key: i.key, x0: i.x0 + 3, x1: i.x1 + 3 }));
  const packed2 = M.packRows(shifted, 10, prev);
  ok("no overlaps after re-pack", overlapCheck(packed2.items, 10));
  const same = packed2.items.filter(i => prev.get(i.key) === i.row).length;
  ok("hysteresis keeps rows stable", same / packed2.items.length > 0.9,
     (100*same/packed2.items.length).toFixed(0) + "% stable");
}

/* ---- 6a. lane packing for pinned pictures ----
   The reported bug: an important picture reserved its whole row, so ordinary
   pictures to its left were dropped with the space beside them plainly free.
   Importance must buy nothing in layout, and only decide who keeps a lane once
   the lanes are full. */
{
  const pic = (key, x0, x1, prio = 0) => ({ key, x0, x1, prio });
  const lanesOf = (res) => {
    const m = {};
    for (const it of res.items) (m[it.row] = m[it.row] || []).push(it.key);
    return m;
  };
  const overlapFree = (res, gutter) => {
    const rows = {};
    for (const it of res.items) if (it.row >= 0) (rows[it.row] = rows[it.row] || []).push(it);
    return Object.values(rows).every((lane) => {
      const s = [...lane].sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < s.length; i++) if (s[i].x0 < s[i - 1].x1 + gutter) return false;
      return true;
    });
  };

  /* the exact shape of the bug: a marked picture far to the right, a plain one
     well clear of it on the left. They belong on the same row. */
  {
    const res = M.packLanes([pic("plain", 0, 100), pic("key", 800, 900, 1)], 8, 3);
    ok("a plain picture shares the row left of a marked one",
       res.rows === 1 && res.items.every((i) => i.row === 0), JSON.stringify(lanesOf(res)));
    ok("nothing is hidden when there is room", res.hidden.length === 0);
  }
  /* several plain ones, all clear of the marked one */
  {
    const items = [pic("k", 900, 1000, 1), pic("a", 0, 100), pic("b", 150, 250), pic("c", 300, 400)];
    const res = M.packLanes(items, 8, 3);
    ok("a marked picture does not reserve the whole row", res.rows === 1, "rows=" + res.rows);
    ok("and none of the plain ones are dropped", res.hidden.length === 0);
  }
  /* genuine overlap still separates them */
  {
    const res = M.packLanes([pic("k", 0, 100, 1), pic("a", 50, 150)], 8, 3);
    ok("overlapping pictures still take separate rows", res.rows === 2);
    ok("lanes never overlap", overlapFree(res, 8));
  }
  /* when the lanes run out, the marked one is the one that stays */
  {
    const items = [pic("a", 0, 100), pic("b", 10, 110), pic("k", 20, 120, 1)];
    const res = M.packLanes(items, 8, 2);
    ok("a full set drops exactly one", res.hidden.length === 1, JSON.stringify(res.hidden.map((i) => i.key)));
    ok("and it is never the marked one", res.hidden[0].key !== "k");
    ok("the marked one holds a lane", items.find((i) => i.key === "k").row >= 0);
    ok("dropped pictures are flagged with row -1", res.hidden[0].row === -1);
  }
  /* two marked ones and one plain, room for two: the plain one goes */
  {
    const items = [pic("a", 0, 100), pic("k1", 10, 110, 1), pic("k2", 20, 120, 1)];
    const res = M.packLanes(items, 8, 2);
    ok("marked pictures outlast plain ones", res.hidden.length === 1 && res.hidden[0].key === "a");
  }
  /* with room for everyone, importance changes nothing at all */
  {
    const items = [pic("a", 0, 100), pic("b", 10, 110), pic("c", 20, 120)];
    const plain = M.packLanes(items.map((i) => ({ ...i })), 8, 5);
    const marked = M.packLanes(items.map((i) => ({ ...i, prio: i.key === "c" ? 1 : 0 })), 8, 5);
    ok("layout is identical whether or not a picture is marked",
       plain.rows === marked.rows && plain.rows === 3);
  }
  /* abutting exactly at the gutter */
  {
    const res = M.packLanes([pic("a", 0, 100), pic("b", 108, 200)], 8, 3);
    ok("a picture exactly one gutter away shares the row", res.rows === 1);
    const tight = M.packLanes([pic("a", 0, 100), pic("b", 107, 200)], 8, 3);
    ok("one pixel closer does not", tight.rows === 2);
  }
  /* Packing carries no memory: a picture always drops to the lowest lane that
     fits. This is what stops one stranding above an empty lane after the
     pictures that crowded it have gone. */
  {
    const crowded = M.packLanes([pic("a", 0, 100), pic("b", 50, 150), pic("c", 100, 200)], 8, 3);
    ok("crowded pictures stack", crowded.rows === 3);
    const cleared = M.packLanes([pic("a", 0, 100), pic("b", 300, 400)], 8, 3);
    ok("and drop straight back down once the crowd leaves",
       cleared.rows === 1 && cleared.items.every((i) => i.row === 0));
  }
  /* the same input always packs the same way, so a redraw never reshuffles */
  {
    const build = () => [pic("k", 400, 500, 1), pic("a", 0, 100), pic("b", 50, 150)];
    const one = lanesOf(M.packLanes(build(), 8, 3));
    const two = lanesOf(M.packLanes(build(), 8, 3));
    ok("packing is deterministic", JSON.stringify(one) === JSON.stringify(two), JSON.stringify(one));
  }
  ok("no items is handled", M.packLanes([], 8, 3).rows === 0);
}

/* ---- 7. index + range query correctness (brute force comparison) ---- */
{
  const doc = M.starterDoc();
  const idx = M.buildIndex(doc);
  ok("index holds every item", idx.items.length === doc.events.length + doc.eras.length);
  const probes = [
    [M.tFromCivil(1980,1,1), M.tFromCivil(1990,1,1)],
    [M.tFromCivil(-3000,1,1), M.tFromCivil(-2000,1,1)],
    [M.parseDateInput("200 Mya").t, M.parseDateInput("100 Mya").t],
    [M.parseDateInput("4.6 Gya").t, M.parseDateInput("3.0 Gya").t],
    [M.tFromCivil(2020,1,1), M.tFromCivil(2030,1,1)],
    [M.parseDateInput("14 Gya").t, M.tFromCivil(3000,1,1)],
  ];
  let allMatch = true, detail = "";
  for (const [a,b] of probes) {
    const got = new Set(M.queryRange(idx, a, b).map(i => i.id));
    const brute = new Set(idx.items.filter(i => i.t0 <= b && i.t1 >= a).map(i => i.id));
    if (got.size !== brute.size || [...brute].some(id => !got.has(id))) {
      allMatch = false;
      detail += " probe(" + [...brute].filter(x=>!got.has(x)).join(",") + " missed)";
    }
  }
  ok("range query matches brute force", allMatch, detail);
  const spanning = M.queryRange(idx, M.tFromCivil(1995,1,1), M.tFromCivil(1996,1,1));
  ok("finds spans that start far earlier",
     spanning.some(i => i.t0 < M.tFromCivil(1900,1,1) && i.t1 > M.tFromCivil(1996,1,1)),
     spanning.map(i=>i.id).join(","));
  ok("finds open-ended eras in the future",
     M.queryRange(idx, M.tFromCivil(2400,1,1), M.tFromCivil(2500,1,1)).some(i => i.open));

/* ---- 10. era layers ---- */
{
  const doc = M.starterDoc();
  const eras = doc.eras;
  const byId = new Map(eras.map(r => [r.id, r]));

  /* nothing sharing a layer overlaps anywhere in the sample data */
  let clashes = [];
  for (const r of eras) { const c = M.siblingClash(eras, r); if (c) clashes.push(r.title + " / " + c.title); }
  ok("sample eras have no same-layer overlaps", clashes.length === 0, clashes.join(" | "));

  /* abutting is allowed: an era starting exactly where another ends */
  const arc = eras.find(r => r.id === "r_arc"), con = eras.find(r => r.id === "r_con");
  ok("abutting eras share an exact instant", M.eraEnd(arc) === M.eraStart(con));
  ok("abutting eras do not clash", M.siblingClash(eras, con) === null);

  /* a genuine overlap on one layer is caught */
  const bad = { id: "__x__", cat: "vg", layer: 0, title: "Bad",
                start: { t: M.tFromCivil(1980,1,1), precision: "year" },
                end: { t: M.tFromCivil(1990,1,1), precision: "year" } };
  ok("overlapping era on one layer is rejected", M.siblingClash(eras, bad) !== null);
  /* the whole point of layers: another layer may cover the same span freely */
  ok("the same range on another layer is fine", M.siblingClash(eras, { ...bad, layer: 2 }) === null);
  /* clashes never cross category boundaries */
  ok("clashes stay within one category", M.siblingClash(eras, bad).cat === "vg");
  ok("an era in a free stretch is accepted",
     M.siblingClash(eras, { ...bad, cat: "hist",
       start: { t: M.tFromCivil(-5000,1,1), precision: "year" },
       end: { t: M.tFromCivil(-4000,1,1), precision: "year" } }) === null);

  /* ---- adding a broader era over ones that already exist ----
     The old dead end: "Phanerozoic" over an existing "Mesozoic" clashed with no
     sensible way out. Now it is a layer insert — everything drops one and the
     new era takes the freed layer, with parentage falling out of the overlap
     rather than being re-pointed by hand. */
  {
    const era2 = (id, title, from, to, layer = 0) => ({
      id, cat: "z", layer, title,
      start: { t: M.agoY(from), precision: "myr" },
      end: to === null ? null : { t: M.agoY(to), precision: "myr" },
    });
    const mes = era2("m", "Mesozoic", 251.9e6, 66e6);
    const phan = era2("p", "Phanerozoic", 538.8e6, null);

    ok("the broader era still reports a clash on its layer", M.siblingClash([mes], phan) !== null);
    const lifted = [...M.insertLayer([mes], "z", 0), phan];
    ok("inserting a layer pushes the old era down", lifted.find(r => r.id === "m").layer === 1);
    ok("and the new one keeps the freed layer", lifted.find(r => r.id === "p").layer === 0);
    ok("the clash is gone", M.siblingClash(lifted, phan) === null);
    ok("and gone for the era that moved",
       M.siblingClash(lifted, lifted.find(r => r.id === "m")) === null);
    ok("the moved era is now a child, with nothing re-pointed",
       M.parentsOf(lifted, lifted.find(r => r.id === "m")).map(r => r.id).join() === "p");

    /* several at once — re-adding Mesozoic over its own periods */
    const tri = era2("t", "Triassic", 251.9e6, 201.4e6);
    const jur = era2("j", "Jurassic", 201.4e6, 145e6);
    const cre = era2("c", "Cretaceous", 145e6, 66e6);
    const lifted2 = [...M.insertLayer([tri, jur, cre], "z", 0), mes];
    ok("every covered era becomes a child at once",
       M.childrenOf(lifted2, mes).map(r => r.id).sort().join() === "c,j,t",
       JSON.stringify(M.childrenOf(lifted2, mes).map(r => r.id)));
    ok("insertLayer leaves other categories alone",
       M.insertLayer([{ ...mes, cat: "other" }], "z", 0)[0].layer === 0);

    /* an era straddling two above it belongs to both — impossible with a tree */
    const age1 = era2("a1", "Age 1", 100e6, 50e6, 0);
    const age2 = era2("a2", "Age 2", 50e6, 10e6, 0);
    const straddle = era2("a3", "Age 3", 70e6, 30e6, 1);
    const both = M.parentsOf([age1, age2, straddle], straddle).map(r => r.id).sort();
    ok("an era under two adjacent ones belongs to both", both.join() === "a1,a2", JSON.stringify(both));
    ok("and each of those two claims it as a child",
       M.childrenOf([age1, age2, straddle], age1).length === 1
       && M.childrenOf([age1, age2, straddle], age2).length === 1);

    /* abutment is not overlap, so it buys no parentage */
    ok("merely abutting does not make a parent",
       M.parentsOf([age1, era2("u", "Just after", 50e6, 10e6, 1)],
                   era2("u", "Just after", 50e6, 10e6, 1)).length === 0);
    /* a gap above leaves an era with no family at all */
    ok("an era with nothing above it has no parents",
       M.parentsOf([age1], era2("g", "Gap", 9e6, 1e6, 1)).length === 0);
    ok("the top layer never has parents", M.parentsOf([age1, age2], age1).length === 0);
    ok("parentage never crosses categories",
       M.parentsOf([{ ...age1, cat: "other" }], straddle).length === 0);
    ok("only the layer directly above counts",
       M.parentsOf([age1, era2("deep", "Deep", 70e6, 30e6, 3)],
                   era2("deep", "Deep", 70e6, 30e6, 3)).length === 0);
  }

  /* layers */
  ok("top-layer era is layer 0", M.eraLayer(byId.get("r_phan")) === 0);
  ok("one down is layer 1", M.eraLayer(byId.get("r_mes")) === 1);
  ok("two down is layer 2", M.eraLayer(byId.get("r_jur")) === 2);
  ok("index records the deepest layer per category", M.buildIndex(doc).depthByCat.get("earth") === 2,
     String(M.buildIndex(doc).depthByCat.get("earth")));
  ok("a category reports its layer count", M.layersOf(doc, "earth") === 3, String(M.layersOf(doc, "earth")));
  ok("and never fewer than one", M.layersOf({ categories: [{ id: "e" }], eras: [] }, "e") === 1);
  ok("a stored count below what the eras need is ignored",
     M.layersOf({ categories: [{ id: "c", layers: 1 }], eras: [{ id: "r", cat: "c", layer: 4 }] }, "c") === 5);

  /* the sample data's own family structure, which the fold rule depends on */
  ok("the periods sit under the Mesozoic",
     M.parentsOf(eras, byId.get("r_jur")).map(r => r.id).join() === "r_mes");
  ok("the Mesozoic sits under the Phanerozoic",
     M.parentsOf(eras, byId.get("r_mes")).map(r => r.id).join() === "r_phan");
  ok("the Phanerozoic sits under nothing", M.parentsOf(eras, byId.get("r_phan")).length === 0);
  ok("the Mesozoic's children are its three periods",
     M.childrenOf(eras, byId.get("r_mes")).map(r => r.id).sort().join() === "r_cre,r_jur,r_tri");
  ok("every era in the sample either has a parent or is on the top layer",
     eras.every(r => M.eraLayer(r) === 0 || M.parentsOf(eras, r).length > 0));

  /* the index carries the same parentage, resolved once for the renderer */
  {
    const idx2 = M.buildIndex(doc).erasByCat.get("earth");
    const jur = idx2.find(e => e.id === "r_jur");
    ok("the index records parents too", jur.parentIds.join() === "r_mes", JSON.stringify(jur.parentIds));
    ok("and none for the top layer",
       idx2.find(e => e.id === "r_phan").parentIds.length === 0);
  }

  /* ---- migrating a document written before layers existed ---- */
  {
    const legacy = [
      { id: "p", cat: "z", parent: null, title: "Phanerozoic" },
      { id: "m", cat: "z", parent: "p", title: "Mesozoic" },
      { id: "j", cat: "z", parent: "m", title: "Jurassic" },
      { id: "loose", cat: "z", parent: "missing", title: "Dangling" },
    ];
    const conv = M.erasWithLayers(legacy);
    ok("depth in the old tree becomes the layer number",
       conv.find(r => r.id === "p").layer === 0
       && conv.find(r => r.id === "m").layer === 1
       && conv.find(r => r.id === "j").layer === 2,
       JSON.stringify(conv.map(r => r.id + ":" + r.layer)));
    ok("a parent that no longer exists lands on the top layer",
       conv.find(r => r.id === "loose").layer === 0);
    ok("the old pointer is dropped", conv.every(r => !("parent" in r)));
    let hung = false;
    try { M.erasWithLayers([{ id: "a", cat: "x", parent: "b" }, { id: "b", cat: "x", parent: "a" }]); }
    catch (e) { hung = true; }
    ok("cyclic parents terminate rather than hanging", !hung);
    const already = [{ id: "a", cat: "x", layer: 2 }];
    ok("documents already on layers pass through untouched", M.erasWithLayers(already) === already);
  }

  /* ---- what an event falls inside, which is what offers its era's colour ---- */
  {
    const ids = (t0, t1, cat = "vg") => M.erasAround(eras, cat, t0, t1).map(r => r.id);
    ok("a point picks up every era covering it, broadest first",
       ids(M.tFromCivil(1985, 6, 1)).join() === "r_con,r_8bit",
       JSON.stringify(ids(M.tFromCivil(1985, 6, 1))));
    /* Eras are half-open, so the instant two abutting eras share belongs to the
       later one — the same rule the bars are drawn with, and the reason an
       event on 1983-01-01 is offered the console era's colour, not the arcade's. */
    ok("a point on a shared boundary belongs to the later era",
       ids(M.tFromCivil(1983, 1, 1)).join() === "r_con,r_8bit",
       JSON.stringify(ids(M.tFromCivil(1983, 1, 1))));
    ok("a span picks up everything it overlaps",
       ids(M.tFromCivil(1981, 1, 1), M.tFromCivil(1984, 1, 1)).join() === "r_arc,r_con,r_8bit",
       JSON.stringify(ids(M.tFromCivil(1981, 1, 1), M.tFromCivil(1984, 1, 1))));
    ok("a span merely touching an era's start is not inside it",
       !ids(M.tFromCivil(1960, 1, 1), M.tFromCivil(1972, 1, 1)).includes("r_arc"));
    ok("an ongoing era still covers today", ids(M.tFromCivil(2020, 1, 1)).includes("r_net"));
    ok("only the asked-for category's eras come back",
       M.erasAround(eras, "hist", M.tFromCivil(1985, 6, 1)).every(r => r.cat === "hist")
       && ids(M.tFromCivil(1985, 6, 1), M.tFromCivil(1985, 6, 1), "hist").join() === "r_mod,r_inf",
       JSON.stringify(ids(M.tFromCivil(1985, 6, 1), M.tFromCivil(1985, 6, 1), "hist")));
    ok("a moment before everything falls in nothing",
       ids(M.tFromCivil(1900, 1, 1)).length === 0);
  }

  /* ---- moving a group of eras to another category ---- */
  {
    const move = (idList, cat, from = eras) =>
      M.moveErasToCategory(from, new Set(idList), cat);
    /* "vg" has two layers, so anything arriving lands on layer 2 and below —
       under what is already there, never colliding with it. */
    const one = move(["r_jur"], "vg").find(r => r.id === "r_jur");
    ok("a moved era joins the new category", one.cat === "vg");
    ok("and lands below the layers already there", one.layer === 2, String(one.layer));

    const two = move(["r_mes", "r_jur"], "vg");
    ok("a batch keeps its own relative stacking",
       two.find(r => r.id === "r_mes").layer === 2 && two.find(r => r.id === "r_jur").layer === 3,
       JSON.stringify(two.filter(r => r.cat === "vg" && r.id.startsWith("r_m") ).map(r => r.layer)));
    ok("eras that did not move are left exactly as they were",
       two.find(r => r.id === "r_arc") === eras.find(r => r.id === "r_arc"));
    ok("moving into the category an era is already in changes nothing",
       move(["r_arc"], "vg") === eras);

    /* Two eras from different categories may well cover the same years — the
       one thing that cannot happen inside a single category. The second one
       drops a layer rather than landing on top of the first. */
    const a = { id: "a", cat: "x", layer: 0, title: "A",
                start: { t: M.tFromCivil(100, 1, 1), precision: "year" },
                end: { t: M.tFromCivil(200, 1, 1), precision: "year" } };
    const b = { ...a, id: "b", cat: "y", title: "B" };
    const dest = { id: "d", cat: "z", layer: 0, title: "Dest",
                   start: { t: M.tFromCivil(0, 1, 1), precision: "year" },
                   end: { t: M.tFromCivil(50, 1, 1), precision: "year" } };
    const merged = M.moveErasToCategory([dest, a, b], new Set(["a", "b"]), "z");
    ok("overlapping arrivals are stacked rather than piled up",
       merged.find(r => r.id === "a").layer !== merged.find(r => r.id === "b").layer,
       JSON.stringify(merged.map(r => r.id + ":" + r.layer)));
    let bad = [];
    for (const r of merged) { const c = M.siblingClash(merged, r); if (c) bad.push(r.id + "/" + c.id); }
    ok("and the result has no same-layer overlap anywhere", bad.length === 0, bad.join());
    ok("everything asked for actually moved",
       merged.filter(r => r.cat === "z").length === 3);
  }

  /* ---- REGRESSION: opening an era in the editor and saving it unchanged ----
     This is the reported bug. The editor round-trips dates through text, so if
     printing and re-parsing shifts an instant even by one second, an era that
     abutted its neighbour now overlaps it and the save is refused. */
  let shifted = [], refused = [];
  for (const r of eras) {
    const s2 = M.parseDateInput(M.instantToInput(r.start.t, r.start.precision));
    const e2 = r.end ? M.parseDateInput(M.instantToInput(r.end.t, r.end.precision)) : null;
    if (!s2 || (r.end && !e2)) { shifted.push(r.title + " unparseable"); continue; }
    if (s2.t !== r.start.t) shifted.push(r.title + " start off by " + Number(s2.t - r.start.t) + "s");
    if (e2 && e2.t !== r.end.t) shifted.push(r.title + " end off by " + Number(e2.t - r.end.t) + "s");
    const candidate = { ...r, start: s2, end: e2 };
    const c = M.siblingClash(eras, candidate);
    if (c) refused.push(r.title + " vs " + c.title);
  }
  ok("editing an era never shifts its instants", shifted.length === 0, shifted.join(" | "));
  ok("re-saving any era unchanged is accepted", refused.length === 0, refused.join(" | "));

  /* two eras typed with the identical phrase must land on the identical instant */
  for (const phrase of ["66.00 Mya", "2.500 Gya", "11.7 kya", "1983", "538.80 Mya"]) {
    const a = M.parseDateInput(phrase), b = M.parseDateInput(phrase);
    ok("'" + phrase + "' is stable", a && b && a.t === b.t);
  }
  /* and an era ending on that phrase abuts one starting on it */
  {
    const t = M.parseDateInput("66.00 Mya").t;
    const older = { id: "A", cat: "z", parent: null, start: { t: M.parseDateInput("251.90 Mya").t, precision: "myr" }, end: { t, precision: "myr" } };
    const newer = { id: "B", cat: "z", parent: null, start: { t, precision: "myr" }, end: { t: M.parseDateInput("0.00 Mya").t, precision: "myr" } };
    ok("deep-time eras abut exactly", M.siblingClash([older, newer], newer) === null);
    ok("deep-time abutment holds both ways", M.siblingClash([older, newer], older) === null);
  }

  /* the datum is fixed, so nothing depends on when the app was opened */
  ok("relative dates do not drift", M.fromYearsAgo(66e6, "myr") === M.fromYearsAgo(66e6, "myr"));
  ok("relative dates are quantised", M.fromYearsAgo(66e6 + 3, "myr") === M.fromYearsAgo(66e6, "myr"));
}
}

/* ---- 8. formatting doesn't produce NaN/undefined anywhere ---- */
{
  let bad = [];
  const precisions = ["second","minute","hour","day","month","year","kyr","myr","gyr"];
  const samples = [0n, M.tFromCivil(1969,7,20,20,17,40), M.tFromCivil(-2559,1,1),
                   M.parseDateInput("13.8 Gya").t, M.parseDateInput("300 kya").t, M.MAX_T, -M.MAX_T];
  for (const t of samples) for (const p of precisions) {
    const s = M.fmtInstant(t, p);
    if (!s || s.includes("NaN") || s.includes("undefined")) bad.push(p + "@" + t + "=" + s);
  }
  for (const d of [0.005, 1, 59, 3600, 86400, 1e6, 1e9, 1e12, 1e15, 1e18, -1e12]) {
    const s = M.fmtDur(d);
    if (!s || s.includes("NaN") || s.includes("undefined")) bad.push("dur " + d + "=" + s);
  }
  ok("no NaN or undefined in any formatter", bad.length === 0, bad.join(" | "));
}

/* ---- 9. precision-driven display actually differs ---- */
{
  const t = M.tFromCivil(1981,7,9,14,30,5);
  ok("year precision hides the day", M.fmtInstant(t,"year") === "1981", M.fmtInstant(t,"year"));
  ok("day precision hides the clock", M.fmtInstant(t,"day") === "9 July 1981", M.fmtInstant(t,"day"));
  ok("second precision shows all", M.fmtInstant(t,"second").includes("14:30:05"));
  ok("BCE renders", M.fmtInstant(M.tFromCivil(-43,1,1),"year") === "44 BCE", M.fmtInstant(M.tFromCivil(-43,1,1),"year"));
}

/* ---- 11. clock independence, with real time passing between load and edit ----
   The reported bug only appeared once a second had ticked over since the
   document was built, so the test has to actually wait. */
{
  const doc = M.starterDoc();
  const t0 = Date.now();
  while (Date.now() - t0 < 1100) { /* time passes while the user works */ }
  let drift = [], refused = [];
  for (const r of doc.eras) {
    const s = M.parseDateInput(M.instantToInput(r.start.t, r.start.precision));
    const e = r.end ? M.parseDateInput(M.instantToInput(r.end.t, r.end.precision)) : null;
    if (s.t !== r.start.t) drift.push(r.title + " start");
    if (e && e.t !== r.end.t) drift.push(r.title + " end");
    if (M.siblingClash(doc.eras, { ...r, start: s, end: e })) refused.push(r.title);
  }
  ok("instants survive a delay between load and edit", drift.length === 0, drift.join(", "));
  ok("abutting eras still save after a delay", refused.length === 0, refused.join(", "));
}

/* ---- 12. the fade tail on an ongoing span ----
   An open span used to draw solid to the edge of the screen regardless of
   zoom, which made anything ongoing look like it would run for billions of
   years the moment you zoomed out far enough to see it next to deep time. The
   fade point is a real instant now, proportional to how long the thing has
   already run, so it recedes properly as the view zooms out. */
{
  const now = M.tFromCivil(2026, 1, 1);
  const oneDay = 86400n;

  const life30yr = M.tFromCivil(1996, 1, 1);
  const end30 = M.openFadeEndT(life30yr, now);
  ok("a 30-year-old span fades roughly 30 years out",
     Math.abs(Number(end30 - now) - Number(now - life30yr)) < 10,
     String(Number(end30 - now)));

  const yesterday = now - oneDay;
  ok("something that started yesterday still gets a real fade, not a razor edge",
     M.openFadeEndT(yesterday, now) - now >= BigInt(M.MIN_OPEN_FADE) - 1n);

  const started_now = now;
  ok("something starting this instant is floored, not zero",
     M.openFadeEndT(started_now, now) - now === BigInt(M.MIN_OPEN_FADE));

  const ancient = M.agoY(538.8e6);
  const endAncient = M.openFadeEndT(ancient, now);
  ok("an ancient span's fade is proportional too — deep, not infinite",
     endAncient > now && endAncient < M.MAX_T,
     String(endAncient));
  ok("older spans get a longer fade than younger ones",
     (endAncient - now) > (end30 - now));

  ok("the same age always gives the same fade point, given the same 'now'",
     M.openFadeEndT(life30yr, now) === M.openFadeEndT(life30yr, now));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
