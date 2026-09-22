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
  quoteIx: 0,
  spotifyNote: null,       /* 'connected' | 'error' after the Spotify round trip, shown once in Settings */
};
ORDER.forEach((t) => { ui.types[t] = true; });

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (saved.view) ui.view = saved.view;
} catch {}

export function rememberUi() {
  try { localStorage.setItem(KEY, JSON.stringify({ view: ui.view })); } catch {}
  try { localStorage.setItem('rounds.theme', ui.theme); } catch {}
}
