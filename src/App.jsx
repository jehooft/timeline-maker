/* App.jsx — the timeline surface itself: viewport maths, the canvas renderer,
   hit testing, interaction, and the wiring between all of the above. */
import React, { useRef, useEffect, useState, useMemo, useReducer, useCallback } from "react";
import {
  MAX_T, PREC_SEC, MIN_SPP, MAX_SPP, clampT, toBig, bmax, nowT, tFromCivil,
  fmtInstant, fmtDur, parseDateInput, instantToInput, openFadeEndT,
} from "./time.js";
import { pickStep, majorTicks, tickLabel, precisionForStep } from "./ticks.js";
import { drawSymbol } from "./symbols.jsx";
import { processImage, externalImage } from "./images.js";
import {
  uid, PALETTE, starterDoc, buildIndex, queryRange, packRows, packLanes, siblingClash,
  IMP,
} from "./model.js";
import { ScaleRail } from "./ui/ScaleRail.jsx";
import { DetailCard } from "./ui/DetailCard.jsx";
import { Editor } from "./ui/Editor.jsx";
import { ItemsPanel } from "./ui/ItemsPanel.jsx";
import { STYLES } from "./ui/styles.js";
import { Library } from "./ui/Library.jsx";
import {
  isPersistent, onStorageChange, probeStorage, loadIndex, loadDoc, saveDoc, deleteDoc,
  loadAppState, saveAppState,
  encodeDoc, decodeDoc, downloadFile, safeFileName,
} from "./storage.js";
import { importCSV, exportCSV, countsDroppedImages } from "./csv.js";
import { ContextMenu } from "./ui/ContextMenu.jsx";
import { makeHistory, commit, undo, redo, reset, canUndo, canRedo } from "./history.js";
import { searchItems } from "./search.js";
import { clusterPoints, CLUSTER_GAP } from "./cluster.js";
import { SearchBox } from "./ui/SearchBox.jsx";

/* ================================================================== the app */

const IMG_H = 96, IMG_GAP = 10, IMG_HANG = 16, IMG_CAP = 14;
const HEADER_H = 22, ERA_ROW = 22, ROW_H = 26, BAND_GAP = 16;
const HOVER_DELAY = 800;
const LONG_PRESS = 520;       // touch equivalent of a right-click
const TIMEOUT_GUARD = 9000;   // hard ceiling on any one library action
const ERA_MIN_PX = 26;    // below this an era is a sliver, so drop it
const ERA_COVER = 0.97;   // covering this much of the viewport counts as filling it
/* Easing time constants, in seconds. A value settles after roughly 4.6 of
   these, so ERA_FADE 0.22 is about a second. */
const ERA_FADE = 0.22;    // how long an era takes to flatten away
const IMG_FADE = 0.22;    // a picture shrinking away, or popping back out
const MOVE_TAU = 0.14;    // vertical glide when rows repack under a zoom or pan
const DRAWER_W = 330;     // the editor drawer, which the detail card must dodge
/* localStorage is usually capped around 5 MB per origin, and a timeline that
   is quietly approaching that should say so while export is still possible. */
const SIZE_WARN = 2.6e6;
const EXPORT_NAG = 50;    // edits since the last export before a reminder

/* How big a symbol is drawn, and whether it carries a halo, per importance
   level — indexed by IMP.TRIVIAL..IMP.CRITICAL. */
const IMP_SIZE = [0.62, 0.82, 1, 1.12, 1.24];
const IMP_RINGS = [0, 0, 0, 1, 2];    // halo rings: none, none, none, one, two
const LABEL_SUPPRESS_PX = 40;   // an Unimportant label this close to a stronger event hides
const DEFAULT_IMG_ROWS = 1.6;   // rows of vertical space kept for pinned pictures
const MAX_IMG_ROWS = 8;
const AXIS_GRAB_PX = 8;         // how close to the axis line counts as "grabbing" it

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/* Roughly what this timeline occupies once written out. Pictures dominate, and
   a linked one costs only its URL, so they are counted as stored rather than
   guessed at. */
function estimateBytes(doc) {
  let n = 0;
  try {
    n = JSON.stringify({ ...doc, images: undefined }).length;
    for (const rec of Object.values(doc.images || {})) {
      n += rec.external ? (rec.url || "").length + 120 : JSON.stringify(rec).length;
    }
  } catch (err) { return 0; }
  return n;
}
const fmtBytes = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB");

/* Colours passed to fadeRect are always the hex era/category/event colours
   (PALETTE entries or a user-picked swatch), never a CSS variable, so a plain
   hex parse is enough. */
function hexA(hex, a) {
  const h = (hex || "#888888").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}
/* A filled rect that fades to nothing past `fadeFromX`, reaching zero alpha at
   `fadeToX`. Used for the tail of anything ongoing — solid up to "now", tapering
   out after, rather than either a hard cut or running solid to the screen edge. */
function fadeRect(ctx, x0, x1, y, h, color, alpha, open, fadeFromX, fadeToX) {
  if (x1 <= x0) return;
  if (!open || x1 <= fadeFromX) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.fillRect(x0, y, x1 - x0, h);
    ctx.globalAlpha = 1;
    return;
  }
  const solidEnd = Math.min(x1, Math.max(x0, fadeFromX));
  if (solidEnd > x0) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.fillRect(x0, y, solidEnd - x0, h);
    ctx.globalAlpha = 1;
  }
  const fs = Math.max(x0, fadeFromX), fe = Math.min(x1, fadeToX);
  if (fe > fs + 0.5) {
    const grad = ctx.createLinearGradient(fs, 0, fe, 0);
    grad.addColorStop(0, hexA(color, alpha));
    grad.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(fs, y, fe - fs, h);
  }
}

function ellipsize(text, maxW, font, measure) {
  if (measure(text, font) <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid) + "…", font) <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

export default function TimelineApp() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sizeRef = useRef({ w: 1000, h: 600 });
  const viewRef = useRef({ s: tFromCivil(1990, 1, 1), f: 0, spp: 3.5e6, scrollY: 0 });
  const rafRef = useRef(0);
  const renderRef = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const measureCache = useRef(new Map());
  const hitsRef = useRef([]);
  const prevRowsRef = useRef(new Map());
  const contentHRef = useRef(0);
  const dragState = useRef(null);
  const imgElRef = useRef(new Map());
  const selAnchorRef = useRef({ x: 500, y: 300 });
  const hoverAnchorRef = useRef({ x: 500, y: 200 });
  const hoverTimer = useRef(0);
  const pressTimer = useRef(0);
  /* Eased-between-frames state, so nothing on the canvas moves or vanishes in
     one jump. Keys are item keys; entries not touched by a frame are dropped,
     which is what makes something scrolling back into view appear where it
     belongs rather than sliding in from wherever it was left. */
  const eraAnimRef = useRef(new Map());    // era id  -> visible 0..1
  const rowAnimRef = useRef(new Map());    // item    -> fractional row
  const visAnimRef = useRef(new Map());    // picture -> shown 0..1
  const lastFrameRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const sizeWarnedRef = useRef(false);
  const nagRef = useRef(0);
  /* The picture rail's height, in rows, set by dragging the axis (§2). Read
     live during render like viewRef, so dragging never waits on a re-render. */
  const imgAreaRowsRef = useRef(DEFAULT_IMG_ROWS);
  const axisYRef = useRef(0);       // where the axis actually landed last frame, for hit-testing
  const axisDragRef = useRef(false);
  const axisHoverRef = useRef(false);

  const [, bump] = useReducer((x) => x + 1, 0);
  /* The document lives inside a history, so every edit is undoable. `setDoc`
     keeps its old shape — updater or value — so nothing else had to change. */
  const [hist, setHist] = useState(() => makeHistory({ ...starterDoc(), id: "tl_boot" }));
  const doc = hist.present;
  const setDoc = useCallback((updater, tag = null) => {
    setHist((h) => {
      const next = typeof updater === "function" ? updater(h.present) : updater;
      return commit(h, next, tag);
    });
  }, []);
  const [entries, setEntries] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);
  const [saveState, setSaveState] = useState("saved");
  const [persistent, setPersistent] = useState(isPersistent);
  const [hidden, setHidden] = useState(() => new Set());
  const [theme, setTheme] = useState("dark");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showLabels, setShowLabels] = useState(true);
  const [uiScale, setUiScale] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [jump, setJump] = useState("");
  const [jumpErr, setJumpErr] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [hover, setHover] = useState(null);       // { id, img }
  const [preview, setPreview] = useState(null);   // id of a hovered pinned image
  const [draft, setDraft] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set(["earth"]));
  const [editingCat, setEditingCat] = useState(null);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(null);      // { item, kind, x, y }
  const [unexported, setUnexported] = useState(0);
  const [axisHover, setAxisHover] = useState(false);
  /* Mirrors imgAreaRowsRef for persistence only — render reads the ref live,
     the same way it reads viewRef, so dragging never waits on a re-render. */
  const [imgAreaRows, setImgAreaRows] = useState(DEFAULT_IMG_ROWS);
  const saveTimer = useRef(0);
  const skipSave = useRef(true);

  const index = useMemo(() => buildIndex(doc), [doc]);
  const selectedItem = useMemo(
    () => (selectedId ? index.items.find((i) => i.id === selectedId) || null : null), [selectedId, index]);
  const previewItem = useMemo(
    () => (preview ? index.items.find((i) => i.id === preview) || null : null), [preview, index]);

  /* ---------------------------------------------------------- viewport maths */
  const normalize = (v) => {
    const carry = Math.floor(v.f);
    if (carry !== 0) { v.s = v.s + BigInt(carry); v.f -= carry; }
    v.s = clampT(v.s);
    v.spp = Math.max(MIN_SPP, Math.min(MAX_SPP, v.spp));
    const maxScroll = Math.max(0, contentHRef.current - sizeRef.current.h + 30);
    v.scrollY = Math.max(0, Math.min(maxScroll, v.scrollY));
    return v;
  };
  const invalidate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (renderRef.current) renderRef.current();
      bump();
    });
  }, []);
  const panBy = (dx, dy = 0) => {
    const v = viewRef.current;
    v.f -= dx * v.spp; v.scrollY -= dy;
    normalize(v); invalidate();
  };
  const zoomAt = (px, factor) => {
    const v = viewRef.current;
    const off = px - sizeRef.current.w / 2;
    const newSpp = Math.max(MIN_SPP, Math.min(MAX_SPP, v.spp * factor));
    v.f = v.f + off * v.spp - off * newSpp;
    v.spp = newSpp;
    normalize(v); invalidate();
  };
  const setSpp = (spp) => {
    const v = viewRef.current;
    v.spp = Math.max(MIN_SPP, Math.min(MAX_SPP, spp));
    normalize(v); invalidate();
  };
  const goTo = (t, precision) => {
    const v = viewRef.current;
    v.s = clampT(t); v.f = 0;
    const prec = PREC_SEC[precision] ?? 1;
    const span = v.spp * sizeRef.current.w;
    if (prec > span || prec < span / 2000) {
      v.spp = Math.max(MIN_SPP, Math.min(MAX_SPP, (prec * 20) / sizeRef.current.w));
    }
    normalize(v); invalidate();
  };
  const fitRange = (t0, t1, precision) => {
    const v = viewRef.current;
    const spanSec = Number(t1 - t0);
    const prec = PREC_SEC[precision] ?? 1;
    v.spp = Math.max(MIN_SPP, Math.min(MAX_SPP, Math.max(spanSec * 1.5, prec * 10) / sizeRef.current.w));
    v.s = t0 + (t1 - t0) / 2n; v.f = 0;
    normalize(v); invalidate();
  };
  const fitAll = () => {
    if (!index.items.length) return;
    let lo = index.items[0].t0, hi = index.items[0].t0;
    for (const it of index.items) {
      if (it.t0 < lo) lo = it.t0;
      hi = bmax(hi, it.t1 === MAX_T ? nowT() : it.t1);
    }
    viewRef.current.scrollY = 0;
    fitRange(lo, hi, "second");
  };
  const gotoItem = (raw) => {
    fitRange(raw.start.t, raw.end ? raw.end.t : raw.start.t, raw.start.precision);
    setSelectedId(raw.id);
  };
  /* Opening a cluster is about separating its members, not framing its extent.
     Fitting the extent — which is roughly one pixel wide, since that is why
     they merged — overshot enormously. So the target zoom comes from the
     closest pair inside it: land just past the point where that pair stops
     merging, and the whole cluster has come apart. */
  const openCluster = (cl) => {
    const v = viewRef.current;
    const w = Math.max(1, sizeRef.current.w);
    const gapPx = CLUSTER_GAP * uiScale;
    const extent = Math.max(Number(cl.t1 - cl.t0), 0);
    /* Deep enough that the tightest pair comes apart... */
    const apart = cl.minGap > 0 ? cl.minGap / (gapPx * 2.4) : 0;
    /* ...but never so deep that the cluster runs off its own edges. One
       outlier would otherwise demand a zoom that leaves the rest off screen;
       framing the whole run and letting a second click drill in is better. */
    const framed = extent > 0 ? extent / (w * 0.85) : 0;
    const target = Math.max(apart, framed);
    /* Always at least one real step in, even for members sharing an instant,
       which no amount of zoom will separate. */
    v.spp = Math.max(MIN_SPP, Math.min(MAX_SPP,
      target > 0 ? Math.min(target, v.spp / 3) : v.spp / 3));
    v.s = clampT(cl.t0 + (cl.t1 - cl.t0) / 2n);
    v.f = 0;
    normalize(v); invalidate();
  };

  const measure = useCallback((text, font) => {
    const k = font + "|" + text;
    let w = measureCache.current.get(k);
    if (w === undefined) {
      const ctx = canvasRef.current.getContext("2d");
      ctx.font = font;
      w = ctx.measureText(text).width;
      measureCache.current.set(k, w);
    }
    return w;
  }, []);
  const getImgEl = (id, url) => {
    const map = imgElRef.current;
    let rec = map.get(id);
    if (!rec) {
      const el = new Image();
      rec = { el, ready: false };
      el.onload = () => { rec.ready = true; invalidate(); };
      el.src = url;
      map.set(id, rec);
    }
    return rec.ready ? rec.el : null;
  };

  /* ------------------------------------------------------------------- render */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(canvas);
    const C = (n) => css.getPropertyValue(n).trim();
    const cInk = C("--ink"), cRule = C("--rule"), cText = C("--text"),
      cMuted = C("--muted"), cAccent = C("--accent"), cFaint = C("--faint");
    /* Tint strengths come from the stylesheet rather than being hardcoded: a
       wash that reads as a tint on a dark ground vanishes on a light one. */
    const aTint = parseFloat(C("--tint")) || 0.055;
    const aEra = parseFloat(C("--era-fill")) || 0.30;

    /* everything that carries a size scales with the display setting */
    const S = uiScale;
    const rowH = Math.round(ROW_H * S), eraRow = Math.round(ERA_ROW * S);
    const headerH = Math.round(HEADER_H * S), bandGap = Math.round(BAND_GAP * S);
    const imgH = Math.round(IMG_H * S), capH = Math.round(IMG_CAP * S);
    const imgRow = imgH + capH + Math.round(IMG_GAP * S), imgHang = Math.round(IMG_HANG * S);
    const symR = 6 * S;
    const fM = Math.round(11 * S) + "px " + MONO;
    const fS = Math.round(10 * S) + "px " + MONO;
    const fT = Math.round(9 * S) + "px " + MONO;
    const axisMin = Math.round(70 + 22 * S);
    const rulerPad = Math.round(34 * S);

    ctx.fillStyle = cInk;
    ctx.fillRect(0, 0, w, h);

    const xOf = (t) => (Number(t - v.s) - v.f) / v.spp + w / 2;
    const tOf = (x) => v.s + toBig((x - w / 2) * v.spp + v.f);
    const hits = [];
    const newRows = new Map();

    /* Frame-rate independent easing, so everything settles in the same wall
       time on a 60Hz and a 144Hz screen. */
    const reduce = reduceMotionRef.current;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    let dt = (nowMs - lastFrameRef.current) / 1000;
    lastFrameRef.current = nowMs;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;      // first frame, or back from a stall
    const rate = (tau) => (reduce ? 1 : 1 - Math.exp(-dt / tau));
    const kEra = rate(ERA_FADE), kImg = rate(IMG_FADE), kMove = rate(MOVE_TAU);
    let animating = false;

    /* Eases `key` toward `target` and returns where it is now. A value already
       within `snap` lands exactly, so a frame is never asked for to close a
       gap nobody can see. First sight takes the target outright. */
    const seen = { row: new Set(), vis: new Set(), era: new Set() };
    const ease = (map, key, target, k, snap) => {
      const prev = map.get(key);
      if (prev === undefined || reduce) { map.set(key, target); return target; }
      if (prev === target) return target;
      let next = prev + (target - prev) * k;
      if (Math.abs(target - next) < snap) next = target; else animating = true;
      map.set(key, next);
      return next;
    };
    const easeRow = (key, target) => {
      seen.row.add(key);
      return ease(rowAnimRef.current, key, target, kMove, 0.004);
    };
    const easeVis = (key, target) => {
      seen.vis.add(key);
      return ease(visAnimRef.current, key, target, kImg, 0.006);
    };

    const layoutT0 = tOf(-w * 0.5), layoutT1 = tOf(w * 1.5);
    const visible = queryRange(index, layoutT0, layoutT1);
    const nowX = xOf(nowT());
    /* Where an ongoing item's visible extent stops: not the true end (it has
       none), and not the edge of the screen either — a fixed pixel sentinel
       there was the original bug, since it made anything open look like it
       would run for as long as the viewport happens to be wide open, at any
       zoom. This is a real instant, so it recedes properly as you zoom out. */
    const openEndX = (t0) => xOf(openFadeEndT(t0));

    /* ---- 1. the picture rail. Its height is a setting (dragging the axis),
       not a function of how many pictures happen to be pinned right now — that
       coupling was what made the whole timeline bob on every zoom or pan. */
    const imgAreaRows = imgAreaRowsRef.current;
    const maxImgRows = Math.max(0, Math.floor(imgAreaRows));
    const axisRaw = Math.min(Math.max(axisMin, 20 + imgAreaRows * imgRow + imgHang), h * 0.72);
    const AXIS_Y = axisRaw;
    axisYRef.current = AXIS_Y;

    const pinnedRaw = [];
    for (const it of visible) {
      /* Pinned pictures belong to their category, so hiding the category hides
         them too — otherwise the pictures float above an empty band. */
      if (hidden.has(it.cat)) continue;
      if (!it.pinImage || !it.imageId) continue;
      const rec = doc.images[it.imageId];
      if (!rec) continue;
      const el = getImgEl(it.imageId, rec.url);
      /* A linked picture has no stored size, so its shape comes from the
         element once the browser has fetched it. */
      const ratio = rec.w && rec.h ? rec.w / rec.h
        : el && el.naturalWidth ? el.naturalWidth / Math.max(1, el.naturalHeight) : 4 / 3;
      const iw = Math.max(40, Math.min(Math.round(220 * S), Math.round(imgH * ratio)));
      const a = xOf(it.t0);
      const b = it.isSpan ? (it.open ? openEndX(it.t0) : xOf(it.t1)) : a;
      let px = (a + b) / 2;
      if (b - a > 2) {
        /* keep the picture over the visible slice of a long span */
        const visL = Math.max(a, 0), visR = Math.min(b, w);
        if (visR - visL > iw + 16) px = Math.max(visL + iw / 2 + 8, Math.min(visR - iw / 2 - 8, px));
      }
      const capMax = Math.max(iw, Math.round(120 * S));
      const caption = ellipsize(it.title, capMax, fT, measure);
      const capW = measure(caption, fT);
      const half = Math.max(iw, capW) / 2 + 5;
      /* Priority carries no layout weight of its own — a picture sits wherever
         it fits, whatever its importance. It only decides who keeps a lane when
         the lanes run out. See packLanes. */
      pinnedRaw.push({ key: "img:" + it.id, it, el, iw, x: px, caption, capW,
        prio: it.imp ?? IMP.NORMAL, x0: px - half, x1: px + half });
    }
    const packedImgs = packLanes(pinnedRaw, 8, maxImgRows);

    /* A dropped picture keeps the lane it last held and shrinks away there,
       rather than snapping to nothing or sliding to row zero on the way out. */
    for (const p of packedImgs.items) {
      p.vis = easeVis(p.key, p.row >= 0 ? 1 : 0);
      const rowTarget = p.row >= 0 ? p.row : (rowAnimRef.current.get(p.key) ?? 0);
      p.rowF = easeRow(p.key, rowTarget);
    }

    const step = pickStep(140 * S * v.spp);
    const majors = majorTicks(step, tOf(-60), tOf(w + 60));

    /* ---- 2. gridlines ---- */
    ctx.strokeStyle = cFaint; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of majors) {
      const x = Math.round(xOf(t)) + 0.5;
      if (x < -1 || x > w + 1) continue;
      ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, h);
    }
    ctx.stroke();

    /* ---- 3. bands: era strip on top, tinted background, events below ---- */
    const byCat = new Map(doc.categories.map((c) => [c.id, { eras: [], events: [] }]));
    for (const it of visible) {
      const bucket = byCat.get(it.cat);
      if (!bucket) continue;
      const x1 = xOf(it.t0);
      const x2 = it.isSpan ? (it.open ? openEndX(it.t0) : xOf(it.t1)) : x1;
      if (it.kind === "era") {
        bucket.eras.push({ ...it, key: it.id, x1p: x1, x2p: x2 });
      } else {
        /* Position only, for now — label width depends on whether a nearby
           stronger event suppresses this one, which needs every event in the
           category placed first. Finalised just below, per category. */
        bucket.events.push({ ...it, key: it.id, x1p: x1, x2p: x2 });
      }
    }
    for (const bucket of byCat.values()) {
      if (!bucket.events.length) continue;
      /* An Unimportant label disappears next to a stronger event — Normal or
         above — so the timeline reads as one thing at a glance rather than two
         overlapping labels fighting for the same few pixels. Trivial never
         shows a label at all; Important and Critical always do. */
      const strongXs = bucket.events
        .filter((e) => (e.imp ?? IMP.NORMAL) > IMP.UNIMPORTANT)
        .map((e) => e.x1p)
        .sort((a, b) => a - b);
      const nearStrong = (x) => {
        let lo = 0, hi = strongXs.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (strongXs[mid] < x) lo = mid + 1; else hi = mid; }
        const px = LABEL_SUPPRESS_PX * S;
        return (strongXs[lo] !== undefined && strongXs[lo] - x <= px)
          || (strongXs[lo - 1] !== undefined && x - strongXs[lo - 1] <= px);
      };
      for (const it of bucket.events) {
        const lvl = it.imp ?? IMP.NORMAL;
        const showLbl = lvl === IMP.TRIVIAL ? false
          : lvl >= IMP.IMPORTANT ? true
            : lvl === IMP.UNIMPORTANT ? (showLabels && !nearStrong(it.x1p))
              : showLabels;
        it.lw = showLbl ? measure(it.title, fM) : 0;
        const x1 = it.x1p, x2 = it.x2p, lw = it.lw;
        if (it.isSpan) {
          const wide = x2 - x1 > lw + 24 * S;
          it.x0 = x1 - 9 * S;
          it.x1 = wide ? Math.max(x2 + 4, x1 + 14 * S + lw + 8) : x2 + 12 * S + lw;
        } else {
          it.x0 = x1 - 9 * S;
          it.x1 = x1 + 9 * S + (lw ? lw + 8 : 0);
        }
      }
    }

    const BAND_TOP = AXIS_Y + Math.round(44 * S);
    let y = BAND_TOP - v.scrollY;
    let contentH = 0;

    const anim = eraAnimRef.current;

    for (const cat of doc.categories) {
      if (hidden.has(cat.id)) continue;
      const bucket = byCat.get(cat.id) || { eras: [], events: [] };
      const isCollapsed = collapsed.has(cat.id);

      /* Level of detail. Two rules, both about relevance at the current zoom:
         a sliver too narrow to read carries no information, and an era that
         already fills the screen makes every ancestor above it redundant, since
         they would all be the same wash from edge to edge. Surviving levels are
         renumbered so flattened rows give their vertical space back. */
      let deepestCovering = -1;
      for (const er of bucket.eras) {
        const visW = Math.min(er.x2p, w) - Math.max(er.x1p, 0);
        if (visW >= w * ERA_COVER && er.depth > deepestCovering) deepestCovering = er.depth;
      }
      const shownIds = new Set(bucket.eras
        .filter((er) => er.depth >= deepestCovering && er.x2p - er.x1p >= ERA_MIN_PX)
        .map((er) => er.id));

      /* Ease each era toward shown/hidden. An era seen for the first time takes
         its target outright — otherwise everything would fade in on load, and
         panning would fade in whatever crosses the edge. */
      for (const er of bucket.eras) {
        seen.era.add(er.id);
        ease(anim, er.id, shownIds.has(er.id) ? 1 : 0, kEra, 0.012);
      }
      const visOf = (er) => anim.get(er.id) ?? 0;
      /* Anything mid-flatten still draws, at the height and alpha it has left. */
      const drawEras = bucket.eras.filter((er) => visOf(er) > 0.012);

      /* A whole level collapses together, so its row height is driven by the
         most-visible era on it — and later levels slide up as it goes. */
      const levelVis = new Map();
      for (const er of drawEras) {
        levelVis.set(er.depth, Math.max(levelVis.get(er.depth) ?? 0, visOf(er)));
      }
      const levels = [...levelVis.keys()].sort((a, b) => a - b);
      const rowTopOf = new Map();
      let stripAcc = 0;
      for (const d of levels) {
        rowTopOf.set(d, stripAcc);
        stripAcc += eraRow * levelVis.get(d);
      }

      /* Merge point events that land on top of each other before packing, so
         a thousand events in one pixel become one marker rather than a
         thousand rows. */
      const { singles, clusters } = isCollapsed
        ? { singles: [], clusters: [] }
        : clusterPoints(bucket.events, CLUSTER_GAP * S);
      const packedEvents = isCollapsed ? { items: [], rows: 0 }
        : packRows(singles, 12, prevRowsRef.current, 2);

      /* Rows are eased before the band is measured, not while it is drawn, so
         the band's own height follows the events inside it. Zoom out and two
         rows merge into one: the events glide together and the band closes up
         around them in the same motion, instead of the band snapping shut
         while its contents are still moving. */
      let maxRowF = 0;
      for (const it of packedEvents.items) {
        it.rowF = easeRow(it.key, it.row);
        if (it.rowF > maxRowF) maxRowF = it.rowF;
      }
      const clusterRow = clusters.length     // clusters get their own row
        ? easeRow("clrow:" + cat.id, packedEvents.rows) : 0;
      if (clusters.length && clusterRow > maxRowF) maxRowF = clusterRow;
      const evRows = isCollapsed ? 0 : Math.max(1, maxRowF + 1);

      const stripTop = y + headerH;
      const stripH = stripAcc;
      const contentTop = stripTop + stripH + (stripH > 0.5 && evRows ? 4 : 0);
      const contentBottom = contentTop + evRows * rowH;
      const bandH = contentBottom - y + bandGap;
      const bandTop = y;

      if (bandTop > AXIS_Y + rulerPad && bandTop < h) {
        ctx.strokeStyle = cFaint; ctx.beginPath();
        ctx.moveTo(0, Math.round(bandTop) + 0.5); ctx.lineTo(w, Math.round(bandTop) + 0.5); ctx.stroke();
      }

      if (bandTop + bandH > AXIS_Y && bandTop < h) {
        /* 3a. background tint — each era colours the band beneath it, and
           nesting compounds, so deeper structure reads as richer colour */
        const sorted = [...drawEras].sort((a, b) => a.depth - b.depth);
        for (const er of sorted) {
          const color = er.color || cat.color;
          const bx1 = Math.max(-30, er.x1p), bx2 = Math.min(w + 30, er.x2p);
          if (bx2 <= bx1) continue;
          fadeRect(ctx, bx1, bx2, stripTop, contentBottom - stripTop, color, aTint * visOf(er), er.open, nowX, er.x2p);
        }

        /* 3b. boundary lines run the full height of the band */
        for (const er of sorted) {
          const color = er.color || cat.color;
          ctx.globalAlpha = (0.2 / (1 + er.depth * 0.6)) * visOf(er);
          ctx.strokeStyle = color;
          for (const bx of [er.x1p, er.open ? null : er.x2p]) {
            if (bx === null || bx < -1 || bx > w + 1) continue;
            ctx.beginPath();
            ctx.moveTo(Math.round(bx) + 0.5, stripTop);
            ctx.lineTo(Math.round(bx) + 0.5, contentBottom);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;

        /* 3c. the era strip: one continuous bar per depth level */
        for (const er of sorted) {
          const a = visOf(er);
          const barH = eraRow * (levelVis.get(er.depth) ?? 0);
          if (barH < 2) continue;
          const top = stripTop + rowTopOf.get(er.depth);
          if (top + barH < AXIS_Y + rulerPad || top > h) continue;
          const color = er.color || cat.color;
          const sel = selectedId === er.id, hov = hover && hover.id === er.id;
          const bx1 = Math.max(-30, er.x1p), bx2 = Math.min(w + 30, er.x2p);
          if (bx2 <= bx1) continue;
          const inner = Math.max(1, barH - 3);

          fadeRect(ctx, bx1, bx2, top + 1, inner, color,
            (sel || hov ? Math.min(1, aEra + 0.2) : aEra) * a, er.open, nowX, er.x2p);
          /* hairline seam so abutting eras stay legible as separate bars */
          if (er.x1p > 0 && er.x1p < w) {
            ctx.globalAlpha = a;
            ctx.fillStyle = cInk;
            ctx.fillRect(Math.round(er.x1p), top + 1, 1, inner);
            ctx.globalAlpha = 1;
          }

          /* The label goes before the bar does — a half-height row has no room
             for type, and shrinking text would read as a glitch. */
          if (showLabels && barH > eraRow * 0.72) {
            const visL = Math.max(bx1, 4), visR = Math.min(bx2, w - 4);
            const room = visR - visL - 10;
            if (room > 18) {
              const label = ellipsize(er.title.toUpperCase(), room, fT, measure);
              const lw = measure(label, fT);
              ctx.font = fT;
              ctx.fillStyle = cText;
              ctx.globalAlpha = (sel || hov ? 1 : 0.85) * a;
              ctx.fillText(label, (visL + visR) / 2 - lw / 2, top + barH * 0.68);
              ctx.globalAlpha = 1;
            }
          }
          /* Half-faded eras are not clickable: hitting something you can barely
             see is worse than having to wait out a tenth of a second. */
          if (a > 0.55) {
            const ax = Math.max(20, Math.min(w - 20, (Math.max(bx1, 0) + Math.min(bx2, w)) / 2));
            hits.push({ item: er, x: ax, y: top + barH / 2, x0: bx1, x1: bx2, y0: top, y1: top + barH - 2 });
            if (er.id === selectedId) selAnchorRef.current = { x: ax, y: top + barH / 2 };
          }
        }
      }

      /* 3d. category name, drawn over its own tint */
      if (bandTop + bandH > AXIS_Y + rulerPad && bandTop < h) {
        ctx.fillStyle = cat.color;
        ctx.fillRect(12, bandTop + 8 * S, 6, 6);
        ctx.font = fT; ctx.fillStyle = cMuted;
        ctx.save();
        try { ctx.letterSpacing = "1.4px"; } catch (err) { /* older browsers */ }
        const suffix = isCollapsed && bucket.events.length ? "  (" + bucket.events.length + " hidden)" : "";
        ctx.fillText(cat.name.toUpperCase() + suffix, 24, bandTop + 14 * S);
        ctx.restore();
      }

      /* 3e. events */
      for (const it of packedEvents.items) {
        newRows.set(it.key, it.row);
        const rowTop = contentTop + it.rowF * rowH;
        const cy = rowTop + rowH * 0.66;
        if (cy < AXIS_Y + rulerPad || cy > h + 20) {
          if (it.id === selectedId) {
            selAnchorRef.current = { x: Math.max(20, Math.min(w - 20, it.x1p)),
              y: Math.max(AXIS_Y + 40, Math.min(h - 40, cy)) };
          }
          continue;
        }
        const color = it.color || cat.color;
        const sel = selectedId === it.id, hov = hover && hover.id === it.id;

        const lvl = it.imp ?? IMP.NORMAL;
        const sizeScale = IMP_SIZE[lvl] ?? 1;
        if (it.isSpan) {
          const bx1 = Math.max(-20, it.x1p), bx2 = Math.min(w + 20, Math.max(it.x2p, it.x1p + 2));
          fadeRect(ctx, bx1, bx2, cy - 2.5 * S, 5 * S, color, sel || hov ? 1 : 0.78, it.open, nowX, it.x2p);
          if (!it.open && it.x2p < w + 20 && it.x2p > -20) {
            ctx.globalAlpha = sel || hov ? 1 : 0.78; ctx.fillStyle = color;
            ctx.fillRect(Math.round(it.x2p) - 1, cy - 6 * S, 2, 12 * S);
            ctx.globalAlpha = 1;
          }
        }
        if (it.x1p > -30 && it.x1p < w + 30) {
          if (sel || hov) {
            ctx.globalAlpha = 0.22; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(it.x1p, cy, 12 * S, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = 1;
          }
          /* Important and Critical events carry a halo and a ring — Critical
             gets a second, wider one — readable at a glance, independent of
             whichever symbol and colour the event already uses, and still
             legible when the symbol itself is only a few pixels. */
          const rings = IMP_RINGS[lvl] ?? 0;
          if (rings > 0) {
            ctx.globalAlpha = 0.18; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(it.x1p, cy, 11 * S, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = sel || hov ? 1 : 0.85;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(it.x1p, cy, 10 * S, 0, 6.2832); ctx.stroke();
            if (rings > 1) {
              ctx.beginPath(); ctx.arc(it.x1p, cy, 13.5 * S, 0, 6.2832); ctx.stroke();
            }
            ctx.lineWidth = 1; ctx.globalAlpha = 1;
          }
          drawSymbol(ctx, it.sym, it.x1p, cy, symR * sizeScale, color);
        }
        if (it.lw > 0) {
          ctx.font = fM;
          ctx.fillStyle = sel || hov || lvl >= IMP.IMPORTANT ? cText : cMuted;
          if (it.isSpan) {
            const wide = it.x2p - it.x1p > it.lw + 24 * S;
            const lx = wide ? Math.max(Math.min(it.x1p + 14 * S, it.x2p - it.lw - 6), 10) : it.x2p + 10;
            if (lx < w - 4 && lx + it.lw > 0) ctx.fillText(it.title, lx, rowTop + 9 * S);
          } else if (it.x1p < w && it.x1p + it.lw > -40) {
            ctx.fillText(it.title, it.x1p + 11 * S, cy + 4 * S);
          }
        }
        hits.push({
          item: it, x: it.x1p, y: cy,
          x0: Math.min(it.x1p - 9 * S * sizeScale, it.x0),
          x1: it.isSpan ? Math.max(it.x2p + 6, it.x1p + 9 * S)
            : it.x1p + 9 * S * sizeScale + (it.lw ? it.lw + 8 : 0),
          y0: cy - 11 * S, y1: cy + 11 * S,
        });
        if (it.id === selectedId) selAnchorRef.current = { x: Math.max(20, Math.min(w - 20, it.x1p)), y: cy };
      }

      /* cluster markers */
      if (clusters.length) {
        const cy = contentTop + clusterRow * rowH + rowH * 0.66;
        if (cy > AXIS_Y + rulerPad && cy < h + 20) {
          ctx.font = fT;
          for (const cl of clusters) {
            if (cl.x1p < -20 || cl.x1p > w + 20) continue;
            const hov = hover && hover.id === cl.key;
            const label = String(cl.count);
            const lw = measure(label, fT);
            const rw = Math.max(18 * S, lw + 14 * S);
            const clImportant = (cl.imp ?? IMP.NORMAL) === IMP.IMPORTANT;
            ctx.globalAlpha = hov ? 0.95 : clImportant ? 0.85 : 0.62;
            ctx.fillStyle = cat.color;
            const rx = cl.x1p - rw / 2, ry = cy - 8 * S, rh = 16 * S;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, rh / 2); ctx.fill(); }
            else ctx.fillRect(rx, ry, rw, rh);
            ctx.globalAlpha = 1;
            if (clImportant) {
              ctx.strokeStyle = cat.color;
              ctx.lineWidth = 1.5;
              if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(rx - 2.5, ry - 2.5, rw + 5, rh + 5, (rh + 5) / 2);
                ctx.stroke();
              }
              ctx.lineWidth = 1;
            }
            ctx.fillStyle = cInk;
            ctx.fillText(label, cl.x1p - lw / 2, cy + 3.5 * S);
            hits.push({ item: cl, isCluster: true, x: cl.x1p, y: cy,
              x0: rx, x1: rx + rw, y0: ry, y1: ry + rh });
          }
        }
      }

      y += bandH;
      contentH += bandH;
    }
    contentHRef.current = contentH + BAND_TOP + 20;

    /* ---- 4. mask the top strip, then the pinned images ---- */
    ctx.fillStyle = cInk;
    ctx.fillRect(0, 0, w, AXIS_Y + rulerPad);

    for (const p of packedImgs.items) {
      newRows.set(p.key, p.row);
      const sel = selectedId === p.it.id, hov = hover && hover.id === p.it.id && hover.img;
      const pcat = doc.categories.find((c) => c.id === p.it.cat);
      const color = p.it.color || (pcat ? pcat.color : cMuted);

      const s = p.vis;                       // 1 shown, 0 collapsed to a marker
      const blockBottom = AXIS_Y - imgHang - p.rowF * imgRow;
      const imgBottom = blockBottom - capH;
      const top = imgBottom - imgH;
      const left = p.x - p.iw / 2;
      const offScreen = left > w + 20 || left + p.iw < -20;

      /* The picture scales about the point it is tethered to, so losing a lane
         reads as shrinking down onto the axis rather than blinking out. */
      if (s > 0.02 && !offScreen) {
        ctx.strokeStyle = color; ctx.globalAlpha = (sel || hov ? 0.9 : 0.45) * s;
        ctx.beginPath();
        ctx.moveTo(Math.round(p.x) + 0.5, blockBottom);
        ctx.lineTo(Math.round(p.x) + 0.5, AXIS_Y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.translate(p.x, blockBottom);
        ctx.scale(s, s);
        ctx.translate(-p.x, -blockBottom);

        if (p.el) {
          ctx.save();
          ctx.beginPath(); ctx.rect(left, top, p.iw, imgH); ctx.clip();
          ctx.globalAlpha = s;
          try { ctx.drawImage(p.el, left, top, p.iw, imgH); } catch (err) { /* not decodable */ }
          ctx.restore();
        } else {
          ctx.globalAlpha = s;
          ctx.fillStyle = cFaint;
          ctx.fillRect(left, top, p.iw, imgH);
        }
        ctx.strokeStyle = color;
        ctx.globalAlpha = (sel || hov ? 1 : 0.55) * s;
        ctx.lineWidth = sel || hov ? 2 : 1;
        ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(p.iw) - 1, imgH - 1);
        ctx.lineWidth = 1;

        ctx.font = fT;
        ctx.globalAlpha = s;
        ctx.fillStyle = sel || hov ? cText : cMuted;
        ctx.fillText(p.caption, p.x - p.capW / 2, blockBottom - 4 * S);
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      /* What it shrinks into: a small frame, not a bare dot, which read as the
         picture having been thrown away rather than folded up. */
      const onAxis = p.x > -10 && p.x < w + 10;
      if (s < 0.98 && onAxis) {
        const mw = 14, mh = 11, mx = Math.round(p.x - mw / 2), my = AXIS_Y - 15;
        const m = 1 - s;
        ctx.globalAlpha = (sel || hov ? 0.22 : 0.14) * m;
        ctx.fillStyle = color;
        ctx.fillRect(mx, my, mw, mh);
        ctx.globalAlpha = (sel || hov ? 1 : 0.75) * m;
        ctx.strokeStyle = color;
        ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
        ctx.beginPath();
        ctx.moveTo(mx + 2.5, my + mh - 3.5);
        ctx.lineTo(mx + 5.5, my + mh - 6.5);
        ctx.lineTo(mx + 8.5, my + mh - 3.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* Whichever of the two is the one you can actually see is the one you
         can click. */
      if (s > 0.5 && !offScreen) {
        hits.push({ item: p.it, isImage: true, x: p.x, y: blockBottom + 4,
          x0: Math.min(left, p.x - p.capW / 2), x1: Math.max(left + p.iw, p.x + p.capW / 2),
          y0: top, y1: blockBottom });
      } else if (onAxis) {
        hits.push({ item: p.it, isImage: true, x: p.x, y: AXIS_Y - 8,
          x0: p.x - 10, x1: p.x + 10, y0: AXIS_Y - 17, y1: AXIS_Y - 1 });
      }
    }

    prevRowsRef.current = newRows;
    hitsRef.current = hits;

    /* Forget anything this frame did not touch. Without this the maps grow
       without bound, and an item scrolling back into view would slide in from
       whatever position it happened to be left at. */
    for (const k of rowAnimRef.current.keys()) if (!seen.row.has(k)) rowAnimRef.current.delete(k);
    for (const k of visAnimRef.current.keys()) if (!seen.vis.has(k)) visAnimRef.current.delete(k);
    for (const k of eraAnimRef.current.keys()) if (!seen.era.has(k)) eraAnimRef.current.delete(k);

    /* ---- 5. the ruler, on top of everything ---- */
    if (step.md > 1) {
      ctx.strokeStyle = cRule; ctx.beginPath();
      for (let i = 0; i + 1 < majors.length; i++) {
        const xa = xOf(majors[i]), xb = xOf(majors[i + 1]);
        if (xb < -20 || xa > w + 20) continue;
        for (let k = 1; k < step.md; k++) {
          const x = Math.round(xa + ((xb - xa) * k) / step.md) + 0.5;
          if (x < 0 || x > w) continue;
          ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, AXIS_Y + 5);
        }
      }
      ctx.stroke();
    }
    /* The axis doubles as a drag handle for the picture rail's height (§2), so
       it brightens under the cursor the way anything grabbable should. */
    const axisActive = axisHoverRef.current || axisDragRef.current;
    ctx.strokeStyle = axisActive ? cAccent : cRule;
    ctx.lineWidth = axisActive ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(AXIS_Y) + 0.5); ctx.lineTo(w, Math.round(AXIS_Y) + 0.5); ctx.stroke();
    ctx.lineWidth = 1;

    ctx.strokeStyle = cMuted; ctx.beginPath();
    for (const t of majors) {
      const x = Math.round(xOf(t)) + 0.5;
      if (x < -1 || x > w + 1) continue;
      ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, AXIS_Y + 11 * S);
    }
    ctx.stroke();

    ctx.font = fM; ctx.fillStyle = cText; ctx.textAlign = "left";
    let lastRight = -Infinity;
    for (const t of majors) {
      const x = xOf(t);
      if (x < -80 || x > w + 80) continue;
      const label = tickLabel(t, step);
      const lw = measure(label, fM);
      if (x - lw / 2 < lastRight + 12) continue;
      ctx.fillText(label, x - lw / 2, AXIS_Y + 26 * S);
      lastRight = x + lw / 2;
    }

    const xn = xOf(nowT());
    if (xn > -50 && xn < w + 50) {
      const x = Math.round(xn) + 0.5;
      ctx.strokeStyle = cAccent; ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, h); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = fS;
      const lw = measure("NOW", fS);
      ctx.fillStyle = cAccent;
      ctx.fillRect(x - lw / 2 - 5, AXIS_Y - 18 * S, lw + 10, 14 * S);
      ctx.fillStyle = cInk;
      ctx.fillText("NOW", x - lw / 2, AXIS_Y - 7.5 * S);
    }

    ctx.strokeStyle = cRule; ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(w / 2) + 0.5, AXIS_Y - 26); ctx.lineTo(Math.round(w / 2) + 0.5, AXIS_Y + 32);
    ctx.stroke(); ctx.setLineDash([]);

    const maxScroll = Math.max(0, contentHRef.current - h + 30);
    if (maxScroll > 0) {
      const trackTop = AXIS_Y + 40, trackH = h - trackTop - 10;
      const thumbH = Math.max(30, (trackH * (h - trackTop)) / contentHRef.current);
      const thumbY = trackTop + ((trackH - thumbH) * v.scrollY) / maxScroll;
      ctx.fillStyle = cRule;
      ctx.fillRect(w - 6, thumbY, 3, thumbH);
    }

    /* Idle stays at zero cost: another frame is only asked for while something
       is still easing. Every value snaps to its target once it is close, so
       this always terminates. */
    if (animating) invalidate();
  }, [doc, index, showLabels, selectedId, hover, collapsed, uiScale, hidden, theme,
    measure, invalidate]);

  useEffect(() => { renderRef.current = render; render(); }, [render]);

  /* Respect the system setting: the era flatten is decoration, and for anyone
     who has asked for less motion it should just be a cut. */
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { reduceMotionRef.current = mq.matches; };
    sync();
    if (mq.addEventListener) { mq.addEventListener("change", sync); return () => mq.removeEventListener("change", sync); }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  /* --------------------------------------------------------------- interaction */
  const hitTest = (px, py) => {
    const hits = hitsRef.current;
    for (let i = hits.length - 1; i >= 0; i--) {
      const hh = hits[i];
      if (px >= hh.x0 - 3 && px <= hh.x1 + 3 && py >= hh.y0 && py <= hh.y1) return hh;
    }
    return null;
  };

  /* Hovering a pinned picture opens its card after a beat, and closes it the
     moment the pointer leaves. Clicking makes the same card stay. */
  const clearHoverTimer = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = 0; } };
  const setHoverTarget = (hh) => {
    const next = hh ? { id: hh.item.id || hh.item.key, img: !!hh.isImage } : null;
    const same = (!next && !hover) || (next && hover && next.id === hover.id && next.img === hover.img);
    if (same) return;
    setHover(next);
    clearHoverTimer();
    if (preview) setPreview(null);
    if (next && next.img && !hh.isCluster) {
      hoverAnchorRef.current = { x: hh.x, y: hh.y };
      const id = next.id;
      hoverTimer.current = setTimeout(() => { hoverTimer.current = 0; setPreview(id); }, HOVER_DELAY);
    }
  };
  useEffect(() => clearHoverTimer, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      sizeRef.current = { w: Math.max(200, r.width), h: Math.max(200, r.height) };
      if (renderRef.current) renderRef.current();
      bump();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) panBy(-e.deltaX);
      else {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        zoomAt(e.clientX - r.left, Math.exp(e.deltaY * unit * 0.0022));
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const clearPressTimer = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = 0; } };
  /* Right-click and long-press open the same menu. */
  const openMenuAt = (px, py) => {
    const hh = hitTest(px, py);
    if (!hh || hh.isCluster) { setMenu(null); return false; }
    const kind = hh.item.kind === "era" ? "era" : "event";
    setMenu({ item: hh.item, kind, x: px + 4, y: py + 4 });
    setSelectedId(hh.item.id);
    selAnchorRef.current = { x: hh.x, y: hh.y };
    setPreview(null);
    return true;
  };

  /* Grabbing the axis resizes the picture rail directly — the pointer sets the
     boundary, rather than nudging a delta, so it tracks the cursor exactly. */
  const nearAxis = (px, py) => Math.abs(py - axisYRef.current) <= AXIS_GRAB_PX && !hitTest(px, py);
  const setImgAreaFromY = (py) => {
    const imgH = Math.round(IMG_H * uiScale), capH = Math.round(IMG_CAP * uiScale),
      imgHang = Math.round(IMG_HANG * uiScale);
    const imgRow = imgH + capH + Math.round(IMG_GAP * uiScale);
    imgAreaRowsRef.current = Math.max(0, Math.min(MAX_IMG_ROWS, (py - 20 - imgHang) / imgRow));
    invalidate();
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragState.current = { moved: 0 };
    if (searchOpen) setSearchOpen(false);
    if (menu) setMenu(null);
    clearHoverTimer();
    clearPressTimer();
    if (preview) setPreview(null);
    if (pointers.current.size === 1 && nearAxis(px, py)) {
      axisDragRef.current = true;
      setImgAreaFromY(py);
      return;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: (a.x + b.x) / 2 };
    } else if (e.pointerType === "touch") {
      pressTimer.current = setTimeout(() => {
        pressTimer.current = 0;
        /* only if the finger stayed put — otherwise this was a pan */
        if (dragState.current && dragState.current.moved < 6 && openMenuAt(px, py)) {
          dragState.current.handled = true;
        }
      }, LONG_PRESS);
    }
  };
  const onPointerMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (axisDragRef.current) { setImgAreaFromY(e.clientY - r.top); return; }
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const overAxis = nearAxis(px, py);
      if (overAxis !== axisHoverRef.current) { axisHoverRef.current = overAxis; setAxisHover(overAxis); }
      setHoverTarget(overAxis ? null : hitTest(px, py));
      return;
    }
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (dragState.current) dragState.current.moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    if (pressTimer.current && dragState.current && dragState.current.moved >= 6) clearPressTimer();
    if (dragState.current && dragState.current.handled) return;
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = (a.x + b.x) / 2;
      if (dist > 4 && pinch.current.dist > 4) zoomAt(mid - r.left, pinch.current.dist / dist);
      panBy(mid - pinch.current.mid);
      pinch.current = { dist, mid };
    } else if (pointers.current.size === 1) {
      panBy(cur.x - prev.x, cur.y - prev.y);
    }
  };
  const onPointerUp = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (axisDragRef.current) {
      axisDragRef.current = false;
      setImgAreaRows(imgAreaRowsRef.current);   // commits the drag for persistence
      pointers.current.delete(e.pointerId);
      dragState.current = null;
      return;
    }
    const ds = dragState.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    dragState.current = null;
    clearPressTimer();
    if (ds && ds.handled) return;      // the long-press already acted
    if (ds && ds.moved < 5) {
      const hh = hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hh && hh.isCluster) {
        /* a cluster is a navigation aid, not a thing: open what it holds */
        openCluster(hh.item);
        setPreview(null);
      } else if (hh) {
        selAnchorRef.current = { x: hh.x, y: hh.y };
        setSelectedId(hh.item.id);
        setPreview(null);
      } else setSelectedId(null);
    }
  };
  const onPointerLeave = () => {
    clearHoverTimer(); clearPressTimer(); setHover(null); setPreview(null);
    if (axisHoverRef.current) { axisHoverRef.current = false; setAxisHover(false); }
  };
  useEffect(() => clearPressTimer, []);

  /* ------------------------------------------------------------------- editing */
  const centreInstant = () => {
    const v = viewRef.current;
    return { t: v.s, precision: precisionForStep(pickStep(140 * v.spp)) };
  };
  const blankDraft = (kind) => {
    const c = centreInstant();
    return {
      kind, id: null, title: "", cat: doc.categories[0] ? doc.categories[0].id : "",
      parent: "", sym: "dot", color: "", startStr: instantToInput(c.t, c.precision), endStr: "",
      desc: "", tagsStr: "", linksStr: "", imageId: "", pinImage: false,
      imp: IMP.NORMAL, ongoing: false,
    };
  };
  const draftFrom = (item, kind) => ({
    kind, id: item.id, title: item.title, cat: item.cat, parent: item.parent || "",
    sym: item.sym || "dot", color: item.color || "",
    startStr: instantToInput(item.start.t, item.start.precision),
    endStr: item.end ? instantToInput(item.end.t, item.end.precision) : "",
    desc: item.desc || "", tagsStr: (item.tags || []).join(", "),
    linksStr: (item.links || []).join("\n"),
    imageId: item.imageId || "", pinImage: !!item.pinImage,
    imp: item.imp ?? IMP.NORMAL, ongoing: !!item.ongoing,
  });
  const onField = (k, val) => setDraft((d) => ({ ...d, [k]: val }));

  /* `adoptIds` names eras this one should take as children — the resolution
     offered when a new era turns out to be the broader of two that overlap. */
  const saveDraft = (adoptIds) => {
    const adopt = Array.isArray(adoptIds) && adoptIds.length ? adoptIds : null;
    const start = parseDateInput(draft.startStr);
    if (!start || !draft.title.trim()) return;
    const endBlank = !draft.endStr.trim();
    const end = endBlank ? null : parseDateInput(draft.endStr);
    const isEra = draft.kind === "era";
    /* An era with no end has always meant "open"; an event needs the explicit
       checkbox, since a blank end otherwise just means a point in time. A span
       with no end and a start that has not happened yet has nothing to fade
       from, so it is refused rather than drawn as permanently, uselessly open. */
    const wouldBeOngoing = endBlank && (isEra || draft.ongoing);
    if (wouldBeOngoing && start.t > nowT()) return;
    const obj = {
      id: draft.id || uid(isEra ? "r" : "e"),
      cat: draft.cat, title: draft.title.trim(), start, end,
      desc: draft.desc.trim(),
      tags: draft.tagsStr.split(",").map((s) => s.trim()).filter(Boolean),
    };
    const links = (draft.linksStr || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (links.length) obj.links = links;
    if (draft.color) obj.color = draft.color;
    if (draft.imageId) { obj.imageId = draft.imageId; obj.pinImage = !!draft.pinImage; }
    if (isEra) obj.parent = draft.parent || null;
    else {
      obj.sym = draft.sym || "dot";
      if (draft.imp !== IMP.NORMAL) obj.imp = draft.imp;
      if (endBlank && draft.ongoing) obj.ongoing = true;
    }

    /* Adopting resolves the overlap, so the clash check is against the tree as
       it will be, not as it is. */
    if (isEra && !adopt && siblingClash(doc.eras, obj)) return;

    const list = isEra ? "eras" : "events";
    setDoc((d) => {
      const arr = d[list];
      const i = arr.findIndex((x) => x.id === obj.id);
      let next = i >= 0 ? arr.map((x) => (x.id === obj.id ? obj : x)) : [...arr, obj];
      if (adopt) next = next.map((r) => (adopt.includes(r.id) ? { ...r, parent: obj.id } : r));
      return { ...d, [list]: next };
    }, draft.id ? "save:" + obj.id : null);
    setSelectedId(obj.id);
    setDraft(null);
    setToast(adopt
      ? "Saved — " + adopt.length + (adopt.length === 1 ? " era now sits" : " eras now sit") + " inside it"
      : draft.id ? "Saved" : "Added to timeline");
  };
  const deleteDraft = () => {
    const isEra = draft.kind === "era";
    const list = isEra ? "eras" : "events";
    setDoc((d) => {
      const next = { ...d, [list]: d[list].filter((x) => x.id !== draft.id) };
      /* children of a deleted era move up rather than vanishing */
      if (isEra) {
        const gone = d.eras.find((r) => r.id === draft.id);
        next.eras = next.eras.map((r) => (r.parent === draft.id ? { ...r, parent: gone ? gone.parent || null : null } : r));
      }
      return next;
    });
    if (selectedId === draft.id) setSelectedId(null);
    setDraft(null);
    setToast("Deleted");
  };
  const pickImage = async (file) => {
    try {
      const rec = await processImage(file);
      setDoc((d) => ({ ...d, images: { ...d.images, [rec.id]: rec } }));
      setDraft((dr) => ({ ...dr, imageId: rec.id }));
    } catch (err) {
      setToast(err.message || "That image could not be read.");
    }
  };
  const clearImage = () => setDraft((d) => ({ ...d, imageId: "", pinImage: false }));
  const linkImage = (url) => {
    try {
      const rec = externalImage(url);
      setDoc((d) => ({ ...d, images: { ...d.images, [rec.id]: rec } }));
      setDraft((dr) => ({ ...dr, imageId: rec.id }));
    } catch (err) {
      setToast(err.message);
    }
  };

  /* ------------------------------------------------------- the context menu */
  const rawOf = (item) => (item.kind === "era"
    ? doc.eras.find((r) => r.id === item.id)
    : doc.events.find((e) => e.id === item.id));

  const menuEdit = () => {
    const raw = rawOf(menu.item);
    if (raw) setDraft(draftFrom(raw, menu.kind));
    setMenu(null);
  };
  const menuDuplicate = () => {
    const raw = rawOf(menu.item);
    setMenu(null);
    if (!raw) return;
    /* An era copied in place would sit exactly on top of its original, which
       the tree forbids — so it opens in the editor for the dates to be sorted
       out first. An event has no such rule and is copied outright. */
    if (menu.kind === "era") {
      setDraft({ ...draftFrom(raw, "era"), id: null, title: raw.title + " (copy)" });
      return;
    }
    const copy = { ...raw, id: uid("e"), title: raw.title + " (copy)" };
    setDoc((d) => ({ ...d, events: [...d.events, copy] }));
    setSelectedId(copy.id);
    setToast("Duplicated");
  };
  const menuTogglePin = () => {
    const { item, kind } = menu;
    const list = kind === "era" ? "eras" : "events";
    setMenu(null);
    if (!item.imageId) return;
    setDoc((d) => ({
      ...d,
      [list]: d[list].map((x) => (x.id === item.id ? { ...x, pinImage: !x.pinImage } : x)),
    }));
    setToast(item.pinImage ? "Picture unpinned" : "Picture pinned above the axis");
  };
  const menuDelete = () => {
    const { item, kind } = menu;
    const list = kind === "era" ? "eras" : "events";
    setMenu(null);
    setDoc((d) => {
      const next = { ...d, [list]: d[list].filter((x) => x.id !== item.id) };
      /* children of a deleted era move up rather than vanishing */
      if (kind === "era") {
        const gone = d.eras.find((r) => r.id === item.id);
        next.eras = next.eras.map((r) => (r.parent === item.id
          ? { ...r, parent: gone ? gone.parent || null : null } : r));
      }
      return next;
    });
    if (selectedId === item.id) setSelectedId(null);
    if (draft && draft.id === item.id) setDraft(null);
    setToast("Deleted");
  };

  /* ---------------------------------------------------------------- categories */
  const addCategory = () => {
    const id = uid("cat");
    const color = PALETTE[doc.categories.length % PALETTE.length];
    setDoc((d) => ({ ...d, categories: [...d.categories, { id, name: "New category", color }] }));
    setEditingCat(id);
    setExpanded((s) => new Set(s).add(id));
  };
  const categoryField = (id, key, val) =>
    setDoc((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, [key]: val } : c)) }),
      "cat:" + id + ":" + key);
  const deleteCategory = (id) => {
    setDoc((d) => {
      if (d.categories.length < 2) return d;
      const fallback = d.categories.find((c) => c.id !== id).id;
      return {
        ...d,
        categories: d.categories.filter((c) => c.id !== id),
        events: d.events.map((e) => (e.cat === id ? { ...e, cat: fallback } : e)),
        eras: d.eras.map((r) => (r.cat === id ? { ...r, cat: fallback, parent: null } : r)),
      };
    });
    setEditingCat(null);
    setToast("Category removed, its items moved");
  };
  const moveCategory = (i, dir) => {
    setDoc((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.categories.length) return d;
      const cs = [...d.categories];
      [cs[i], cs[j]] = [cs[j], cs[i]];
      return { ...d, categories: cs };
    });
  };
  const toggleSet = (setter, id) => setter((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /* ------------------------------------------------------------------- search */
  const results = useMemo(
    () => (searchOpen ? searchItems(index, doc, query) : []), [searchOpen, index, doc, query]);
  /* A toggle, not a one-way door: the same control that opens it closes it. */
  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (!open) setQuery("");
      return !open;
    });
  };
  const openSearch = () => { setSearchOpen(true); setQuery(""); };
  const pickResult = (it) => {
    const raw = it.kind === "era" ? doc.eras.find((r) => r.id === it.id)
      : doc.events.find((e) => e.id === it.id);
    if (raw) {
      if (hidden.has(raw.cat)) setHidden((hs) => { const n = new Set(hs); n.delete(raw.cat); return n; });
      gotoItem(raw);
    }
    setSearchOpen(false);
  };

  /* Tab and Shift+Tab walk the items on screen, so the canvas is reachable
     without a pointer. The list view in the panel remains the fuller route. */
  const stepFocus = (dir) => {
    const list = hitsRef.current.filter((hh) => !hh.isCluster);
    if (!list.length) return;
    const ordered = [...list].sort((a, b) => a.x - b.x || a.y - b.y);
    let i = ordered.findIndex((hh) => hh.item.id === selectedId);
    i = i < 0 ? (dir > 0 ? 0 : ordered.length - 1) : (i + dir + ordered.length) % ordered.length;
    const hh = ordered[i];
    selAnchorRef.current = { x: hh.x, y: hh.y };
    setSelectedId(hh.item.id);
  };

  const doUndo = () => { setHist((h) => (canUndo(h) ? undo(h) : h)); setDraft(null); };
  const doRedo = () => { setHist((h) => (canRedo(h) ? redo(h) : h)); setDraft(null); };

  /* ---------------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      /* these work even while typing, because they are about the document */
      if (mod && k === "f") { e.preventDefault(); toggleSearch(); return; }
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && k === "y") { e.preventDefault(); doRedo(); return; }
      if (e.key === "Escape" && searchOpen) { e.preventDefault(); setSearchOpen(false); return; }
      if (typing) { if (e.key === "Escape") e.target.blur(); return; }
      if (mod) return;

      const w = sizeRef.current.w;
      if (e.key === "Tab") { e.preventDefault(); stepFocus(e.shiftKey ? -1 : 1); return; }
      if (k === "/") { e.preventDefault(); openSearch(); return; }
      if (k === "l") { setTheme((t) => (t === "dark" ? "light" : "dark")); e.preventDefault(); return; }
      if (e.key === "+" || e.key === "=") { zoomAt(w / 2, 1 / 1.6); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { zoomAt(w / 2, 1.6); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { panBy(w / 3); e.preventDefault(); }
      else if (e.key === "ArrowRight") { panBy(-w / 3); e.preventDefault(); }
      else if (e.key === "ArrowUp") { panBy(0, 60); e.preventDefault(); }
      else if (e.key === "ArrowDown") { panBy(0, -60); e.preventDefault(); }
      else if (e.key === "Home") { goTo(nowT(), "day"); e.preventDefault(); }
      else if (k === "f") { fitAll(); e.preventDefault(); }
      else if (k === "n") { setDraft(blankDraft("event")); e.preventDefault(); }
      else if (k === "b") { setPanelOpen((p) => !p); e.preventDefault(); }
      else if (e.key === "Escape") {
        setShowHelp(false); setDraft(null); setSelectedId(null);
        setSearchOpen(false); setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  /* --------------------------------------------------------------- persistence
     Open the last timeline used, or lay down the sample one on a first visit. */
  useEffect(() => {
    let cancelled = false;
    /* If the store degrades at any point, say so rather than quietly dropping
       the user's work into memory. */
    const off = onStorageChange((reason) => {
      if (cancelled) return;
      setPersistent(false);
      setToast(reason + " Working in memory — export to keep your work.");
    });
    (async () => {
      try {
        await probeStorage();
        if (cancelled) return;
        setPersistent(isPersistent());
        const [idx, st] = await Promise.all([loadIndex(), loadAppState()]);
        let list = idx, chosen = null;
        if (!list.length) {
          chosen = { ...starterDoc(), id: uid("tl"), createdAt: new Date().toISOString() };
          await saveDoc(chosen);
          list = await loadIndex();
        } else {
          const wanted = st.lastOpenedId && list.some((e) => e.id === st.lastOpenedId)
            ? st.lastOpenedId : list[0].id;
          chosen = await loadDoc(wanted);
          if (!chosen) {
            chosen = { ...starterDoc(), id: uid("tl"), createdAt: new Date().toISOString() };
            await saveDoc(chosen);
            list = await loadIndex();
          }
        }
        if (cancelled) return;
        if (st.uiScale) setUiScale(st.uiScale);
        if (typeof st.showLabels === "boolean") setShowLabels(st.showLabels);
        if (st.theme === "light" || st.theme === "dark") setTheme(st.theme);
        if (typeof st.imgAreaRows === "number") {
          imgAreaRowsRef.current = st.imgAreaRows;
          setImgAreaRows(st.imgAreaRows);
        }
        skipSave.current = true;
        setHist(reset(chosen));
        setEntries(list);
      } catch (err) {
        setToast("Could not read saved timelines — starting fresh.");
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => { cancelled = true; off(); };
  }, []);

  /* Autosave, debounced, so a burst of typing writes once. */
  useEffect(() => {
    if (!booted) return undefined;
    if (skipSave.current) { skipSave.current = false; return undefined; }
    setSaveState("dirty");
    setUnexported((n) => n + 1);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaveState("saving");
        const entry = await saveDoc(doc);
        setEntries((prev) => {
          const i = prev.findIndex((e) => e.id === entry.id);
          if (i < 0) return [...prev, entry];
          const next = [...prev]; next[i] = entry; return next;
        });
        setSaveState("saved");
        /* Said once per session: a warning that repeats every save is noise,
           and the answer to it (export) does not change. */
        const bytes = estimateBytes(doc);
        if (bytes > SIZE_WARN && !sizeWarnedRef.current) {
          sizeWarnedRef.current = true;
          setToast("This timeline is about " + fmtBytes(bytes)
            + " — near what a browser will keep. Export it while you can.");
        }
      } catch (err) {
        setSaveState("error");
        setToast(err.message || "Could not save.");
      }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [doc, booted]);

  /* Browser storage can be cleared by the browser or the user without warning,
     so export is the real save. Nag on the way past every 50 edits. */
  useEffect(() => {
    if (!booted) return;
    if (unexported - nagRef.current >= EXPORT_NAG) {
      nagRef.current = unexported;
      setToast(unexported + " changes since the last export — Timelines → Export JSON keeps a copy.");
    }
  }, [unexported, booted]);

  useEffect(() => {
    if (booted) saveAppState({ lastOpenedId: doc.id, uiScale, showLabels, theme, imgAreaRows });
  }, [booted, doc.id, uiScale, showLabels, theme, imgAreaRows]);

  /* A backstop: whatever goes wrong underneath, the controls come back. */
  useEffect(() => {
    if (!busy) return undefined;
    const id = setTimeout(() => {
      setBusy(false);
      setToast("That took too long — nothing was changed.");
    }, TIMEOUT_GUARD);
    return () => clearTimeout(id);
  }, [busy]);

  /* ------------------------------------------------------------- the library */
  const adoptDoc = (d) => {
    skipSave.current = true;
    prevRowsRef.current = new Map();
    setHist(reset(d));          // undo must not reach across timelines
    setHidden(new Set());
    setSelectedId(null);
    setDraft(null);
    setMenu(null);
    setLibraryOpen(false);
    eraAnimRef.current = new Map();
    sizeWarnedRef.current = false;
    setUnexported(0);
    nagRef.current = 0;
  };
  const openTimeline = async (id) => {
    if (id === doc.id) { setLibraryOpen(false); return; }
    setBusy(true);
    try {
      const d = await loadDoc(id);
      if (d) { adoptDoc(d); setToast("Opened " + (d.name || "timeline")); }
      else setToast("That timeline could not be read.");
    } finally { setBusy(false); }
  };
  const persistNew = async (d) => {
    await saveDoc(d);
    setEntries(await loadIndex());
    adoptDoc(d);
  };
  const newTimeline = async () => {
    setBusy(true);
    try {
      await persistNew({
        id: uid("tl"), name: "Untitled timeline", createdAt: new Date().toISOString(),
        categories: [{ id: uid("cat"), name: "Events", color: PALETTE[0] }],
        eras: [], events: [], images: {},
      });
      setToast("New timeline");
    } catch (err) { setToast(err.message || "Could not create it."); }
    finally { setBusy(false); }
  };
  const duplicateTimeline = async (id) => {
    setBusy(true);
    try {
      const src = id === doc.id ? doc : await loadDoc(id);
      if (!src) return;
      await persistNew({ ...src, id: uid("tl"), name: src.name + " (copy)",
        createdAt: new Date().toISOString() });
      setToast("Duplicated");
    } catch (err) { setToast(err.message || "Could not duplicate it."); }
    finally { setBusy(false); }
  };
  const removeTimeline = async (id) => {
    setBusy(true);
    try {
      const list = await deleteDoc(id);
      setEntries(list);
      if (id === doc.id && list.length) {
        const d = await loadDoc(list[0].id);
        if (d) adoptDoc(d);
      }
      setToast("Deleted");
    } catch (err) { setToast(err.message || "Could not delete it."); }
    finally { setBusy(false); }
  };

  /* -------------------------------------------------------------- files in/out */
  const markExported = () => { setUnexported(0); nagRef.current = 0; };
  const exportJSON = () => {
    downloadFile(safeFileName(doc.name) + ".timeline.json",
      JSON.stringify(encodeDoc(doc, { withImages: true }), null, 2), "application/json");
    markExported();
    setToast("Exported, pictures included");
  };
  const exportCSVFile = () => {
    /* Linked pictures travel as their URL; uploaded ones cannot fit in a cell. */
    const dropped = countsDroppedImages(doc);
    downloadFile(safeFileName(doc.name) + ".csv", exportCSV(doc), "text/csv");
    markExported();
    setToast(dropped
      ? "Exported — " + dropped + " uploaded picture" + (dropped === 1 ? "" : "s")
        + " left behind; JSON keeps them"
      : "Exported");
  };
  const importFile = async (file) => {
    setBusy(true);
    try {
      const text = await file.text();
      const looksJSON = /\.json$/i.test(file.name) || text.trim().startsWith("{");
      if (looksJSON) {
        const d = decodeDoc(JSON.parse(text));
        d.id = uid("tl");
        d.createdAt = new Date().toISOString();
        await persistNew(d);
        setToast("Imported " + d.events.length + " events and " + d.eras.length + " eras");
      } else {
        const res = importCSV(text, doc);
        setDoc((d0) => ({
          ...d0,
          categories: res.categories,
          events: [...d0.events, ...res.events],
          eras: [...d0.eras, ...res.eras],
          images: { ...d0.images, ...res.images },
        }));
        setLibraryOpen(false);
        const n = res.events.length + res.eras.length;
        setToast(res.errors.length
          ? "Added " + n + " rows, skipped " + res.errors.length
          : "Added " + n + " rows to this timeline");
        if (res.errors.length) console.warn("CSV import problems:\n" + res.errors.join("\n"));
      }
    } catch (err) {
      setToast(err.message || "Could not read that file.");
    } finally { setBusy(false); }
  };

  /* ------------------------------------------------------------------ readouts */
  /* Only measured while the dialog that shows it is actually open. */
  const libSizeNote = useMemo(
    () => (libraryOpen ? fmtBytes(estimateBytes(doc)) : ""), [libraryOpen, doc]);
  const v = viewRef.current;
  const span = v.spp * sizeRef.current.w;
  const centrePrec = precisionForStep(pickStep(140 * v.spp));
  const doJump = () => {
    const p = parseDateInput(jump);
    if (!p) { setJumpErr(true); return; }
    setJumpErr(false);
    goTo(p.t, p.precision);
  };

  return (
    <div className={"app" + (theme === "light" ? " light" : "")}>
      <style>{STYLES}</style>

      <div className="bar">
        <button className="btn" aria-pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)}
          title="Toggle the contents panel">☰</button>
        <div className="brand">Time<span>·</span>line</div>
        <div className="jump">
          <input className={jumpErr ? "err" : ""} value={jump}
            placeholder="1969-07-20 · 44 BCE · 13.8 Gya"
            onChange={(e) => { setJump(e.target.value); setJumpErr(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") doJump(); }}
            aria-label="Go to date" />
          <button className="btn" onClick={doJump}>Go</button>
        </div>
        <button className="btn" onClick={fitAll}>Fit</button>
        <button className="btn" aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>Labels</button>
        <div className="sizeslider" title="Display size — pictures and type scale with it in real time">
          <input type="range" min={0.6} max={2} step={0.01} value={uiScale}
            aria-label="Display size"
            onChange={(e) => setUiScale(parseFloat(e.target.value))} />
          <span>{Math.round(uiScale * 100)}%</span>
        </div>
        <button className="btn" aria-pressed={showHelp} onClick={() => setShowHelp(!showHelp)}>Keys</button>
        <button className="btn" onClick={toggleSearch} aria-pressed={searchOpen}
          title={searchOpen ? "Close search (Esc)" : "Search (Ctrl+F)"}>Find</button>
        <button className="btn" onClick={doUndo} disabled={!canUndo(hist)} title="Undo (Ctrl+Z)">↶</button>
        <button className="btn" onClick={doRedo} disabled={!canRedo(hist)} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button className="btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Switch theme (L)">{theme === "dark" ? "☾" : "☀"}</button>
        <button className="btn" onClick={() => setLibraryOpen(true)}>Timelines</button>
        <div className="readout">
          <span className={"saveflag" + (persistent && saveState !== "error" ? "" : " warn")}>
            {!persistent ? "Not saved"
              : saveState === "saving" ? "Saving…"
                : saveState === "dirty" ? "Unsaved"
                  : saveState === "error" ? "Save failed" : "Saved"}
          </span>
          <span>centre <b>{fmtInstant(v.s, centrePrec)}</b></span>
          <span>1 px = <b>{fmtDur(v.spp)}</b></span>
          <span>span <b>{fmtDur(span)}</b></span>
        </div>
      </div>

      <ScaleRail spp={v.spp} onSet={setSpp} />

      <div className="main">
        {panelOpen && (
          <ItemsPanel
            doc={doc} index={index} collapsed={collapsed} expanded={expanded}
            selectedId={selectedId} editingCat={editingCat} setEditingCat={setEditingCat}
            persistent={persistent} hidden={hidden}
            onToggleHidden={(id) => toggleSet(setHidden, id)}
            onAdd={(kind) => setDraft(blankDraft(kind))}
            onAddCategory={addCategory}
            onEditItem={(item, kind) => setDraft(draftFrom(item, kind))}
            onGoto={gotoItem}
            onMoveCategory={moveCategory}
            onToggleCollapse={(id) => toggleSet(setCollapsed, id)}
            onToggleExpand={(id) => toggleSet(setExpanded, id)}
            onCategoryField={categoryField}
            onDeleteCategory={deleteCategory}
            onRename={(name) => setDoc((d) => ({ ...d, name }), "rename")}
          />
        )}

        <div className="stage" ref={wrapRef}>
          <canvas ref={canvasRef}
            className={"surface" + (hover ? " pointing" : "") + (axisHover ? " axis-resize" : "")}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onContextMenu={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              /* Only swallow the browser menu when there is something to act on. */
              if (openMenuAt(e.clientX - r.left, e.clientY - r.top)) e.preventDefault();
            }}
            onDoubleClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              zoomAt(e.clientX - r.left, 1 / 4);
            }} />

          {/* These stay up while the editor is open: looking something else up
              is exactly what you need mid-edit. The drawer sits above them, so
              they only have to dodge the space it takes. */}
          {selectedItem && (
            <DetailCard item={selectedItem} doc={doc} stage={sizeRef.current}
              anchor={selAnchorRef.current} rightInset={draft ? DRAWER_W : 0}
              onClose={() => setSelectedId(null)}
              onEdit={(item) => {
                const raw = rawOf(item);
                if (raw) setDraft(draftFrom(raw, item.kind));
              }} />
          )}

          {previewItem && !selectedItem && (
            <DetailCard item={previewItem} doc={doc} stage={sizeRef.current}
              anchor={hoverAnchorRef.current} rightInset={draft ? DRAWER_W : 0} preview />
          )}

          {draft && (
            <Editor draft={draft} doc={doc} onField={onField} onSave={saveDraft}
              onDelete={deleteDraft} onClose={() => setDraft(null)}
              onPickImage={pickImage} onLinkImage={linkImage} onClearImage={clearImage} />
          )}

          {menu && (
            <ContextMenu menu={menu} stage={sizeRef.current} onClose={() => setMenu(null)}
              onEdit={menuEdit} onDuplicate={menuDuplicate}
              onTogglePin={menuTogglePin} onDelete={menuDelete} />
          )}

          {showHelp && (
            <div className="help">
              <h3>Controls</h3>
              <p><kbd>scroll</kbd> zoom · <kbd>drag</kbd> pan · <kbd>click</kbd> open</p>
              <p><kbd>N</kbd> new event · <kbd>B</kbd> panel · <kbd>F</kbd> fit all</p>
              <p><kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>←</kbd> <kbd>→</kbd> pan</p>
              <p><kbd>↑</kbd> <kbd>↓</kbd> scroll bands · <kbd>Home</kbd> now</p>
              <p><kbd>Ctrl</kbd>+<kbd>F</kbd> search · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</p>
              <p><kbd>Tab</kbd> next item · <kbd>L</kbd> theme · <kbd>Esc</kbd> close</p>
              <p style={{ marginTop: 8, opacity: .8 }}>Rest on a pinned picture to peek at its card.</p>
              <p style={{ opacity: .8 }}>Right-click an item (or hold on touch) for more.</p>
              <p style={{ opacity: .8 }}>Drag the axis itself to resize the picture rail.</p>
            </div>
          )}

          {searchOpen && (
            <SearchBox doc={doc} results={results} query={query} onQuery={setQuery}
              onPick={pickResult} onClose={() => setSearchOpen(false)} />
          )}

          {toast && <div className="toast">{toast}</div>}

          {libraryOpen && (
            <Library entries={entries} currentId={doc.id} busy={busy} persistent={persistent}
              unexported={unexported} sizeNote={libSizeNote}
              onOpen={openTimeline} onNew={newTimeline} onDuplicate={duplicateTimeline}
              onDelete={removeTimeline} onExportJSON={exportJSON} onExportCSV={exportCSVFile}
              onImportFile={importFile} onClose={() => setLibraryOpen(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
