import { describe, it, expect } from 'vitest';
import { isTyping } from '../src/legacy/js/dom.js';

const el = (tagName, type = '') => ({ tagName, type, isContentEditable: false });

describe('isTyping', () => {
  it('is true in text fields, where a redraw would lose what is typed', () => {
    for (const e of [el('INPUT', 'text'), el('INPUT', 'search'), el('INPUT', ''), el('INPUT', 'date'), el('TEXTAREA'), el('SELECT')]) {
      expect(isTyping(e), `${e.tagName} ${e.type}`).toBe(true);
    }
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false on buttons, checkboxes and nothing', () => {
    for (const e of [el('BUTTON'), el('INPUT', 'checkbox'), el('INPUT', 'radio'), el('INPUT', 'button'), el('BODY'), el('A')]) {
      expect(isTyping(e), `${e.tagName} ${e.type}`).toBe(false);
    }
    expect(isTyping(null)).toBe(false);
  });
});
