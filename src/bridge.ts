// The only coupling between React and the legacy code while the move is in progress.
// The legacy side calls notify() after it renders and setStudyBadge() as the timer runs;
// React components subscribe. This module imports nothing, so either side can use it.

type Listener = () => void;
const listeners = new Set<Listener>();
let studyBadge: string | null = null;
let version = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Something React may show has changed: the legacy `ui`, the store, or sync status. */
export function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

/** Bumped by every notify(), so a hook over the mutable `ui` object has a snapshot. */
export function getVersion(): number {
  return version;
}

/** The running study timer's time left, shown on the dock's Study icon; null when none. */
export function setStudyBadge(text: string | null): void {
  if (text === studyBadge) return;
  studyBadge = text;
  notify();
}

export function getStudyBadge(): string | null {
  return studyBadge;
}
