// Every view is React now (src/components/): the week, month and table, the Study page,
// the Spotify page and the focus screen. The legacy code still calls render() after it
// changes something; that is notify(), which tells React to redraw. Goes in stage 7.

import { notify } from '../../../bridge.ts';

export function renderView() {
  notify();
}

/** The same call; the legacy code uses both names. */
export const render = renderView;
