/* ItemsPanel.jsx — the contents list: categories, their era trees and their
   events, with the controls for reordering and editing categories. */
import React from "react";
import { fmtInstant } from "../time.js";
import { SymbolChip } from "../symbols.jsx";
import { IMP, layersOf, eraLayer } from "../model.js";

/* ------------------------------------------------------------- the items panel */
export function ItemsPanel({ doc, index, collapsed, expanded, selectedId, persistent, hidden, onToggleHidden, onAdd, onAddCategory,
  onEditItem, onGoto, onMoveCategory, onToggleCollapse, onToggleExpand,
  onCategoryField, onDeleteCategory, onRename, editingCat, setEditingCat,
  activeCat, onActivateCat, onAddLayer, onRemoveLayer }) {

  const counts = new Map(doc.categories.map((c) => [c.id, 0]));
  for (const it of index.items) counts.set(it.cat, (counts.get(it.cat) || 0) + 1);

  /* Listed layer by layer, broadest first, which is how the strip stacks them. */
  const eraLayersOf = (catId) => {
    const n = layersOf(doc, catId);
    return Array.from({ length: n }, (_, layer) => ({
      layer,
      eras: doc.eras
        .filter((r) => r.cat === catId && eraLayer(r) === layer)
        .sort((a, b) => Number(a.start.t - b.start.t)),
    }));
  };

  return (
    <aside className="panel" aria-label="Timeline contents">
      <div className="panel-head">
        <input className="tl-name" value={doc.name} onChange={(e) => onRename(e.target.value)}
          aria-label="Timeline name" />
        <div className="panel-actions">
          <button className="btn small" onClick={() => onAdd("event")}>+ Event</button>
          <button className="btn small" onClick={() => onAdd("era")}>+ Era</button>
          <button className="btn small" onClick={onAddCategory}>+ Category</button>
        </div>
      </div>

      <div className="panel-body">
        {doc.categories.map((cat, ci) => {
          const layers = eraLayersOf(cat.id);
          const evs = doc.events.filter((e) => e.cat === cat.id);
          const open = expanded.has(cat.id);
          const isCollapsed = collapsed.has(cat.id);
          return (
            <div className={"cat" + (hidden.has(cat.id) ? " is-off" : "")
              + (activeCat === cat.id ? " is-active" : "")} key={cat.id}
              onPointerDownCapture={() => onActivateCat && onActivateCat(cat.id)}>
              <div className="cat-head">
                <button className="twist" onClick={() => onToggleExpand(cat.id)}
                  aria-expanded={open} aria-label={open ? "Hide items" : "Show items"}>
                  {open ? "▾" : "▸"}
                </button>
                <span className="swatch" style={{ background: cat.color }} />
                <span className="cat-name">{cat.name}</span>
                <span className="cat-count">{counts.get(cat.id) || 0}</span>
                {/* Always visible, not hover-only: it is the only way back once
                    a category has been hidden. */}
                <button className={"eye" + (hidden.has(cat.id) ? " off" : "")}
                  aria-pressed={hidden.has(cat.id)}
                  title={hidden.has(cat.id) ? "Show on the timeline" : "Hide from the timeline"}
                  onClick={() => onToggleHidden(cat.id)}>
                  {hidden.has(cat.id) ? "◌" : "◉"}
                </button>
                <span className="cat-tools">
                  <button title="Move up" disabled={ci === 0} onClick={() => onMoveCategory(ci, -1)}>▲</button>
                  <button title="Move down" disabled={ci === doc.categories.length - 1}
                    onClick={() => onMoveCategory(ci, 1)}>▼</button>
                  <button title={isCollapsed ? "Expand band" : "Collapse band"}
                    className={isCollapsed ? "on" : ""} onClick={() => onToggleCollapse(cat.id)}>
                    {isCollapsed ? "⊞" : "⊟"}
                  </button>
                  <button title="Edit category" className={editingCat === cat.id ? "on" : ""}
                    onClick={() => setEditingCat(editingCat === cat.id ? null : cat.id)}>✎</button>
                </span>
              </div>

              {editingCat === cat.id && (
                <>
                  <div className="cat-edit">
                    <input value={cat.name} onChange={(e) => onCategoryField(cat.id, "name", e.target.value)}
                      aria-label="Category name" />
                    <input type="color" value={cat.color}
                      onChange={(e) => onCategoryField(cat.id, "color", e.target.value)}
                      aria-label="Category colour" />
                    <button className="btn small danger" disabled={doc.categories.length < 2}
                      onClick={() => onDeleteCategory(cat.id)}
                      title={doc.categories.length < 2 ? "A timeline needs at least one category" : "Delete and move its items"}>
                      Delete
                    </button>
                  </div>
                  <div className="cat-layers">
                    <span>{layers.length} layer{layers.length === 1 ? "" : "s"}</span>
                    <button className="btn small" onClick={() => onAddLayer(cat.id, 0)}
                      title="Add a layer above everything — the eras below become its children">
                      + Above
                    </button>
                    <button className="btn small" onClick={() => onAddLayer(cat.id, layers.length)}
                      title="Add a layer below everything">+ Below</button>
                  </div>
                </>
              )}

              {open && (
                <div className="cat-items">
                  {layers.map(({ layer, eras }) => (
                    <div key={layer}>
                      {layers.length > 1 && (
                        <div className="layer-head">
                          <span>Layer {layer + 1}</span>
                          {eras.length === 0 && (
                            <button title="Remove this empty layer"
                              onClick={() => onRemoveLayer(cat.id, layer)}>✕</button>
                          )}
                        </div>
                      )}
                      {eras.map((r) => (
                        <div key={r.id} className={"item" + (selectedId === r.id ? " sel" : "")}>
                          <button className="item-main" onClick={() => onGoto(r)}
                            style={{ paddingLeft: 26 + layer * 12 }}>
                            <span className="era-mark" style={{ background: r.color || cat.color }} />
                            <span className="item-title">{r.title}</span>
                            <span className="item-date">{fmtInstant(r.start.t, r.start.precision)}</span>
                          </button>
                          <button className="item-edit" onClick={() => onEditItem(r, "era")} aria-label="Edit">✎</button>
                        </div>
                      ))}
                    </div>
                  ))}
                  {evs.map((e) => {
                    const imp = e.imp ?? IMP.NORMAL;
                    return (
                      <div key={e.id} className={"item" + (selectedId === e.id ? " sel" : "")}>
                        <button className="item-main" onClick={() => onGoto(e)}>
                          <SymbolChip name={e.sym} color={e.color || cat.color} size={14} />
                          <span className={"item-title" + (imp >= IMP.IMPORTANT ? " key" : "")
                            + (imp <= IMP.UNIMPORTANT ? " dim" : "")}>{e.title}</span>
                          {imp === IMP.CRITICAL && <span className="item-star" title="Critical">★★</span>}
                          {imp === IMP.IMPORTANT && <span className="item-star" title="Important">★</span>}
                          <span className="item-date">{fmtInstant(e.start.t, e.start.precision)}</span>
                        </button>
                        <button className="item-edit" onClick={() => onEditItem(e, "event")} aria-label="Edit">✎</button>
                      </div>
                    );
                  })}
                  {doc.eras.filter((r) => r.cat === cat.id).length + evs.length === 0
                    && <p className="empty">Nothing here yet.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="panel-note">{persistent ? "Changes save automatically" : "Not saved — export to keep your work"}</p>
    </aside>
  );
}
