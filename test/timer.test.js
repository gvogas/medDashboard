import { describe, it, expect } from 'vitest';
import { start, read, pause, resume, skip, loggedMinutes, totalMs, resumable } from '../src/legacy/js/timer.js';
import { normalizeFlow } from '../src/legacy/js/model.js';

const MIN = 60_000;
const flow = { steps: [['study', 25], ['break', 5]], rounds: 2 };
const t0 = 1_000_000;

describe('study timer engine', () => {
  it('starts in the first study step with its full length left', () => {
    const s = read(start(flow, t0), t0);
    expect(s).toMatchObject({ round: 1, index: 0, kind: 'study', leftMs: 25 * MIN, studyMs: 0, done: false, paused: false });
  });

  it('crosses step and round boundaries', () => {
    const run = start(flow, t0);
    expect(read(run, t0 + 25 * MIN)).toMatchObject({ round: 1, index: 1, kind: 'break', leftMs: 5 * MIN, studyMs: 25 * MIN });
    expect(read(run, t0 + 30 * MIN)).toMatchObject({ round: 2, index: 0, kind: 'study', roundsDone: 1, studyMs: 25 * MIN });
    expect(read(run, t0 + 42 * MIN)).toMatchObject({ round: 2, kind: 'study', leftMs: 13 * MIN, studyMs: 37 * MIN });
  });

  it('finishes after the last step of the last round', () => {
    const s = read(start(flow, t0), t0 + totalMs(flow));
    expect(s).toMatchObject({ done: true, round: 2, roundsDone: 2, leftMs: 0, studyMs: 50 * MIN, leftInFlowMs: 0 });
  });

  it('a long gap (a sleeping phone) lands several steps on, and never past the end', () => {
    const run = start(flow, t0);
    expect(read(run, t0 + 33 * MIN)).toMatchObject({ round: 2, index: 0, leftMs: 22 * MIN });
    expect(read(run, t0 + 500 * MIN)).toMatchObject({ done: true, studyMs: 50 * MIN });
  });

  it('pausing stops the clock and resuming carries on from the same point', () => {
    let run = start(flow, t0);
    run = pause(run, t0 + 10 * MIN);
    expect(read(run, t0 + 60 * MIN)).toMatchObject({ paused: true, leftMs: 15 * MIN, studyMs: 10 * MIN });
    run = resume(run, t0 + 60 * MIN);
    expect(read(run, t0 + 65 * MIN)).toMatchObject({ paused: false, leftMs: 10 * MIN, studyMs: 15 * MIN });
  });

  it('skipping a study step keeps the time spent and drops the rest', () => {
    let run = start(flow, t0);
    run = skip(run, t0 + 10 * MIN);
    const s = read(run, t0 + 10 * MIN);
    expect(s).toMatchObject({ kind: 'break', leftMs: 5 * MIN, studyMs: 10 * MIN });
    expect(read(run, t0 + 15 * MIN)).toMatchObject({ round: 2, kind: 'study', studyMs: 10 * MIN });
  });

  it('skipping a break costs no study time', () => {
    let run = start(flow, t0);
    run = skip(run, t0 + 26 * MIN);
    expect(read(run, t0 + 26 * MIN)).toMatchObject({ round: 2, kind: 'study', studyMs: 25 * MIN });
  });

  it('logs whole minutes, and nothing under one', () => {
    const run = start(flow, t0);
    expect(loggedMinutes(read(run, t0 + 59_000))).toBe(0);
    expect(loggedMinutes(read(run, t0 + 12 * MIN + 59_000))).toBe(12);
  });

  it('keeps its own copy of the flow, so later edits do not move a run', () => {
    const mine = structuredClone(flow);
    const run = start(mine, t0);
    mine.steps[0][1] = 90;
    expect(read(run, t0).leftMs).toBe(25 * MIN);
  });
});

describe('resumable', () => {
  it('takes a kept run, and drops one read() would choke on', () => {
    const run = start(flow, t0);
    expect(resumable(run)).toBe(true);
    expect(resumable(pause(run, t0 + MIN))).toBe(true);
    expect(resumable(null)).toBe(false);
    expect(resumable({ ...run, flow: { steps: [], rounds: 1 } })).toBe(false);
    expect(resumable({ ...run, pausedMs: undefined })).toBe(false);
    expect(resumable({ ...run, flow: { ...run.flow, rounds: 0 } })).toBe(false);
  });
});

describe('normalizeFlow', () => {
  it('clamps minutes and rounds and drops unknown steps', () => {
    expect(normalizeFlow({ steps: [['study', 500], ['nap', 5], ['break', 0]], rounds: 40 }))
      .toEqual({ steps: [['study', 180], ['break', 1]], rounds: 12 });
  });
  it('falls back to Classic 25/5 without a study step', () => {
    expect(normalizeFlow({ steps: [['break', 5]], rounds: 2 })).toEqual({ steps: [['study', 25], ['break', 5]], rounds: 4 });
    expect(normalizeFlow(undefined).rounds).toBe(4);
  });
});
