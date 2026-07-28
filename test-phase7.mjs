/* Undo/redo, search ranking and clustering. */
import { makeHistory, commit, undo, redo, reset, canUndo, canRedo } from "./src/history.js";
import { searchItems } from "./src/search.js";
import { clusterPoints, CLUSTER_GAP } from "./src/cluster.js";
import { starterDoc, buildIndex } from "./src/model.js";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else { fail++; console.log("  FAIL " + n + (x ? "  " + x : "")); } };

/* ---- history ---- */
{
  let h = makeHistory({ n: 0 });
  ok("nothing to undo at the start", !canUndo(h) && !canRedo(h));
  ok("undoing an empty history is safe", undo(h) === h);
  ok("redoing an empty history is safe", redo(h) === h);

  h = commit(h, { n: 1 });
  h = commit(h, { n: 2 });
  h = commit(h, { n: 3 });
  ok("present is the latest", h.present.n === 3);
  ok("undo is available", canUndo(h));

  h = undo(h);
  ok("undo steps back", h.present.n === 2);
  h = undo(h);
  ok("undo steps back again", h.present.n === 1);
  ok("redo is now available", canRedo(h));
  h = redo(h);
  ok("redo steps forward", h.present.n === 2);

  /* a fresh edit after undoing discards the abandoned future */
  h = commit(h, { n: 99 });
  ok("editing clears the redo branch", !canRedo(h));
  ok("the new edit is present", h.present.n === 99);
  h = undo(h);
  ok("and the branch point is intact", h.present.n === 2);

  /* committing the identical object is not a step */
  const same = h.present;
  ok("committing the same object does nothing", commit(h, same) === h);

  /* tagged edits inside the window coalesce into one step */
  let g = makeHistory({ t: "" });
  g = commit(g, { t: "D" }, "title:e1");
  const depth = g.past.length;
  g = commit(g, { t: "Do" }, "title:e1");
  g = commit(g, { t: "Don" }, "title:e1");
  g = commit(g, { t: "Donk" }, "title:e1");
  ok("typing coalesces into one step", g.past.length === depth, "depth " + g.past.length);
  ok("but keeps the latest text", g.present.t === "Donk");
  g = undo(g);
  ok("one undo clears the whole burst", g.present.t === "", JSON.stringify(g.present));

  /* a different tag starts a new step */
  let f = makeHistory({ v: 0 });
  f = commit(f, { v: 1 }, "a");
  f = commit(f, { v: 2 }, "b");
  ok("a different tag is a separate step", f.past.length === 2);

  /* the stack is bounded */
  let big = makeHistory({ i: 0 });
  for (let i = 1; i <= 200; i++) big = commit(big, { i });
  ok("history is capped", big.past.length <= 60, "depth " + big.past.length);
  ok("the newest states are the ones kept", big.present.i === 200);

  /* switching timelines wipes the stack */
  ok("reset clears undo", !canUndo(reset({ x: 1 })));
}

/* ---- search ---- */
{
  const doc = starterDoc();
  const index = buildIndex(doc);
  const titles = (q) => searchItems(index, doc, q).map((i) => i.title);

  ok("empty query returns nothing", searchItems(index, doc, "   ").length === 0);
  ok("finds an exact title", titles("Donkey Kong")[0] === "Donkey Kong released");
  ok("is case insensitive", titles("donkey kong")[0] === "Donkey Kong released");
  ok("matches a prefix", titles("pac")[0] === "Pac-Man");
  ok("matches mid-word too", titles("kong").length > 0);
  ok("finds eras as well as events", titles("Jurassic").includes("Jurassic"));
  ok("searches descriptions", titles("Miyamoto").includes("Donkey Kong released"));
  ok("searches tags", titles("nintendo").length >= 4, String(titles("nintendo").length));
  ok("searches category names", titles("Videogaming").length > 5);
  ok("all terms must match", titles("donkey jurassic").length === 0);
  ok("multi-term narrows", titles("age console")[0] === "The Age of the Console", titles("age console")[0]);
  ok("nonsense finds nothing", titles("qqzzxx").length === 0);
  ok("a title beats a description", titles("Steam")[0] === "Steam launches");
  ok("results are capped", searchItems(index, doc, "e", 5).length <= 5);
}

/* ---- clustering ---- */
{
  const mk = (i, x, isSpan = false) => ({
    key: "k" + i, id: "k" + i, x1p: x, x2p: isSpan ? x + 50 : x,
    t0: BigInt(i * 1000), t1: BigInt(i * 1000), isSpan, cat: "c",
  });

  /* well separated: nothing merges */
  const spread = [mk(1, 0), mk(2, 100), mk(3, 200)];
  const a = clusterPoints(spread);
  ok("separated points stay separate", a.singles.length === 3 && a.clusters.length === 0);

  /* piled up: one marker */
  const piled = Array.from({ length: 40 }, (_, i) => mk(i, 500 + i * 0.2));
  const b = clusterPoints(piled);
  ok("a pile becomes one cluster", b.clusters.length === 1, JSON.stringify(b.clusters.length));
  ok("the cluster counts everything", b.clusters[0].count === 40);
  ok("nothing is left loose", b.singles.length === 0);
  ok("the cluster spans its members", b.clusters[0].t0 === 0n && b.clusters[0].t1 === 39000n);

  /* two piles stay two */
  const two = [...Array.from({ length: 5 }, (_, i) => mk(i, i)),
               ...Array.from({ length: 5 }, (_, i) => mk(i + 10, 400 + i))];
  ok("distinct piles stay distinct", clusterPoints(two).clusters.length === 2);

  /* spans are never clustered, however dense */
  const spans = Array.from({ length: 20 }, (_, i) => mk(i, 300 + i * 0.1, true));
  const c = clusterPoints(spans);
  ok("spans are never clustered", c.clusters.length === 0 && c.singles.length === 20);

  /* a lone point is not a cluster of one */
  ok("a single point is left alone", clusterPoints([mk(1, 0)]).clusters.length === 0);
  ok("no items is handled", clusterPoints([]).singles.length === 0);

  /* every item is accounted for, always */
  const mixed = [...piled, ...spans, ...spread];
  const d = clusterPoints(mixed);
  const held = d.singles.length + d.clusters.reduce((n, cl) => n + cl.count, 0);
  ok("no item is ever lost", held === mixed.length, held + " of " + mixed.length);

  /* the gap threshold is respected */
  const edge = [mk(1, 0), mk(2, CLUSTER_GAP - 1)];
  ok("just inside the gap merges", clusterPoints(edge).clusters.length === 1);
  const far = [mk(1, 0), mk(2, CLUSTER_GAP + 1)];
  ok("just outside the gap does not", clusterPoints(far).clusters.length === 0);

  /* ---- the tightest pair inside a cluster ----
     Clicking a cluster zooms until its members come apart, and it is the
     closest pair that decides when that happens — not the cluster's extent,
     which is about one pixel wide and used to send the zoom into deep time. */
  const at = (i, x, t) => ({ ...mk(i, x), t0: BigInt(t), t1: BigInt(t) });
  ok("evenly spaced members report the spacing",
     clusterPoints([mk(0, 0), mk(1, 1), mk(2, 2)]).clusters[0].minGap === 1000);
  ok("the smallest gap wins, not the average",
     clusterPoints([at(0, 0, 0), at(1, 1, 10), at(2, 2, 9000)]).clusters[0].minGap === 10);
  ok("order on screen does not matter",
     clusterPoints([at(0, 0, 9000), at(1, 1, 10), at(2, 2, 0)]).clusters[0].minGap === 10);
  ok("coincident members report no gap at all",
     clusterPoints([at(0, 0, 500), at(1, 1, 500)]).clusters[0].minGap === 0);
  ok("duplicates alongside a real gap still report the gap",
     clusterPoints([at(0, 0, 500), at(1, 1, 500), at(2, 2, 700)]).clusters[0].minGap === 200);
}

/* ---- importance and clustering ----
   Events only cluster with events of the same importance level, and Critical
   never clusters at all — even with other Critical events. */
{
  const TRIVIAL = 0, UNIMPORTANT = 1, NORMAL = 2, IMPORTANT = 3, CRITICAL = 4;
  const mk = (i, x, imp = NORMAL) => ({
    key: "k" + i, id: "k" + i, x1p: x, x2p: x,
    t0: BigInt(i * 1000), t1: BigInt(i * 1000), isSpan: false, imp, cat: "c",
  });

  /* the core rule: never merged with a different level */
  const mixed = [mk(1, 0), mk(2, 2), mk(3, 4, IMPORTANT), mk(4, 6), mk(5, 8, IMPORTANT)];
  const r = clusterPoints(mixed);
  for (const cl of r.clusters) {
    ok("a cluster is uniformly one importance level",
       cl.members.every((m) => m.imp === cl.members[0].imp),
       cl.members.map((m) => m.imp).join(","));
  }
  const marked = r.clusters.filter((c) => c.imp === IMPORTANT);
  ok("Important events cluster only with each other",
     marked.every((c) => c.members.every((m) => m.imp === IMPORTANT)));
  ok("the Normal ones still cluster", r.clusters.some((c) => c.imp === NORMAL));
  ok("nothing is lost when mixed",
     r.singles.length + r.clusters.reduce((n, c) => n + c.count, 0) === mixed.length);

  /* a lone Important event among a Normal pile stays a single */
  const pile = [...Array.from({ length: 20 }, (_, i) => mk(i, i * 0.3)), mk(99, 3, IMPORTANT)];
  const p2 = clusterPoints(pile);
  ok("a lone Important event is never absorbed into a Normal pile",
     p2.singles.some((s) => s.id === "k99"), p2.singles.map((s) => s.id).join(","));

  /* dense Important events still merge with each other, so rows stay bounded */
  const many = Array.from({ length: 30 }, (_, i) => mk(i, i * 0.2, IMPORTANT));
  const m3 = clusterPoints(many);
  ok("dense Important events still merge", m3.clusters.length === 1 && m3.clusters[0].count === 30);
  ok("and the merged marker is flagged Important", m3.clusters[0].imp === IMPORTANT);

  /* Critical is the exception: it never clusters, not even with itself */
  const crits = Array.from({ length: 12 }, (_, i) => mk(i, i * 0.2, CRITICAL));
  const c1 = clusterPoints(crits);
  ok("dense Critical events never merge", c1.clusters.length === 0 && c1.singles.length === 12);

  /* every one of the five levels stays with its own kind */
  const allLevels = [
    ...Array.from({ length: 6 }, (_, i) => mk(i, i * 0.2, TRIVIAL)),
    ...Array.from({ length: 6 }, (_, i) => mk(100 + i, 20 + i * 0.2, UNIMPORTANT)),
    ...Array.from({ length: 6 }, (_, i) => mk(200 + i, 40 + i * 0.2, NORMAL)),
    ...Array.from({ length: 6 }, (_, i) => mk(300 + i, 60 + i * 0.2, IMPORTANT)),
  ];
  const c2 = clusterPoints(allLevels);
  ok("four separate levels give four separate clusters", c2.clusters.length === 4,
     c2.clusters.map((c) => c.imp + ":" + c.count).join(" "));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
