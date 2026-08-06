/* Library.jsx — the saved timelines: switching between them, and the doors in
   and out of the app (JSON for fidelity, CSV for spreadsheets). */
import React, { useRef, useState } from "react";

export function Library({ entries, currentId, busy, persistent, unexported, sizeNote, roomNote,
  onOpen, onNew, onDuplicate, onDelete, onExportJSON, onExportCSV, onImportFile, onCleanup, onClose }) {
  const [confirmId, setConfirmId] = useState(null);
  const fileRef = useRef(null);

  return (
    <div className="modal-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Timelines">
        <div className="modal-head">
          <h2>Timelines</h2>
          <button className="card-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!persistent && (
          <p className="notice warn" style={{ margin: "0 18px 12px" }}>
            No browser storage available here, so this session will be forgotten on reload.
            Export to a file to keep your work.
          </p>
        )}
        {persistent && unexported > 0 && (
          <p className="notice" style={{ margin: "0 18px 12px" }}>
            <b>{unexported}</b> change{unexported === 1 ? "" : "s"} since the last export.
            Browser storage can be cleared without warning, so an exported file is the real backup.
          </p>
        )}
        {/* Size on its own says nothing useful — "3 MB" only means something
            next to how much room there is. The second figure is the browser's
            own, covering every timeline at once, and is absent on the browsers
            that will not say. The two are labelled separately rather than
            summed because they measure different things: the first is how big
            this document is, the second is what it takes up on disk once the
            browser has compressed it. */}
        {persistent && sizeNote && (
          <p className="storagenote">
            This timeline is about <b>{sizeNote}</b>.
            {roomNote ? <> Browser storage: <b>{roomNote}</b>.</> : null}
          </p>
        )}

        <div className="modal-body">
          {entries.length === 0 && <p className="empty">No saved timelines yet.</p>}
          {entries.map((e) => (
            <div key={e.id} className={"tlrow" + (e.id === currentId ? " on" : "")}>
              <button className="tlrow-main" onClick={() => onOpen(e.id)} disabled={busy}>
                <span className="tlrow-name">{e.name || "Untitled"}</span>
                <span className="tlrow-meta">
                  {e.events} events · {e.eras} eras
                  {e.updatedAt ? " · " + new Date(e.updatedAt).toLocaleDateString() : ""}
                </span>
              </button>
              <span className="tlrow-tools">
                <button onClick={() => onDuplicate(e.id)} disabled={busy} title="Duplicate">⧉</button>
                {confirmId === e.id ? (
                  <>
                    <button className="danger" onClick={() => { onDelete(e.id); setConfirmId(null); }}>Delete</button>
                    <button onClick={() => setConfirmId(null)}>Keep</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmId(e.id)} disabled={busy || entries.length < 2}
                    title={entries.length < 2 ? "This is your only timeline" : "Delete"}>✕</button>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onNew} disabled={busy}>New</button>
          {/* A real button rather than a label wrapping the input: `disabled` has
              no effect on a label, so it never greyed out yet the disabled input
              inside it silently swallowed every click. */}
          <button className="btn" disabled={busy}
            onClick={() => fileRef.current && fileRef.current.click()}>Import</button>
          <input ref={fileRef} type="file" style={{ display: "none" }}
            accept=".json,.csv,.txt,text/csv,application/json"
            onChange={(ev) => {
              const f = ev.target.files && ev.target.files[0];
              ev.target.value = "";
              if (f) onImportFile(f);
            }} />
          {/* A picture nothing points at any more — left behind by a deleted
              item, or one that got swapped for another — is swept up on its
              own the next time the app is opened. This is the same sweep, for
              anyone who is already over quota and does not want to wait. */}
          <button className="btn" onClick={onCleanup} disabled={busy}
            title="Remove pictures no longer used by any saved timeline">Clean up</button>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button className="btn" onClick={onExportCSV} disabled={busy}>Export CSV</button>
            <button className="btn primary" onClick={onExportJSON} disabled={busy}>Export JSON</button>
          </span>
        </div>
      </div>
    </div>
  );
}
