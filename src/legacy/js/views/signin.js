// The sign-in screen: session.js decides when it shows; React draws the form
// (src/components/sign-in.tsx) from what showSignInState() passes it.

import { $ } from '../dom.js';
import { showSignInState } from '../../../data/signin.ts';

export function renderSignIn({ error = '', username = '' } = {}) {
  $('signin').hidden = false;
  $('app').hidden = true;
  showSignInState({ error, username });
}

export function hideSignIn() {
  $('signin').hidden = true;
  $('app').hidden = false;
}
