// UI state: what is open, what is filtered, how the table is sorted. Never synced.
// The view and theme are remembered per browser as a convenience.

import { today } from './dates.js';

const KEY = 'rounds.ui';

export const ui = {
  view: 'week', anchor: today(), search: '', types: {}, course: 'all',
  sel: null, draft: null, courseDraft: null, courseMode: null, confirm: null,
  settings: false, settingsTab: 'you', focusField: null,
  sort: { key: 'date', dir: 1 },
  theme: (typeof window !== 'undefined' && window.__roundsTheme) || 'system',
  bg: (typeof window !== 'undefined' && window.__roundsBg) || 'med',     /* background art: 'med' | 'cs' */
  quoteIx: 0,
  monthDeadlines: true,    /* the month view shows dated items beside the classes */
  importPlan: null,        /* the import preview: { plan, name } */
  fillNote: null,          /* what "Fill topics" did, shown in the exam drawer until it closes */
  importNote: null,
  outlineBusy: false,      /* a course outline is being read */        /* the last import's result or error, shown once in Settings */
  spotifyNote: null,       /* 'connected' | 'error' after the Spotify round trip, shown once in Settings */
  /* the Spotify view: home | playlist | album | artist | queue | search, and the filter inside a list */
  spotify: { pane: 'home', playlistId: null, albumId: null, artistId: null, q: '', filter: '' },
  focus: false,            /* the focus screen is up: the study clock and Spotify, nothing else */
  study: { courseId: null, itemId: null },   /* what the next study run is logged against */
  /* the Study tab's history: which week and month are shown, Week or Month for the
     sessions, the day picked on the month's calendar or the heatmap, and a deleted
     session that can still be undone */
  hist: { weekOffset: 0, range: 'week', monthOffset: 0, focusDay: null, undo: null },
  sessionDraft: null,      /* the Log study / Edit session drawer */
  achDraft: null,          /* the New / Edit achievement drawer */
  lb: null,                /* the leaderboard from the server: {joined, week, all, at}, or loading/offline/error */
  lbTab: 'week',           /* the leaderboard's This week / All-time switch */
  schoolDraft: null,       /* the school calendar review drawer */
  schoolBusy: false,       /* a school calendar is being read */
  schoolNote: null,        /* {text, error}: the last school calendar read, in Settings */
  schoolAsk: false,        /* Settings is asking before removing the school calendar */
  signoutAsk: null,        /* sign-out waits on a warning about unsynced edits: { everywhere } */
};

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (['week', 'month', 'table', 'spotify', 'study'].includes(saved.view)) ui.view = saved.view;
  if (typeof saved.monthDeadlines === 'boolean') ui.monthDeadlines = saved.monthDeadlines;
} catch {}

export function rememberUi() {
  try { localStorage.setItem(KEY, JSON.stringify({ view: ui.view, monthDeadlines: ui.monthDeadlines })); } catch {}
  try { localStorage.setItem('rounds.theme', ui.theme); } catch {}
  try { localStorage.setItem('rounds.bg', ui.bg); } catch {}
}
