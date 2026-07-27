/* images.js — intake for uploaded pictures. Everything is downscaled and
   re-encoded on the way in, which is what keeps stored timelines small. */

/* --------------------------------------------------------------- image intake
   Downscale on upload. A 4 MB phone photo becomes ~120 KB, which is what makes
   browser storage viable when Phase 6 starts writing these to disk. */
export const IMAGE_MAX = 1200;
export const THUMB_MAX = 160;

export function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}
export function loadImageEl(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("That file isn't an image we can read."));
    im.src = src;
  });
}
export function resample(im, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(im.width, im.height));
  const w = Math.max(1, Math.round(im.width * scale));
  const h = Math.max(1, Math.round(im.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(im, 0, 0, w, h);
  let out = c.toDataURL("image/webp", quality);
  if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", quality);
  return { url: out, w, h };
}
export async function processImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const raw = await fileToDataURL(file);
  const im = await loadImageEl(raw);
  const full = resample(im, IMAGE_MAX, 0.82);
  const thumb = resample(im, THUMB_MAX, 0.7);
  return {
    id: "img_" + Math.random().toString(36).slice(2, 9),
    name: file.name, url: full.url, thumb: thumb.url, w: full.w, h: full.h,
  };
}
