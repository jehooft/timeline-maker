/* ticks.js — the ruler ladder: choosing a step for the current zoom and
   generating calendar-aligned ticks with labels. */
import { DAY_S, MEAN_YEAR, bfloordiv, civilFromT, tFromCivil, fmtYear, pad,
         deepLabel, yearsAgoRef, MONTHS } from "./time.js";

/* --------------------------------------------------------------- tick ladder */

export const LADDER = (() => {
  const L = [];
  const push = (u, n, approx, md) => L.push({ u, n, approx, md });
  [[1, 0], [2, 2], [5, 5], [10, 5], [15, 3], [30, 6]].forEach(([n, md]) => push("sec", n, n, md));
  [[1, 6], [2, 4], [5, 5], [10, 5], [15, 3], [30, 6]].forEach(([n, md]) => push("sec", n * 60, n * 60, md));
  [[1, 6], [2, 4], [3, 3], [6, 6], [12, 4]].forEach(([n, md]) => push("sec", n * 3600, n * 3600, md));
  push("sec", 86400, 86400, 4);
  push("sec", 604800, 604800, 7);
  [[1, 0], [3, 3], [6, 6]].forEach(([n, md]) => push("month", n, n * 2629800, md));
  for (let e = 0; e <= 10; e++) {
    for (const mant of [1, 2, 5]) {
      const n = mant * Math.pow(10, e);
      if (n > 5e10) break;
      push("year", n, n * MEAN_YEAR, mant === 2 ? 4 : 5);
    }
  }
  return L;
})();

export function pickStep(targetSec) {
  for (const e of LADDER) if (e.approx >= targetSec) return e;
  return LADDER[LADDER.length - 1];
}
export function precisionForStep(step) {
  if (step.u === "year") return step.n >= 1e9 ? "gyr" : step.n >= 1e6 ? "myr" : step.n >= 1e3 ? "kyr" : "year";
  if (step.u === "month") return "month";
  return step.n >= 86400 ? "day" : step.n >= 60 ? "minute" : "second";
}

export function majorTicks(step, t0, t1) {
  const out = [];
  const GUARD = 4000;
  if (step.u === "sec") {
    const s = BigInt(step.n);
    let t = bfloordiv(t0, s) * s;
    while (t <= t1 && out.length < GUARD) { out.push(t); t += s; }
    if (out.length) { out.unshift(out[0] - s); out.push(out[out.length - 1] + s); }
  } else if (step.u === "month") {
    const c = civilFromT(t0);
    let mi = c.y * 12 + (c.m - 1);
    mi = Math.floor(mi / step.n) * step.n - step.n;
    while (out.length < GUARD) {
      const y = Math.floor(mi / 12);
      const mo = mi - y * 12 + 1;
      const t = tFromCivil(y, mo, 1);
      out.push(t);
      if (t > t1) break;
      mi += step.n;
    }
  } else {
    let y = civilFromT(t0).y;
    y = Math.floor(y / step.n) * step.n - step.n;
    while (out.length < GUARD) {
      const t = tFromCivil(y, 1, 1);
      out.push(t);
      if (t > t1) break;
      y += step.n;
    }
  }
  return out;
}

export function tickLabel(t, step) {
  const c = civilFromT(t);
  if (step.u === "sec") {
    if (step.n < 60) return pad(c.hh) + ":" + pad(c.mm) + ":" + pad(c.ss);
    if (step.n < 86400) return pad(c.hh) + ":" + pad(c.mm);
    if (c.d === 1 && c.m === 1) return fmtYear(c.y);
    return c.d + " " + MONTHS[c.m - 1];
  }
  if (step.u === "month") return c.m === 1 ? fmtYear(c.y) : MONTHS[c.m - 1] + " " + fmtYear(c.y);
  if (step.n >= 10000) return deepLabel(yearsAgoRef(t), step.n);
  return fmtYear(c.y);
}
