import type { RailPanel } from "@novadeck/core/types"

import { context, describe, expect, it } from "../test"
import { openCommands } from "../test/commands"
import {
  currentTarget,
  panelOpen,
  panelPlace,
  panelsAway,
  panelShowing,
  terminalsViewShown,
} from "./selectors"

// Which of these panels are in sight on the app's screen, wide or a phone's.
const inSight = (app: ReturnType<typeof openCommands>, desktop: boolean): RailPanel[] =>
  (["terminals", "inbox", "notes"] as const).filter((panel) =>
    panelShowing(app.ui.getSnapshot(), app.workspace.getSnapshot(), panel, () => desktop),
  )

describe("panelPlace", () => {
  it("has each panel in the sidebar until it opens in a window, and there again once returned", () => {
    const app = openCommands()
    const place = () => panelPlace(app.ui.getSnapshot(), app.workspace.getSnapshot(), "notes")
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
    expect(panelPlace(app.ui.getSnapshot(), app.workspace.getSnapshot(), "notes")).toBe("sidebar")
  })

  it("has a panel in its own window there in every session, until that window closes", () => {
    const app = openCommands()
    const place = () => panelPlace(app.ui.getSnapshot(), app.workspace.getSnapshot(), "notes")
    app.commands.detachPanel("notes")
    app.commands.openOwnWindow("notes")
    expect(place()).toBe("window")
    app.commands.startFresh()
    expect(place()).toBe("window")
    app.commands.returnPanel("notes")
    expect(place()).toBe("sidebar")
  })

  it("lists the panels out of the sidebar, those in their own windows first", () => {
    const app = openCommands()
    app.commands.detachPanel("todo")
    app.commands.detachPanel("notes")
    app.commands.openOwnWindow("notes")
    app.commands.detachPanel("notes")
    expect(panelsAway(app.ui.getSnapshot(), app.workspace.getSnapshot())).toEqual(["notes", "todo"])
  })
})

describe("panelOpen", () => {
  // Which panels and views their places show.
  const open = (app: ReturnType<typeof openCommands>) =>
    (["terminals", "sessions", "inbox", "notes"] as const).filter((panel) =>
      panelOpen(app.ui.getSnapshot(), app.workspace.getSnapshot(), panel),
    )

  it("has the sidebar show the panel the route names", () => {
    const app = openCommands()
    app.commands.toggleSidebar("sessions")
    expect(open(app)).toEqual(["sessions"])
    expect(terminalsViewShown(app.ui.getSnapshot(), app.workspace.getSnapshot())).toBe("sessions")
  })

  it("has a window show its panel, and of the Terminals panel the view chosen there", () => {
    const app = openCommands()
    app.commands.toggleSidebar("inbox")
    app.commands.detachPanel("notes")
    app.commands.detachPanel("terminals")
    expect(open(app)).toEqual(["terminals", "inbox", "notes"])
    app.commands.switchTerminalsView("sessions", false)
    expect(open(app)).toEqual(["sessions", "inbox", "notes"])
  })

  it("has no view of the Terminals panel shown while the sidebar shows another panel", () => {
    const app = openCommands()
    app.commands.toggleSidebar("inbox")
    expect(terminalsViewShown(app.ui.getSnapshot(), app.workspace.getSnapshot())).toBeNull()
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

    it("has it in sight in a window of its own, whatever the stage shows", () => {
      const app = openCommands({ url: "/projects/project/sessions/initial/focus?terminal=01" })
      app.commands.hideSidebar()
      app.commands.detachPanel("notes")
      app.commands.openOwnWindow("notes")
      app.commands.select("01")
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
