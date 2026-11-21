import { workspaceReducer } from "@novadeck/core/state"
import { workspaceFixture, workspaceWithPanel } from "@novadeck/core/testing"
import { railPanels, type RailPanel, type SidebarPanel } from "@novadeck/core/types"

import { context, describe, expect, it } from "../../test"
import { openCommands, type CommandsOptions } from "../../test/commands"
import { currentTarget, terminalsViewShown } from "../selectors"

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
// The panels in a window of their own.
const own = (app: ReturnType<typeof openCommands>): readonly RailPanel[] =>
  app.ui.getSnapshot().ownWindows
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

    it("hides the sidebar when every panel of the rail is in a window", () => {
      const app = open("terminals")
      for (const panel of railPanels) app.commands.detachPanel(panel)
      expect(staged(app)).toEqual(railPanels)
      expect(sidebar(app).visible).toBe(false)
      // Returning one opens it on that one.
      app.commands.returnPanel("todo")
      expect(sidebar(app)).toEqual({ panel: "todo", visible: true })
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

describe("a look at a panel in a window on the stage", () => {
  it("selects its window, and goes back to the terminal it was on after", () => {
    const app = open("notes")
    app.commands.detachPanel("inbox")
    app.commands.select("02")
    const back = app.commands.peekInbox()
    expect(app.state().selected).toBe("panel:inbox")
    back?.()
    expect(app.state().selected).toBe("02")
    app.flush()
    expect(app.effects.at(-1)).toBe("focus input 02")
  })

  it("stays where the person went since", () => {
    const app = open("notes")
    app.commands.detachPanel("inbox")
    app.commands.select("02")
    const back = app.commands.peekInbox()
    app.commands.select("01")
    back?.()
    expect(app.state().selected).toBe("01")
  })

  it("has nothing to put back for a window already selected", () => {
    const app = open("notes")
    app.commands.detachPanel("inbox")
    expect(app.commands.peekInbox()).toBeUndefined()
  })
})

describe("dropping a panel the app no longer shows", () => {
  it("closes its windows, on the stage and of its own, and leaves the sidebar as it was", () => {
    const app = open("inbox")
    app.commands.detachPanel("worktrees")
    app.commands.openOwnWindow("worktrees")
    app.commands.detachPanel("worktrees")
    app.commands.dropPanel("worktrees")
    expect(app.effects).toContain("close worktrees window")
    expect(own(app)).toEqual([])
    expect(staged(app)).toEqual([])
    expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
  })

  it("leaves Preferences open over it, and the keyboard where it is", () => {
    const app = open("inbox")
    app.commands.detachPanel("worktrees")
    app.navigation.go({ dialog: "preferences" })
    const moves = app.shell().navigation.count
    app.commands.dropPanel("worktrees")
    expect(staged(app)).toEqual([])
    expect(app.ui.getSnapshot().location.route.dialog).toBe("preferences")
    // Closing it still goes back through the entry it opened over.
    expect(app.ui.getSnapshot().location.dialogDepth).toBe(1)
    expect(app.shell().navigation.count).toBe(moves)
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

// The view the Terminals panel shows: in its window, the one chosen there.
const terminalsView = (app: ReturnType<typeof openCommands>) =>
  terminalsViewShown(app.ui.getSnapshot(), app.workspace.getSnapshot())

// A session saved with the Terminals panel in a window on its stage, as the app opens it again
// with the route on the Terminals panel, where nothing names another.
const savedWithTerminalsOut = () => {
  const app = openCommands({
    url: grid,
    moveTerminal: async () => ({ sessionId: "s", moved: [], left: null }),
    workspace: workspaceReducer(workspaceFixture(), {
      type: "panel/open",
      target: { projectId: "project", workspaceSessionId: "initial" },
      panel: "terminals",
    }),
  })
  expect(app.ui.getSnapshot().location.route.panel).toBe("terminals")
  return app
}

describe("the Terminals panel in a window", () => {
  context("with the route still on the Terminals panel", () => {
    it("switches its view there", () => {
      const app = savedWithTerminalsOut()
      app.commands.switchTerminalsView("sessions", false)
      expect(terminalsView(app)).toBe("sessions")
    })

    it("is revealed on the sessions by their key", () => {
      const app = savedWithTerminalsOut()
      app.commands.showSessions()
      expect(terminalsView(app)).toBe("sessions")
      expect(app.state().selected).toBe("panel:terminals")
    })

    it("returns on the view its window showed", () => {
      const app = savedWithTerminalsOut()
      app.commands.switchTerminalsView("sessions", false)
      app.commands.returnPanel("terminals")
      expect(sidebar(app)).toEqual({ panel: "sessions", visible: true })
      expect(terminalsView(app)).toBe("sessions")
    })

    it("takes the sidebar's view again in a session that has the panel there", () => {
      const app = savedWithTerminalsOut()
      app.commands.switchTerminalsView("sessions", false)
      app.commands.startFresh()
      expect(app.shell().terminalsView).toBe("terminals")
      app.commands.detachPanel("terminals")
      expect(terminalsView(app)).toBe("terminals")
    })

    it("keeps a pick of where a terminal goes there", () => {
      const app = savedWithTerminalsOut()
      app.commands.pickSession("01", "menu")
      expect(terminalsView(app)).toBe("sessions")
      expect(app.ui.getSnapshot().moving).toMatchObject({ terminalId: "01" })
    })
  })

  it("shows the view it had in the sidebar, and comes back on the view it had there", () => {
    const app = open("sessions")
    app.commands.detachPanel("terminals")
    expect(terminalsView(app)).toBe("sessions")
    expect(sidebar(app).panel).not.toBe("sessions")
    app.commands.switchTerminalsView("terminals", false)
    app.commands.returnPanel("terminals")
    expect(sidebar(app)).toEqual({ panel: "terminals", visible: true })
    app.flush()
    expect(app.effects.at(-1)).toBe("focus terminals panel")
  })

  it("switches its view in its window, the sidebar as it was, the switch keeping the keys", () => {
    const app = open("inbox")
    app.commands.detachPanel("terminals")
    app.commands.select("01")
    app.commands.switchTerminalsView("sessions", true)
    expect(terminalsView(app)).toBe("sessions")
    expect(app.state().selected).toBe("01")
    expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
    app.flush()
    expect(app.effects.at(-1)).toBe("focus sessions view")
  })

  it("is revealed on the view a key or its rail toggle names", () => {
    const app = open("inbox")
    app.commands.detachPanel("terminals")
    app.commands.select("01")
    app.commands.toggleSidebar("sessions")
    expect(app.state().selected).toBe("panel:terminals")
    expect(terminalsView(app)).toBe("sessions")
    app.flush()
    expect(app.effects.at(-1)).toBe("focus sessions panel")
    app.commands.toggleSidebar("terminals")
    expect(terminalsView(app)).toBe("terminals")
    app.commands.select("01")
    app.commands.toggleRail("terminals")
    expect(app.state().selected).toBe("panel:terminals")
    expect(terminalsView(app)).toBe("terminals")
    expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
  })

  context("in a window of its own", () => {
    it("is brought to the front on the view named", () => {
      const app = open("inbox")
      app.commands.detachPanel("terminals")
      app.commands.openOwnWindow("terminals")
      app.commands.showSessions()
      expect(terminalsView(app)).toBe("sessions")
      expect(app.effects.at(-1)).toBe("focus sessions window")
    })

    it("keeps a new session's terminals there, on their view, with New terminal focused", () => {
      const app = open("inbox")
      app.commands.detachPanel("terminals")
      app.commands.openOwnWindow("terminals")
      app.commands.switchTerminalsView("sessions", false)
      app.commands.startFresh()
      expect(own(app)).toEqual(["terminals"])
      expect(terminalsView(app)).toBe("terminals")
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
      app.flush()
      expect(app.effects.at(-1)).toBe("focus terminals create")
    })
  })

  context("as a terminal's menu picks where it goes", () => {
    const picking = () => {
      const app = open("inbox", {
        moveTerminal: async () => ({ sessionId: "s", moved: [], left: null }),
      })
      app.commands.detachPanel("terminals")
      app.commands.select("01")
      app.commands.pickSession("01", "menu")
      return app
    }

    it("shows the sessions in its window, keyboard focus on the first to move to", () => {
      const app = picking()
      expect(terminalsView(app)).toBe("sessions")
      expect(app.ui.getSnapshot().moving).toMatchObject({ terminalId: "01" })
      expect(sidebar(app)).toEqual({ panel: "inbox", visible: true })
      app.flush()
      expect(app.effects).toContain("focus move pick")
    })

    it("puts its view back as the pick is given up, and the terminal it was on", () => {
      const app = picking()
      expect(app.state().selected).toBe("panel:terminals")
      app.commands.cancelPick()
      expect(app.ui.getSnapshot().moving).toBeNull()
      expect(terminalsView(app)).toBe("terminals")
      expect(app.state().selected).toBe("01")
      app.flush()
      expect(app.effects.at(-1)).toBe("focus input 01")
    })

    it("ends the pick as its window turns to the terminals", () => {
      const app = picking()
      app.commands.switchTerminalsView("terminals", false)
      expect(app.ui.getSnapshot().moving).toBeNull()
    })
  })
})
