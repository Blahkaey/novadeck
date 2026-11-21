import type { WorkspacePanel } from "@novadeck/ui/app/App"
import { afterEach, beforeEach, vi } from "vitest"
import { page, type Locator } from "vitest/browser"

import { ownWindowPointer } from "../support/pointer"
import { currentSessionName, newSessionName, savedSession } from "../support/sessions"
import {
  detachPanel,
  literal,
  openSessions,
  openWorkspace,
  panelWindow,
  sidebar,
  sidebarPanel,
} from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo keeps the person's notes and its todos, and lists the project's files.
const agents = "/?demo=agents"

type Panel = "Notes" | "Todo" | "Files" | "History"

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
})
