// Small HTML fragments shared by the drawers.

import { esc } from '../dom.js';

export const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';

export const TUCK_SVG = '<svg class="tuck" viewBox="0 0 60 34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">'
  + '<path d="M4 6c0 9 7 8 9 14s7 9 14 8 12-6 18-6"/><path d="M11 4c0 7 4 8 6 12"/>'
  + '<circle cx="50" cy="20" r="6"/><circle cx="50" cy="20" r="2.6"/><path d="M44.6 21.6 42 23"/></svg>';

/** A drawer's footer asking before something is lost: the question, Keep, and `yes`. */
export const confirmFoot = (question, yesAct, yes = 'Delete', keep = 'Keep') => '<div class="dfoot"><span class="hint" role="status">' + esc(question) + '</span>'
  + '<button class="btn ghost" type="button" data-act="keep">' + keep + '</button>'
  + '<button class="btn danger" type="button" data-act="' + yesAct + '">' + yes + '</button></div>';
