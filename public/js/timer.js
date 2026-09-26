// The study timer's clock: where a run is in its flow, from timestamps alone. No DOM
// and no ticking counter, so a sleeping phone or a throttled tab comes back right, and
// a reload resumes the run. The run record is kept on this device (focus.js).
//
// run = { flow, startedAt, pausedAt, pausedMs, skippedMs, skippedStudyMs }
//   pausedAt        when the current pause began, or null while running
//   pausedMs        paused time already over
//   skippedMs       time jumped forward by Skip step
//   skippedStudyMs  the part of that which was study, and so never counts

const MIN = 60_000;

export function start(flow, now = Date.now()) {
  return { flow: structuredClone(flow), startedAt: now, pausedAt: null, pausedMs: 0, skippedMs: 0, skippedStudyMs: 0 };
}

export const roundMs = (flow) => flow.steps.reduce((a, [, m]) => a + m * MIN, 0);
export const totalMs = (flow) => roundMs(flow) * flow.rounds;

/** How far into the flow the run is, in ms of flow time. */
export function elapsed(run, now = Date.now()) {
  return Math.max(0, (run.pausedAt ?? now) - run.startedAt - run.pausedMs + run.skippedMs);
}

/**
 * Where `ms` of flow time lands: round (1-based), step index, its kind, ms left in it,
 * study ms covered so far, whole rounds finished, and whether the flow is over.
 */
export function position(flow, ms) {
  const per = roundMs(flow), total = per * flow.rounds;
  const done = ms >= total;
  const at = Math.min(ms, total);
  const roundsDone = Math.min(flow.rounds, Math.floor(at / per));
  const round = Math.min(flow.rounds, roundsDone + 1);
  let into = done ? per : at - roundsDone * per, index = 0, studyMs = 0;
  const studyPerRound = flow.steps.reduce((a, [k, m]) => a + (k === 'study' ? m * MIN : 0), 0);
  studyMs += studyPerRound * (done ? flow.rounds - 1 : roundsDone);
  for (; index < flow.steps.length; index++) {
    const [k, m] = flow.steps[index], len = m * MIN;
    if (into < len || index === flow.steps.length - 1) {
      const used = Math.min(into, len);
      if (k === 'study') studyMs += used;
      return { round, index, kind: k, leftMs: len - used, stepMs: len, studyMs, roundsDone, done };
    }
    if (k === 'study') studyMs += len;
    into -= len;
  }
  return null;   /* unreachable: a flow has at least one step */
}

/** Everything a view needs about a run at `now`. */
export function read(run, now = Date.now()) {
  const p = position(run.flow, elapsed(run, now));
  return {
    ...p,
    paused: run.pausedAt !== null,
    studyMs: Math.max(0, p.studyMs - run.skippedStudyMs),
    leftInFlowMs: Math.max(0, totalMs(run.flow) - elapsed(run, now)),
  };
}

export function pause(run, now = Date.now()) {
  return run.pausedAt !== null ? run : { ...run, pausedAt: now };
}

export function resume(run, now = Date.now()) {
  return run.pausedAt === null ? run : { ...run, pausedAt: null, pausedMs: run.pausedMs + (now - run.pausedAt) };
}

/** Jump to the start of the next step. Study time not yet spent in this step never counts. */
export function skip(run, now = Date.now()) {
  const p = position(run.flow, elapsed(run, now));
  if (p.done) return run;
  return { ...run, skippedMs: run.skippedMs + p.leftMs, skippedStudyMs: run.skippedStudyMs + (p.kind === 'study' ? p.leftMs : 0) };
}

/** Whole minutes of study to log, or 0 when there is less than a minute. */
export const loggedMinutes = (state) => Math.floor(state.studyMs / MIN);
