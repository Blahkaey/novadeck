import type { AgentName } from "@novadeck/core/harnesses"
import type { BackendAction, TerminalKey } from "@novadeck/core/port"
import type { TerminalMetadata } from "@novadeck/core/types"

import type { DemoTurns } from "../agents/turns"
import type { DemoTour, TourScreen } from "../tour"
import { demoRun } from "../tour-runs"

// How long each phase of the demo's tour agent takes: short and fixed, so specs run fast.
export const tourPhaseMs = { bind: 300, work: 400, finish: 400 } as const

// What the tour's terminal is named once its agent describes itself.
export const tourLeadName = "Tour lead"

const noop = () => {}

const target = ({ projectId, workspaceSessionId }: TerminalKey) => ({
  projectId,
  workspaceSessionId,
})

// An agent held for the person at one of its own screens, as the runner reports it: its
// process is the harness, and it waits there, not working.
export const atTourScreen = (
  key: TerminalKey,
  harness: AgentName,
  screen: TourScreen,
): BackendAction[] => [
  { type: "terminal/process", target: target(key), terminalId: key.terminalId, process: harness },
  {
    type: "terminal/status",
    target: target(key),
    terminalId: key.terminalId,
    status: { state: "running", agent: { working: false, startup: screen } },
  },
]

// The agent's describe: its terminal takes the name, as the agent's own.
export const describedAs = (key: TerminalKey, by: string): BackendAction => ({
  type: "terminal/update",
  target: target(key),
  terminalId: key.terminalId,
  name: tourLeadName,
  titleSource: { kind: "agent", by },
})

type Player = {
  readonly key: TerminalKey
  readonly harness: AgentName
  readonly tour: DemoTour
  readonly turns: DemoTurns
  readonly dispatch: (actions: BackendAction[]) => void
  // The terminal as the workspace holds it now; none once it's closed.
  readonly terminal: () => TerminalMetadata | undefined
}

// Plays the tour's agent in its terminal: an optional startup screen, held until answered;
// bound at the doorbell's ring where the harness waits for one (Antigravity), else at once;
// working; describing itself (once nudged, where quiet); and a finished turn. Answers a
// function that stops it.
export const playTourAgent = ({ key, harness, tour, turns, dispatch, terminal }: Player) => {
  const plan = tour.take()
  const verbs = turns.as(harness)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const stops = new Set<() => void>()
  let over = false
  const later = (ms: number, then: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!over) then()
    }, ms)
    timers.add(timer)
  }
  // Calls `then` once `ready` holds; every phase checks the terminal is still there.
  const when = (
    subscribe: (poke: () => void) => () => void,
    ready: () => boolean,
    then: () => void,
  ) => {
    let done = false
    let stop: () => void = noop
    const poke = () => {
      if (done || over || !ready()) return
      done = true
      stop()
      stops.delete(stop)
      then()
    }
    stop = subscribe(poke)
    stops.add(stop)
    poke()
  }
  const alive = (): TerminalMetadata | undefined => {
    const found = terminal()
    if (!found) over = true
    return found
  }
  const describe = () => {
    const found = alive()
    if (!found) return
    dispatch([describedAs(key, found.handle ?? harness)])
    verbs.finish(key, terminal(), "completed", {
      after: tourPhaseMs.finish,
      reply: "That's the tour's lead: ready.",
    })
  }
  const work = () => {
    if (!alive()) return
    verbs.work(key, terminal())
    later(tourPhaseMs.work, describe)
  }
  // The agent shows at its prompt; the doorbell's harness starts only once rung. A quiet one sits
  // idle there, no turn begun, as an agent that never took its first line does, until nudged.
  const bound = () => {
    if (!alive()) return
    if (plan.quiet) {
      verbs.rest(key, terminal())
      return when(
        (poke) => tour.nudged.subscribe(poke),
        () => tour.nudged.getSnapshot().includes(key.terminalId),
        () => later(tourPhaseMs.bind, work),
      )
    }
    if (demoRun(harness).brief === "launch") return work()
    verbs.rest(key, terminal())
    when(
      (poke) => tour.briefed.subscribe(poke),
      () => tour.briefed.getSnapshot().includes(key.terminalId),
      () => later(tourPhaseMs.bind, work),
    )
  }
  later(tourPhaseMs.bind, () => {
    if (!alive()) return
    if (!plan.screen) return bound()
    dispatch(atTourScreen(key, harness, plan.screen))
    const ms = tour.screenMs()
    let answered = false
    const answer = () => {
      if (answered) return
      answered = true
      stop()
      stops.delete(stop)
      later(tourPhaseMs.bind, bound)
    }
    const stop = tour.answered(answer)
    stops.add(stop)
    if (ms !== undefined) later(ms, answer)
  })
  return () => {
    over = true
    timers.forEach(clearTimeout)
    timers.clear()
    stops.forEach((stop) => stop())
    stops.clear()
    turns.release(key)
  }
}
