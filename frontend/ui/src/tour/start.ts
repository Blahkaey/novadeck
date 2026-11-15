import type { AgentName } from "@novadeck/core/harnesses"
import type { Tour, TourRun } from "@novadeck/core/port"

// What starting the tour does to the workspace, as the app's commands do it.
export type TourEffects = {
  readonly tour: Tour
  // Opens the tour's folder as its own project, in place of those the backend removed.
  readonly openTour: (run: TourRun) => void
  // Adds a terminal to the project on screen, starting `command` there; answers its id.
  readonly add: (options: { readonly title: string; readonly command: string }) => string
  // Resolves true once the terminal's agent shows there, false if the terminal is gone first.
  // It waits as long as that takes: the agent may first ask the person something of its own,
  // as to sign in.
  readonly agentShown: (terminalId: string) => Promise<boolean>
}

// The tour's terminal, named for the person and not by its agent: what they see in its tab.
export const tourTitle = "Tour"

// The tour started: its terminal, the run it started from, and its agent's first line on its
// way: settled once rung (or at once where the launch line carried it), or once the terminal
// closed before its agent showed; rejected where the backend couldn't ring it.
export type TourStarted = {
  readonly terminalId: string
  readonly run: TourRun
  readonly briefed: Promise<void>
}

/**
 * Starts the tour with `agent`: the backend readies its folder and launch line, the tour
 * opens as a project of its own with one terminal starting the agent, and where the launch
 * line carries no first line (`doorbell`), that line is rung once the agent shows. Rejects
 * where the backend refuses, before anything in the workspace changes.
 */
export const startTour = async (agent: AgentName, effects: TourEffects): Promise<TourStarted> => {
  const run = await effects.tour.prepare(agent)
  effects.openTour(run)
  const terminalId = effects.add({ title: tourTitle, command: run.command })
  const briefed =
    run.brief === "doorbell"
      ? effects
          .agentShown(terminalId)
          .then((shown) => (shown ? effects.tour.brief(terminalId) : undefined))
      : Promise.resolve()
  return { terminalId, run, briefed }
}

// Whether the terminal's agent shows in the workspace, as its backend reports it bound: true,
// false once the terminal is gone or its process ended (its agent not signed in, or crashed),
// undefined while it waits.
const ended: ReadonlySet<string> = new Set(["exited", "failed", "finished"])

export const agentShownIn = (
  terminals: readonly { readonly id: string; readonly state: string; readonly agent?: unknown }[],
  terminalId: string,
): boolean | undefined => {
  const terminal = terminals.find(({ id }) => id === terminalId)
  if (!terminal || ended.has(terminal.state)) return false
  return terminal.state === "running" && terminal.agent !== undefined ? true : undefined
}
