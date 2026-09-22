import { describe, it, expect } from 'vitest';
import { emailAllowed } from '../worker/google.js';

describe('ALLOWED_EMAILS', () => {
  it('empty means open sign-up', () => {
    expect(emailAllowed('anyone@example.com', '')).toBe(true);
    expect(emailAllowed('anyone@example.com', undefined)).toBe(true);
  });

  it('a list pins the app to those accounts, case-insensitively, ignoring spaces', () => {
    const list = ' George@Example.com, friend@example.com ';
    expect(emailAllowed('george@example.com', list)).toBe(true);
    expect(emailAllowed('FRIEND@example.com', list)).toBe(true);
    expect(emailAllowed('stranger@example.com', list)).toBe(false);
  });
});
