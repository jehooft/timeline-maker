import { parseDateInput, instantToInput } from "./src/time.js";
import { starterDoc, siblingClash } from "./src/model.js";
const doc = starterDoc();
const t0 = Date.now();
while (Date.now() - t0 < 1200) { /* the user works */ }
let drift = 0, refused = 0;
for (const r of doc.eras) {
  const s = parseDateInput(instantToInput(r.start.t, r.start.precision));
  const e = r.end ? parseDateInput(instantToInput(r.end.t, r.end.precision)) : null;
  if (s.t !== r.start.t) drift++;
  if (e && e.t !== r.end.t) drift++;
  if (siblingClash(doc.eras, { ...r, start: s, end: e })) refused++;
}
console.log("  instants moved: " + drift + ",  saves refused: " + refused);
