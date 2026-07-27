/* symbols.jsx — event glyphs, drawn as canvas paths so they stay crisp and
   take the event colour. SymbolChip renders one into a small canvas for the UI. */
import React, { useRef, useEffect } from "react";

/* ------------------------------------------------------------------- symbols */
export const SYMBOLS = {
  dot: (c, x, y, r) => { c.beginPath(); c.arc(x, y, r * 0.62, 0, 6.2832); c.fill(); },
  ring: (c, x, y, r) => { c.lineWidth = 1.8; c.beginPath(); c.arc(x, y, r * 0.62, 0, 6.2832); c.stroke(); },
  square: (c, x, y, r) => { const s = r * 0.58; c.fillRect(x - s, y - s, s * 2, s * 2); },
  diamond: (c, x, y, r) => {
    c.beginPath(); c.moveTo(x, y - r * 0.85); c.lineTo(x + r * 0.72, y);
    c.lineTo(x, y + r * 0.85); c.lineTo(x - r * 0.72, y); c.closePath(); c.fill();
  },
  triangle: (c, x, y, r) => {
    c.beginPath(); c.moveTo(x, y - r * 0.85); c.lineTo(x + r * 0.82, y + r * 0.6);
    c.lineTo(x - r * 0.82, y + r * 0.6); c.closePath(); c.fill();
  },
  star: (c, x, y, r) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.42 : r;
      c[i ? "lineTo" : "moveTo"](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
  },
  flag: (c, x, y, r) => {
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(x - r * 0.5, y + r); c.lineTo(x - r * 0.5, y - r); c.stroke();
    c.beginPath(); c.moveTo(x - r * 0.5, y - r); c.lineTo(x + r * 0.9, y - r * 0.55);
    c.lineTo(x - r * 0.5, y - r * 0.1); c.closePath(); c.fill();
  },
  pin: (c, x, y, r) => {
    c.beginPath(); c.moveTo(x, y + r); c.quadraticCurveTo(x + r * 0.85, y - r * 0.15, x, y - r);
    c.quadraticCurveTo(x - r * 0.85, y - r * 0.15, x, y + r); c.closePath(); c.fill();
  },
  cross: (c, x, y, r) => {
    c.lineWidth = 2; c.lineCap = "round"; const s = r * 0.66;
    c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s);
    c.moveTo(x + s, y - s); c.lineTo(x - s, y + s); c.stroke(); c.lineCap = "butt";
  },
  plus: (c, x, y, r) => {
    const s = r * 0.85, w = r * 0.3;
    c.fillRect(x - w, y - s, w * 2, s * 2); c.fillRect(x - s, y - w, s * 2, w * 2);
  },
  bolt: (c, x, y, r) => {
    c.beginPath(); c.moveTo(x + r * 0.35, y - r); c.lineTo(x - r * 0.55, y + r * 0.12);
    c.lineTo(x + r * 0.02, y + r * 0.12); c.lineTo(x - r * 0.3, y + r);
    c.lineTo(x + r * 0.6, y - r * 0.18); c.lineTo(x - r * 0.02, y - r * 0.18);
    c.closePath(); c.fill();
  },
  hex: (c, x, y, r) => {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      c[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
    }
    c.closePath(); c.fill();
  },
};
export const SYMBOL_KEYS = Object.keys(SYMBOLS);
export function drawSymbol(ctx, name, x, y, r, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color;
  (SYMBOLS[name] || SYMBOLS.dot)(ctx, x, y, r);
}

/* A symbol rendered into a small canvas, for the picker and the item list. */
export function SymbolChip({ name, color, size = 20 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawSymbol(ctx, name, size / 2, size / 2, size * 0.34, color);
  }, [name, color, size]);
  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />;
}
