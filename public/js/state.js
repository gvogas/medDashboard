// UI state: what is open, what is filtered, how the table is sorted. Never synced.
// The view and theme are remembered per browser as a convenience.

import { ORDER } from './model.js';
import { today } from './dates.js';

const KEY = 'rounds.ui';

export const ui = {
  view: 'week', anchor: today(), search: '', types: {}, course: 'all',
  sel: null, draft: null, courseDraft: null, courseMode: null, confirm: null,
  settings: false, focusField: null, sort: { key: 'date', dir: 1 },
  theme: (typeof window !== 'undefined' && window.__roundsTheme) || 'system',
  bg: (typeof window !== 'undefined' && window.__roundsBg) || 'med',     /* background art: 'med' | 'cs' */
  quoteIx: 0,
  importPlan: null,        /* the import preview: { plan, name } */
  fillNote: null,          /* what "Fill topics" did, shown in the exam drawer until it closes */
  importNote: null,
  outlineBusy: false,      /* a course outline is being read */        /* the last import's result or error, shown once in Settings */
  spotifyNote: null,       /* 'connected' | 'error' after the Spotify round trip, shown once in Settings */
  /* the Spotify view: home | playlist | album | artist | queue | search, and the filter inside a list */
  spotify: { pane: 'home', playlistId: null, albumId: null, artistId: null, q: '', filter: '' },
};
ORDER.forEach((t) => { ui.types[t] = true; });

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (saved.view) ui.view = saved.view;
} catch {}

export function rememberUi() {
  try { localStorage.setItem(KEY, JSON.stringify({ view: ui.view })); } catch {}
  try { localStorage.setItem('rounds.theme', ui.theme); } catch {}
  try { localStorage.setItem('rounds.bg', ui.bg); } catch {}
}
