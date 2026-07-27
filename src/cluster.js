/* cluster.js — what to do when thousands of events land on one pixel.

   Zoomed far enough out, row packing stops helping: a hundred events inside one
   pixel would open a hundred rows. So events too close together to distinguish
   are merged into a single counted marker. Clicking one zooms to fit what it
   contains, which turns the problem into the navigation route.

   Spans and eras are never clustered — they are the landmarks you navigate by,
   and their extent is still meaningful when their start is not. */

export const CLUSTER_GAP = 14;      // px between symbol centres before merging

/* Important events are never folded in with ordinary ones: the whole point of
   marking an event is that it stays findable when everything around it has
   collapsed. They still merge with each other, so a dense run of important
   events cannot open a thousand rows either. */
export function clusterPoints(items, gap = CLUSTER_GAP) {
  const others = [], plain = [], keyed = [];
  for (const it of items) {
    if (it.isSpan) others.push(it);
    else if (it.important) keyed.push(it);
    else plain.push(it);
  }
  const singles = [...others], clusters = [];
  for (const group of [plain, keyed]) clusterGroup(group, gap, singles, clusters);
  return { singles, clusters };
}

function clusterGroup(points, gap, singles, clusters) {
  if (points.length === 0) return;
  if (points.length === 1) { singles.push(points[0]); return; }

  points.sort((a, b) => a.x1p - b.x1p || (a.key < b.key ? -1 : 1));
  let run = [points[0]];
  const flush = () => {
    if (run.length === 1) { singles.push(run[0]); return; }
    const important = run[0].important;
    let lo = run[0], hi = run[0];
    for (const p of run) {
      if (p.t0 < lo.t0) lo = p;
      if (p.t0 > hi.t0) hi = p;
    }
    const x = (run[0].x1p + run[run.length - 1].x1p) / 2;
    clusters.push({
      key: "cl:" + run[0].key + ":" + run.length,
      isCluster: true, important, members: run, count: run.length,
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
