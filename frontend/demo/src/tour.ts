import { harnesses, type AgentName } from "@novadeck/core/harnesses"
import { TourNeedsAgent, type AgentConnection, type Tour, type TourRun } from "@novadeck/core/port"
import { createStore, type MutableStore, type Store } from "@novadeck/core/store"
import type { Workspace } from "@novadeck/core/types"

const agentName = (agent: AgentName): string =>
  harnesses.find(({ id }) => id === agent)?.name ?? agent

// Where the demo's tour runs, as the runner's runs in `~/.novadeck/tour`.
export const demoTourFolder = "~/.novadeck/tour"

const startLine = "Start the Novadeck tour: follow AGENTS.md in this folder."

// The launch lines the runner builds for each harness (backend/runner/src/tour/launch.ts),
// on each one's cheapest model.
const launches: Readonly<Record<AgentName, Omit<TourRun, "directory" | "removed">>> = {
  claude: {
    command: `claude --model haiku --effort low --permission-mode acceptEdits "${startLine}"`,
    brief: "launch",
    model: "haiku",
  },
  codex: {
    command: `codex --model gpt-6-luna -c model_reasoning_effort=low --sandbox workspace-write --ask-for-approval on-request "${startLine}"`,
    brief: "launch",
    model: "gpt-6-luna",
  },
  agy: {
    command: "agy --model gemini-3.8-flash-low --effort low --mode accept-edits",
    brief: "doorbell",
    model: "gemini-3.8-flash-low",
  },
}

// Why the demo's tour won't start, where the debug panel says it shouldn't: as a runner
// refuses one (a folder of the person's own in its place), with the sentence it gives.
export const demoTourRefusal =
  "~/.novadeck/tour holds files Novadeck didn't put there, so the tour leaves it as it is."

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
    prepare: (agent) => {
      const fails = failing
      failing = undefined
      if (fails === "folder") return Promise.reject(new Error(demoTourRefusal))
      if (fails === "unlisted")
        return Promise.reject(
          new TourNeedsAgent(
            `${agentName(agent)} hasn't listed its models here yet, so the tour can't pick its cheapest. Start ${agentName(agent)} and sign in, then take the tour.`,
            agent,
          ),
        )
      const connected = agents.getSnapshot().some((each) => each.agent === agent && each.connected)
      if (!connected)
        return Promise.reject(new Error("Novadeck isn't connected to it, so the tour can't start."))
      const removed = (workspace()?.projects ?? [])
        .filter((project) => project.directory === demoTourFolder)
        .map((project) => project.id)
      return Promise.resolve({ ...launches[agent], directory: demoTourFolder, removed })
    },
    brief: (terminalId) => {
      briefed.update((ids) => [...ids, terminalId])
      return Promise.resolve()
    },
  }
  tours.add(tour)
  return tour
}
