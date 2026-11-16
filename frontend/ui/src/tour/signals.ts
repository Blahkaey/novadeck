import type { TerminalMetadata, Workspace } from "@novadeck/core/types"

// Where the tour's lead stands, as its terminal shows it:
// - `gone`: its terminal closed, which ends the tour.
// - `ended`: its process ended (exited or failed), as an agent not signed in may.
// - `starting`: a shell with no agent showing yet.
// - `screen`: the agent holds at one of its own screens first, for the person to answer:
//   folder trust and the like (`startup`), its sign-in, or Novadeck's hooks off (`hooks`).
// - `agent`: the agent is there (or resting, asleep, for a message to wake it), `working` on a
//   turn or not, `named` once it described itself (its terminal took a title of its agent's), and
//   `answered` once a turn of its ended.
export type LeadState =
  | { readonly kind: "gone" }
  | { readonly kind: "ended" }
  | { readonly kind: "starting" }
  | { readonly kind: "screen"; readonly screen: "startup" | "sign-in" | "hooks" }
  | {
      readonly kind: "agent"
      readonly working: boolean
      readonly named: boolean
      readonly answered: boolean
    }

// What the tour waits on, read from the workspace: the signals its steps go by.
export type TourSignals = {
  readonly lead: LeadState
  // Whether the lead's project is the one on screen: the tour shows only there.
  readonly onScreen: boolean
}

// A process that ended; `finished` is a command that ran its course, its shell still there.
const ended: ReadonlySet<string> = new Set(["exited", "failed"])

// Where a terminal's agent stands, as `LeadState` says.
export const leadState = (terminal: TerminalMetadata | undefined): LeadState => {
  if (!terminal) return { kind: "gone" }
  if (ended.has(terminal.state)) return { kind: "ended" }
  const named = terminal.titleSource?.kind === "agent"
  if (terminal.state === "sleeping") return { kind: "agent", working: false, named, answered: true }
  if (terminal.state !== "running" || !terminal.agent) return { kind: "starting" }
  const { startup, working, lastTurn } = terminal.agent
  if (startup) return { kind: "screen", screen: startup }
  return { kind: "agent", working, named, answered: lastTurn !== undefined }
}

// The tour's signals in the workspace, for its lead in `terminalId`.
export const tourSignals = (workspace: Workspace, terminalId: string): TourSignals => {
  for (const project of workspace.projects)
    for (const session of project.history) {
      const terminal = session.state.roster.terminals.find(({ id }) => id === terminalId)
      if (terminal)
        return {
          lead: leadState(terminal),
          onScreen:
            workspace.activeProjectId === project.id && project.activeSessionId === session.id,
        }
    }
  return { lead: { kind: "gone" }, onScreen: false }
}

export const sameSignals = (a: TourSignals, b: TourSignals): boolean =>
  a.onScreen === b.onScreen && JSON.stringify(a.lead) === JSON.stringify(b.lead)
