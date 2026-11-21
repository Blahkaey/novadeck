import { demoInboxIds } from "@novadeck/demo/inbox/fixtures"
import type { WorkspacePanel } from "@novadeck/ui/app/App"
import { afterEach, beforeEach, vi } from "vitest"
import { page, type Locator } from "vitest/browser"

import { desktopWindow } from "../support/backend"
import { closePreferences, openPreferencesOn, preferencesDialog } from "../support/keyboard"
import { expectStaysTrue } from "../support/layouts"
import { ownWindowPointer } from "../support/pointer"
import { currentSessionName, newSessionName, savedSession } from "../support/sessions"
import {
  detachPanel,
  expectSelected,
  literal,
  openSessions,
  openWorkspace,
  panelWindow,
  sidebar,
  sidebarPanel,
  tabDescription,
} from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo keeps the person's notes and its todos, and lists the project's files.
const agents = "/?demo=agents"

type Panel = "Terminals" | "Inbox" | "Worktrees" | "Notes" | "Todo" | "History" | "Files"

// The windows of a panel's own the app opens, by name, as it opens them: windows of the test's
// own page, so the spec reaches into them as the app does. Playwright's locators see only the
// test's frame, so in them the spec finds elements itself, types with DOM events, and points with
// the mouse of that window's page (`ownWindowPointer`).
const opened = new Map<string, Window>()
let open: typeof window.open
beforeEach(() => {
  open = window.open
  window.open = (...args: Parameters<typeof window.open>) => {
    const view = open.apply(window, args)
    if (view && typeof args[1] === "string") opened.set(args[1], view)
    return view
  }
})
afterEach(() => {
  window.open = open
  for (const view of opened.values()) view.close()
  opened.clear()
})

const ownWindow = (name: Panel): Window | undefined =>
  opened.get(`novadeck-panel-${name.toLowerCase()}`)

// What the window of `name`'s own shows, once it shows it.
const panelIn = (view: Window, name: Panel): HTMLElement | null =>
  view.closed ? null : view.document.getElementById(`${name.toLowerCase()}-panel`)

const ownWindowButton = (name: Panel): Locator =>
  panelWindow(name).getByRole("button", { name: `Open ${name} in its own window` })

// Opens the panel's window on the stage, then a window of its own from that window's header.
const openOwnWindow = async (name: Panel): Promise<Window> => {
  if (!panelWindow(name).query()) await detachPanel(name)
  await ownWindowButton(name).click()
  await expect.poll(() => ownWindow(name) && panelIn(ownWindow(name)!, name)).toBeTruthy()
  return ownWindow(name)!
}

// The element in the window matching `selector`.
const find = <E extends Element = HTMLElement>(view: Window, selector: string): E => {
  const found = view.document.querySelector<E>(selector)
  if (!found) throw new Error(`Nothing in the window matches ${selector}`)
  return found
}

// What an element of the window is called, as a screen reader names it: its label, what labels
// it, or its words.
const nameOf = (element: Element): string => {
  const label = element.getAttribute("aria-label")
  if (label) return label
  const by = element.getAttribute("aria-labelledby")
  if (by)
    return by
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim()
  const labels = "labels" in element ? (element as HTMLInputElement).labels : null
  if (labels && labels.length > 0)
    return [...labels]
      .map((each) => each.textContent ?? "")
      .join(" ")
      .trim()
  return element.textContent?.trim() ?? ""
}

// The elements of each role, as markup gives it.
const roles = {
  button: 'button, [role="button"]',
  dialog: '[role="dialog"]',
  list: 'ul, ol, [role="list"]',
  radio: 'input[type="radio"], [role="radio"]',
  radiogroup: '[role="radiogroup"]',
} as const

// The elements in `within` of the role named, and of the name given: Playwright's locators see
// only the test's frame, not the window's.
const allByRole = <E extends HTMLElement = HTMLElement>(
  within: ParentNode,
  role: keyof typeof roles,
  name?: string | RegExp,
): E[] =>
  [...within.querySelectorAll<E>(roles[role])].filter(
    (each) =>
      name === undefined ||
      (typeof name === "string" ? nameOf(each) === name : name.test(nameOf(each))),
  )
const byRole = <E extends HTMLElement = HTMLElement>(
  within: ParentNode,
  role: keyof typeof roles,
  name: string | RegExp,
): E => {
  const found = allByRole<E>(within, role, name)[0]
  if (!found) throw new Error(`Nothing in the window is a ${role} named ${String(name)}`)
  return found
}

// Whether every edge of `element` is within the window's view.
const withinView = (view: Window, element: Element): boolean => {
  const box = element.getBoundingClientRect()
  return (
    box.width > 0 &&
    box.left >= 0 &&
    box.top >= 0 &&
    box.right <= view.innerWidth &&
    box.bottom <= view.innerHeight
  )
}

// Types `text` into a field of the window as a person's typing leaves it, for React to hear.
const type = (field: HTMLInputElement | HTMLTextAreaElement, text: string): void => {
  const view = field.ownerDocument.defaultView!
  const prototype =
    field.localName === "textarea"
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text)
  field.dispatchEvent(new view.Event("input", { bubbles: true }))
}

// Where a person aims at an element of the window: near its start for a wide one, as at a row's
// name, or at its middle.
const pointAt = (element: Element, aim: "start" | "middle" = "start"): { x: number; y: number } => {
  const box = element.getBoundingClientRect()
  const x = aim === "start" ? Math.min(20, box.width / 2) : box.width / 2
  return { x: box.left + x, y: box.top + box.height / 2 }
}

// The first row of the Files tree, a file or a folder.
const firstRow = '[role="treeitem"][aria-level="1"]:not([aria-disabled])'

const noteField = (within: Locator): Locator => within.getByRole("textbox", { name: "Add a note…" })

describe("a sidebar panel in a window of its own", () => {
  context("when Notes opens in its own window from its window's header", () => {
    it("shows its notes there, dressed in the app's styles, and leaves the stage", async () => {
      await openWorkspace(agents)
      await detachPanel("Notes")

      const view = await openOwnWindow("Notes")

      const notes = find(view, '[role="list"][aria-label="Notes"]')
      expect(notes.querySelectorAll('[role="listitem"]').length).toBeGreaterThan(0)
      expect(view.document.title).toMatch(/^Notes · /)
      // The app's own sheets dress its page, as their reset of the body's margin shows.
      expect(view.getComputedStyle(view.document.body).margin).toBe("0px")
      // Its frame offers the way back, in place of Hide.
      expect(find(view, '[aria-label="Return Notes to the sidebar"]')).toBeTruthy()
      expect(view.document.querySelector('[aria-label="Hide notes"]')).toBeNull()
      // Gone from the stage, its rail toggle says where it is.
      await expect.element(panelWindow("Notes")).not.toBeInTheDocument()
      await expect.element(sidebarPanel("Notes")).toHaveAccessibleDescription("In its own window")
      // Keyboard focus is in it, on its first control.
      await expect
        .poll(() => view.document.activeElement?.getAttribute("aria-label"))
        .toBe("Add a note…")
    })
  })

  context("for Todo in its own window", () => {
    it("adds a todo and checks it off there", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Todo")
      const field = find<HTMLTextAreaElement | HTMLInputElement>(view, '[aria-label="Add a todo…"]')

      type(field, "Cover the refund flow")
      field.form!.requestSubmit()

      const check = (): HTMLInputElement | null =>
        view.document.querySelector<HTMLInputElement>(
          'input[type="checkbox"][aria-label="Cover the refund flow"]',
        )
      await expect.poll(check).toBeTruthy()
      check()!.click()
      const tab = (name: string): string | undefined =>
        [...view.document.querySelectorAll('[role="tab"]')]
          .find((each) => each.textContent?.startsWith(name))
          ?.textContent?.replace(name, "")
      await expect.poll(() => tab("Done")).toBe("3")
      expect(tab("To do")).toBe("3")
    })

    it("moves a card to Done when it is dragged onto Done's tab", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Todo")
      const text = "Reply to the design review about the empty cart"
      const line = find(view, `[aria-label="Edit ${text}"]`)
      const done = [...view.document.querySelectorAll('[role="tab"]')].find((each) =>
        each.textContent?.startsWith("Done"),
      )!

      await ownWindowPointer(view.name, "press", pointAt(line))
      await ownWindowPointer(view.name, "move", pointAt(done, "middle"))
      await ownWindowPointer(view.name, "release")

      await expect.poll(() => done.textContent).toBe("Done3")
    })
  })

  context("when its window closes", () => {
    it("comes back to the sidebar, open on it, with what was typed in it", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Notes")
      type(find<HTMLTextAreaElement>(view, '[aria-label="Add a note…"]'), "Check the refund flow")

      view.close()

      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      await expect.element(noteField(sidebar())).toHaveValue("Check the refund flow")
      await expect.element(sidebarPanel("Notes")).toBeChecked()
      await expect
        .element(sidebarPanel("Notes"))
        .not.toHaveAccessibleDescription("In its own window")
    })

    it("does the same from its Return to sidebar, with keyboard focus there", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Notes")
      type(find<HTMLTextAreaElement>(view, '[aria-label="Add a note…"]'), "Check the refund flow")

      find(view, '[aria-label="Return Notes to the sidebar"]').click()

      await expect.poll(() => view.closed).toBe(true)
      await expect.element(sidebar()).toHaveAccessibleName("Notes")
      await expect.element(noteField(sidebar())).toHaveValue("Check the refund flow")
      await expect.element(noteField(sidebar())).toHaveFocus()
    })
  })

  context("when its window closes over a question or a menu the panel opened there", () => {
    // What the question or the menu left holding the page, once it has gone: a screen over the
    // page, something of the page hidden from assistive technology or made inert, its scrolling
    // locked.
    const holdingThePage = (): string[] =>
      [
        '[data-scope="dialog"][data-part="backdrop"]',
        '[data-scope="menu"][data-part="content"][data-state="open"]',
        'body > [aria-hidden="true"], body > [inert]',
      ]
        .filter((selector) => document.querySelector(selector))
        .concat(getComputedStyle(document.body).overflow === "hidden" ? ["scroll lock"] : [])
    const pageFree = async (): Promise<void> => {
      await expect.poll(holdingThePage).toEqual([])
    }

    it("takes History's Clear question away, keyboard focus back in the panel", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("History")
      find(view, '[aria-label="Clear History"]').click()
      await expect.poll(() => view.document.querySelector('[role="alertdialog"]')).toBeTruthy()

      view.close()

      await expect.element(sidebar()).toHaveAccessibleName("History")
      await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument()
      await pageFree()
      await expect.poll(() => sidebar().element().contains(document.activeElement)).toBe(true)
      // The panel asks again on the page, as ever.
      await sidebar().getByRole("button", { name: "Clear History" }).click()
      await expect.element(page.getByRole("alertdialog", { name: "Clear History?" })).toBeVisible()
    })

    it("takes a Files row's menu away", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Files")
      await expect.poll(() => view.document.querySelector(firstRow)).toBeTruthy()
      await ownWindowPointer(view.name, "right-click", pointAt(find(view, firstRow)))
      await expect.poll(() => view.document.querySelector('[role="menu"]')).toBeTruthy()

      view.close()

      await expect.element(sidebar()).toHaveAccessibleName("Files")
      await expect.element(page.getByRole("menu")).not.toBeInTheDocument()
      await pageFree()
    })
  })

  context("when its rail toggle is pressed", () => {
    it("brings its window to the front, leaving the sidebar as it was", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Notes")
      const focused = vi.spyOn(view, "focus")
      const before = sidebar().element().getAttribute("aria-label")

      await sidebarPanel("Notes").click()

      expect(focused).toHaveBeenCalled()
      expect(sidebar().element().getAttribute("aria-label")).toBe(before)
    })
  })

  context("when the browser refuses the window", () => {
    it("says so, and leaves the panel in its window on the stage", async () => {
      let refuseNextWindow = (): void => {}
      const Hooks: WorkspacePanel = (props) => {
        refuseNextWindow = props.refuseNextWindow
        return null
      }
      await openWorkspace(agents, { panel: () => Hooks })
      await detachPanel("Notes")

      refuseNextWindow()
      await ownWindowButton("Notes").click()

      await expect
        .element(
          page.getByText(
            "Novadeck couldn't open a window for Notes — your browser may have blocked it.",
          ),
        )
        .toBeVisible()
      await expect.element(noteField(panelWindow("Notes"))).toBeVisible()
      expect(ownWindow("Notes")).toBeUndefined()
    })
  })

  context("in another session whose stage has its window", () => {
    it("says there where it is, and brings it into that window", async () => {
      await openWorkspace(agents)
      await detachPanel("Notes")
      await openSessions()
      const original = await currentSessionName()
      await page.getByRole("button", { name: "New session" }).click()
      await openSessions()
      const fresh = await newSessionName(original)
      await detachPanel("Notes")
      await openSessions()
      await savedSession(original).click()
      const view = await openOwnWindow("Notes")

      await openSessions()
      await savedSession(fresh).click()

      const tile = panelWindow("Notes")
      await expect.element(tile.getByText("Notes is in its own window")).toBeVisible()
      await expect.element(noteField(tile)).not.toBeInTheDocument()
      expect(panelIn(view, "Notes")).not.toBeNull()

      await tile.getByRole("button", { name: "Bring it here" }).click()

      await expect.poll(() => view.closed).toBe(true)
      await expect.element(noteField(panelWindow("Notes"))).toBeVisible()
    })
  })

  context("for Files in its own window", () => {
    it("copies a path through that window's clipboard", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Files")
      const written: string[] = []
      Object.defineProperty(view.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void written.push(text) },
      })
      await expect.poll(() => view.document.querySelector(firstRow)).toBeTruthy()
      const row = find(view, firstRow)
      const path = row.dataset["path"]!
      await ownWindowPointer(view.name, "right-click", pointAt(row))
      const copyPath = (): HTMLElement | undefined =>
        [...view.document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
          item.textContent?.startsWith("Copy Path"),
        )
      await expect.poll(copyPath).toBeTruthy()
      // Over the item, as a hand reaches it, and then a click.
      await ownWindowPointer(view.name, "move", pointAt(copyPath()!))
      await ownWindowPointer(view.name, "click", pointAt(copyPath()!))

      await expect
        .poll(() => written)
        .toEqual([expect.stringMatching(new RegExp(`/${literal(path)}$`))])
    })
  })

  context("for the Terminals panel in its own window", () => {
    const viewChoice = (view: Window, name: "Terminals" | "Sessions"): HTMLInputElement =>
      byRole(byRole(view.document, "radiogroup", "Terminals panel view"), "radio", name)

    it("switches to the sessions there, and returns on that view", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Terminals")
      expect(allByRole(view.document, "button", /^Select Checkout review(, @\w+)?$/)).toHaveLength(
        1,
      )

      viewChoice(view, "Sessions").click()

      await expect.poll(() => allByRole(view.document, "list", "Saved sessions")).toHaveLength(1)
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")
      byRole(view.document, "button", "Return Terminals to the sidebar").click()
      await expect.poll(() => view.closed).toBe(true)
      await expect.element(sidebar()).toHaveAccessibleName("Sessions")
    })

    it("shows a new session's terminals there, keyboard focus on New terminal", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Terminals")
      viewChoice(view, "Sessions").click()
      await expect.poll(() => allByRole(view.document, "button", "New session")).toHaveLength(1)

      byRole(view.document, "button", "New session").click()

      await expect
        .poll(() => view.document.activeElement && nameOf(view.document.activeElement))
        .toBe("New terminal")
      expect(viewChoice(view, "Terminals").checked).toBe(true)
      await expect.element(sidebar()).toHaveAccessibleName("Inbox")
    })
  })

  context("for the Inbox in its own window", () => {
    // The buttons that open the Inbox's rows there, by their words: not the buttons beside them
    // that name them too.
    const rowButtons = (view: Window): HTMLElement[] =>
      allByRole(byRole(view.document, "list", "Messages from your agents"), "button").filter(
        (button) => !/^(?:Dismiss|Snooze|Unsnooze): /.test(nameOf(button)),
      )
    // The row whose sheet is open, by its button's words.
    const openRow = (view: Window): string | undefined => {
      const current = rowButtons(view).find((button) => button.ariaCurrent === "true")
      return current && nameOf(current)
    }

    it("steps down and up its list with j and k, the sheet in that window", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Inbox")
      await expect.poll(() => rowButtons(view).length).toBeGreaterThan(1)
      const first = rowButtons(view)[0]!
      first.click()
      await expect.poll(() => openRow(view)).toBe(nameOf(first))
      const key = (name: string): void =>
        void view.document.activeElement!.dispatchEvent(
          new view.document.defaultView!.KeyboardEvent("keydown", {
            key: name,
            bubbles: true,
            cancelable: true,
          }),
        )
      // From the row, which keeps the keyboard.
      first.focus()

      key("j")
      await expect.poll(() => openRow(view)).not.toBe(nameOf(first))
      key("k")
      await expect.poll(() => openRow(view)).toBe(nameOf(first))
      expect(allByRole(view.document, "dialog")).toHaveLength(1)
      expect(allByRole(document, "dialog")).toHaveLength(0)
    })

    it("opens a sheet within the window, beside or over the list, to answer there", async () => {
      await openWorkspace("/?demo=agents")
      const view = await openOwnWindow("Inbox")
      const ask = (): HTMLElement | undefined =>
        rowButtons(view).find((button) => /Run pnpm test/.test(nameOf(button)))
      await expect.poll(ask).toBeDefined()

      ask()!.click()

      const sheet = (): HTMLElement | undefined => allByRole(view.document, "dialog")[0]
      const yes = (): HTMLElement | undefined =>
        sheet() && allByRole(sheet()!, "button", /Yes, proceed/)[0]
      await expect.poll(yes).toBeDefined()
      // Laid out where the person can see it, every edge within the window.
      await expect.poll(() => withinView(view, sheet()!)).toBe(true)
      // A press within a moment of the card moving, as the agent's context comes in over it, is
      // held back, as aimed at where a row was: pressed once the answer stands still.
      let last: number | undefined = Number.NaN
      await expect
        .poll(
          async () => {
            const before = last
            last = yes()?.getBoundingClientRect().top
            await new Promise((resolve) => setTimeout(resolve, 450))
            return before === last && yes()?.getBoundingClientRect().top === last
          },
          { timeout: 10_000, interval: 0 },
        )
        .toBe(true)
      yes()!.click()
      await expect
        .poll(() => tabDescription("Checkout review") ?? "", { timeout: 10_000 })
        .not.toContain("Needs")
    })

    it("reads an update it shows while it has the person's focus", async () => {
      await openWorkspace("/projects/storefront/sessions/initial/focus?desktop=on")
      const view = await openOwnWindow("Inbox")
      // The system gives the Inbox's window its focus, away from the app's own.
      desktopWindow.focus(false)
      view.document.hasFocus = () => true
      view.dispatchEvent(new view.document.defaultView!.FocusEvent("focus"))

      desktopWindow.arrive(demoInboxIds.told)

      // A read row says so at the end of its words.
      await expect
        .poll(() =>
          rowButtons(view)
            .map(nameOf)
            .find((name) => name.includes("an API key is in git history")),
        )
        .toMatch(/, read$/)
    })

    it("reads nothing in the sidebar's Inbox while the person is in another panel's window", async () => {
      await openWorkspace("/projects/storefront/sessions/initial/focus?desktop=on")
      const view = await openOwnWindow("Notes")
      await sidebarPanel("Inbox").click()
      // The person goes to the Notes window, which the desktop app counts as its own focus.
      view.document.hasFocus = () => true
      view.dispatchEvent(new view.document.defaultView!.FocusEvent("focus"))
      desktopWindow.arrive(demoInboxIds.told)
      const update = page
        .getByRole("list", { name: "Messages from your agents" })
        .getByRole("button", { name: /an API key is in git history/ })
      await expect.element(update).toBeVisible()

      await expectStaysTrue(
        () => !(update.element().getAttribute("aria-label") ?? "").endsWith(", read"),
        "the update unread",
        // Past the moment a row in sight takes to be read.
        { ms: 2500 },
      )
      // Back in the app's own window, it is read.
      view.document.hasFocus = () => false
      view.dispatchEvent(new view.document.defaultView!.FocusEvent("blur"))
      await expect.element(update).toHaveAccessibleName(/, read$/)
    })

    it("brings the app's window to the front as Show terminal goes to the terminal", async () => {
      await openWorkspace("/?demo=agents")
      const view = await openOwnWindow("Inbox")
      const ask = (): HTMLElement | undefined =>
        rowButtons(view).find((button) => /Run pnpm test/.test(nameOf(button)))
      await expect.poll(ask).toBeDefined()
      ask()!.click()
      const show = (): HTMLElement | undefined => {
        const sheet = allByRole(view.document, "dialog")[0]
        return sheet && allByRole(sheet, "button", /^Show terminal/)[0]
      }
      await expect.poll(show).toBeDefined()
      const front = vi.spyOn(window, "focus")

      show()!.click()

      await expectSelected("Checkout review")
      expect(front).toHaveBeenCalled()
    })
  })

  context("for Worktrees in its own window", () => {
    it("returns to the sidebar from there", async () => {
      await openWorkspace(agents)
      const view = await openOwnWindow("Worktrees")

      find(view, '[aria-label="Return Worktrees to the sidebar"]').click()

      await expect.poll(() => view.closed).toBe(true)
      await expect.element(sidebar()).toHaveAccessibleName("Worktrees")
    })

    it("closes as agent worktrees turn off", async () => {
      // An app with updates (`?update=ready`, a stable launch) has agent worktrees off, and on in
      // Preferences' Experimental tab.
      await openWorkspace("/?update=ready")
      const experimental = () => preferencesDialog().getByRole("switch", { name: "Experimental" })
      await openPreferencesOn("About")
      await experimental().click()
      await preferencesDialog().getByRole("tab", { name: "Experimental" }).click()
      await preferencesDialog().getByRole("switch", { name: "Agent worktrees" }).click()
      await closePreferences()
      const view = await openOwnWindow("Worktrees")

      await openPreferencesOn("About")
      await experimental().click()
      await closePreferences()

      await expect.poll(() => view.closed).toBe(true)
      await expect.element(sidebarPanel("Worktrees")).not.toBeInTheDocument()
      await expect.element(panelWindow("Worktrees")).not.toBeInTheDocument()
    })
  })
})
