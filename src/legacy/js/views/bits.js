// Small HTML fragments shared by the drawers.

import { esc } from '../dom.js';

export const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';

/** A drawer's footer asking before something is lost: the question, Keep, and `yes`. */
export const confirmFoot = (question, yesAct, yes = 'Delete', keep = 'Keep') => '<div class="dfoot"><span class="hint" role="status">' + esc(question) + '</span>'
  + '<button class="btn ghost" type="button" data-act="keep">' + keep + '</button>'
  + '<button class="btn danger" type="button" data-act="' + yesAct + '">' + yes + '</button></div>';
