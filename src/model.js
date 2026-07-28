/* model.js — the document shape, the era tree, the spatial index and the
   row packer. No rendering and no React: this is the part with the rules. */
import { MAX_T, JULIAN_YEAR, clampT, toBig, bmax, tFromCivil, fromYearsAgo } from "./time.js";

/* ------------------------------------------------------------ the document */

export const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 9);
export const D = (t, precision) => ({ t, precision });

/* Sample dates run through the same quantiser the parser uses, so a value
   written twice (one era's end, the next one's start) lands on one instant. */
export const agoY = (y) => fromYearsAgo(y, y >= 1e9 ? "gyr" : y >= 1e6 ? "myr" : y >= 1e3 ? "kyr" : "year");

export const PALETTE = ["#4E92C8", "#A184C4", "#5FA97C", "#E0A64B", "#C46A5A", "#57A8A8",
  "#C08A4A", "#8FA85C", "#D3799C", "#7F8BA8"];

/* Importance is a five-step scale rather than a flag, so an event can outrank
   the ordinary run without being lumped in with the handful that matter most.
   Each step overrules everything below it — for clustering, for which picture
   keeps its lane when room runs out — and Normal is silently the default, the
   same way an event with no colour just takes its category's. */
export const IMP = { TRIVIAL: 0, UNIMPORTANT: 1, NORMAL: 2, IMPORTANT: 3, CRITICAL: 4 };
export const IMP_LEVELS = [
  { v: IMP.TRIVIAL, key: "trivial", label: "Trivial" },
  { v: IMP.UNIMPORTANT, key: "unimportant", label: "Unimportant" },
  { v: IMP.NORMAL, key: "normal", label: "Normal" },
  { v: IMP.IMPORTANT, key: "important", label: "Important" },
  { v: IMP.CRITICAL, key: "critical", label: "Critical" },
];
export const impOf = (it) => (typeof it.imp === "number" ? it.imp : IMP.NORMAL);

/* Eras form a tree per category. Siblings must not overlap; a child sits inside
   its parent. Depth becomes a row in the band's era strip, and every era tints
   the band background beneath it. */
export function starterDoc() {
  const era = (id, cat, parent, title, start, end, color, desc) =>
    ({ id, cat, parent, title, start, end, color, desc });
  return {
    name: "A short history of everything",
    categories: [
      { id: "vg", name: "Videogaming", color: "#4E92C8" },
      { id: "hist", name: "Broad History", color: "#A184C4" },
      { id: "earth", name: "Earth & Life", color: "#5FA97C" },
    ],
    eras: [
      /* Videogaming — three sequential top-level eras, one with sub-eras */
      era("r_arc", "vg", null, "The Age of Arcade", D(tFromCivil(1972, 1, 1), "year"), D(tFromCivil(1983, 1, 1), "year"), "#3E7CB1", "Coin-operated machines dominate, from Pong to the American crash."),
      era("r_con", "vg", null, "The Age of the Console", D(tFromCivil(1983, 1, 1), "year"), D(tFromCivil(2003, 1, 1), "year"), "#4E92C8", "Play moves into the living room. Begins exactly where the arcade era ends, so the two bars meet."),
      era("r_net", "vg", null, "The Networked Age", D(tFromCivil(2003, 1, 1), "year"), null, "#6FB0DC", "Digital distribution and always-online play. No end date, so it runs to the edge of the view."),
      era("r_8bit", "vg", "r_con", "8-bit", D(tFromCivil(1983, 1, 1), "year"), D(tFromCivil(1990, 1, 1), "year"), "#5FA9D8", ""),
      era("r_16bit", "vg", "r_con", "16-bit", D(tFromCivil(1990, 1, 1), "year"), D(tFromCivil(1995, 1, 1), "year"), "#5FA9D8", ""),
      era("r_3d", "vg", "r_con", "3D", D(tFromCivil(1995, 1, 1), "year"), D(tFromCivil(2003, 1, 1), "year"), "#5FA9D8", ""),

      /* Broad History */
      era("r_ant", "hist", null, "Classical antiquity", D(tFromCivil(-799, 1, 1), "year"), D(tFromCivil(476, 1, 1), "year"), "#8B72AE", "Conventional bounds for the Greco-Roman world."),
      era("r_mid", "hist", null, "Middle Ages", D(tFromCivil(476, 1, 1), "year"), D(tFromCivil(1453, 1, 1), "year"), "#A184C4", ""),
      era("r_emo", "hist", null, "Early modern", D(tFromCivil(1453, 1, 1), "year"), D(tFromCivil(1800, 1, 1), "year"), "#B99AD6", ""),
      era("r_mod", "hist", null, "Modern", D(tFromCivil(1800, 1, 1), "year"), null, "#C9AEE2", ""),
      era("r_ind", "hist", "r_mod", "Industrial", D(tFromCivil(1800, 1, 1), "year"), D(tFromCivil(1914, 1, 1), "year"), "#C9AEE2", ""),
      era("r_inf", "hist", "r_mod", "Information", D(tFromCivil(1947, 1, 1), "year"), null, "#C9AEE2", "Siblings may leave gaps between them — they just may not overlap."),

      /* Earth & Life — three levels deep */
      era("r_had", "earth", null, "Hadean", D(agoY(4.54e9), "gyr"), D(agoY(4.0e9), "gyr"), "#7A6A55", ""),
      era("r_arch", "earth", null, "Archean", D(agoY(4.0e9), "gyr"), D(agoY(2.5e9), "gyr"), "#8E6F5E", ""),
      era("r_prot", "earth", null, "Proterozoic", D(agoY(2.5e9), "gyr"), D(agoY(538.8e6), "myr"), "#A67C52", ""),
      era("r_phan", "earth", null, "Phanerozoic", D(agoY(538.8e6), "myr"), null, "#5FA97C", "The eon of visible life."),
      era("r_pal", "earth", "r_phan", "Paleozoic", D(agoY(538.8e6), "myr"), D(agoY(251.9e6), "myr"), "#6FA88C", ""),
      era("r_mes", "earth", "r_phan", "Mesozoic", D(agoY(251.9e6), "myr"), D(agoY(66e6), "myr"), "#7FB88C", ""),
      era("r_cen", "earth", "r_phan", "Cenozoic", D(agoY(66e6), "myr"), null, "#8FC89C", ""),
      era("r_tri", "earth", "r_mes", "Triassic", D(agoY(251.9e6), "myr"), D(agoY(201.4e6), "myr"), "#9ACBA6", ""),
      era("r_jur", "earth", "r_mes", "Jurassic", D(agoY(201.4e6), "myr"), D(agoY(145e6), "myr"), "#9ACBA6", ""),
      era("r_cre", "earth", "r_mes", "Cretaceous", D(agoY(145e6), "myr"), D(agoY(66e6), "myr"), "#9ACBA6", ""),
    ],
    events: [
      { id: "e1", cat: "vg", title: "Pong released", sym: "square", start: D(tFromCivil(1972, 11, 29), "day"), end: null, desc: "Atari's coin-op table tennis game reaches arcades and effectively starts the commercial industry.", tags: ["atari", "arcade"] },
      { id: "e2", cat: "vg", title: "Space Invaders", sym: "triangle", start: D(tFromCivil(1978, 6, 1), "month"), end: null, desc: "Taito's shooter causes a nationwide surge in arcade play in Japan.", tags: ["taito"] },
      { id: "e3", cat: "vg", title: "Pac-Man", sym: "dot", start: D(tFromCivil(1980, 5, 22), "day"), end: null, desc: "Namco's maze chase becomes the highest-grossing arcade game of its era.", tags: ["namco"] },
      { imp: IMP.IMPORTANT, id: "e4", cat: "vg", title: "Donkey Kong released", sym: "star", color: "#E0A64B", start: D(tFromCivil(1981, 7, 9), "day"), end: null, desc: "Nintendo's arcade hit, designed by Shigeru Miyamoto, introduces both Donkey Kong and the character who becomes Mario.", tags: ["nintendo", "arcade"] },
      { id: "e5", cat: "vg", title: "Development of the Famicom", sym: "ring", start: D(tFromCivil(1981, 1, 1), "month"), end: D(tFromCivil(1983, 7, 15), "day"), desc: "Roughly two and a half years from initial concept to Japanese launch.", tags: ["nintendo"] },
      { id: "e6", cat: "vg", title: "NES launches in North America", sym: "flag", start: D(tFromCivil(1985, 10, 18), "day"), end: null, desc: "A limited New York test launch, following the 1983 crash in the American market.", tags: ["nintendo"] },
      { id: "e7", cat: "vg", title: "Game Boy", sym: "square", start: D(tFromCivil(1989, 4, 21), "day"), end: null, desc: "Handheld play goes mainstream on four AA batteries and a monochrome screen.", tags: ["nintendo"] },
      { id: "e8", cat: "vg", title: "PlayStation", sym: "diamond", start: D(tFromCivil(1994, 12, 3), "day"), end: null, desc: "Sony enters the console market with a CD-based system aimed at an older audience.", tags: ["sony"] },
      { id: "e9", cat: "vg", title: "Half-Life", sym: "hex", start: D(tFromCivil(1998, 11, 19), "day"), end: null, desc: "Valve's debut reshapes expectations for narrative in first-person games.", tags: ["valve"] },
      { id: "e10", cat: "vg", title: "Steam launches", sym: "pin", start: D(tFromCivil(2003, 9, 12), "day"), end: null, desc: "Initially a patching tool for Valve's own games; later the dominant PC storefront.", tags: ["valve"] },
      { id: "e11", cat: "vg", title: "Wii", sym: "plus", start: D(tFromCivil(2006, 11, 19), "day"), end: null, desc: "Motion controls pull in an audience well outside the existing player base.", tags: ["nintendo"] },
      { id: "e12", cat: "vg", title: "Minecraft development", sym: "square", color: "#7FB069", start: D(tFromCivil(2009, 5, 17), "day"), end: D(tFromCivil(2011, 11, 18), "day"), desc: "From first public build to the 1.0 release, developed largely in the open.", tags: ["indie"] },
      { id: "h1", cat: "hist", title: "Great Pyramid of Giza", sym: "triangle", start: D(tFromCivil(-2559, 1, 1), "year"), end: D(tFromCivil(-2539, 1, 1), "year"), desc: "Built for Pharaoh Khufu during the Fourth Dynasty. Dates are approximate to within decades.", tags: ["egypt"] },
      { id: "h2", cat: "hist", title: "Roman Empire", sym: "flag", start: D(tFromCivil(-26, 1, 16), "day"), end: D(tFromCivil(476, 9, 4), "day"), desc: "From Octavian receiving the title Augustus to the deposition of Romulus Augustulus in the west.", tags: ["rome"] },
      { id: "h3", cat: "hist", title: "Printing press in Europe", sym: "square", start: D(tFromCivil(1440, 1, 1), "year"), end: null, desc: "Gutenberg's movable-type press. The date is conventional rather than documented.", tags: ["technology"] },
      { id: "h4", cat: "hist", title: "Industrial Revolution", sym: "hex", start: D(tFromCivil(1760, 1, 1), "year"), end: D(tFromCivil(1840, 1, 1), "year"), desc: "Conventional dating for the first phase, centred on Britain.", tags: ["technology"] },
      { imp: IMP.IMPORTANT, id: "h5", cat: "hist", title: "Apollo 11 lunar landing", sym: "star", color: "#E0A64B", start: D(tFromCivil(1969, 7, 20, 20, 17, 40), "second"), end: null, desc: "Touchdown in the Sea of Tranquillity. Stored to the second — zoom all the way in and the marker stays exactly here.", tags: ["space"] },
      { id: "h6", cat: "hist", title: "First ARPANET message", sym: "bolt", start: D(tFromCivil(1969, 10, 29, 22, 30, 0), "minute"), end: null, desc: "Two letters transmitted from UCLA to Stanford before the system crashed.", tags: ["networks"] },
      { id: "h7", cat: "hist", title: "World Wide Web proposal", sym: "ring", start: D(tFromCivil(1989, 3, 12), "day"), end: null, desc: "Tim Berners-Lee circulates his information management proposal at CERN.", tags: ["networks"] },
      { id: "h8", cat: "hist", title: "Fall of the Berlin Wall", sym: "cross", start: D(tFromCivil(1989, 11, 9), "day"), end: null, desc: "Border crossings open after an announcement at an evening press conference.", tags: ["politics"] },
      { id: "d1", cat: "earth", title: "Formation of Earth", sym: "dot", start: D(agoY(4.54e9), "gyr"), end: null, desc: "Accretion from the solar nebula, dated by radiometric analysis of meteorites.", tags: ["geology"] },
      { id: "d2", cat: "earth", title: "Earliest evidence of life", sym: "ring", start: D(agoY(3.7e9), "gyr"), end: null, desc: "Isotopic and structural evidence from Greenland metasedimentary rocks. Contested.", tags: ["biology"] },
      { id: "d3", cat: "earth", title: "Great Oxidation Event", sym: "hex", start: D(agoY(2.4e9), "gyr"), end: D(agoY(2.0e9), "gyr"), desc: "Free oxygen accumulates in the atmosphere following the rise of cyanobacteria.", tags: ["atmosphere"] },
      { imp: IMP.IMPORTANT, id: "d4", cat: "earth", title: "Cambrian explosion", sym: "bolt", start: D(agoY(538.8e6), "myr"), end: null, desc: "Rapid diversification of most major animal phyla in the fossil record.", tags: ["evolution"] },
      { id: "d5", cat: "earth", title: "Age of the dinosaurs", sym: "triangle", color: "#C08A4A", start: D(agoY(233e6), "myr"), end: D(agoY(66e6), "myr"), desc: "From the earliest known dinosaurs in the Carnian to the end-Cretaceous extinction.", tags: ["evolution"] },
      { imp: IMP.CRITICAL, id: "d6", cat: "earth", title: "K–Pg extinction", sym: "cross", color: "#C46A5A", start: D(agoY(66e6), "myr"), end: null, desc: "The Chicxulub impact and its aftermath end roughly three quarters of species.", tags: ["extinction"] },
      { id: "d7", cat: "earth", title: "Homo sapiens appears", sym: "pin", start: D(agoY(300e3), "kyr"), end: null, desc: "Earliest known fossils, from Jebel Irhoud in Morocco.", tags: ["humans"] },
      { id: "d8", cat: "earth", title: "Last glacial period", sym: "diamond", start: D(agoY(115e3), "kyr"), end: D(agoY(11.7e3), "kyr"), desc: "The most recent glacial, ending with the transition into the Holocene.", tags: ["climate"] },
    ],
    images: {},
  };
}

/* ------------------------------------------------------------- the era tree */

export const eraStart = (r) => r.start.t;
export const eraEnd = (r) => (r.end ? r.end.t : MAX_T);

export function eraDepth(era, byId, guard = 0) {
  if (!era || !era.parent || guard > 16) return 0;
  const p = byId.get(era.parent);
  if (!p) return 0;
  return 1 + eraDepth(p, byId, guard + 1);
}

/* Every era that would be orphaned or cyclic if `id` became the parent. */
export function descendantsOf(eras, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of eras) {
      if (!out.has(r.id) && r.parent && out.has(r.parent)) { out.add(r.id); grew = true; }
    }
  }
  return out;
}

/* Siblings may touch end-to-start, but may not overlap. Returns the clash. */
export function siblingClash(eras, candidate) {
  const a0 = eraStart(candidate), a1 = eraEnd(candidate);
  const parent = candidate.parent || null;
  for (const r of eras) {
    if (r.id === candidate.id) continue;
    if (r.cat !== candidate.cat) continue;
    if ((r.parent || null) !== parent) continue;
    if (a0 < eraEnd(r) && eraStart(r) < a1) return r;
  }
  return null;
}

/* Siblings the candidate completely swallows.

   An overlap is only ever reported by `siblingClash`, which offers no way out
   except nesting the *new* era under an existing one. That is backwards when
   the era being added is the broader of the two — adding "Phanerozoic" once
   "Mesozoic" already sits at the top level had no resolution at all. So:
   overlap purely by containment is resolvable in the other direction, by
   adopting the eras it covers as children.

   Returns the covered siblings, or null when any overlap is partial — a
   candidate that runs through the middle of a sibling is a genuine conflict
   that nesting cannot express, and must still be refused. */
export function containedSiblings(eras, candidate) {
  const a0 = eraStart(candidate), a1 = eraEnd(candidate);
  const parent = candidate.parent || null;
  const out = [];
  for (const r of eras) {
    if (r.id === candidate.id) continue;
    if (r.cat !== candidate.cat) continue;
    if ((r.parent || null) !== parent) continue;
    if (a0 < eraEnd(r) && eraStart(r) < a1) {
      if (a0 <= eraStart(r) && eraEnd(r) <= a1) out.push(r);
      else return null;                     // partial overlap: not resolvable
    }
  }
  return out.length ? out : null;
}

/* A soft check: a sub-era normally sits inside the era that contains it. */
export function escapesParent(eras, candidate) {
  if (!candidate.parent) return null;
  const p = eras.find((r) => r.id === candidate.parent);
  if (!p) return null;
  if (eraStart(candidate) < eraStart(p) || eraEnd(candidate) > eraEnd(p)) return p;
  return null;
}

/* --------------------------------------------------------------- the index */
export function buildIndex(doc) {
  const byId = new Map(doc.eras.map((r) => [r.id, r]));
  const items = [];
  for (const e of doc.events) {
    /* An event is a point unless it has an end, or is explicitly marked as
       still running — "ongoing" is what lets a span exist with only a start,
       the same freedom eras already had. */
    const open = !e.end && !!e.ongoing;
    const isSpan = !!e.end || open;
    items.push({ ...e, imp: impOf(e), kind: "event", t0: e.start.t,
      t1: e.end ? e.end.t : (open ? MAX_T : e.start.t), isSpan, open });
  }
  for (const r of doc.eras) {
    items.push({ ...r, kind: "era", depth: eraDepth(r, byId), t0: eraStart(r), t1: eraEnd(r), open: !r.end, isSpan: true });
  }
  items.sort((a, b) => (a.t0 < b.t0 ? -1 : a.t0 > b.t0 ? 1 : a.id < b.id ? -1 : 1));
  const prefixMaxEnd = [];
  let mx = -MAX_T;
  for (const it of items) { mx = bmax(mx, it.t1); prefixMaxEnd.push(mx); }

  /* Strip height per category comes from every era, not just visible ones, so
     band heights stay put while panning. */
  const depthByCat = new Map();
  for (const r of doc.eras) {
    const d = eraDepth(r, byId);
    depthByCat.set(r.cat, Math.max(depthByCat.get(r.cat) ?? -1, d));
  }
  return { items, prefixMaxEnd, depthByCat };
}

export function queryRange(index, t0, t1) {
  const { items, prefixMaxEnd } = index;
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (items[mid].t0 <= t1) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let i = lo - 1; i >= 0; i--) {
    if (prefixMaxEnd[i] < t0) break;
    if (items[i].t1 >= t0) out.push(items[i]);
  }
  return out;
}

/* --------------------------------------------- lane packing for pinned pictures

   The event packer below walks items left to right and remembers only how far
   right each row reaches, which is all that order needs. Pictures cannot use
   it: vertical room is finite, so when the lanes fill up something has to be
   dropped, and it should be the least important picture first. That means
   placing higher-priority pictures first — and the moment the pass stops being
   left-to-right, a right-edge-only row is wrong. One high-priority picture at
   x=800 would reserve everything to its left, so every ordinary picture before
   it fell out of the row with the space beside it plainly empty.

   So a lane here keeps its members and a candidate is tested against all of
   them. Going out of order then costs nothing in layout: a lower-priority
   picture still drops into any gap a higher one leaves. Priority decides only
   who is left without a lane once the lanes run out — and because it is a
   number rather than a flag, "Critical outranks Important outranks Normal..."
   falls out for free, without this file knowing what the numbers mean.

   A picture always takes the lowest lane it fits in, with no memory of where
   it was. An earlier version kept the previous lane to stop rows reshuffling
   while panning, but that is what left a picture stranded one lane up long
   after the room below it had cleared. Movement between lanes is eased by the
   caller instead, which buys the same calm without the staleness. */
export function packLanes(items, gutter, maxRows) {
  const byX = [...items].sort((a, b) => a.x0 - b.x0 || (a.key < b.key ? -1 : 1));
  const lanes = [];
  const clear = (lane, it) =>
    !lane.some((o) => it.x0 < o.x1 + gutter && o.x0 < it.x1 + gutter);
  const hidden = [];
  const put = (it) => {
    for (let r = 0; r < lanes.length; r++) {
      if (clear(lanes[r], it)) { lanes[r].push(it); it.row = r; return; }
    }
    if (lanes.length < maxRows) { lanes.push([it]); it.row = lanes.length - 1; return; }
    it.row = -1;
    hidden.push(it);
  };
  const levels = [...new Set(byX.map((it) => it.prio || 0))].sort((a, b) => b - a);
  for (const lvl of levels) for (const it of byX) if ((it.prio || 0) === lvl) put(it);
  return { items: byX, rows: lanes.length, hidden };
}

/* ------------------------------------------------- row packing with hysteresis
   Items may carry `prio`. Because the pass is greedy — each item takes the
   first row it fits in — processing high-priority items first hands them the
   low rows, and everything else fills the gaps left over. Rows stay free of
   overlaps whatever the order, so priority costs nothing but ordering. */
export function packRows(items, gutter, prevRows, maxDrift = 2) {
  const sorted = [...items].sort(
    (a, b) => (b.prio || 0) - (a.prio || 0) || a.x0 - b.x0 || (a.key < b.key ? -1 : 1));
  const rowMax = [];
  const fits = (r, x0) => rowMax[r] === undefined || rowMax[r] + gutter <= x0;
  for (const it of sorted) {
    let first = 0;
    while (!fits(first, it.x0)) first++;
    const prev = prevRows ? prevRows.get(it.key) : undefined;
    const r = prev !== undefined && prev >= first && prev <= first + maxDrift && fits(prev, it.x0) ? prev : first;
    rowMax[r] = rowMax[r] === undefined ? it.x1 : Math.max(rowMax[r], it.x1);
    it.row = r;
  }
  return { items: sorted, rows: rowMax.length };
}
