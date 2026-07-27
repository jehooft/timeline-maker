/* time.js — the instant model.
   Instants are BigInt seconds from the Unix epoch, so precision holds from the
   second to billions of years. Calendar conversion, formatting and the date
   parser all live here. */

/* ---------------------------------------------------------------- time core */

export const DAY_S = 86400n;
export const JULIAN_YEAR = 31557600;
export const MEAN_YEAR = 31556952;
export const MAX_T = 10n ** 18n;
export const MIN_SPP = 0.01;
export const MAX_SPP = 1e15;

export function bfloordiv(a, b) {
  let q = a / b;
  if (a % b !== 0n && (a < 0n) !== (b < 0n)) q -= 1n;
  return q;
}
export function toBig(x) {
  if (!Number.isFinite(x)) return 0n;
  return BigInt(Math.round(x));
}
export function clampT(t) {
  if (t > MAX_T) return MAX_T;
  if (t < -MAX_T) return -MAX_T;
  return t;
}
export function bmax(a, b) { return a > b ? a : b; }

export function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}
export function daysFromCivil(y, m, d) {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function tFromCivil(y, m = 1, d = 1, hh = 0, mm = 0, ss = 0) {
  return BigInt(daysFromCivil(y, m, d)) * DAY_S + BigInt(hh * 3600 + mm * 60 + ss);
}
export function civilFromT(t) {
  const days = bfloordiv(t, DAY_S);
  const sod = Number(t - days * DAY_S);
  const c = civilFromDays(Number(days));
  return { ...c, hh: Math.floor(sod / 3600), mm: Math.floor((sod % 3600) / 60), ss: sod % 60 };
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

export function nowT() { return BigInt(Math.floor(Date.now() / 1000)); }

/* Relative deep-time dates ("13.8 Gya") are anchored to a FIXED datum, not to
   the current clock. Anchoring to "now" made the same phrase resolve a little
   later on every keystroke, so re-saving an era nudged its end past the start
   of the next one and the two stopped abutting. 1950 is the standard Before
   Present datum, and at these magnitudes the offset is invisible.
   Each unit is also quantised to the resolution the editor prints it at, so
   parse(print(t)) === t exactly and two eras written as the same phrase land
   on the same instant. */
export const PRESENT_REF = tFromCivil(1950, 1, 1);
export const DEEP_STEP = { gyr: 1e6, myr: 1e4, kyr: 1e2, year: 1 };
export const yearsAgoRef = (t) => Number(PRESENT_REF - t) / JULIAN_YEAR;
export function fromYearsAgo(yearsAgo, precision) {
  const step = DEEP_STEP[precision] || 1;
  const q = Math.round(yearsAgo / step) * step;
  let t = clampT(PRESENT_REF - toBig(q * JULIAN_YEAR));
  if (precision === "year") t = tFromCivil(civilFromT(t).y, 1, 1);
  return t;
}
export function fmtYear(y) {
  if (y <= 0) { const v = 1 - y; return (v >= 10000 ? v.toLocaleString("en-US") : v) + " BCE"; }
  return y >= 10000 ? y.toLocaleString("en-US") : String(y);
}
export function pad(n, w = 2) { return String(n).padStart(w, "0"); }

export function deepLabel(yearsAgo, stepYears) {
  let div, suffix;
  if (stepYears >= 1e9) { div = 1e9; suffix = "Gy"; }
  else if (stepYears >= 1e6) { div = 1e6; suffix = "My"; }
  else { div = 1e3; suffix = "ky"; }
  const dec = Math.max(0, Math.min(3, Math.ceil(Math.log10(div / stepYears))));
  const v = yearsAgo / div;
  if (Math.abs(v) < Math.pow(10, -dec) / 2) return "present";
  const num = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return v > 0 ? num + " " + suffix + "a" : "+" + num + " " + suffix + "r";
}

export function fmtDur(sec) {
  const a = Math.abs(sec);
  const sig = (v, u) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US")) + " " + u;
  if (a < 1) return a.toPrecision(2) + " s";
  if (a < 90) return sig(a, "s");
  if (a < 5400) return sig(a / 60, "min");
  if (a < 172800) return sig(a / 3600, "h");
  if (a < 5259600) return sig(a / 86400, "d");
  if (a < 63113904) return sig(a / 2629800, "mo");
  if (a < 3.15e10) return sig(a / MEAN_YEAR, "yr");
  if (a < 3.15e13) return sig(a / MEAN_YEAR / 1e3, "kyr");
  if (a < 3.15e16) return sig(a / MEAN_YEAR / 1e6, "Myr");
  return sig(a / MEAN_YEAR / 1e9, "Gyr");
}

/* ------------------------------------------------------------- date parsing */

export const PREC_SEC = {
  second: 1, minute: 60, hour: 3600, day: 86400, month: 2629800,
  year: MEAN_YEAR, decade: MEAN_YEAR * 10, century: MEAN_YEAR * 100,
  kyr: MEAN_YEAR * 1e3, myr: MEAN_YEAR * 1e6, gyr: MEAN_YEAR * 1e9,
};

export function parseDateInput(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  if (/^now$/i.test(s)) return { t: nowT(), precision: "second" };

  let m = s.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*(gya|ga|mya|ma|kya|ka|ybp|bp|ya|y|yr|yrs|years?(?:\s*ago)?)$/i);
  if (m) {
    const v = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    let mult = 1, precision = "year";
    if (u === "gya" || u === "ga") { mult = 1e9; precision = "gyr"; }
    else if (u === "mya" || u === "ma") { mult = 1e6; precision = "myr"; }
    else if (u === "kya" || u === "ka") { mult = 1e3; precision = "kyr"; }
    /* A date is stored at the start of its precision bucket (plan section 3.5),
       so "10000 BP" means that whole year, not an arbitrary instant inside it. */
    if (precision !== "year") return { t: fromYearsAgo(v * mult, precision), precision };
    if (u === "bp" || u === "ybp") return { t: fromYearsAgo(v, "year"), precision };
    let t = clampT(nowT() - toBig(v * JULIAN_YEAR));
    return { t: tFromCivil(civilFromT(t).y, 1, 1), precision };
  }

  m = s.match(/^(\d{1,10})\s*(bce|bc|ce|ad)$/i);
  if (m) {
    const v = parseInt(m[1], 10);
    const era = m[2].toLowerCase();
    const y = (era === "bce" || era === "bc") ? 1 - v : v;
    return { t: clampT(tFromCivil(y, 1, 1)), precision: "year" };
  }

  m = s.match(/^([+-]?\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*Z?$/i);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = m[2] ? parseInt(m[2], 10) : 1;
    const d = m[3] ? parseInt(m[3], 10) : 1;
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? parseInt(m[5], 10) : 0;
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
    const precision = m[6] ? "second" : m[4] ? "minute" : m[3] ? "day" : m[2] ? "month" : "year";
    return { t: clampT(tFromCivil(y, mo, d, hh, mi, ss)), precision };
  }
  return null;
}

export function fmtInstant(t, precision = "second") {
  const c = civilFromT(t);
  const yearsAgo = yearsAgoRef(t);
  switch (precision) {
    case "gyr": return deepLabel(yearsAgo, 1e8);
    case "myr": return deepLabel(yearsAgo, 1e5);
    case "kyr": return deepLabel(yearsAgo, 1e2);
    case "century": case "decade": case "year": return fmtYear(c.y);
    case "month": return MONTHS_LONG[c.m - 1] + " " + fmtYear(c.y);
    case "day": return c.d + " " + MONTHS_LONG[c.m - 1] + " " + fmtYear(c.y);
    case "hour": case "minute":
      return c.d + " " + MONTHS[c.m - 1] + " " + fmtYear(c.y) + ", " + pad(c.hh) + ":" + pad(c.mm) + " UTC";
    default:
      return c.d + " " + MONTHS[c.m - 1] + " " + fmtYear(c.y) + ", " + pad(c.hh) + ":" + pad(c.mm) + ":" + pad(c.ss) + " UTC";
  }
}

/* Instant -> a string the parser will read back identically. Used to seed the
   editor when adding an item at the current viewport centre. */
export function instantToInput(t, precision) {
  const c = civilFromT(t);
  const ya = yearsAgoRef(t);
  switch (precision) {
    case "gyr": return (ya / 1e9).toFixed(3) + " Gya";
    case "myr": return (ya / 1e6).toFixed(2) + " Mya";
    case "kyr": return (ya / 1e3).toFixed(1) + " kya";
    case "year": return c.y <= 0 ? 1 - c.y + " BCE" : String(c.y);
    case "month": return c.y + "-" + pad(c.m);
    case "day": return c.y + "-" + pad(c.m) + "-" + pad(c.d);
    case "hour": case "minute":
      return c.y + "-" + pad(c.m) + "-" + pad(c.d) + "T" + pad(c.hh) + ":" + pad(c.mm);
    default:
      return c.y + "-" + pad(c.m) + "-" + pad(c.d) + "T" + pad(c.hh) + ":" + pad(c.mm) + ":" + pad(c.ss);
  }
}
