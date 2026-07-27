/* ContextMenu.jsx — right-click (or long-press) on an item.

   The actions that were previously only reachable by opening the detail card
   and then the editor, plus duplicate, which had no route at all. */
import React, { useEffect, useRef } from "react";

export function ContextMenu({ menu, stage, onEdit, onDuplicate, onTogglePin, onDelete, onClose }) {
  const ref = useRef(null);
  const { item, kind } = menu;
  const isEra = kind === "era";

  /* Close on anything that isn't a click inside the menu. */
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const W = 170, H = 148;
  const left = Math.max(6, Math.min(stage.w - W - 6, menu.x));
  const top = Math.max(6, Math.min(stage.h - H - 6, menu.y));

  return (
    <div className="ctxmenu" ref={ref} style={{ left, top, width: W }}
      role="menu" aria-label={item.title}>
      <p className="ctx-head" title={item.title}>{item.title}</p>
      <button role="menuitem" onClick={onEdit}>Edit…</button>
      <button role="menuitem" onClick={onDuplicate}>
        {isEra ? "Duplicate…" : "Duplicate"}
      </button>
      <button role="menuitem" disabled={!item.imageId} onClick={onTogglePin}
        title={item.imageId ? "" : "This item has no picture"}>
        {item.pinImage ? "Unpin picture" : "Pin picture above"}
      </button>
      <span className="ctx-sep" />
      <button role="menuitem" className="danger" onClick={onDelete}>Delete</button>
    </div>
  );
}
