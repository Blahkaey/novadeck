import type { AgentName } from "@novadeck/core/harnesses"
import type { SidebarPanel, ViewMode } from "@novadeck/core/types"

import type { LeadState, TourSignals } from "./signals"

// The places the tour points at, each a `data-tour` mark in the page (one name may mark a few
// elements; the spotlight takes the first shown). `terminal` is the lead's own terminal.
export type TourAnchor =
  | "terminal"
  | "tabs"
  | "terminals"
  | "messages"
  | "inbox"
  | "inbox-card"
  | "views"
  | "side-pane"

// What the tour says at a step: where it points (none: it floats in a corner), a heading and a
// line or two.
export type Coach = {
  readonly anchor: TourAnchor | null
  readonly title: string
  readonly body: string
}

// What the tour moves as a step begins, never again: the view, the lead's terminal brought into
// view and selected (in Canvas the camera flies to it), a sidebar panel, the Inbox.
export type TourMove =
  | { readonly kind: "view"; readonly view: ViewMode }
  | { readonly kind: "reveal" }
  | { readonly kind: "sidebar"; readonly panel: SidebarPanel }
  | { readonly kind: "inbox" }

// A step of the tour's story: what it moves as it begins, what it says while it waits, and the
// signal that ends it. One that waits on the agent (`nudge`) rings the lead once after the tour's
// patience, and moves on after as long again; one that waits on the person (`patient`), as their
// answer in the Inbox, waits as long as it takes.
export type TourStep = {
  readonly id: string
  readonly enter: readonly TourMove[]
  readonly coach: Coach
  readonly done: (signals: TourSignals) => boolean
  readonly wait: "nudge" | "patient"
}

// Step 1 of the story: a terminal opens and the person's own agent starts there, with its
// brief, and describes itself as the tour's lead.
export const startStep: TourStep = {
  id: "start",
  enter: [{ kind: "view", view: "focus" }, { kind: "reveal" }],
  coach: {
    anchor: "terminal",
    title: "Your agent is starting",
    body: "This is your own agent, with your config and account, in a sandbox folder. It reads the tour's brief and gets to work.",
  },
  // It describes itself, as its brief asks; or, where a cheap model skips that, its first turn
  // ends.
  done: ({ lead }) => lead.kind === "agent" && (lead.named || lead.answered),
  wait: "nudge",
}

// The tour's steps, in order. The story's later steps join them (team, Messages, the Inbox,
// the side pane, the views).
export const tourSteps: readonly TourStep[] = [startStep]

// What the tour says while the lead's agent holds at a screen of its own, whatever the step:
// the person answers it in the agent's terminal, and the tour waits as long as that takes.
export const screenCoach = (
  screen: Extract<LeadState, { kind: "screen" }>["screen"],
  agent: AgentName,
): Coach => ({
  anchor: "terminal",
  title: "Your agent is asking you something first",
  body:
    screen === "sign-in"
      ? "It needs you to sign in: do it here, in its terminal. The tour goes on once you're in."
      : screen === "hooks"
        ? agent === "codex"
          ? "Codex asks you to review Novadeck's hooks: run /hooks here and trust them, and the tour goes on."
          : "Novadeck's hooks are off for it, so Novadeck can't follow it. Turn hooks back on in its settings, then start it again here."
        : "Answer it here, in its terminal: it's its own question, such as whether to trust the tour's folder. The tour goes on once you have.",
})

// What the tour says once the lead's agent has stopped: its terminal is still there to read.
export const endedCoach: Coach = {
  anchor: "terminal",
  title: "Your agent stopped",
  body: "Its terminal shows why. Start it again there and the tour goes on, or end the tour.",
}
