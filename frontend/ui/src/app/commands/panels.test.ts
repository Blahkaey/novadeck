import { workspaceWithPanel } from "@novadeck/core/testing"
import { railPanels, type RailPanel, type SidebarPanel } from "@novadeck/core/types"

import { context, describe, expect, it } from "../../test"
import { openCommands, type CommandsOptions } from "../../test/commands"
import { currentTarget } from "../selectors"

const grid = "/projects/project/sessions/initial/grid?terminal=01"

// The app on Grid with the notes the Notes panel lists, its sidebar open on `panel`.
const open = (panel: SidebarPanel | null, options: CommandsOptions = {}) => {
  const app = openCommands({ url: grid, notes: true, ...options })
  if (panel) app.commands.toggleSidebar(panel)
  else app.commands.hideSidebar()
  return app
}

const staged = (app: ReturnType<typeof openCommands>): RailPanel[] =>
  app.state().roster.panels.map((each) => each.panel)
const sidebar = (app: ReturnType<typeof openCommands>) => ({
  panel: app.ui.getSnapshot().location.route.panel,
  visible: !app.shell().sidebarCollapsed,
})

describe("detaching a panel", () => {
  it("opens its window on the stage, selected, and puts keyboard focus in it a frame later", () => {
    const app = open("notes")
    app.commands.detachPanel("notes")
    expect(staged(app)).toEqual(["notes"])
    expect(app.state().selected).toBe("panel:notes")
    expect(app.urls.at(-1)).toContain("terminal=panel%3Anotes")
    expect(app.effects).not.toContain("focus notes panel")
    app.flush()
    expect(app.effects.at(-1)).toBe("focus notes panel")
  })

  it("leaves keyboard focus where it is when asked to, as the demo's gallery does", () => {
    const app = open("notes")
    app.commands.detachPanel("notes", { focus: false })
    app.flush()
    expect(staged(app)).toEqual(["notes"])
    expect(app.effects).not.toContain("focus notes panel")
  })

  context("when the sidebar shows it", () => {
    it("moves the sidebar to the first panel the rail's order still has there", () => {
      const app = open("notes")
      app.screen.railOrder = ["notes", "todo", "files", ...railPanels]
      app.commands.detachPanel("todo")
      app.commands.detachPanel("notes")
      expect(sidebar(app)).toEqual({ panel: "files", visible: true })
    })

    it("opens the Terminals panel's last view where Terminals comes next", () => {
      const app = open("sessions")
      app.commands.toggleSidebar("notes")
      app.screen.railOrder = ["notes", "terminals", ...railPanels]
      app.commands.detachPanel("notes")
      expect(sidebar(app)).toEqual({ panel: "sessions", visible: true })
    })

    // For when every panel can open in a window: today Terminals, always in the rail's order,
    // never does, so the order here leaves it out.
    it("hides the sidebar when every panel of the rail is in a window", () => {
      const app = open("notes")
      app.screen.railOrder = ["notes"]
      app.commands.detachPanel("notes")
      expect(sidebar(app).visible).toBe(false)
    })

    it("closes a phone's drawer, so the window shows", () => {
      const app = open("notes", { desktop: false })
      expect(app.shell().sidebar).toBe(true)
      app.commands.detachPanel("notes")
      expect(app.shell().sidebar).toBe(false)
      expect(staged(app)).toEqual(["notes"])
    })
  })

  it("leaves the sidebar on another panel it shows", () => {
    const app = open("inbox")
    app.commands.detachPanel("notes")
    expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
  })
})

describe("returning a panel", () => {
  it("closes its window and opens the sidebar on it, with keyboard focus there", () => {
    const app = open(null, { workspace: workspaceWithPanel() })
    app.commands.returnPanel("notes")
    expect(staged(app)).toEqual([])
    expect(sidebar(app)).toEqual({ panel: "notes", visible: true })
    app.flush()
    expect(app.effects.at(-1)).toBe("focus notes panel")
  })

  it("returns two panels in either order", () => {
    const app = open(null)
    app.commands.detachPanel("todo")
    app.commands.detachPanel("files")
    app.commands.returnPanel("todo")
    expect(staged(app)).toEqual(["files"])
    app.commands.returnPanel("files")
    expect(staged(app)).toEqual([])
    expect(sidebar(app)).toEqual({ panel: "files", visible: true })
  })
})

describe("revealing a panel's window", () => {
  it("selects it and puts keyboard focus in it, leaving the sidebar as it was", () => {
    const app = open("inbox")
    app.commands.detachPanel("notes")
    app.commands.select("01")
    app.flush()
    app.commands.revealPanel("notes")
    expect(app.state().selected).toBe("panel:notes")
    expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
    app.flush()
    expect(app.effects.at(-1)).toBe("focus notes panel")
  })

  it("shows it again in Grid where the person hid it", () => {
    const app = open(null)
    app.commands.detachPanel("notes")
    app.commands.setVisibility(currentTarget(app.workspace.getSnapshot()), "panel:notes", true)
    app.commands.select("01")
    app.commands.revealPanel("notes")
    expect(app.state().layout.hidden["panel:notes"]).toBe(false)
    expect(app.state().selected).toBe("panel:notes")
  })

  it("closes a phone's drawer over it", () => {
    const app = open("inbox", { desktop: false })
    app.commands.detachPanel("notes")
    app.commands.toggleSidebar("inbox")
    app.commands.revealPanel("notes")
    expect(app.shell().sidebar).toBe(false)
  })

  context("from the rail and the panel's key", () => {
    it("reveals the window instead of opening the sidebar on it", () => {
      const app = open("inbox")
      app.commands.detachPanel("notes")
      app.commands.select("01")
      app.commands.toggleRail("notes")
      expect(app.state().selected).toBe("panel:notes")
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
      app.commands.select("01")
      app.commands.toggleSidebar("notes")
      expect(app.state().selected).toBe("panel:notes")
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
    })

    it("hides the sidebar rather than step back to a panel now in a window", () => {
      const app = open("notes")
      app.commands.toggleSidebar("inbox")
      app.commands.detachPanel("notes")
      app.commands.toggleSidebar("inbox")
      expect(sidebar(app).visible).toBe(false)
    })
  })

  it("reveals it from the sidebar's note on a panel in a window", () => {
    const app = open(null)
    app.commands.detachPanel("notes")
    app.commands.select("01")
    app.navigation.go({ panel: "notes" })
    app.commands.revealPanel("notes")
    expect(app.state().selected).toBe("panel:notes")
  })
})

describe("panel windows by session", () => {
  it("keeps each session's own windows as the person switches", () => {
    const app = open(null)
    app.commands.detachPanel("notes")
    const first = app.workspace.getSnapshot().projects[0]!.activeSessionId
    app.commands.startFresh()
    expect(staged(app)).toEqual([])
    app.commands.detachPanel("todo")
    app.commands.switchSession(first)
    expect(staged(app)).toEqual(["notes"])
  })
})

// The panels in a window of their own.
const own = (app: ReturnType<typeof openCommands>): readonly RailPanel[] =>
  app.ui.getSnapshot().ownWindows

describe("a panel in a window of its own", () => {
  context("as it opens from its window on the stage", () => {
    it("moves into the window, out of the stage, with keyboard focus there once it holds it", () => {
      const app = open("inbox")
      app.commands.detachPanel("notes")
      app.commands.openOwnWindow("notes")
      expect(app.effects).toContain("open notes window")
      expect(own(app)).toEqual(["notes"])
      expect(staged(app)).toEqual([])
      expect(app.state().selected).not.toBe("panel:notes")
      expect(app.effects).not.toContain("focus notes window")
      app.flush()
      expect(app.effects.at(-1)).toBe("focus notes window")
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
    })

    it("stays where it was, and says why, where the window is refused", () => {
      const app = open("inbox")
      app.commands.detachPanel("notes")
      app.screen.windowsOpen = false
      app.commands.openOwnWindow("notes")
      expect(own(app)).toEqual([])
      expect(staged(app)).toEqual(["notes"])
      expect(app.ui.getSnapshot().windowRefused).toMatchObject({ panel: "notes" })
    })
  })

  context("from the rail and the panel's key", () => {
    it("brings its window to the front, leaving the sidebar as it was", () => {
      const app = open("inbox")
      app.commands.detachPanel("notes")
      app.commands.openOwnWindow("notes")
      app.commands.toggleRail("notes")
      expect(app.effects.at(-1)).toBe("focus notes window")
      app.commands.toggleSidebar("notes")
      expect(app.effects.at(-1)).toBe("focus notes window")
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
    })
  })

  context("as it returns", () => {
    it("closes its window and opens the sidebar on it, with keyboard focus there", () => {
      const app = open("inbox")
      app.commands.detachPanel("notes")
      app.commands.openOwnWindow("notes")
      app.commands.returnPanel("notes")
      expect(app.effects).toContain("close notes window")
      expect(own(app)).toEqual([])
      expect(sidebar(app)).toEqual({ panel: "notes", visible: true })
      app.flush()
      expect(app.effects.at(-1)).toBe("focus notes panel")
    })

    it("closes the window on the stage of the session on screen that said where it was", () => {
      const app = open(null)
      app.commands.detachPanel("notes")
      app.commands.openOwnWindow("notes")
      app.commands.detachPanel("notes")
      expect(staged(app)).toEqual(["notes"])
      app.commands.returnPanel("notes")
      expect(staged(app)).toEqual([])
      expect(sidebar(app)).toEqual({ panel: "notes", visible: true })
    })
  })

  context("as the workspace around it goes", () => {
    it("closes every window of their own, each panel back where the session has it", () => {
      const app = open("inbox")
      app.commands.detachPanel("notes")
      app.commands.openOwnWindow("notes")
      app.commands.detachPanel("todo")
      app.commands.openOwnWindow("todo")
      app.commands.detachPanel("files")
      app.commands.forgetOwnWindows()
      expect(app.effects).toEqual(
        expect.arrayContaining(["close notes window", "close todo window"]),
      )
      expect(own(app)).toEqual([])
      expect(staged(app)).toEqual(["files"])
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
    })
  })

  context("in another session whose stage has its window", () => {
    // Notes opens in a window of its own from one session, and another session on screen still
    // has its window on the stage.
    const elsewhere = () => {
      const app = open(null)
      app.commands.detachPanel("notes")
      const first = app.workspace.getSnapshot().projects[0]!.activeSessionId
      app.commands.startFresh()
      app.commands.detachPanel("notes")
      const second = app.workspace.getSnapshot().projects[0]!.activeSessionId
      app.commands.switchSession(first)
      app.commands.openOwnWindow("notes")
      app.commands.switchSession(second)
      return app
    }

    it("leaves that session's window on the stage as it was", () => {
      const app = elsewhere()
      expect(staged(app)).toEqual(["notes"])
      expect(own(app)).toEqual(["notes"])
    })

    it("brings the panel into that window, closing its own", () => {
      const app = elsewhere()
      app.commands.select("01")
      app.commands.bringPanelHere("notes")
      expect(app.effects).toContain("close notes window")
      expect(own(app)).toEqual([])
      expect(app.state().selected).toBe("panel:notes")
      app.flush()
      expect(app.effects.at(-1)).toBe("focus notes panel")
    })
  })
})
