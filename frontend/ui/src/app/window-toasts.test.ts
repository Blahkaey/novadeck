import type { RefusedToast } from "../inbox/InboxToasts"
import { describe, expect, it } from "../test"
import { openCommands } from "../test/commands"
import { watchRefusedWindows } from "./window-toasts"

describe("a window of a panel's own that couldn't open", () => {
  it("is told on a toast, which stays where the panel stays", () => {
    const app = openCommands({ notes: true })
    app.commands.detachPanel("notes")
    const told: RefusedToast[] = []
    watchRefusedWindows(app.ui, { show: (refused) => told.push(refused) })
    app.screen.windowsOpen = false

    app.commands.openOwnWindow("notes")

    expect(told.map(({ words }) => words)).toEqual([
      "Novadeck couldn't open a window for Notes — your browser may have blocked it.",
    ])
    expect(app.state().roster.panels.map(({ panel }) => panel)).toEqual(["notes"])
  })

  it("is told again each time the person asks", () => {
    const app = openCommands({ notes: true })
    app.commands.detachPanel("notes")
    const told: RefusedToast[] = []
    watchRefusedWindows(app.ui, { show: (refused) => told.push(refused) })
    app.screen.windowsOpen = false

    app.commands.openOwnWindow("notes")
    app.commands.openOwnWindow("notes")

    expect(told).toHaveLength(2)
    expect(told[0]!.id).not.toBe(told[1]!.id)
  })
})
