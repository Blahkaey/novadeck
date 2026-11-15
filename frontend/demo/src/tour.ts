import type { AgentName } from "@novadeck/core/harnesses"
import type { AgentConnection, Backend, Tour } from "@novadeck/core/port"
import { createStore, type MutableStore, type Store } from "@novadeck/core/store"
import type { Workspace } from "@novadeck/core/types"

import type { DemoTurns } from "./agents/turns"
import { terminalOf } from "./workspace"

// Where the demo's tour runs, as the runner's runs in `~/.novadeck/tour`.
export const demoTourFolder = "~/.novadeck/tour"

// What a start answers, loaded only as one is readied: the website's visitor demo, which never
// offers the tour, doesn't carry it in its first load.
const runs = () => import("./tour-runs")

// The screens a tour agent can be held at before Novadeck reaches it (`AgentStatus.startup`).
export type TourScreen = "startup" | "sign-in" | "hooks"

export const tourScreens: readonly TourScreen[] = ["startup", "sign-in", "hooks"]

// How the next run's agent goes, as the debug panel or a spec's address asks.
export type TourAgentPlan = {
  // The screen it waits at until it's answered.
  readonly screen?: TourScreen | undefined
  // It binds but never describes itself until nudged.
  readonly quiet: boolean
}

export type DemoTour = Tour & {
  // Whether the UI offers it: held back, as everywhere, until the debug panel or a spec's
  // `&tour=on` turns it on.
  readonly offered: MutableStore<boolean>
  // Makes the next start fail, as the debug panel or a spec's `&tourStart=fails` asks: as a
  // folder of the person's own does, or (`unlisted`) as Codex not signed in yet does.
  readonly failNext: (how?: "folder" | "unlisted") => void
  // Asks for the tour as the desktop app's Help menu does.
  readonly ask: () => void
  // The terminals whose agent was rung the start line, oldest first.
  readonly briefed: Store<readonly string[]>
  // The terminals whose agent was nudged, oldest first.
  readonly nudged: Store<readonly string[]>
  // The next run's agent waits at `screen` (none: runs as usual) until it's answered.
  readonly holdAt: (screen: TourScreen | undefined) => void
  // The next run's agent stays quiet until nudged.
  readonly goQuiet: (quiet?: boolean) => void
  // Answers the screen an agent waits at.
  readonly answer: () => void
  // What a spec asks of the address: `patienceMs` is what the UI waits before nudging, and
  // `screenMs` answers a held screen on its own after that long.
  // Follows another set of connected agents and workspace: the debug demo's, which runs the
  // tour on the panel's agents and reuses the inner demo's tour (and so its player).
  readonly follow: (
    agents: Store<readonly AgentConnection[]>,
    workspace: () => Workspace | undefined,
  ) => void
  readonly configure: (options: { patienceMs?: number; screenMs?: number }) => void
  // For the agent's player: what the next run is to do (taken once), when a held screen
  // answers itself, and a way to hear an answer.
  readonly take: () => TourAgentPlan
  readonly screenMs: () => number | undefined
  readonly answered: (listener: () => void) => () => void
}

const tours = new WeakSet<Tour>()

// Whether a backend's tour is the demo's, which the debug panel and specs can drive.
export const isDemoTour = (tour: Tour | undefined): tour is DemoTour =>
  tour !== undefined && tours.has(tour)

// The demo's tour: readies a run as the runner does, with nothing to empty, answering the
// projects open at its folder as removed (the UI removes them from the workspace).
export const demoTour = (
  initialAgents: Store<readonly AgentConnection[]>,
  initialWorkspace: () => Workspace | undefined,
): DemoTour => {
  let agents = initialAgents
  let workspace = initialWorkspace
  let failing: "folder" | "unlisted" | undefined
  const briefed = createStore<readonly string[]>([])
  const nudged = createStore<readonly string[]>([])
  const listeners = new Set<() => void>()
  let asking = false
  const answers = new Set<() => void>()
  let plan: TourAgentPlan = { quiet: false }
  let screenMs: number | undefined
  const tour: DemoTour = {
    offered: createStore(false),
    failNext: (how = "folder") => {
      failing = how
    },
    // An ask with no one listening yet, as the same click that took the hold off asks before
    // the page has heard of the tour, waits for the first to listen.
    ask: () => {
      if (listeners.size === 0) asking = true
      for (const listener of listeners) listener()
    },
    asked: (listener) => {
      listeners.add(listener)
      if (asking) {
        asking = false
        queueMicrotask(listener)
      }
      return () => void listeners.delete(listener)
    },
    briefed,
    nudged,
    holdAt: (screen) => {
      plan = { ...plan, screen }
    },
    goQuiet: (quiet = true) => {
      plan = { ...plan, quiet }
    },
    answer: () => {
      for (const listener of answers) listener()
    },
    follow: (nextAgents, nextWorkspace) => {
      agents = nextAgents
      workspace = nextWorkspace
    },
    configure: (options) => {
      const own: { patienceMs?: number } = tour
      if (options.patienceMs === undefined) delete own.patienceMs
      else own.patienceMs = options.patienceMs
      screenMs = options.screenMs
    },
    take: () => {
      const taken = plan
      plan = { quiet: false }
      return taken
    },
    screenMs: () => screenMs,
    answered: (listener) => {
      answers.add(listener)
      return () => void answers.delete(listener)
    },
    prepare: async (agent) => {
      const fails = failing
      failing = undefined
      const { demoRun, demoRefusal } = await runs()
      if (fails) throw demoRefusal(fails, agent)
      const connected = agents.getSnapshot().some((each) => each.agent === agent && each.connected)
      if (!connected) throw new Error("Novadeck isn't connected to it, so the tour can't start.")
      const removed = (workspace()?.projects ?? [])
        .filter((project) => project.directory === demoTourFolder)
        .map((project) => project.id)
      return { ...demoRun(agent), directory: demoTourFolder, removed }
    },
    brief: (terminalId) => {
      briefed.update((ids) => [...ids, terminalId])
      return Promise.resolve()
    },
    nudge: (terminalId) => {
      nudged.update((ids) => [...ids, terminalId])
      return Promise.resolve()
    },
  }
  tours.add(tour)
  return tour
}

// The harness a tour terminal's command starts, which names its agent.
export const tourHarness = (command: string): AgentName | undefined => {
  const program = command.trim().split(/\s+/)[0]
  return program === "claude" || program === "codex" || program === "agy" ? program : undefined
}

// The backend with the tour's agent played in the terminals the UI adds in the tour's folder,
// as a runner would report one (see `tour/player.ts`, loaded as the first one starts).
export const withTourAgent = (backend: Backend, turns: DemoTurns): Backend => {
  const tour = backend.tour
  if (!isDemoTour(tour)) return backend
  let sink: Parameters<NonNullable<Backend["start"]>>[0] | undefined
  let latest: Workspace | undefined
  const stops = new Set<() => void>()
  return {
    ...backend,
    commit: (workspace, actions) => {
      latest = workspace
      backend.commit(workspace, actions)
      for (const action of actions) {
        if (action.type !== "terminal/add" || action.terminal.directory !== demoTourFolder) continue
        const harness = tourHarness(action.terminal.command)
        const at = sink
        if (!harness || !at) continue
        const key = { ...action.target, terminalId: action.terminal.id }
        let stop: (() => void) | undefined
        let stopped = false
        const end = () => {
          stopped = true
          stop?.()
        }
        stops.add(end)
        void import("./tour/player").then(({ playTourAgent }) => {
          if (stopped) return
          stop = playTourAgent({
            key,
            harness,
            tour,
            turns,
            dispatch: at.dispatch,
            terminal: () => terminalOf(latest, key),
          })
        })
      }
    },
    start: (next) => {
      sink = next
      const stop = backend.start?.(next)
      return () => {
        stop?.()
        for (const end of stops) end()
        stops.clear()
        if (sink === next) sink = undefined
      }
    },
  }
}
