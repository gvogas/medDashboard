// The change signal. The store and the UI state are plain objects changed in place, so
// whatever changes them calls notify(), and the hooks in src/data/ subscribe. The timer's
// badge ticks every second, so it has listeners of its own: a tick redraws the badge, not
// every view that reads the store. This module imports nothing, so anything can use it.

type Listener = () => void;
const listeners = new Set<Listener>();
const badgeListeners = new Set<Listener>();
let studyBadge: string | null = null;
let version = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Something React may show has changed: the UI state, the store, or sync status. */
export function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

/** Bumped by every notify(), so a hook over the mutable `ui` object has a snapshot. */
export function getVersion(): number {
  return version;
}

/** The running study timer's time left, shown beside Study in the side nav; null when none. */
export function setStudyBadge(text: string | null): void {
  if (text === studyBadge) return;
  studyBadge = text;
  for (const fn of badgeListeners) fn();
}

/** For useSyncExternalStore over getStudyBadge. */
export function subscribeStudyBadge(fn: Listener): () => void {
  badgeListeners.add(fn);
  return () => { badgeListeners.delete(fn); };
}

export function getStudyBadge(): string | null {
  return studyBadge;
}
