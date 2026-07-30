/* Editor.jsx — the add/edit form. Parses dates as you type and enforces the
   era tree rules before it will let you save. */
import React, { useState } from "react";
import { parseDateInput, fmtInstant, nowT } from "../time.js";
import { SYMBOL_KEYS, SymbolChip } from "../symbols.jsx";
import { IMAGE_MAX } from "../images.js";
import {
  PALETTE, siblingClash, IMP, IMP_LEVELS, layersOf, parentsOf,
} from "../model.js";

/* ----------------------------------------------------------------- the editor */
export function Editor({ draft, doc, onField, onSave, onDelete, onClose, onPickImage,
  onLinkImage, onClearImage, customColors = [], onAddColor, onRemoveColor, onAddLayer }) {
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

  /* Live layer checks */
  const layerCount = isEra ? layersOf(doc, draft.cat) : 1;
  let clash = null, parents = [], orphan = false;
  if (isEra && startParse) {
    const candidate = {
      id: draft.id || "__new__", cat: draft.cat, layer: draft.layer || 0,
      start: startParse, end: endBlank ? null : endParse,
    };
    if (endBlank || (endParse && order)) {
      clash = siblingClash(doc.eras, candidate);
      parents = parentsOf(doc.eras, candidate);
      /* Sitting below a layer that has nothing covering this span is allowed —
         it just means the era has no family to fold away with. */
      orphan = (draft.layer || 0) > 0 && parents.length === 0;
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

  /* An era with a blank end has always meant open; an event needs the explicit
     checkbox. Either way, a span with nothing to fade from — because it has not
     even started yet — cannot be left permanently open. */
  const wouldBeOngoing = endBlank && (isEra || !!draft.ongoing);
  const futureOngoing = wouldBeOngoing && startParse && startParse.t > nowT();

  const valid = draft.title.trim() && startParse && (endBlank || endParse) && order && !clash && !futureOngoing;

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
          <select value={draft.cat} onChange={(e) => { onField("cat", e.target.value); if (isEra) onField("layer", 0); }}>
            {doc.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        {isEra && (
          <div className="fld">
            <span>Layer</span>
            <div className="layerrow">
              <select value={draft.layer || 0}
                onChange={(e) => onField("layer", parseInt(e.target.value, 10))}>
                {Array.from({ length: layerCount }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? "Layer 1 — broadest" : "Layer " + (i + 1)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn small" title="Insert a new layer above this one"
                onClick={() => { onAddLayer(draft.cat, draft.layer || 0); onField("layer", draft.layer || 0); }}>
                ↑ Layer
              </button>
              <button type="button" className="btn small" title="Insert a new layer below this one"
                onClick={() => { onAddLayer(draft.cat, (draft.layer || 0) + 1); onField("layer", (draft.layer || 0) + 1); }}>
                ↓ Layer
              </button>
            </div>
            <em className="hint">
              {parents.length
                ? "Sits under " + parents.map((r) => r.title).join(", ") + "."
                : (draft.layer || 0) === 0
                  ? "The top layer — nothing above it, so it never folds away."
                  : "Nothing on the layer above covers this span yet."}
              {" "}Eras on different layers may overlap freely; eras sharing one may not.
            </em>
          </div>
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
              ? isEra ? "Fades out into the future, rather than running forever"
                : draft.ongoing ? "Fades out into the future, rather than running forever"
                  : "Shows as a single symbol"
              : !endParse ? "Not a date I recognise"
                : !order ? "End falls before start"
                  : "→ " + fmtInstant(endParse.t, endParse.precision) + "  (" + endParse.precision + ")"}
          </em>
        </label>

        {!isEra && endBlank && (
          <label className="check">
            <input type="checkbox" checked={!!draft.ongoing}
              onChange={(e) => onField("ongoing", e.target.checked)} />
            <span>Ongoing — still happening</span>
          </label>
        )}

        {futureOngoing && (
          <p className="notice bad" style={{ marginTop: 10 }}>
            This starts in the future, so it can't be left open-ended — give it an end date,
            or move the start to the past.
          </p>
        )}

        {clash && (
          <div className="notice warn">
            Overlaps <b>{clash.title}</b> on the same layer. Eras sharing a layer may touch
            but not overlap — put this one on its own layer, or change the dates so they
            only meet at the edge.
            <button className="btn small" style={{ marginTop: 9, display: "block" }}
              onClick={() => onSave(true)}>
              Put it on a new layer above
            </button>
          </div>
        )}

        {!isEra && (
          <div className="fld">
            <span>Importance</span>
            <div className="impgrid">
              {IMP_LEVELS.map((lvl) => (
                <button key={lvl.key} type="button"
                  className={"impbtn imp-" + lvl.key + ((draft.imp ?? IMP.NORMAL) === lvl.v ? " on" : "")}
                  onClick={() => onField("imp", lvl.v)} aria-pressed={(draft.imp ?? IMP.NORMAL) === lvl.v}>
                  {lvl.label}
                </button>
              ))}
            </div>
            <em className="hint">
              {(draft.imp ?? IMP.NORMAL) === IMP.CRITICAL
                ? "Two rings, never clusters even with other Critical events, and its pinned picture is the last thing folded away."
                : (draft.imp ?? IMP.NORMAL) === IMP.IMPORTANT
                  ? "A halo and its label always show, and it clusters only with other Important events."
                  : (draft.imp ?? IMP.NORMAL) === IMP.UNIMPORTANT
                    ? "Drawn a little smaller; its label hides when a stronger event sits close by."
                    : (draft.imp ?? IMP.NORMAL) === IMP.TRIVIAL
                      ? "Small, and its title never shows on the timeline — only in this card, on click."
                      : "The default weight and behaviour."}
              {" "}Events only cluster with others of the same importance.
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
            {/* Kept colours sit alongside the built-in ones; right-click drops
                one again, so the row cannot silently fill up for good. */}
            {customColors.map((c) => (
              <button key={c} type="button" className={"sw saved" + (draft.color === c ? " on" : "")}
                onClick={() => onField("color", c)}
                onContextMenu={(e) => { e.preventDefault(); onRemoveColor(c); }}
                title={c + " — right-click to forget"}>
                <span style={{ background: c }} />
              </button>
            ))}
            <input type="color" className="sw-custom" value={draft.color || (cat ? cat.color : "#888888")}
              onChange={(e) => onField("color", e.target.value)} title="Mix a colour" />
            <button type="button" className="sw sw-add"
              disabled={!draft.color || PALETTE.includes(draft.color) || customColors.includes(draft.color)}
              onClick={() => onAddColor(draft.color)}
              title="Keep this colour in the palette">+</button>
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
