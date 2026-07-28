/* cluster.js — what to do when thousands of events land on one pixel.

   Zoomed far enough out, row packing stops helping: a hundred events inside one
   pixel would open a hundred rows. So events too close together to distinguish
   are merged into a single counted marker. Clicking one zooms to fit what it
   contains, which turns the problem into the navigation route.

   Spans and eras are never clustered — they are the landmarks you navigate by,
   and their extent is still meaningful when their start is not. */
import { IMP } from "./model.js";

export const CLUSTER_GAP = 14;      // px between symbol centres before merging

/* Events only cluster with events of the same importance level: a point that
   matters is never hidden inside a pile of ones that don't, and — as
   important as that sounds — bundling a Critical event in with Normal ones
   would bury it just the same. Critical goes one step further and never
   clusters at all, even with other Critical events, matching how the mark is
   meant to work: always its own, findable thing on the timeline. */
export function clusterPoints(items, gap = CLUSTER_GAP) {
  const others = [];
  const byLevel = new Map();
  for (const it of items) {
    const lvl = it.imp ?? IMP.NORMAL;
    if (it.isSpan || lvl === IMP.CRITICAL) { others.push(it); continue; }
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(it);
  }
  const singles = [...others], clusters = [];
  for (const group of byLevel.values()) clusterGroup(group, gap, singles, clusters);
  return { singles, clusters };
}

function clusterGroup(points, gap, singles, clusters) {
  if (points.length === 0) return;
  if (points.length === 1) { singles.push(points[0]); return; }

  points.sort((a, b) => a.x1p - b.x1p || (a.key < b.key ? -1 : 1));
  let run = [points[0]];
  const flush = () => {
    if (run.length === 1) { singles.push(run[0]); return; }
    const imp = run[0].imp ?? IMP.NORMAL;    // uniform within a run: same-level grouping guarantees it
    let lo = run[0], hi = run[0];
    for (const p of run) {
      if (p.t0 < lo.t0) lo = p;
      if (p.t0 > hi.t0) hi = p;
    }
    /* The tightest pair inside the run. Clicking a cluster zooms until its
       members separate, and it is this smallest gap — not the cluster's whole
       span — that decides when that happens. Zero means two members share an
       instant and no amount of zoom will part them. */
    const ts = run.map((p) => p.t0).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let minGap = Infinity;
    for (let i = 1; i < ts.length; i++) {
      const d = Number(ts[i] - ts[i - 1]);
      if (d > 0 && d < minGap) minGap = d;
    }
    if (!Number.isFinite(minGap)) minGap = 0;

    const x = (run[0].x1p + run[run.length - 1].x1p) / 2;
    clusters.push({
      key: "cl:" + run[0].key + ":" + run.length,
      isCluster: true, imp, members: run, count: run.length, minGap,
      cat: run[0].cat, x1p: x, x2p: x, t0: lo.t0, t1: hi.t0,
      x0: x - 13, x1: x + 13,
    });
  };
  for (let i = 1; i < points.length; i++) {
    if (points[i].x1p - run[run.length - 1].x1p <= gap) run.push(points[i]);
    else { flush(); run = [points[i]]; }
  }
  flush();
}
