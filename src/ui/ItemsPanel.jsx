/* ItemsPanel.jsx — the contents list: categories, their era trees and their
   events, with the controls for reordering and editing categories. */
import React from "react";
import { fmtInstant } from "../time.js";
import { SymbolChip } from "../symbols.jsx";

/* ------------------------------------------------------------- the items panel */
export function ItemsPanel({ doc, index, collapsed, expanded, selectedId, persistent, hidden, onToggleHidden, onAdd, onAddCategory,
  onEditItem, onGoto, onMoveCategory, onToggleCollapse, onToggleExpand,
  onCategoryField, onDeleteCategory, onRename, editingCat, setEditingCat }) {

  const counts = new Map(doc.categories.map((c) => [c.id, 0]));
  for (const it of index.items) counts.set(it.cat, (counts.get(it.cat) || 0) + 1);

  /* Eras listed depth-first so the tree reads top-down, like the strip does. */
  const eraTreeOf = (catId) => {
    const out = [];
    const walk = (parent, depth) => {
      doc.eras
        .filter((r) => r.cat === catId && (r.parent || null) === parent)
        .sort((a, b) => Number(a.start.t - b.start.t))
        .forEach((r) => { out.push({ era: r, depth }); if (depth < 8) walk(r.id, depth + 1); });
    };
    walk(null, 0);
    return out;
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
          const eras = eraTreeOf(cat.id);
          const evs = doc.events.filter((e) => e.cat === cat.id);
          const open = expanded.has(cat.id);
          const isCollapsed = collapsed.has(cat.id);
          return (
            <div className={"cat" + (hidden.has(cat.id) ? " is-off" : "")} key={cat.id}>
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
              )}

              {open && (
                <div className="cat-items">
                  {eras.map(({ era: r, depth }) => (
                    <div key={r.id} className={"item" + (selectedId === r.id ? " sel" : "")}>
                      <button className="item-main" onClick={() => onGoto(r)}
                        style={{ paddingLeft: 26 + depth * 12 }}>
                        <span className="era-mark" style={{ background: r.color || cat.color }} />
                        <span className="item-title">{r.title}</span>
                        <span className="item-date">{fmtInstant(r.start.t, r.start.precision)}</span>
                      </button>
                      <button className="item-edit" onClick={() => onEditItem(r, "era")} aria-label="Edit">✎</button>
                    </div>
                  ))}
                  {evs.map((e) => (
                    <div key={e.id} className={"item" + (selectedId === e.id ? " sel" : "")}>
                      <button className="item-main" onClick={() => onGoto(e)}>
                        <SymbolChip name={e.sym} color={e.color || cat.color} size={14} />
                        <span className={"item-title" + (e.important ? " key" : "")}>{e.title}</span>
                        {e.important && <span className="item-star" title="Important">★</span>}
                        <span className="item-date">{fmtInstant(e.start.t, e.start.precision)}</span>
                      </button>
                      <button className="item-edit" onClick={() => onEditItem(e, "event")} aria-label="Edit">✎</button>
                    </div>
                  ))}
                  {eras.length + evs.length === 0 && <p className="empty">Nothing here yet.</p>}
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
