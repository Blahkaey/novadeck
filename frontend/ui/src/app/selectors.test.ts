import type { RailPanel } from "@novadeck/core/types"

import { context, describe, expect, it } from "../test"
import { openCommands } from "../test/commands"
import { currentTarget, panelPlace, panelShowing } from "./selectors"

// Which of these panels are in sight on the app's screen, wide or a phone's.
const inSight = (app: ReturnType<typeof openCommands>, desktop: boolean): RailPanel[] =>
  (["terminals", "inbox", "notes"] as const).filter((panel) =>
    panelShowing(app.ui.getSnapshot(), app.workspace.getSnapshot(), panel, () => desktop),
  )

describe("panelPlace", () => {
  it("has each panel in the sidebar until it opens in a window, and there again once returned", () => {
    const app = openCommands()
    const place = () => panelPlace(app.workspace.getSnapshot(), "notes")
    expect(place()).toBe("sidebar")
    app.commands.detachPanel("notes")
    expect(place()).toBe("stage")
    app.commands.returnPanel("notes")
    expect(place()).toBe("sidebar")
  })

  it("keeps each session's own places", () => {
    const app = openCommands()
    app.commands.detachPanel("notes")
    app.commands.startFresh()
    expect(panelPlace(app.workspace.getSnapshot(), "notes")).toBe("sidebar")
  })
})

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

  context("when the panel is in a window", () => {
    it("has it in sight while its window is, whatever the sidebar shows", () => {
      const app = openCommands()
      app.commands.toggleSidebar("inbox")
      app.commands.detachPanel("notes")
      expect(inSight(app, true)).toEqual(["inbox", "notes"])
      app.commands.hideSidebar()
      expect(inSight(app, true)).toEqual(["notes"])
    })

    it("has it out of sight in Grid once the person hides its window, and in sight selected", () => {
      const app = openCommands()
      app.commands.hideSidebar()
      app.commands.detachPanel("notes")
      app.commands.select("01")
      app.commands.setVisibility(currentTarget(app.workspace.getSnapshot()), "panel:notes", true)
      expect(inSight(app, true)).toEqual([])
      app.commands.select("panel:notes")
      expect(inSight(app, true)).toEqual(["notes"])
    })

    it("has it in sight in Focus only while Focus shows its window", () => {
      const app = openCommands({ url: "/projects/project/sessions/initial/focus?terminal=01" })
      app.commands.hideSidebar()
      app.commands.detachPanel("notes")
      expect(inSight(app, true)).toEqual(["notes"])
      app.commands.select("01")
      expect(inSight(app, true)).toEqual([])
    })
  })
})
