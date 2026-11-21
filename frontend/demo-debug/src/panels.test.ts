import type { RailPanel } from "@novadeck/core/types"

import { panelGroups, windowPanels } from "./panels"
import { describe, expect, it } from "./test"
import type { DemoActionContext } from "./types"

const context = (opened: RailPanel[], refused: string[] = []): DemoActionContext => ({
  target: "selected",
  harness: "claude",
  selected: () => undefined,
  select: () => {},
  addTerminal: () => {
    throw new Error("unused")
  },
  addInBackground: () => {
    throw new Error("unused")
  },
  startFresh: () => undefined,
  openPanels: (panels) => void opened.push(...panels),
  refuseNextWindow: () => void refused.push("next"),
  dispatch: undefined,
  workspace: () => undefined,
  note: () => undefined,
  crash: () => undefined,
  failViewLoads: () => undefined,
})

describe("panel windows", () => {
  it("sits with the terminals' states", () => {
    expect(panelGroups.map(({ section, title }) => ({ section, title }))).toEqual([
      { section: "Terminals", title: "Panel windows" },
    ])
  })

  it("opens every panel of the rail as a window at once, Files last", async () => {
    const opened: RailPanel[] = []
    const [group] = panelGroups
    await group!.actions
      .find((action) => action.label === "Panels in windows")!
      .run(context(opened))
    expect(opened).toEqual(["terminals", "inbox", "worktrees", "notes", "todo", "history", "files"])
    expect(windowPanels).toEqual(opened)
  })

  it("has the next window of a panel's own refused, as a popup blocker would", async () => {
    const refused: string[] = []
    const [group] = panelGroups
    await group!.actions
      .find((action) => action.label === "Next own window is blocked")!
      .run(context([], refused))
    expect(refused).toEqual(["next"])
  })
})
