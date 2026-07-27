/* search.js — finding an item by name.

   Small enough to scan linearly: a few thousand items times a handful of terms
   is well inside a frame. Scoring is deliberately plain — a prefix match beats a
   word-start match beats a substring — because a clever ranking that surprises
   people is worse than a dull one they can predict. */

const norm = (s) => (s || "").toLowerCase();

function scoreOne(hay, needle) {
  if (!hay) return 0;
  const i = hay.indexOf(needle);
  if (i < 0) return 0;
  if (i === 0) return 100 - Math.min(40, hay.length - needle.length);
  if (/[\s\-–—(:,.]/.test(hay[i - 1])) return 70 - Math.min(30, hay.length - needle.length);
  return 40;
}

export function searchItems(index, doc, query, limit = 40) {
  const q = norm(query).trim();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const catName = new Map(doc.categories.map((c) => [c.id, norm(c.name)]));
  const out = [];

  for (const it of index.items) {
    const title = norm(it.title);
    const desc = norm(it.desc);
    const tags = (it.tags || []).map(norm).join(" ");
    const cat = catName.get(it.cat) || "";
    let total = 0, matchedAll = true;

    for (const t of terms) {
      const s = Math.max(
        scoreOne(title, t) * 3,
        scoreOne(tags, t) * 2,
        scoreOne(cat, t) * 1.5,
        scoreOne(desc, t) * 0.6,
      );
      if (!s) { matchedAll = false; break; }
      total += s;
    }
    if (!matchedAll) continue;
    if (it.kind === "era") total += 8;          // eras are landmarks; surface them
    if (it.important) total += 12;             // as are events the user marked
    out.push({ item: it, score: total });
  }

  out.sort((a, b) => b.score - a.score || (a.item.t0 < b.item.t0 ? -1 : 1));
  return out.slice(0, limit).map((r) => r.item);
}
