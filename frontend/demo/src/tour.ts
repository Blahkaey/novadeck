import type { AgentConnection, Tour } from "@novadeck/core/port"
import { createStore, type MutableStore, type Store } from "@novadeck/core/store"
import type { Workspace } from "@novadeck/core/types"

// Where the demo's tour runs, as the runner's runs in `~/.novadeck/tour`.
export const demoTourFolder = "~/.novadeck/tour"

// What a start answers, loaded only as one is readied: the website's visitor demo, which never
// offers the tour, doesn't carry it in its first load.
const runs = () => import("./tour-runs")

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
}

const tours = new WeakSet<Tour>()

// Whether a backend's tour is the demo's, which the debug panel and specs can drive.
export const isDemoTour = (tour: Tour | undefined): tour is DemoTour =>
  tour !== undefined && tours.has(tour)

// The demo's tour: readies a run as the runner does, with nothing to empty, answering the
// projects open at its folder as removed (the UI removes them from the workspace).
export const demoTour = (
  agents: Store<readonly AgentConnection[]>,
  workspace: () => Workspace | undefined,
): DemoTour => {
  let failing: "folder" | "unlisted" | undefined
  const briefed = createStore<readonly string[]>([])
  const listeners = new Set<() => void>()
  const tour: DemoTour = {
    offered: createStore(false),
    failNext: (how = "folder") => {
      failing = how
    },
    ask: () => {
      for (const listener of listeners) listener()
    },
    asked: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    briefed,
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
  }
  tours.add(tour)
  return tour
}
