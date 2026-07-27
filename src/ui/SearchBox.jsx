/* SearchBox.jsx — find an item by name and jump to it.
   Arrow keys move through results, Enter takes you there, Escape closes. */
import React, { useState, useRef, useEffect } from "react";
import { fmtInstant } from "../time.js";
import { SymbolChip } from "../symbols.jsx";

export function SearchBox({ doc, results, query, onQuery, onPick, onClose }) {
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const el = listRef.current && listRef.current.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[active]) onPick(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="search" role="dialog" aria-label="Search">
      <div className="search-bar">
        <input ref={inputRef} value={query} onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey} placeholder="Search events and eras…" aria-label="Search"
          role="combobox" aria-expanded={results.length > 0} aria-controls="search-results" />
        <button className="search-x" onClick={onClose} aria-label="Close search">×</button>
      </div>
      {query.trim() !== "" && (
        <div className="search-results" id="search-results" ref={listRef} role="listbox">
          {results.length === 0 && <p className="empty">Nothing matches.</p>}
          {results.map((it, i) => {
            const cat = doc.categories.find((c) => c.id === it.cat);
            const color = it.color || (cat ? cat.color : "#888");
            return (
              <button key={it.id} role="option" aria-selected={i === active}
                className={"search-row" + (i === active ? " on" : "")}
                onPointerEnter={() => setActive(i)} onClick={() => onPick(it)}>
                {it.kind === "era"
                  ? <span className="era-mark" style={{ background: color }} />
                  : <SymbolChip name={it.sym} color={color} size={14} />}
                <span className="search-title">{it.title}</span>
                <span className="search-meta">{fmtInstant(it.t0, it.start.precision)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
