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

/* ---- 10. the era tree ---- */
{
  const doc = M.starterDoc();
  const eras = doc.eras;
  const byId = new Map(eras.map(r => [r.id, r]));

  /* no two siblings anywhere in the sample data overlap */
  let clashes = [];
  for (const r of eras) { const c = M.siblingClash(eras, r); if (c) clashes.push(r.title + " / " + c.title); }
  ok("sample eras have no sibling overlaps", clashes.length === 0, clashes.join(" | "));

  /* abutting is allowed: an era starting exactly where another ends */
  const arc = eras.find(r => r.id === "r_arc"), con = eras.find(r => r.id === "r_con");
  ok("abutting eras share an exact instant", M.eraEnd(arc) === M.eraStart(con));
  ok("abutting eras do not clash", M.siblingClash(eras, con) === null);

  /* a genuine overlap is caught */
  const bad = { id: "__x__", cat: "vg", parent: null, title: "Bad",
                start: { t: M.tFromCivil(1980,1,1), precision: "year" },
                end: { t: M.tFromCivil(1990,1,1), precision: "year" } };
  ok("overlapping sibling is rejected", M.siblingClash(eras, bad) !== null);
  /* nesting it under the era it overlaps resolves the clash (no sub-eras there) */
  ok("nesting resolves the overlap", M.siblingClash(eras, { ...bad, parent: "r_arc" }) === null);
  /* but it still clashes if the chosen parent already has sub-eras in the way */
  ok("nesting under a crowded parent still clashes",
     M.siblingClash(eras, { ...bad, parent: "r_con" }) !== null);
  /* clashes never cross category boundaries */
  ok("clashes stay within one category", M.siblingClash(eras, bad).cat === "vg");
  ok("an era in a free stretch is accepted",
     M.siblingClash(eras, { ...bad, cat: "hist",
       start: { t: M.tFromCivil(-5000,1,1), precision: "year" },
       end: { t: M.tFromCivil(-4000,1,1), precision: "year" } }) === null);

  /* ---- adding a broader era over ones that already exist ----
     The reported dead end: with "Mesozoic" already at the top level, adding
     "Phanerozoic" over it clashed, and the only offered fix was to nest the
     new era under the old one — backwards, since the new one is the container.
     Overlap purely by containment must be resolvable the other way. */
  {
    const era2 = (id, title, from, to) => ({
      id, cat: "z", parent: null, title,
      start: { t: M.agoY(from), precision: "myr" },
      end: to === null ? null : { t: M.agoY(to), precision: "myr" },
    });
    const mes = era2("m", "Mesozoic", 251.9e6, 66e6);
    const phan = era2("p", "Phanerozoic", 538.8e6, null);

    ok("the broader era still reports a clash", M.siblingClash([mes], phan) !== null);
    const adopt = M.containedSiblings([mes], phan);
    ok("containment offers a way out", adopt !== null && adopt.length === 1 && adopt[0].id === "m",
       JSON.stringify(adopt && adopt.map((r) => r.id)));
    const after = [{ ...mes, parent: "p" }, phan];
    ok("adopting resolves it for the new era", M.siblingClash(after, phan) === null);
    ok("and for the adopted one", M.siblingClash(after, after[0]) === null);
    ok("the adopted era sits inside its new parent", M.escapesParent(after, after[0]) === null);
    ok("depth follows", M.eraDepth(after[0], new Map(after.map((r) => [r.id, r]))) === 1);

    /* several at once — re-adding Mesozoic over its own periods */
    const tri = era2("t", "Triassic", 251.9e6, 201.4e6);
    const jur = era2("j", "Jurassic", 201.4e6, 145e6);
    const cre = era2("c", "Cretaceous", 145e6, 66e6);
    const many = M.containedSiblings([tri, jur, cre], mes);
    ok("every covered sibling is offered", many !== null && many.length === 3,
       JSON.stringify(many && many.map((r) => r.id)));

    /* a candidate that cuts through a sibling is a real conflict */
    ok("partial overlap stays unresolvable",
       M.containedSiblings([mes], era2("x", "Partial", 300e6, 150e6)) === null);
    ok("partial overlap the other way too",
       M.containedSiblings([mes], era2("x", "Partial", 150e6, 20e6)) === null);
    /* exact abutment is not an overlap at all, so there is nothing to adopt */
    ok("an abutting neighbour is not adopted",
       M.containedSiblings([mes], era2("x", "Cenozoic", 66e6, 0)) === null);
    ok("a disjoint era offers nothing", M.containedSiblings([mes], era2("x", "Later", 30e6, 10e6)) === null);
    /* identical bounds count as contained — the new era can still take it in */
    ok("an identical range is containment",
       (M.containedSiblings([mes], era2("x", "Same", 251.9e6, 66e6)) || []).length === 1);

    /* the tree's own boundaries still apply */
    ok("another category is never adopted",
       M.containedSiblings([{ ...mes, cat: "other" }], phan) === null);
    ok("an era at another level is never adopted",
       M.containedSiblings([{ ...mes, parent: "somewhere" }], phan) === null);
    ok("an era never adopts itself", M.containedSiblings([phan], phan) === null);
  }

  /* depth */
  ok("top-level era is depth 0", M.eraDepth(byId.get("r_phan"), byId) === 0);
  ok("sub-era is depth 1", M.eraDepth(byId.get("r_mes"), byId) === 1);
  ok("sub-sub-era is depth 2", M.eraDepth(byId.get("r_jur"), byId) === 2);
  ok("index records max depth per category", M.buildIndex(doc).depthByCat.get("earth") === 2,
     String(M.buildIndex(doc).depthByCat.get("earth")));

  /* a cycle must not hang the depth walk */
  const cyc = [{ id: "a", parent: "b", cat: "x" }, { id: "b", parent: "a", cat: "x" }];
  const cycById = new Map(cyc.map(r => [r.id, r]));
  let hung = false;
  try { M.eraDepth(cyc[0], cycById); } catch (e) { hung = true; }
  ok("cyclic parents terminate", !hung);

  /* descendants, so the parent picker can't create a cycle */
  const desc = M.descendantsOf(eras, "r_phan");
  ok("descendants include grandchildren", desc.has("r_jur") && desc.has("r_mes") && desc.has("r_phan"));
  ok("descendants exclude siblings", !desc.has("r_arch"));

  /* containment is a soft warning, not an error */
  ok("child inside parent is fine", M.escapesParent(eras, byId.get("r_mes")) === null);
  const escapee = { ...byId.get("r_mes"), start: { t: M.tFromCivil(-5000000000,1,1), precision: "gyr" } };
  ok("child reaching outside parent is flagged", M.escapesParent(eras, escapee) !== null);

  /* every era sits inside its parent in the sample data */
  const escapes = eras.filter(r => M.escapesParent(eras, r)).map(r => r.title);
  ok("sample sub-eras stay inside their parents", escapes.length === 0, escapes.join(", "));

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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
