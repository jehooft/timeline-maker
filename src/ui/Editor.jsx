/* Editor.jsx — the add/edit form. Parses dates as you type and enforces the
   era tree rules before it will let you save. */
import React, { useState } from "react";
import { parseDateInput, fmtInstant } from "../time.js";
import { SYMBOL_KEYS, SymbolChip } from "../symbols.jsx";
import { IMAGE_MAX } from "../images.js";
import { PALETTE, descendantsOf, siblingClash, escapesParent, containedSiblings } from "../model.js";

/* ----------------------------------------------------------------- the editor */
export function Editor({ draft, doc, onField, onSave, onDelete, onClose, onPickImage,
  onLinkImage, onClearImage }) {
  const [confirming, setConfirming] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlOpen, setUrlOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const isEra = draft.kind === "era";
  const startParse = parseDateInput(draft.startStr);
  const endParse = draft.endStr.trim() ? parseDateInput(draft.endStr) : null;
  const endBlank = !draft.endStr.trim();
  const order = !startParse || !endParse || endParse.t >= startParse.t;
  const image = draft.imageId ? doc.images[draft.imageId] : null;
  const cat = doc.categories.find((c) => c.id === draft.cat);

  /* Live era-tree checks */
  let clash = null, escapes = null, adoptable = null, parentOptions = [];
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
        /* An overlap that is really containment has a second way out: this era
           is the broader one, so it can take the eras it covers as children. */
        if (clash) adoptable = containedSiblings(doc.eras, candidate);
      }
    }
  }

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { onPickImage(f); return; }
    const url = e.dataTransfer && e.dataTransfer.getData("text/uri-list").trim();
    if (url) onLinkImage(url);
  };

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

        {clash && adoptable && (
          <div className="notice warn">
            This era covers {adoptable.length === 1
              ? <b>{adoptable[0].title}</b>
              : <><b>{adoptable.length} eras</b> at the same level ({adoptable.map((r) => r.title).join(", ")})</>}
            . Eras side by side may not overlap, but a broader era can hold {adoptable.length === 1 ? "it" : "them"}.
            <button className="btn small" style={{ marginTop: 9, display: "block" }}
              onClick={() => onSave(adoptable.map((r) => r.id))}>
              Nest {adoptable.length === 1 ? "it" : "them"} inside this era
            </button>
          </div>
        )}
        {clash && !adoptable && (
          <p className="notice bad">
            Overlaps <b>{clash.title}</b>, which sits at the same level.
            Eras side by side may touch but not overlap — set “Within” to nest this one instead,
            or change the dates so they only meet at the edge.
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
              Marked events keep a halo and their label, and are never merged
              into a cluster with ordinary events. Their pinned pictures sit
              wherever they fit like any other, but are the last to be folded
              away when the room above the axis runs out.
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

        <div className="fld"
          onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
          onDrop={onDrop}>
          <span>Image</span>
          {image ? (
            <div className="imgbox">
              <img src={image.thumb} alt="" />
              <div className="imgmeta">
                <b>{image.name}</b>
                <em>{image.external ? "linked" : image.w + " × " + image.h}</em>
                <button className="btn small" onClick={onClearImage}>Remove</button>
              </div>
            </div>
          ) : (
            <>
              <label className={"filebtn" + (dragOver ? " over" : "")}>
                {dragOver ? "Drop it here" : "Choose an image, or drag one in"}
                <input type="file" accept="image/*" onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) onPickImage(f);
                  e.target.value = "";
                }} />
              </label>
              {urlOpen ? (
                <div className="urlrow">
                  <input value={urlDraft} autoFocus placeholder="https://example.com/picture.jpg"
                    onChange={(e) => setUrlDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { onLinkImage(urlDraft); setUrlDraft(""); setUrlOpen(false); }
                      if (e.key === "Escape") { setUrlOpen(false); setUrlDraft(""); }
                    }} />
                  <button className="btn small" disabled={!urlDraft.trim()}
                    onClick={() => { onLinkImage(urlDraft); setUrlDraft(""); setUrlOpen(false); }}>Use</button>
                </div>
              ) : (
                <button className="btn small linkbtn" onClick={() => setUrlOpen(true)}>Link one by URL</button>
              )}
            </>
          )}
          {image && (
            <label className="check">
              <input type="checkbox" checked={!!draft.pinImage}
                onChange={(e) => onField("pinImage", e.target.checked)} />
              <span>Pin above the timeline</span>
            </label>
          )}
          {image && (
            <em className="hint">
              {image.external
                ? "Held as a link — costs no storage, but breaks if the address dies."
                : "Downscaled to " + IMAGE_MAX + "px on the long side."}
            </em>
          )}
        </div>

        <label className="fld">
          <span>Description</span>
          <textarea rows={4} value={draft.desc} onChange={(e) => onField("desc", e.target.value)}
            placeholder="What happened, and why it matters." />
        </label>

        <label className="fld">
          <span>Links <i>one per line</i></span>
          <textarea rows={2} value={draft.linksStr || ""}
            onChange={(e) => onField("linksStr", e.target.value)}
            placeholder="https://en.wikipedia.org/wiki/Donkey_Kong" />
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
        {/* onSave takes an optional list of eras to adopt, so the click event
            must not be passed through as one. */}
        <button className="btn primary" disabled={!valid} onClick={() => onSave()} style={{ marginLeft: "auto" }}>
          {draft.id ? "Save changes" : "Add to timeline"}
        </button>
      </div>
    </aside>
  );
}
