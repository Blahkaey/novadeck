import type { RailPanel } from "@novadeck/core/types"

import { context, describe, expect, it } from "../test"
import { openCommands } from "../test/commands"
import { panelShowing } from "./selectors"

// Which of these panels are in sight on the app's screen, wide or a phone's.
const inSight = (app: ReturnType<typeof openCommands>, desktop: boolean): RailPanel[] =>
  (["terminals", "inbox", "notes"] as const).filter((panel) =>
    panelShowing(app.ui.getSnapshot(), panel, () => desktop),
  )

describe("panelShowing", () => {
  context("when the sidebar shows a panel", () => {
    it("has that panel in sight, and no other", () => {
      const app = openCommands()
      app.commands.toggleSidebar("inbox")
      expect(inSight(app, true)).toEqual(["inbox"])
    })

    it("has the Terminals panel in sight on either of its views", () => {
      const app = openCommands()
      app.commands.toggleSidebar("sessions")
      expect(app.ui.getSnapshot().location.route.panel).toBe("sessions")
      expect(inSight(app, true)).toEqual(["terminals"])
    })
  })

  context("when the sidebar is hidden on a panel", () => {
    it("has none in sight", () => {
      const app = openCommands()
      app.commands.toggleSidebar("inbox")
      app.commands.hideSidebar()
      expect(app.ui.getSnapshot().location.route.panel).toBe("inbox")
      expect(inSight(app, true)).toEqual([])
    })
  })

  context("in Zen", () => {
    it("has none in sight", () => {
      const app = openCommands()
      app.commands.toggleSidebar("inbox")
      app.commands.enterZen()
      expect(inSight(app, true)).toEqual([])
    })
  })

  context("on a phone", () => {
    it("has the panel in sight only while its drawer is open", () => {
      const app = openCommands({ desktop: false })
      expect(inSight(app, false)).toEqual([])
      app.commands.toggleSidebar("inbox")
      expect(inSight(app, false)).toEqual(["inbox"])
    })
  })
})
