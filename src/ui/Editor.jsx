/* Editor.jsx — the add/edit form. Parses dates as you type and enforces the
   era tree rules before it will let you save. */
import React, { useState } from "react";
import { parseDateInput, fmtInstant } from "../time.js";
import { SYMBOL_KEYS, SymbolChip } from "../symbols.jsx";
import { IMAGE_MAX } from "../images.js";
import { PALETTE, descendantsOf, siblingClash, escapesParent } from "../model.js";

/* ----------------------------------------------------------------- the editor */
export function Editor({ draft, doc, onField, onSave, onDelete, onClose, onPickImage, onClearImage }) {
  const [confirming, setConfirming] = useState(false);
  const isEra = draft.kind === "era";
  const startParse = parseDateInput(draft.startStr);
  const endParse = draft.endStr.trim() ? parseDateInput(draft.endStr) : null;
  const endBlank = !draft.endStr.trim();
  const order = !startParse || !endParse || endParse.t >= startParse.t;
  const image = draft.imageId ? doc.images[draft.imageId] : null;
  const cat = doc.categories.find((c) => c.id === draft.cat);

  /* Live era-tree checks */
  let clash = null, escapes = null, parentOptions = [];
  if (isEra) {
    const blocked = draft.id ? descendantsOf(doc.eras, draft.id) : new Set();
    parentOptions = doc.eras.filter((r) => r.cat === draft.cat && !blocked.has(r.id));
    if (startParse) {
      const candidate = {
        id: draft.id || "__new__", cat: draft.cat, parent: draft.parent || null,
        start: startParse, end: endBlank ? null : endParse,
      };
      if (endBlank || (endParse && order)) {
        clash = siblingClash(doc.eras, candidate);
        escapes = escapesParent(doc.eras, candidate);
      }
    }
  }

  const valid = draft.title.trim() && startParse && (endBlank || endParse) && order && !clash;

  return (
    <aside className="drawer" aria-label={draft.id ? "Edit item" : "New item"}>
      <div className="drawer-head">
        <h2>{draft.id ? "Edit" : "New"} {isEra ? "era" : "event"}</h2>
        <button className="card-x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="drawer-body">
        <label className="fld">
          <span>Title</span>
          <input value={draft.title} autoFocus
            onChange={(e) => onField("title", e.target.value)}
            placeholder={isEra ? "The Age of Arcade" : "Donkey Kong released"} />
        </label>

        <label className="fld">
          <span>Category</span>
          <select value={draft.cat} onChange={(e) => { onField("cat", e.target.value); if (isEra) onField("parent", ""); }}>
            {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        {isEra && (
          <label className="fld">
            <span>Within <i>optional</i></span>
            <select value={draft.parent || ""} onChange={(e) => onField("parent", e.target.value)}>
              <option value="">Top level</option>
              {parentOptions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <em className="hint">Nest an era to let it overlap another in the same category.</em>
          </label>
        )}

        <label className="fld">
          <span>Start</span>
          <input value={draft.startStr} className={draft.startStr && !startParse ? "err" : ""}
            onChange={(e) => onField("startStr", e.target.value)}
            placeholder="1981-07-09  ·  44 BCE  ·  13.8 Gya" />
          <em className={startParse ? "hint ok" : "hint bad"}>
            {startParse
              ? "→ " + fmtInstant(startParse.t, startParse.precision) + "  (" + startParse.precision + ")"
              : draft.startStr ? "Not a date I recognise" : "Year, ISO date, BCE, or deep time"}
          </em>
        </label>

        <label className="fld">
          <span>End <i>optional</i></span>
          <input value={draft.endStr} className={draft.endStr && !endParse ? "err" : ""}
            onChange={(e) => onField("endStr", e.target.value)}
            placeholder={isEra ? "leave blank for ongoing" : "leave blank for a point in time"} />
          <em className={endBlank ? "hint" : endParse && order ? "hint ok" : "hint bad"}>
            {endBlank
              ? isEra ? "Runs to the edge of the view" : "Shows as a single symbol"
              : !endParse ? "Not a date I recognise"
                : !order ? "End falls before start"
                  : "→ " + fmtInstant(endParse.t, endParse.precision) + "  (" + endParse.precision + ")"}
          </em>
        </label>

        {clash && (
          <p className="notice bad">
            Overlaps <b>{clash.title}</b>, which sits at the same level.
            Eras side by side may touch but not overlap — set “Within” to nest this one instead.
          </p>
        )}
        {!clash && escapes && (
          <p className="notice warn">
            Reaches outside <b>{escapes.title}</b>. That still draws, but a sub-era normally
            stays inside the era that contains it.
          </p>
        )}

        {!isEra && (
          <div className="fld">
            <span>Emphasis</span>
            <label className="check">
              <input type="checkbox" checked={!!draft.important}
                onChange={(ev) => onField("important", ev.target.checked)} />
              <span>Important event</span>
            </label>
            <em className="hint">
              Marked events keep a halo and their label, are never merged into a
              cluster with ordinary events, and their pinned pictures win the
              front row when space runs short.
            </em>
          </div>
        )}

        {!isEra && (
          <div className="fld">
            <span>Symbol</span>
            <div className="symgrid">
              {SYMBOL_KEYS.map((k) => (
                <button key={k} type="button"
                  className={"symbtn" + (draft.sym === k ? " on" : "")}
                  onClick={() => onField("sym", k)} title={k} aria-pressed={draft.sym === k}>
                  <SymbolChip name={k} color={draft.color || (cat ? cat.color : "#888")} size={20} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="fld">
          <span>Colour</span>
          <div className="swatches">
            <button type="button" className={"sw" + (!draft.color ? " on" : "")}
              onClick={() => onField("color", "")} title="Use the category colour">
              <span className="sw-auto" style={{ background: cat ? cat.color : "#888" }} />
            </button>
            {PALETTE.map((c) => (
              <button key={c} type="button" className={"sw" + (draft.color === c ? " on" : "")}
                onClick={() => onField("color", c)} title={c}>
                <span style={{ background: c }} />
              </button>
            ))}
            <input type="color" className="sw-custom" value={draft.color || (cat ? cat.color : "#888888")}
              onChange={(e) => onField("color", e.target.value)} title="Custom colour" />
          </div>
        </div>

        <div className="fld">
          <span>Image</span>
          {image ? (
            <div className="imgbox">
              <img src={image.thumb} alt="" />
              <div className="imgmeta">
                <b>{image.name}</b>
                <em>{image.w} × {image.h}</em>
                <button className="btn small" onClick={onClearImage}>Remove</button>
              </div>
            </div>
          ) : (
            <label className="filebtn">
              Choose an image
              <input type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) onPickImage(f);
                e.target.value = "";
              }} />
            </label>
          )}
          {image && (
            <label className="check">
              <input type="checkbox" checked={!!draft.pinImage}
                onChange={(e) => onField("pinImage", e.target.checked)} />
              <span>Pin above the timeline</span>
            </label>
          )}
          {image && <em className="hint">Downscaled to {IMAGE_MAX}px on the long side.</em>}
        </div>

        <label className="fld">
          <span>Description</span>
          <textarea rows={4} value={draft.desc} onChange={(e) => onField("desc", e.target.value)}
            placeholder="What happened, and why it matters." />
        </label>

        <label className="fld">
          <span>Tags <i>comma separated</i></span>
          <input value={draft.tagsStr} onChange={(e) => onField("tagsStr", e.target.value)}
            placeholder="nintendo, arcade" />
        </label>
      </div>

      <div className="drawer-foot">
        {draft.id && (
          confirming ? (
            <>
              <button className="btn danger" onClick={onDelete}>Delete for good</button>
              <button className="btn" onClick={() => setConfirming(false)}>Keep</button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirming(true)}>Delete</button>
          )
        )}
        <button className="btn primary" disabled={!valid} onClick={onSave} style={{ marginLeft: "auto" }}>
          {draft.id ? "Save changes" : "Add to timeline"}
        </button>
      </div>
    </aside>
  );
}
