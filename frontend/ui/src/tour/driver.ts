import type { AgentName } from "@novadeck/core/harnesses"

import type { TourSignals } from "./signals"
import { endedCoach, screenCoach, type Coach, type TourMove, type TourStep } from "./steps"

// A run of the tour as the UI follows it: its lead's terminal and agent, where the lead's first
// line goes (`launch`, or rung once the agent shows: `doorbell`), the step it is at, when that
// step's wait began (it begins again after a screen of the agent's own, or a pause), whether the
// lead was nudged at this step, whether its first line was rung, and whether the person paused it.
export type TourRun = {
  readonly terminalId: string
  readonly agent: AgentName
  readonly brief: "launch" | "doorbell"
  readonly step: number
  readonly waitingSince: number
  readonly nudged: boolean
  readonly briefed: boolean
  readonly paused: boolean
  // The step's moves were made: a step makes them once, as it begins, never again.
  readonly entered: boolean
}

// What moves the run on: the workspace's signals changing, the clock reaching a wait's end,
// the person's pause, resume, skip (of a step) or end (of the tour), or the backend refusing to
// ring the lead's first line, to be tried again.
export type TourEvent =
  | { readonly type: "signals"; readonly signals: TourSignals; readonly now: number }
  | { readonly type: "tick"; readonly signals: TourSignals; readonly now: number }
  | { readonly type: "pause" }
  | { readonly type: "resume"; readonly now: number }
  | { readonly type: "skip"; readonly now: number }
  | { readonly type: "end" }
  | { readonly type: "brief-failed" }

// How a run ended: its story done, the person ended it, or its lead's terminal closed.
export type TourEnd = "done" | "ended" | "gone"

// What follows from an event: the run as it is now (null once it ended, with why), the moves to
// make as a step begins, and whether to ring the lead its first line or a nudge.
export type TourOutcome = {
  readonly run: TourRun | null
  readonly end?: TourEnd
  readonly moves: readonly TourMove[]
  readonly brief: boolean
  readonly nudge: boolean
}

export const beginRun = (
  start: {
    readonly terminalId: string
    readonly agent: AgentName
    readonly brief: TourRun["brief"]
  },
  now: number,
): TourRun => ({
  ...start,
  step: 0,
  waitingSince: now,
  nudged: false,
  briefed: start.brief === "launch",
  paused: false,
  entered: false,
})

const still = (run: TourRun | null): TourOutcome => ({ run, moves: [], brief: false, nudge: false })

// The run at its next step, or ended once its story is done: past its last step, it stays only
// until its lead's first line is rung, which a skip at a screen of the agent's own comes before.
const nextStep = (run: TourRun, steps: readonly TourStep[], now: number): TourOutcome => {
  const step = Math.min(run.step + 1, steps.length)
  if (step === steps.length && run.briefed) return { ...still(null), end: "done" }
  return still({ ...run, step, waitingSince: now, nudged: false, entered: false })
}

// Whether the lead stands where a step's wait counts: its agent there and quiet, not working on
// a turn, nor holding at a screen of its own, nor stopped. A turn that runs long is no silence.
const counting = (signals: TourSignals): boolean =>
  signals.lead.kind === "agent" && !signals.lead.working

/**
 * Moves the run on by one event. A step makes its moves once, as it begins, and only while the
 * tour's project is on screen and the run isn't paused, so the tour never takes the person's
 * view back from them. Its first line is rung once the agent shows, where the launch line
 * carried none. A step waiting on the agent nudges it once after `patienceMs` of its agent being
 * there, and moves on after as long again; its wait starts over while the agent holds at a
 * screen of its own. A run ends once its last step is done, the person ends it, or its lead's
 * terminal closes.
 */
export const stepRun = (
  run: TourRun,
  steps: readonly TourStep[],
  event: TourEvent,
  patienceMs: number,
): TourOutcome => {
  switch (event.type) {
    case "end":
      return { ...still(null), end: "ended" }
    case "pause":
      return still(run.paused ? run : { ...run, paused: true })
    case "resume":
      return still(run.paused ? { ...run, paused: false, waitingSince: event.now } : run)
    case "skip":
      return nextStep(run, steps, event.now)
    case "brief-failed":
      return still({ ...run, briefed: false })
    case "signals":
    case "tick":
      return follow(run, steps, event.signals, event.now, patienceMs)
  }
}

const follow = (
  run: TourRun,
  steps: readonly TourStep[],
  signals: TourSignals,
  now: number,
  patienceMs: number,
): TourOutcome => {
  if (signals.lead.kind === "gone") return { ...still(null), end: "gone" }
  const brief = !run.briefed && signals.lead.kind === "agent"
  const briefed = brief ? { ...run, briefed: true } : run
  const step = steps[run.step]
  // Past its story: it ends once its first line was rung, at the event after, so a ring the
  // backend refused is tried again first.
  if (!step)
    return brief || !run.briefed ? { ...still(briefed), brief } : { ...still(null), end: "done" }
  // Done: on to the next step, but never ended in the event that rings its first line.
  if (step.done(signals)) {
    const next = nextStep(brief ? run : briefed, steps, now)
    return { ...next, run: next.run && { ...next.run, briefed: briefed.briefed }, brief }
  }
  // Its moves once, as it begins on screen, unpaused, whatever the agent is doing.
  const enter = !run.entered && signals.onScreen && !run.paused
  const entered = enter ? { ...briefed, entered: true } : briefed
  const moves = enter ? step.enter : []
  // No agent there yet, a screen of its own, or a pause: the wait starts over once it counts.
  if (!counting(signals) || run.paused || step.wait === "patient") {
    const waiting = entered.waitingSince === now ? entered : { ...entered, waitingSince: now }
    return { run: step.wait === "patient" ? entered : waiting, moves, brief, nudge: false }
  }
  const waited = now - run.waitingSince
  if (!run.nudged && waited >= patienceMs)
    return { run: { ...entered, nudged: true, waitingSince: now }, moves, brief, nudge: true }
  if (run.nudged && waited >= patienceMs) return { ...nextStep(entered, steps, now), brief }
  return { run: entered, moves, brief, nudge: false }
}

// When the clock next matters to the run, as epoch ms: its wait's end, for a step waiting on its
// agent while it is there; none otherwise, as for a paused run.
export const nextTick = (
  run: TourRun,
  steps: readonly TourStep[],
  signals: TourSignals,
  patienceMs: number,
): number | null => {
  const step = steps[run.step]
  if (!step || run.paused || step.wait === "patient" || !counting(signals)) return null
  return run.waitingSince + patienceMs
}

// What the tour says now: a screen of the agent's own, or its stopping, comes first, whatever
// the step; nothing while paused.
export const coachNow = (
  run: TourRun,
  steps: readonly TourStep[],
  signals: TourSignals,
): Coach | null => {
  if (run.paused) return null
  const { lead } = signals
  if (lead.kind === "screen") return screenCoach(lead.screen, run.agent)
  if (lead.kind === "ended") return endedCoach
  return steps[run.step]?.coach ?? null
}
