// Shape rules, mirroring migrations/0001_init.sql, so a bad request gets a 400
// naming the field instead of a raw SQLite error.

import { HttpError } from './http.js';

export const COLOURS = ['#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6'];
const THEMES = ['light', 'dark', 'system'];
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function fail(field) {
  throw new HttpError(400, { error: 'invalid', field });
}

function str(v, field, max, min = 0) {
  if (typeof v !== 'string' || v.length < min || v.length > max) fail(field);
  return v;
}

function optDate(v, field) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !DATE.test(v)) fail(field);
  return v;
}

export function validateProfile(body) {
  if (!body || typeof body !== 'object') fail('body');
  const coat = body.coat && typeof body.coat === 'object' ? body.coat : fail('coat');
  return {
    displayName: str(body.displayName ?? '', 'displayName', 60),
    coatName: str(coat.name ?? '', 'coat.name', 28),
    coatRole: str(coat.role ?? '', 'coat.role', 34),
    coatColor: COLOURS.includes(coat.color) ? coat.color : fail('coat.color'),
    theme: THEMES.includes(body.theme) ? body.theme : fail('theme'),
    termStart: optDate(body.termStart, 'termStart'),
  };
}
