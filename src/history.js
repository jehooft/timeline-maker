/* history.js — undo and redo.

   The document is small and always replaced wholesale, so the simplest thing
   that works is a stack of whole documents rather than a diff log. A timeline
   with a thousand events is well under a megabyte, and nothing here is cloned:
   every edit already produces a new object, so past states share structure with
   the present one.

   Consecutive edits of the same kind to the same item coalesce, so typing a
   title is one undo step rather than forty. */

const LIMIT = 60;
const COALESCE_MS = 900;

export function makeHistory(initial) {
  return { past: [], present: initial, future: [], lastTag: null, lastAt: 0 };
}

/* tag: a label like "edit:e12". Repeats within the window merge into one step. */
export function commit(h, next, tag = null) {
  if (next === h.present) return h;
  const now = Date.now();
  const merge = tag !== null && tag === h.lastTag && now - h.lastAt < COALESCE_MS;
  if (merge) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  const past = [...h.past, h.present];
  if (past.length > LIMIT) past.shift();
  return { past, present: next, future: [], lastTag: tag, lastAt: now };
}

export function undo(h) {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1];
  return { past, present, future: [h.present, ...h.future], lastTag: null, lastAt: 0 };
}

export function redo(h) {
  if (!h.future.length) return h;
  const [present, ...future] = h.future;
  return { past: [...h.past, h.present], present, future, lastTag: null, lastAt: 0 };
}

/* Switching timelines starts a fresh history — undoing across documents would
   silently resurrect a timeline you had moved on from. */
export const reset = (present) => makeHistory(present);

export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;
