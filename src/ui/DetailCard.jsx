/* DetailCard.jsx — what you see when you click an item, and also the inert
   preview shown when resting on a pinned picture. */
import React from "react";
import { fmtInstant, fmtDur } from "../time.js";

/* ------------------------------------------------------------- the detail card
   Doubles as the hover preview for pinned images: same card, but inert and
   without the controls, so it can appear and vanish without stealing clicks. */
export function DetailCard({ item, doc, stage, anchor, preview, rightInset = 0, onClose, onEdit }) {
  const cat = doc.categories.find((c) => c.id === item.cat);
  const color = item.color || (cat ? cat.color : "#888");
  const image = item.imageId ? doc.images[item.imageId] : null;
  const W = 330;
  /* The editor drawer docks over the right edge, so the card has to be clamped
     against the space that is actually left rather than the whole stage. */
  const room = Math.max(W + 20, stage.w - rightInset);
  const left = Math.max(10, Math.min(room - W - 10, anchor.x - W / 2));
  const below = anchor.y + 300 < stage.h;
  const top = below ? anchor.y + 22 : Math.max(10, Math.min(anchor.y - 300, stage.h - 320));
  const isEra = item.kind === "era";
  const dur = item.isSpan && !item.open ? Number(item.t1 - item.t0) : null;

  const parent = isEra && item.parent ? doc.eras.find((r) => r.id === item.parent) : null;
  const children = isEra ? doc.eras.filter((r) => r.parent === item.id) : [];
  const within = !isEra
    ? doc.eras
      .filter((r) => r.cat === item.cat && r.start.t <= item.t0 && (!r.end || r.end.t >= item.t0))
      .sort((a, b) => Number(a.start.t - b.start.t))
    : [];

  return (
    <div className={"card" + (preview ? " preview" : "")} style={{ left, top, width: W }}
      role="dialog" aria-label={item.title}>
      {!preview && <button className="card-x" onClick={onClose} aria-label="Close">×</button>}
      {image && <img className="card-img" src={image.url} alt="" />}
      <div className="card-cat">
        <span className="swatch" style={{ background: cat ? cat.color : "#888" }} />
        {cat ? cat.name : "Uncategorised"}
        {item.important && <span className="card-star" title="Important event">★</span>}
        <span className="card-kind">{isEra ? (item.depth ? "Sub-era" : "Era") : item.isSpan ? "Span" : "Point"}</span>
      </div>
      <h2 className="card-title" style={{ color }}>{item.title}</h2>
      <div className="card-dates">
        <div className="row"><span>{item.isSpan ? "Start" : "Date"}</span><b>{fmtInstant(item.t0, item.start.precision)}</b></div>
        {item.isSpan && <div className="row"><span>End</span><b>{item.open ? "ongoing" : fmtInstant(item.t1, item.end.precision)}</b></div>}
        {dur !== null && <div className="row"><span>Duration</span><b>{fmtDur(dur)}</b></div>}
        <div className="row"><span>Known to</span><b>{item.start.precision}</b></div>
      </div>
      {item.desc && <p className="card-desc">{item.desc}</p>}
      {parent && (
        <div className="card-within"><span>Part of</span><em>{parent.title}</em></div>
      )}
      {children.length > 0 && (
        <div className="card-within">
          <span>Contains</span>
          {children.map((r) => <em key={r.id}>{r.title}</em>)}
        </div>
      )}
      {within.length > 0 && (
        <div className="card-within">
          <span>Falls within</span>
          {within.map((r) => <em key={r.id}>{r.title}</em>)}
        </div>
      )}
      {item.links && item.links.length > 0 && (
        <div className="card-links">
          {item.links.map((u) => (
            /* noopener/noreferrer: an outbound link must not hand the opened
               page a handle back to this one. */
            <a key={u} href={u} target="_blank" rel="noopener noreferrer"
              title={u} tabIndex={preview ? -1 : 0}>
              {u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </a>
          ))}
        </div>
      )}
      {item.tags && item.tags.length > 0 && (
        <div className="chips">{item.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>
      )}
      {!preview && (
        <div className="card-actions"><button className="btn small" onClick={() => onEdit(item)}>Edit</button></div>
      )}
    </div>
  );
}
