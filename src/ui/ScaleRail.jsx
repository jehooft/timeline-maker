/* ScaleRail.jsx — the zoom control, gradated in real time units rather than
   arbitrary steps, because 17 orders of magnitude need landmarks. */
import React, { useRef, useEffect, useCallback } from "react";
import { MEAN_YEAR } from "../time.js";
import { MIN_SPP, MAX_SPP } from "../time.js";

/* ------------------------------------------------------------------ the rail */
export const RAIL_UNITS = [
  { label: "SEC", sec: 1 }, { label: "MIN", sec: 60 }, { label: "HR", sec: 3600 },
  { label: "DAY", sec: 86400 }, { label: "MON", sec: 2629800 }, { label: "YR", sec: MEAN_YEAR },
  { label: "KYR", sec: MEAN_YEAR * 1e3 }, { label: "MYR", sec: MEAN_YEAR * 1e6 },
  { label: "GYR", sec: MEAN_YEAR * 1e9 },
];
export const LOG_MIN = Math.log(MIN_SPP), LOG_MAX = Math.log(MAX_SPP);
export const sppToFrac = (spp) => (Math.log(spp) - LOG_MIN) / (LOG_MAX - LOG_MIN);
export const fracToSpp = (f) => Math.exp(LOG_MIN + f * (LOG_MAX - LOG_MIN));

export function ScaleRail({ spp, onSet }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const setFromEvent = useCallback((e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    onSet(fracToSpp(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))));
  }, [onSet]);
  useEffect(() => {
    const move = (e) => { if (dragging.current) { e.preventDefault(); setFromEvent(e); } };
    const up = () => { dragging.current = false; };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [setFromEvent]);
  const frac = Math.max(0, Math.min(1, sppToFrac(spp)));
  return (
    <div className="rail-wrap">
      <div className="rail" ref={ref}
        onPointerDown={(e) => { dragging.current = true; setFromEvent(e); }}
        role="slider" aria-label="Zoom scale" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); onSet(fracToSpp(Math.max(0, frac - 0.02))); }
          if (e.key === "ArrowRight") { e.preventDefault(); onSet(fracToSpp(Math.min(1, frac + 0.02))); }
        }}>
        <div className="rail-track" />
        {RAIL_UNITS.map((u) => {
          const f = sppToFrac(u.sec / 100);
          if (f < -0.02 || f > 1.02) return null;
          return (
            <button key={u.label} className="rail-grad"
              style={{ left: Math.max(0, Math.min(1, f)) * 100 + "%" }}
              onPointerDown={(e) => { e.stopPropagation(); onSet(u.sec / 100); }}>
              <span className="rail-grad-tick" />
              <span className="rail-grad-label">{u.label}</span>
            </button>
          );
        })}
        <div className="rail-knob" style={{ left: frac * 100 + "%" }} />
      </div>
    </div>
  );
}
