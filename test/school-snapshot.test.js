import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { post, signInAdmin } from './spaces.js';

const CAL = { name: 'Northfield', terms: [{ name: 'Fall 2026', start: '2026-09-08', end: '2026-12-18' }], days: [] };
const course = { code: 'WEB', name: 'Web Services', color: '#17B3AE', instructor: '', term: 'Fall 2026', meetings: [] };
let n = 0;
const setCal = (id, cal) => env.DB.prepare('UPDATE users SET school_calendar = ? WHERE id = ?').bind(JSON.stringify(cal), id).run();

describe("a class's school calendar", () => {
  it("copies the owner's calendar when the class is made, shows it to members, and the owner refreshes it", async () => {
    const owner = await signInAdmin('sco' + ++n), member = await signInAdmin('scm' + n);
    await setCal(owner.id, CAL);
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    await env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', 2, 2)").bind(space.id, member.id).run();
    expect((await (await member(`/api/spaces/${space.id}`)).json()).schoolCalendar).toEqual(CAL);
    const next = { ...CAL, terms: [...CAL.terms, { name: 'Winter 2027', start: '2027-01-05', end: '2027-04-16' }] };
    await setCal(owner.id, next);
    expect((await post(member, `/api/spaces/${space.id}/school`)).status).toBe(403);
    const res = await post(owner, `/api/spaces/${space.id}/school`);
    expect(res.status).toBe(200);
    expect((await res.json()).schoolCalendar).toEqual(next);
    expect((await (await member(`/api/spaces/${space.id}`)).json()).schoolCalendar).toEqual(next);
  });

  it('is null when the owner has no calendar, or an empty one', async () => {
    const owner = await signInAdmin('sco' + ++n);
    await setCal(owner.id, {});
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    expect((await (await owner(`/api/spaces/${space.id}`)).json()).schoolCalendar).toBeNull();
  });

  it("is null when the owner's calendar has a name but no semester", async () => {
    const owner = await signInAdmin('sco' + ++n);
    await setCal(owner.id, { name: 'Northfield', terms: [], days: [] });
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    expect((await (await owner(`/api/spaces/${space.id}`)).json()).schoolCalendar).toBeNull();
  });

  it('the owner refreshes an archived class; an outsider gets 404', async () => {
    const owner = await signInAdmin('sco' + ++n), outsider = await signInAdmin('sct' + n);
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(space.id).run();
    await setCal(owner.id, CAL);
    const res = await post(owner, `/api/spaces/${space.id}/school`);
    expect(res.status).toBe(200);
    expect((await res.json()).schoolCalendar).toEqual(CAL);
    expect((await post(outsider, `/api/spaces/${space.id}/school`)).status).toBe(404);
  });

  it("a refresh after the owner's calendar lost its semesters keeps the old copy", async () => {
    const owner = await signInAdmin('sco' + ++n);
    await setCal(owner.id, CAL);
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    await setCal(owner.id, { ...CAL, terms: [] });
    const res = await post(owner, `/api/spaces/${space.id}/school`);
    expect(res.status).toBe(200);
    expect((await res.json()).schoolCalendar).toEqual(CAL);
    expect((await (await owner(`/api/spaces/${space.id}`)).json()).schoolCalendar).toEqual(CAL);
  });
});
