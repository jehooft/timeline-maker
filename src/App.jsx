/* App.jsx — the timeline surface itself: viewport maths, the canvas renderer,
   hit testing, interaction, and the wiring between all of the above. */
import React, { useRef, useEffect, useState, useMemo, useReducer, useCallback } from "react";
import {
  MAX_T, PREC_SEC, MIN_SPP, MAX_SPP, clampT, toBig, bmax, nowT, tFromCivil,
  fmtInstant, fmtDur, parseDateInput, instantToInput,
} from "./time.js";
import { pickStep, majorTicks, tickLabel, precisionForStep } from "./ticks.js";
import { drawSymbol } from "./symbols.jsx";
import { processImage, externalImage } from "./images.js";
import {
  uid, PALETTE, starterDoc, buildIndex, queryRange, packRows, siblingClash,
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
const ERA_FADE = 0.11;    // seconds; how long an era takes to flatten away
const DRAWER_W = 330;     // the editor drawer, which the detail card must dodge
/* localStorage is usually capped around 5 MB per origin, and a timeline that
   is quietly approaching that should say so while export is still possible. */
const SIZE_WARN = 2.6e6;
const EXPORT_NAG = 50;    // edits since the last export before a reminder

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
  /* Era id -> how visible it is, 0..1, eased between frames so a level that
     drops out of the strip flattens away instead of blinking off. */
  const eraAnimRef = useRef(new Map());
  const lastFrameRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const sizeWarnedRef = useRef(false);
  const nagRef = useRef(0);

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

    const layoutT0 = tOf(-w * 0.5), layoutT1 = tOf(w * 1.5);
    const visible = queryRange(index, layoutT0, layoutT1);

    /* ---- 1. pinned images, centred on the middle of what they mark ---- */
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
      const b = it.isSpan ? (it.open ? w + 40 : xOf(it.t1)) : a;
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
      /* Layout runs over a window wider than the screen so pictures are placed
         before they scroll into view. Priority must not use that window: an
         important picture already past the edge would keep claiming the front
         row and push a picture you *can* see into the overflow markers, where
         it stayed until every important one had left the wider window too.
         So only what is actually on screen outranks anything. */
      const onScreen = px + iw / 2 > 0 && px - iw / 2 < w;
      pinnedRaw.push({ key: "img:" + it.id, it, el, iw, x: px, caption, capW,
        prio: it.important && onScreen ? 1 : 0, x0: px - half, x1: px + half });
    }
    const maxImgRows = Math.max(1, Math.floor((h * 0.5 - 40) / imgRow));
    const packedImgs = packRows(pinnedRaw, 8, prevRowsRef.current, 1);
    const usedImgRows = Math.min(packedImgs.rows, maxImgRows);
    const AXIS_Y = pinnedRaw.length
      ? Math.max(axisMin, 20 + usedImgRows * imgRow + imgHang) : axisMin;

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
      const x2 = it.isSpan ? (it.open ? w + 40 : xOf(it.t1)) : x1;
      if (it.kind === "era") {
        bucket.eras.push({ ...it, key: it.id, x1p: x1, x2p: x2 });
      } else {
        const lw = showLabels || it.important ? measure(it.title, fM) : 0;
        let x0f, x1f;
        if (it.isSpan) {
          const wide = x2 - x1 > lw + 24 * S;
          x0f = x1 - 9 * S;
          x1f = wide ? Math.max(x2 + 4, x1 + 14 * S + lw + 8) : x2 + 12 * S + lw;
        } else {
          x0f = x1 - 9 * S;
          x1f = x1 + 9 * S + (lw ? lw + 8 : 0);
        }
        bucket.events.push({ ...it, key: it.id, x1p: x1, x2p: x2, lw, x0: x0f, x1: x1f });
      }
    }

    const BAND_TOP = AXIS_Y + Math.round(44 * S);
    let y = BAND_TOP - v.scrollY;
    let contentH = 0;

    /* Frame-rate independent easing, so the flatten reads the same on a 60Hz
       and a 144Hz screen. */
    const anim = eraAnimRef.current;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    let dt = (nowMs - lastFrameRef.current) / 1000;
    lastFrameRef.current = nowMs;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;      // first frame, or back from a stall
    const ease = reduceMotionRef.current ? 1 : 1 - Math.exp(-dt / ERA_FADE);
    let animating = false;

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
        const target = shownIds.has(er.id) ? 1 : 0;
        const prev = anim.get(er.id);
        if (prev === undefined || reduceMotionRef.current) { anim.set(er.id, target); continue; }
        if (prev === target) continue;
        let next = prev + (target - prev) * ease;
        if (Math.abs(target - next) < 0.012) next = target; else animating = true;
        anim.set(er.id, next);
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
      const clusterRow = packedEvents.rows;          // clusters get their own row
      const evRows = isCollapsed ? 0
        : Math.max(1, packedEvents.rows + (clusters.length ? 1 : 0));

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
          ctx.globalAlpha = aTint * visOf(er);
          ctx.fillStyle = color;
          ctx.fillRect(bx1, stripTop, bx2 - bx1, contentBottom - stripTop);
        }
        ctx.globalAlpha = 1;

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

          ctx.globalAlpha = (sel || hov ? Math.min(1, aEra + 0.2) : aEra) * a;
          ctx.fillStyle = color;
          ctx.fillRect(bx1, top + 1, bx2 - bx1, inner);
          ctx.globalAlpha = 1;
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
        const rowTop = contentTop + it.row * rowH;
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

        if (it.isSpan) {
          const bx1 = Math.max(-20, it.x1p), bx2 = Math.min(w + 20, Math.max(it.x2p, it.x1p + 2));
          ctx.globalAlpha = sel || hov ? 1 : 0.78;
          ctx.fillStyle = color;
          ctx.fillRect(bx1, cy - 2.5 * S, Math.max(2, bx2 - bx1), 5 * S);
          if (it.x2p < w + 20 && it.x2p > -20) ctx.fillRect(Math.round(it.x2p) - 1, cy - 6 * S, 2, 12 * S);
          ctx.globalAlpha = 1;
        }
        if (it.x1p > -30 && it.x1p < w + 30) {
          if (sel || hov) {
            ctx.globalAlpha = 0.22; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(it.x1p, cy, 12 * S, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = 1;
          }
          /* An important event carries a halo and a ring: readable at a glance,
             independent of whichever symbol and colour the event already uses,
             and still legible when the symbol itself is only a few pixels. */
          if (it.important) {
            ctx.globalAlpha = 0.18; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(it.x1p, cy, 11 * S, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = sel || hov ? 1 : 0.85;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(it.x1p, cy, 10 * S, 0, 6.2832); ctx.stroke();
            ctx.lineWidth = 1; ctx.globalAlpha = 1;
          }
          drawSymbol(ctx, it.sym, it.x1p, cy, it.important ? symR * 1.12 : symR, color);
        }
        if (showLabels || it.important) {
          ctx.font = fM;
          ctx.fillStyle = sel || hov || it.important ? cText : cMuted;
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
          x0: Math.min(it.x1p - 9 * S, it.x0),
          x1: it.isSpan ? Math.max(it.x2p + 6, it.x1p + 9 * S)
            : it.x1p + 9 * S + (showLabels || it.important ? it.lw + 8 : 0),
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
            ctx.globalAlpha = hov ? 0.95 : cl.important ? 0.85 : 0.62;
            ctx.fillStyle = cat.color;
            const rx = cl.x1p - rw / 2, ry = cy - 8 * S, rh = 16 * S;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, rh / 2); ctx.fill(); }
            else ctx.fillRect(rx, ry, rw, rh);
            ctx.globalAlpha = 1;
            if (cl.important) {
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

      /* Out of headroom. A bare dot read as "the picture is gone", so this is
         drawn as a shrunken frame instead — clearly a collapsed picture, and
         still clickable. */
      if (p.row >= maxImgRows) {
        if (p.x > -10 && p.x < w + 10) {
          const mw = 14, mh = 11, mx = Math.round(p.x - mw / 2), my = AXIS_Y - 15;
          ctx.globalAlpha = sel || hov ? 0.22 : 0.14;
          ctx.fillStyle = color;
          ctx.fillRect(mx, my, mw, mh);
          ctx.globalAlpha = sel || hov ? 1 : 0.75;
          ctx.strokeStyle = color;
          ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
          ctx.beginPath();
          ctx.moveTo(mx + 2.5, my + mh - 3.5);
          ctx.lineTo(mx + 5.5, my + mh - 6.5);
          ctx.lineTo(mx + 8.5, my + mh - 3.5);
          ctx.stroke();
          ctx.globalAlpha = 1;
          hits.push({ item: p.it, isImage: true, x: p.x, y: AXIS_Y - 8,
            x0: mx - 3, x1: mx + mw + 3, y0: my - 2, y1: AXIS_Y - 1 });
        }
        continue;
      }
      const blockBottom = AXIS_Y - imgHang - p.row * imgRow;
      const imgBottom = blockBottom - capH;
      const top = imgBottom - imgH;
      const left = p.x - p.iw / 2;
      if (left > w + 20 || left + p.iw < -20) continue;

      ctx.strokeStyle = color; ctx.globalAlpha = sel || hov ? 0.9 : 0.45;
      ctx.beginPath();
      ctx.moveTo(Math.round(p.x) + 0.5, blockBottom);
      ctx.lineTo(Math.round(p.x) + 0.5, AXIS_Y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (p.el) {
        ctx.save();
        ctx.beginPath(); ctx.rect(left, top, p.iw, imgH); ctx.clip();
        try { ctx.drawImage(p.el, left, top, p.iw, imgH); } catch (err) { /* not decodable */ }
        ctx.restore();
      } else {
        ctx.fillStyle = cFaint;
        ctx.fillRect(left, top, p.iw, imgH);
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = sel || hov ? 1 : 0.55;
      ctx.lineWidth = sel || hov ? 2 : 1;
      ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(p.iw) - 1, imgH - 1);
      ctx.lineWidth = 1; ctx.globalAlpha = 1;

      ctx.font = fT;
      ctx.fillStyle = sel || hov ? cText : cMuted;
      ctx.fillText(p.caption, p.x - p.capW / 2, blockBottom - 4 * S);

      hits.push({ item: p.it, isImage: true, x: p.x, y: blockBottom + 4,
        x0: Math.min(left, p.x - p.capW / 2), x1: Math.max(left + p.iw, p.x + p.capW / 2),
        y0: top, y1: blockBottom });
    }

    prevRowsRef.current = newRows;
    hitsRef.current = hits;

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
    ctx.strokeStyle = cRule; ctx.beginPath();
    ctx.moveTo(0, Math.round(AXIS_Y) + 0.5); ctx.lineTo(w, Math.round(AXIS_Y) + 0.5); ctx.stroke();

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

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragState.current = { moved: 0 };
    if (searchOpen) setSearchOpen(false);
    if (menu) setMenu(null);
    clearHoverTimer();
    clearPressTimer();
    if (preview) setPreview(null);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: (a.x + b.x) / 2 };
    } else if (e.pointerType === "touch") {
      const r = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
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
    const prev = pointers.current.get(e.pointerId);
    if (!prev) { setHoverTarget(hitTest(e.clientX - r.left, e.clientY - r.top)); return; }
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
  const onPointerLeave = () => { clearHoverTimer(); clearPressTimer(); setHover(null); setPreview(null); };
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
      desc: "", tagsStr: "", linksStr: "", imageId: "", pinImage: false, important: false,
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
    important: !!item.important,
  });
  const onField = (k, val) => setDraft((d) => ({ ...d, [k]: val }));

  /* `adoptIds` names eras this one should take as children — the resolution
     offered when a new era turns out to be the broader of two that overlap. */
  const saveDraft = (adoptIds) => {
    const adopt = Array.isArray(adoptIds) && adoptIds.length ? adoptIds : null;
    const start = parseDateInput(draft.startStr);
    if (!start || !draft.title.trim()) return;
    const end = draft.endStr.trim() ? parseDateInput(draft.endStr) : null;
    const isEra = draft.kind === "era";
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
      if (draft.important) obj.important = true;
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
    if (booted) saveAppState({ lastOpenedId: doc.id, uiScale, showLabels, theme });
  }, [booted, doc.id, uiScale, showLabels, theme]);

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
        <select className="sizesel" value={uiScale} aria-label="Display size"
          onChange={(e) => setUiScale(parseFloat(e.target.value))}>
          <option value={0.85}>Small</option>
          <option value={1}>Normal</option>
          <option value={1.2}>Large</option>
          <option value={1.45}>Extra large</option>
        </select>
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
          <canvas ref={canvasRef} className={"surface" + (hover ? " pointing" : "")}
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
