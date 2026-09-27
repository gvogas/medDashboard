// A CSV timetable: RFC 4180 quoting, comma or semicolon, a header row.
// parseCsv(text) → [{ type, course, title, date, start, end, room, weight }]
// Unknown columns are ignored; missing ones come back as ''. Dates are normalised to
// YYYY-MM-DD (DD/MM/YYYY is accepted); times to HH:MM when they parse.

import { parseTime } from '../timepicker.js';
import { validDate } from '../school.js';

function records(text, sep) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** 'YYYY-MM-DD' from 2026-9-14 or 14/09/2026, or '' for anything else, 31/02 included. */
export function normDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), out = '';
  if (m) out = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  else if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/))) out = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return validDate(out) ? out : '';
}

const COLUMNS = ['type', 'course', 'title', 'date', 'start', 'end', 'room', 'weight'];

export function parseCsv(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const [header, ...body] = records(text, sep);
  if (!header) return [];
  const index = {};
  header.forEach((h, i) => { index[h.trim().toLowerCase()] = i; });
  return body.map((r) => {
    const get = (k) => (index[k] === undefined ? '' : String(r[index[k]] ?? '').trim());
    const out = {};
    for (const k of COLUMNS) out[k] = get(k);
    out.type = out.type.toLowerCase();
    out.date = normDate(out.date);
    out.start = out.start ? parseTime(out.start) || '' : '';
    out.end = out.end ? parseTime(out.end) || '' : '';
    const w = parseFloat(out.weight);
    out.weight = Number.isFinite(w) && w > 0 && w <= 100 ? w : null;
    return out;
  });
}
