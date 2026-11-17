import type { ClosedTerminal } from "@novadeck/core/history"
import type { AgentConnection } from "@novadeck/core/port"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { vi } from "vitest"

import { context, describe, eventually, expect, it } from "../test"
import { HistoryPanel } from "./HistoryPanel"

// jsdom has no ResizeObserver, which a tooltip opened by the keyboard's focus places itself with.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
})

const closed = (name: string, parts: Partial<ClosedTerminal> = {}): ClosedTerminal => ({
  id: name,
  projectId: "storefront",
  title: `Title ${name}`,
  summary: null,
  handle: "wren",
  agent: "claude",
  program: "claude",
  cwd: "/work/storefront",
  closedAt: new Date(2026, 10, 6, 15, 40).getTime(),
  closedBy: null,
  availability: { state: "ready" },
  ...parts,
})

const restoring = (name: string): ClosedTerminal =>
  closed(name, { availability: { state: "restoring" } })

const show = (
  rows: readonly ClosedTerminal[],
  options: {
    remove?: (ids: readonly string[]) => Promise<void>
    connections?: readonly AgentConnection[]
  } = {},
) => {
  const onRemove = vi.fn<(ids: readonly string[]) => Promise<void>>(
    options.remove ?? (async () => {}),
  )
  const onRestore = vi.fn<(row: ClosedTerminal) => void>()
  const props = {
    rows,
    list: async () => [],
    connections: options.connections,
    iconOf: () => null,
    active: true,
    onClose: () => {},
    onRestore,
    onReveal: () => {},
    onConnect: () => {},
    onRemove,
  }
  const page = render(createElement(HistoryPanel, props))
  // The panel again with other rows, as the backend reports them, or hidden and shown.
  const listing = (next: readonly ClosedTerminal[], active = true) =>
    page.rerender(createElement(HistoryPanel, { ...props, rows: next, active }))
  const row = (name: string) =>
    page.container.querySelector<HTMLElement>(`[data-history-row="${name}"]`)!
  const select = (name: string) => row(name).querySelector<HTMLButtonElement>("button")!
  const removeOf = (name: string) =>
    row(name).querySelector<HTMLButtonElement>(`button[aria-label^="Remove "]`)
  const clear = () =>
    page.container.querySelector<HTMLButtonElement>(`button[aria-label="Clear History"]`)
  const hide = () =>
    page.container.querySelector<HTMLButtonElement>(`button[aria-label="Hide history"]`)!
  const said = () =>
    [...page.container.querySelectorAll("[role=status]")].map((line) => line.textContent)
  const search = (text: string) =>
    act(() => {
      const field = page.container.querySelector<HTMLInputElement>("input[type=search]")!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text)
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
  return { page, listing, row, select, removeOf, clear, hide, said, search, onRemove, onRestore }
}

const dialog = () => document.querySelector<HTMLElement>("[role=alertdialog]")
const answer = (name: string) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find((item) => item.textContent === name)!

// A removal the backend refuses.
const refused = () => Promise.reject(new Error("no"))

describe("History's Clear button", () => {
  context("while the project has rows", () => {
    it("stands before Hide in the panel's header", () => {
      const { clear, hide } = show([closed("a")])
      expect(clear()!.compareDocumentPosition(hide())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(clear()!.closest("header")).toBe(hide().closest("header"))
    })

    it("asks first, with how many go and that they can't be restored after", async () => {
      const { clear, onRemove } = show([closed("a"), closed("b"), closed("c")])
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      const text = dialog()!.textContent!
      expect(text).toContain("Clear History?")
      expect(text).toContain("3 closed terminals are removed from History for good.")
      expect(text).toContain("You can’t restore them after.")
      expect(onRemove).not.toHaveBeenCalled()
    })

    it("keeps every row when the question is cancelled", async () => {
      const { clear, row, onRemove } = show([closed("a"), closed("b")])
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      act(() => answer("Cancel").click())
      await eventually(() => expect(dialog()).toBeNull())
      expect(onRemove).not.toHaveBeenCalled()
      expect(row("a")).not.toBeNull()
    })

    it("removes every row once confirmed, those a search leaves out too", async () => {
      const { clear, search, row, onRemove } = show([
        closed("a", { title: "Tax rounding" }),
        closed("b", { title: "Coupon codes" }),
      ])
      search("tax")
      expect(row("b")).toBeNull()
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      expect(dialog()!.textContent).toContain("2 closed terminals are removed")
      act(() => answer("Clear History").click())
      expect(onRemove).toHaveBeenCalledExactlyOnceWith(["a", "b"])
    })

    it("leaves a row that is being restored, and says so", async () => {
      const { clear, onRemove } = show([closed("a"), restoring("b")])
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      expect(dialog()!.textContent).toContain("1 closed terminal is removed from History for good.")
      expect(dialog()!.textContent).toContain("The one being restored stays.")
      act(() => answer("Clear History").click())
      expect(onRemove).toHaveBeenCalledExactlyOnceWith(["a"])
    })

    it("removes the rows it asked about, not one that closed while it asked", async () => {
      const { clear, listing, onRemove } = show([closed("a")])
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      listing([closed("late"), closed("a")])
      act(() => answer("Clear History").click())
      expect(onRemove).toHaveBeenCalledExactlyOnceWith(["a"])
    })

    it("stops asking once the rows it asked about are gone", async () => {
      const { clear, listing } = show([closed("a")])
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      listing([])
      await eventually(() => expect(dialog()).toBeNull())
    })
  })

  context("with nothing it could remove", () => {
    it("isn't there: with no rows, or only rows being restored", () => {
      expect(show([]).clear()).toBeNull()
      expect(show([restoring("a")]).clear()).toBeNull()
    })
  })

  context("when the backend couldn't", () => {
    it("says so above the list, and the rows stay", async () => {
      const { clear, row, said } = show([closed("a"), closed("b")], { remove: refused })
      act(() => clear()!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
      act(() => answer("Clear History").click())
      await eventually(() =>
        expect(said()).toEqual(["Couldn’t clear History. What’s listed is still here."]),
      )
      expect(row("a")).not.toBeNull()
      expect(row("b")).not.toBeNull()
    })
  })
})

describe("a History row's Remove button", () => {
  it("names the row it removes", () => {
    const { removeOf } = show([closed("a", { title: "Coupon codes" })])
    expect(removeOf("a")!.getAttribute("aria-label")).toBe("Remove Coupon codes from History")
  })

  it("removes just that row, without asking and without restoring it", async () => {
    const { removeOf, onRemove, onRestore } = show([closed("a"), closed("b")])
    act(() => removeOf("b")!.click())
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(["b"])
    expect(onRestore).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(dialog()).toBeNull()
  })

  it("is a button of its own beside the row's, which still restores", () => {
    const { removeOf, select, onRestore, onRemove } = show([closed("a")])
    expect(removeOf("a")!.closest("button:not([aria-label^='Remove '])")).toBeNull()
    act(() => select("a").click())
    expect(onRestore).toHaveBeenCalledOnce()
    expect(onRemove).not.toHaveBeenCalled()
  })

  it("is on a row in every state but one being restored", () => {
    const { removeOf } = show([
      closed("ready"),
      closed("gone", { availability: { state: "gone", reason: "folder" } }),
      closed("open", { availability: { state: "open", handle: "fox", terminalId: "t" } }),
      closed("disconnected", { availability: { state: "disconnected", agent: "codex" } }),
      restoring("restoring"),
    ])
    for (const name of ["ready", "gone", "open", "disconnected"])
      expect(removeOf(name), name).not.toBeNull()
    expect(removeOf("restoring")).toBeNull()
  })

  it("stands after the plug on a row whose agent can be connected", () => {
    const { row } = show([closed("a", { availability: { state: "disconnected", agent: "codex" } })])
    const labels = [...row("a").querySelectorAll(".history-row-actions button")].map((button) =>
      button.getAttribute("aria-label"),
    )
    expect(labels).toEqual(["Connect Codex in Preferences", "Remove Title a from History"])
  })

  context("pressed with the keyboard", () => {
    // A key's click carries no pointer detail.
    const press = (button: HTMLButtonElement) =>
      act(() => void button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })))

    it("moves the focus to the row after it, to the one before the last, then to Hide", () => {
      const { removeOf, select, hide, listing } = show([closed("a"), closed("b"), closed("c")])
      removeOf("b")!.focus()
      press(removeOf("b")!)
      expect(document.activeElement).toBe(select("c"))
      listing([closed("a"), closed("c")])
      press(removeOf("c")!)
      expect(document.activeElement).toBe(select("a"))
      listing([closed("a")])
      press(removeOf("a")!)
      expect(document.activeElement).toBe(hide())
    })

    it("leaves the focus where a pointer's press put it", () => {
      const { removeOf } = show([closed("a"), closed("b")])
      removeOf("a")!.focus()
      act(
        () =>
          void removeOf("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })),
      )
      expect(document.activeElement).toBe(removeOf("a"))
    })
  })

  context("when the backend couldn't", () => {
    it("says which row above the list, and the row stays", async () => {
      const { removeOf, row, said } = show([closed("a", { title: "Coupon codes" })], {
        remove: refused,
      })
      act(() => removeOf("a")!.click())
      await eventually(() =>
        expect(said()).toEqual(["Couldn’t remove Coupon codes. It’s still in History."]),
      )
      expect(row("a")).not.toBeNull()
    })

    it("stops saying so once the row is gone, another removal starts, or the panel is hidden", async () => {
      const failing = (rows: readonly ClosedTerminal[]) => {
        let fail = true
        const shown = show(rows, {
          remove: () => (fail ? Promise.reject(new Error("no")) : Promise.resolve()),
        })
        return { ...shown, works: () => void (fail = false) }
      }
      const failedOn = async (shown: ReturnType<typeof failing>) => {
        act(() => shown.removeOf("a")!.click())
        await eventually(() => expect(shown.said()).toHaveLength(1))
      }
      const rows = [closed("a"), closed("b")]

      const gone = failing(rows)
      await failedOn(gone)
      gone.listing([closed("b")])
      expect(gone.said()).toEqual([])

      const again = failing(rows)
      await failedOn(again)
      again.works()
      act(() => again.removeOf("b")!.click())
      expect(again.said()).toEqual([])

      const hidden = failing(rows)
      await failedOn(hidden)
      hidden.listing(rows, false)
      hidden.listing(rows)
      expect(hidden.said()).toEqual([])
    })
  })
})

describe("History's search", () => {
  it("is forgotten with the last row, so the next terminal closed is listed", () => {
    const { search, listing, row } = show([closed("a", { title: "Tax rounding" })])
    search("tax")
    listing([])
    listing([closed("b", { title: "Coupon codes" })])
    expect(row("b")).not.toBeNull()
  })
})
