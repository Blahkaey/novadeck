import { afterEach } from "vitest"
import { page, userEvent, type Locator } from "vitest/browser"

import { boxOf, scrollOver, settled } from "../support/canvas"
import {
  closePreferences,
  expectSearchReady,
  findDialog,
  openPreferencesOn,
  preferencesDialog,
  pressShortcut,
  recentOption,
  recentSwitcher,
} from "../support/keyboard"
import {
  currentRoute,
  currentSessionName,
  newSessionName,
  savedSession,
  savedSessions,
  visit,
} from "../support/sessions"
import { visibilityToggle } from "../support/terminals"
import {
  chooseTerminalsView,
  chooseView,
  detachButton,
  detachPanel,
  openSessions,
  openWorkspace,
  panelWindow,
  press,
  returnButton,
  sidebar,
  sidebarPanel,
  expectSelected,
  terminalsView,
  terminalTab,
  terminalTabNames,
} from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo keeps the person's notes, its todos and the terminals they closed, and lists
// the project's files.
const agents = "/?demo=agents"

// Where to look: the page, or a part of it.
type Within = Pick<Locator, "getByRole">

const noteField = (within: Within = page): Locator =>
  within.getByRole("textbox", { name: "Add a note…" })
const notes = (within: Within = page): Locator => within.getByRole("list", { name: "Notes" })
const closedList = (within: Locator): Locator =>
  within.getByRole("list", { name: "Closed terminals" })
const closedRows = (within: Locator): Locator =>
  closedList(within).getByRole("button", { name: /^Restore / })
// A window's row in the Terminals list.
const windowRow = (name: string): Locator => terminalTab(name)
const hasFocusIn = (locator: Locator): boolean =>
  locator.query()?.contains(document.activeElement) ?? false
// The Todo board's field for a new card, and the tab of one of its columns where it shows one
// at a time.
const todoField = (within: Within = page): Locator =>
  within.getByRole("textbox", { name: "Add a todo…" })
const todoTab = (name: string, within: Within = page): Locator =>
  within.getByRole("tab", { name: new RegExp(`^${name}\\s*\\d+$`) })
// Leaves the session on screen for a new one, and comes back to it with `back`.
const inAnotherSession = async (meanwhile: () => Promise<void>): Promise<void> => {
  await openSessions()
  const original = await currentSessionName()
  await page.getByRole("button", { name: "New session" }).click()
  await openSessions()
  await newSessionName(original)
  await meanwhile()
  await openSessions()
  await savedSession(original).click()
}

describe("a sidebar panel in a window", () => {
  afterEach(async () => {
    await page.viewport(1440, 900)
  })

  context("when Notes is opened in a window from its header", () => {
    it("shows a Notes window on the stage, moves the sidebar on and marks the rail", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await sidebarPanel("Notes").click()
      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      await expect.element(detachButton("Notes")).toBeVisible()

      await detachButton("Notes").click()

      await expect.element(panelWindow("Notes")).toBeVisible()
      await expect.element(notes(panelWindow("Notes"))).toBeVisible()
      // The sidebar moved to the first panel of the rail still there.
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")
      await expect.element(sidebarPanel("Notes")).not.toBeChecked()
      await expect.element(sidebarPanel("Notes")).toHaveAccessibleDescription("In a window")
      // Listed with the session's terminals.
      await expect.element(windowRow("Notes")).toBeVisible()
      // Keyboard focus is in the window, on its first control.
      await expect.element(noteField(panelWindow("Notes"))).toHaveFocus()
    })

    it("keeps a draft typed in the sidebar, and edits a note there", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Notes").click()
      await noteField().fill("Check the refund flow")

      await detachPanel("Notes")

      const window = panelWindow("Notes")
      await expect.element(noteField(window)).toHaveValue("Check the refund flow")
      await notes(window)
        .getByRole("button", { name: "Edit Staging deploys from the release branch" })
        .click()
      const line = window.getByRole("textbox", { name: "Note text" })
      await expect.element(line).toHaveFocus()
      await line.fill("Staging deploys from release")
      await userEvent.keyboard("{Enter}")
      await expect
        .element(notes(window).getByRole("button", { name: "Edit Staging deploys from release" }))
        .toHaveFocus()
    })
  })

  context("as it moves between the sidebar and its window", () => {
    it("keeps the Todo board as the person left it: its draft and the column it shows", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await sidebarPanel("Todo").click()
      await todoTab("In progress", sidebar()).click()
      await todoField(sidebar()).fill("Cover the refund flow")

      await detachPanel("Todo")

      await expect.element(todoField(panelWindow("Todo"))).toHaveValue("Cover the refund flow")

      await returnButton("Todo").click()

      await expect.element(todoField(sidebar())).toHaveValue("Cover the refund flow")
      await expect
        .element(todoTab("In progress", sidebar()))
        .toHaveAttribute("aria-selected", "true")

      // Across sessions: in a window in this one, in the sidebar in the next.
      await detachPanel("Todo")
      await inAnotherSession(async () => {
        await sidebarPanel("Todo").click()
        await expect.element(todoField(sidebar())).toHaveValue("Cover the refund flow")
        await expect
          .element(todoTab("In progress", sidebar()))
          .toHaveAttribute("aria-selected", "true")
      })
      await expect.element(todoField(panelWindow("Todo"))).toHaveValue("Cover the refund flow")
    })

    it("keeps a scrolled History list where it was, out to a window and back", async () => {
      await page.viewport(1440, 600)
      await openWorkspace(agents)
      await chooseView("Grid")
      await sidebarPanel("History").click()
      await expect.element(closedRows(sidebar()).last()).toBeInTheDocument()
      closedList(sidebar()).element().scrollTop = 80
      await expect.poll(() => closedList(sidebar()).element().scrollTop).toBe(80)

      await detachPanel("History")

      const window = panelWindow("History")
      await expect.poll(() => closedList(window).element().scrollTop).toBe(80)
      closedList(window).element().scrollTop = 40

      await returnButton("History").click()

      await expect.element(closedList(sidebar())).toBeVisible()
      await expect.poll(() => closedList(sidebar()).element().scrollTop).toBe(40)
    })

    it("keeps a note's edit open, with what was typed in it, across a session switch", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await detachPanel("Notes")
      const here = currentRoute()
      let there = ""
      await inAnotherSession(async () => {
        there = currentRoute()
      })
      const line = (): Locator => panelWindow("Notes").getByRole("textbox", { name: "Note text" })
      await notes(panelWindow("Notes"))
        .getByRole("button", { name: "Edit Staging deploys from the release branch" })
        .click()
      await line().fill("Staging deploys from release")

      // By links, as a click elsewhere would end the edit, saving it.
      visit(there)
      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      visit(here)

      await expect.element(line()).toHaveValue("Staging deploys from release")
    })

    it("shows its count beside the window's name, its heading saying it too", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Notes").click()
      const heading = sidebar().getByRole("heading", { name: /^Notes \d+$/ })
      await expect.element(heading).toBeVisible()
      const count = heading.element().textContent!.replace("Notes", "")

      await detachPanel("Notes")

      const window = panelWindow("Notes")
      await expect
        .element(window.getByRole("heading", { name: `Notes ${count}` }))
        .toBeInTheDocument()
      const header = window.element().querySelector(".terminal-header")!
      expect(header.querySelector(".panel-window-count")!.textContent).toBe(count)
      // Its own row, with nothing but the count to show, shows nothing.
      const row = window.element().querySelector<HTMLElement>(".sidebar-panel-header")!
      expect(row.offsetHeight).toBe(0)
    })

    it("is found by Search and Ctrl+Tab as a panel window", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await detachPanel("Notes")
      const other = terminalTabNames().find((name) => name !== "Notes")!
      await terminalTab(other).click()

      await press("{Control>}{Tab}")
      await expect.element(recentSwitcher()).toBeVisible()
      await expect.element(recentOption("Notes").getByText("panel window")).toBeVisible()
      await press("{Escape}")
      await press("{/Control}")
      await expect.element(recentSwitcher()).not.toBeInTheDocument()

      await page.getByRole("button", { name: "Find a terminal" }).click()
      await expectSearchReady()
      await expect
        .element(
          findDialog()
            .getByRole("option", { name: /^Notes / })
            .getByText("panel window"),
        )
        .toBeVisible()
    })
  })

  context("when its rail toggle is pressed", () => {
    it("brings its window into view with keyboard focus, shown again where Grid hid it", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await detachPanel("Notes")
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")
      const other = terminalTabNames().find((name) => name !== "Notes")!
      await terminalTab(other).click()

      await sidebarPanel("Notes").click()

      await expectSelected("Notes")
      await expect.poll(() => hasFocusIn(panelWindow("Notes"))).toBe(true)
      // The sidebar stays on what it showed.
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")

      // Hidden from Grid while another terminal is selected, it shows again.
      await terminalTab(other).click()
      await visibilityToggle("Notes", "Hide").click()
      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()

      await sidebarPanel("Notes").click()

      await expect.element(panelWindow("Notes")).toBeVisible()
      await expect.element(visibilityToggle("Notes", "Hide")).toBeInTheDocument()
      await expect.poll(() => hasFocusIn(panelWindow("Notes"))).toBe(true)
    })
  })

  context("when it returns to the sidebar", () => {
    it("closes the window and opens the sidebar on it, with keyboard focus there", async () => {
      await openWorkspace(agents)
      await detachPanel("Notes")

      await returnButton("Notes").click()

      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      await expect.element(noteField(sidebar())).toHaveFocus()
      await expect.element(sidebarPanel("Notes")).toBeChecked()
    })

    it("returns Todo and Files opened together, in either order", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await detachPanel("Todo")
      await detachPanel("Files")
      await expect.element(panelWindow("Todo")).toBeVisible()
      await expect.element(panelWindow("Files")).toBeVisible()

      await returnButton("Files").click()
      await expect.element(panelWindow("Files")).not.toBeInTheDocument()
      await expect.element(panelWindow("Todo")).toBeVisible()
      await expect.element(sidebar()).toHaveAccessibleName("Files")
      await returnButton("Todo").click()
      await expect.element(panelWindow("Todo")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Todo")

      await detachPanel("Todo")
      await detachPanel("Files")
      await returnButton("Todo").click()
      await expect.element(panelWindow("Files")).toBeVisible()
      await returnButton("Files").click()
      await expect.element(panelWindow("Files")).not.toBeInTheDocument()
      await expect.element(panelWindow("Todo")).not.toBeInTheDocument()
    })

    it("returns from its row in the Terminals list", async () => {
      await openWorkspace(agents)
      await detachPanel("Notes")
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")

      await sidebar().getByRole("button", { name: "Return Notes to the sidebar" }).click()

      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Notes")
    })
  })

  context("when the session changes", () => {
    it("shows each session's own windows and sidebar", async () => {
      await openWorkspace(agents)
      await detachPanel("Notes")
      await openSessions()
      const original = await currentSessionName()
      await page.getByRole("button", { name: "New session" }).click()
      await openSessions()
      await newSessionName(original)

      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      await expect.element(sidebarPanel("Notes")).not.toHaveAccessibleDescription("In a window")
      await sidebarPanel("Notes").click()
      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      await expect.element(notes(sidebar())).toBeVisible()

      await openSessions()
      await savedSession(original).click()

      await expect.element(panelWindow("Notes")).toBeVisible()
      await expect.element(sidebarPanel("Notes")).toHaveAccessibleDescription("In a window")
      await sidebarPanel("Notes").click()
      await expect.element(sidebar()).not.toHaveAccessibleName("Notes")
    })
  })

  context("in each view", () => {
    it("draws in Focus, Grid and Canvas", async () => {
      await openWorkspace(agents)
      await detachPanel("Notes")
      for (const view of ["Focus", "Grid", "Canvas"] as const) {
        // oxlint-disable-next-line no-await-in-loop -- One view after another.
        await chooseView(view)
        // oxlint-disable-next-line no-await-in-loop -- As above.
        await windowRow("Notes").click()
        // oxlint-disable-next-line no-await-in-loop -- As above.
        await expect.element(notes(panelWindow("Notes"))).toBeVisible()
      }
    })

    it("scrolls its list with the wheel on Canvas, leaving the camera where it was", async () => {
      await page.viewport(1440, 700)
      await openWorkspace(agents)
      await chooseView("Canvas")
      await detachPanel("History")
      const window = panelWindow("History")
      await expect.element(closedRows(window).last()).toBeInTheDocument()
      const list = (): Element => closedList(window).element()
      expect(list().scrollHeight).toBeGreaterThan(list().clientHeight)
      const before = await settled(() => boxOf(window))

      await scrollOver(closedRows(window).first(), 240)

      await expect.poll(() => list().scrollTop).toBeGreaterThan(0)
      // Neither panned nor zoomed: the window is where it was, as big.
      expect(await settled(() => boxOf(window))).toEqual(before)
    })
  })

  context("by keyboard alone", () => {
    it("opens and returns with Tab and Enter, focus landing in the panel each time", async () => {
      await openWorkspace(agents)
      // On the rail's toggle, as Tab reaches it.
      sidebarPanel("Notes").element().focus()
      await press("{Enter}")
      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      // The panel's header comes next: its first button opens it in a window.
      await press("{Tab}")
      await expect.element(detachButton("Notes")).toHaveFocus()
      await press("{Enter}")

      await expect.element(panelWindow("Notes")).toBeVisible()
      await expect.element(noteField(panelWindow("Notes"))).toHaveFocus()

      // The window's header is just before its body.
      await press("{Shift>}{Tab}{/Shift}")
      await expect.element(returnButton("Notes")).toHaveFocus()
      await press("{Enter}")

      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      await expect.element(noteField(sidebar())).toHaveFocus()
    })
  })

  context("when a link names a panel that is in a window", () => {
    it("leaves the sidebar saying where it is, with a way to it and a way back", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await detachPanel("Notes")
      // The address as it is, naming Notes as the sidebar's panel.
      const atNotes = (): string => {
        const [path, query] = currentRoute().split("?")
        const search = new URLSearchParams(query)
        search.set("panel", "notes")
        return `${path}?${search}`
      }

      visit(atNotes())

      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      await expect.element(sidebar().getByText("Notes is in a window")).toBeVisible()
      await sidebar().getByRole("button", { name: "Show it" }).click()
      await expect.poll(() => hasFocusIn(panelWindow("Notes"))).toBe(true)

      visit(atNotes())
      await expect.element(sidebar().getByText("Notes is in a window")).toBeVisible()
      await sidebar().getByRole("button", { name: "Return to sidebar" }).click()

      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      await expect.element(notes(sidebar())).toBeVisible()
      await expect.element(noteField(sidebar())).toHaveFocus()
    })
  })

  context("on a phone", () => {
    it("closes the drawer as the panel opens in a window, which shows", async () => {
      await page.viewport(390, 800)
      await openWorkspace(agents)
      await sidebarPanel("Notes").click()
      const drawer = page.getByRole("dialog", { name: "Notes" })
      await expect.element(drawer).toBeVisible()

      await detachButton("Notes").click()

      await expect.element(drawer).not.toBeInTheDocument()
      await expect.element(panelWindow("Notes")).toBeVisible()
      await expect.element(notes(panelWindow("Notes"))).toBeVisible()
    })
  })

  context("for the Terminals panel", () => {
    it("opens in a window on the view it showed, switches there, and returns on that view", async () => {
      await openWorkspace(agents)
      await openSessions()

      await page.getByRole("button", { name: "Open Sessions in a window" }).click()

      const window = panelWindow("Terminals")
      await expect.element(savedSessions()).toBeVisible()
      expect(window.element().contains(savedSessions().element())).toBe(true)
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")
      await chooseTerminalsView("Terminals")
      await expect.element(terminalsView("Terminals")).toBeChecked()
      await expect.element(terminalTab("Checkout review")).toBeVisible()
      // The sidebar stays where it was.
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")

      // The window's header's, before its list's row for the window.
      await returnButton("Terminals").first().click()

      await expect.element(panelWindow("Terminals")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")
      await expect.element(terminalsView("Terminals")).toBeChecked()
    })

    it("is shown on the sessions by the Sessions key, the sidebar as it was", async () => {
      await openWorkspace(agents)
      await detachPanel("Terminals")
      await terminalTab("Checkout review").click()

      await pressShortcut("sessions")

      await expect.element(terminalsView("Sessions")).toBeChecked()
      await expect.element(savedSessions()).toBeVisible()
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")
      await expect.poll(() => hasFocusIn(panelWindow("Terminals"))).toBe(true)
    })

    it("switches its view in a session that has it in a window, the sidebar on the sessions", async () => {
      await openWorkspace(agents)
      await detachPanel("Terminals")
      await chooseTerminalsView("Sessions")
      const original = await currentSessionName()
      await panelWindow("Terminals").getByRole("button", { name: "New session" }).click()
      // The new session has the panel in the sidebar; its sessions there name the first.
      await openSessions()
      await newSessionName(original)
      await savedSession(original).click()
      await expect.element(panelWindow("Terminals")).toBeVisible()

      await chooseTerminalsView("Terminals")

      await expect.element(terminalsView("Terminals")).toBeChecked()
      await expect.element(terminalTab("Checkout review")).toBeVisible()
      await pressShortcut("sessions")
      await expect.element(terminalsView("Sessions")).toBeChecked()
    })

    it("lists its own window, whose row goes to it and returns it", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      await detachPanel("Terminals")
      await terminalTab("Checkout review").click()

      await windowRow("Terminals").click()

      await expectSelected("Terminals")
      // The row's, in the list after the window's header and its own.
      await panelWindow("Terminals")
        .getByRole("button", { name: "Return Terminals to the sidebar" })
        .last()
        .click()
      await expect.element(panelWindow("Terminals")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")
    })
  })

  context("for the Inbox", () => {
    it("opens in a window and returns to the sidebar", async () => {
      await openWorkspace(agents)

      await detachPanel("Inbox")

      const window = panelWindow("Inbox")
      await expect
        .element(window.getByRole("list", { name: "Messages from your agents" }))
        .toBeVisible()
      await expect.element(sidebar()).toHaveAccessibleName("Terminals")

      await returnButton("Inbox").click()

      await expect.element(panelWindow("Inbox")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")
    })
  })

  context("for Worktrees", () => {
    // Agent worktrees, which bring the panel, are turned on and off in Preferences' Experimental
    // tab, which an app with updates has (`?update=ready`, a stable launch, has them off).
    const agentWorktrees = async (): Promise<void> => {
      await openPreferencesOn("About")
      await preferencesDialog().getByRole("switch", { name: "Experimental" }).click()
      await preferencesDialog().getByRole("tab", { name: "Experimental" }).click()
      await preferencesDialog().getByRole("switch", { name: "Agent worktrees" }).click()
      await closePreferences()
    }

    it("opens in a window and returns to the sidebar", async () => {
      await openWorkspace(agents)

      await detachPanel("Worktrees")

      await expect
        .element(panelWindow("Worktrees").getByRole("region", { name: /^Worktrees( \d+)?$/ }))
        .toBeVisible()
      await returnButton("Worktrees").click()
      await expect.element(panelWindow("Worktrees")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Worktrees")
    })

    it("closes its window as agent worktrees turn off", async () => {
      await openWorkspace("/?update=ready")
      await agentWorktrees()
      await detachPanel("Worktrees")
      await sidebarPanel("Inbox").click()

      // Experimental off turns agent worktrees off with it.
      await openPreferencesOn("About")
      await preferencesDialog().getByRole("switch", { name: "Experimental" }).click()
      // Preferences stays open as the window goes.
      await expect.element(panelWindow("Worktrees")).not.toBeInTheDocument()
      await closePreferences()

      await expect.element(panelWindow("Worktrees")).not.toBeInTheDocument()
      await expect.element(sidebarPanel("Worktrees")).not.toBeInTheDocument()
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")
    })
  })

  context("when every panel of the rail is in a window", () => {
    it("hides the sidebar, and returning one opens it on that one", async () => {
      await openWorkspace(agents)
      await chooseView("Grid")
      const rail = page.getByRole("radiogroup", { name: "Sidebar actions" }).getByRole("radio")
      const names = rail.elements().map((radio) => radio.getAttribute("aria-label")!)
      expect(names).toEqual(
        expect.arrayContaining(["Terminals", "Files", "Worktrees", "Notes", "Todo", "History"]),
      )

      const all = ["Terminals", "Inbox", "Worktrees", "Files", "Notes", "Todo", "History"] as const
      for (const name of all) {
        // One after another, each from the sidebar the last one left.
        // eslint-disable-next-line no-await-in-loop -- As above.
        await detachPanel(name)
      }

      await expect.element(sidebar()).not.toBeInTheDocument()
      await returnButton("Todo").click()
      await expect.element(sidebar()).toHaveAccessibleName("Todo")
    })
  })
})
