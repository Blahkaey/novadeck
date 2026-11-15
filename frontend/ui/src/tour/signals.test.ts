import { terminalFixture, workspaceFixture } from "@novadeck/core/testing"
import type { TerminalMetadata } from "@novadeck/core/types"

import { describe, expect, it } from "../test"
import { leadState, tourSignals } from "./signals"

const terminal = (parts: Partial<TerminalMetadata>): TerminalMetadata =>
  ({ ...terminalFixture(1, "~/.novadeck/tour"), ...parts }) as TerminalMetadata

describe("The tour's lead", () => {
  it("is gone without a terminal, and ended once its process is", () => {
    expect(leadState(undefined)).toEqual({ kind: "gone" })
    expect(leadState(terminal({ state: "exited", exitCode: 1, signal: null }))).toEqual({
      kind: "ended",
    })
  })

  it("is starting while no agent shows", () => {
    expect(leadState(terminal({ state: "running" }))).toEqual({ kind: "starting" })
    expect(leadState(terminal({ state: "idle" }))).toEqual({ kind: "starting" })
  })

  it("holds at a screen of its agent's own, as its status says", () => {
    expect(
      leadState(terminal({ state: "running", agent: { working: false, startup: "sign-in" } })),
    ).toEqual({ kind: "screen", screen: "sign-in" })
  })

  it("is its agent once there, named once it took a title of its own", () => {
    expect(leadState(terminal({ state: "running", agent: { working: true } }))).toEqual({
      kind: "agent",
      working: true,
      named: false,
      answered: false,
    })
    expect(
      leadState(
        terminal({
          state: "running",
          agent: { working: false },
          titleSource: { kind: "agent", by: "moth" },
        }),
      ),
    ).toMatchObject({ named: true })
  })
})

describe("The tour's lead, resting", () => {
  it("is its agent, asleep for a message to wake it, its turn ended", () => {
    expect(leadState(terminal({ state: "sleeping", agent: "claude" }))).toEqual({
      kind: "agent",
      working: false,
      named: false,
      answered: true,
    })
  })
})

describe("The tour's signals", () => {
  it("find the lead in any project, and say whether that project is on screen", () => {
    const workspace = workspaceFixture()
    const [first] = workspace.projects[0]!.history[0]!.state.roster.terminals
    expect(tourSignals(workspace, first!.id).onScreen).toBe(
      workspace.activeProjectId === workspace.projects[0]!.id,
    )
    expect(tourSignals(workspace, "nowhere")).toEqual({ lead: { kind: "gone" }, onScreen: false })
  })
})
