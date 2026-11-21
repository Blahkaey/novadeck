import { afterEach, vi } from "vitest"

import { context, describe, expect, it } from "../test"
import type { OwnWindowBounds } from "./own-window-bounds"
import {
  closeOwnWindow,
  closeOwnWindows,
  focusOwnWindow,
  keepOwnWindowBounds,
  openOwnWindow,
  ownWindowOf,
  refuseNextOwnWindow,
} from "./own-windows"
import { readOwnWindowBounds, writeOwnWindowBounds } from "./shell-storage"

type View = Window & typeof globalThis

// Another window of the page, as a panel's window of its own is: a frame's, which says it is at
// `at` on the screens, its page as big as asked, as a browser opens one.
const otherWindow = ({ left = 0, top = 0, width, height }: OwnWindowBounds): View => {
  const frame = document.createElement("iframe")
  document.body.append(frame)
  const view = frame.contentWindow as View
  place(view, { left, top, width, height })
  vi.spyOn(view, "close").mockImplementation(() => {})
  vi.spyOn(view, "focus").mockImplementation(() => {})
  return view
}

// Has the window say it is at `bounds` now, its frame 40px taller than its page.
const place = (view: View, { left = 0, top = 0, width, height }: OwnWindowBounds): void => {
  const says = { screenX: left, screenY: top, innerWidth: width, innerHeight: height }
  for (const [name, value] of Object.entries(says))
    Object.defineProperty(view, name, { configurable: true, value })
  Object.defineProperty(view, "outerWidth", { configurable: true, value: width })
  Object.defineProperty(view, "outerHeight", { configurable: true, value: height + 40 })
}

// The browser opens `view` for the next window asked for.
const opensAs = (view: View) => vi.spyOn(window, "open").mockReturnValue(view)

afterEach(() => {
  closeOwnWindows()
  localStorage.clear()
  document.body.replaceChildren()
})

describe("a panel's window of its own", () => {
  context("as it opens", () => {
    it("is refused once where the next one is to be, and opens after", () => {
      const open = opensAs(otherWindow({ width: 380, height: 640 }))
      refuseNextOwnWindow()

      expect(openOwnWindow("notes")).toBe(false)
      expect(open).not.toHaveBeenCalled()
      expect(ownWindowOf("notes")).toBeUndefined()

      expect(openOwnWindow("notes")).toBe(true)
      expect(open).toHaveBeenCalledWith("", "novadeck-panel-notes", "popup,width=380,height=640")
    })

    it("opens where the last one was", () => {
      writeOwnWindowBounds("todo", { left: 200, top: 80, width: 420, height: 700 })
      const open = opensAs(otherWindow({ width: 420, height: 700 }))

      openOwnWindow("todo")

      expect(open).toHaveBeenCalledWith(
        "",
        "novadeck-panel-todo",
        "popup,left=200,top=80,width=420,height=700",
      )
    })
  })

  context("as it is measured", () => {
    it("writes nothing while it stays where it opened", () => {
      const kept = { left: 200, top: 80, width: 420, height: 700 }
      writeOwnWindowBounds("notes", kept)
      opensAs(otherWindow(kept))
      openOwnWindow("notes")
      const written = vi.spyOn(Storage.prototype, "setItem")

      keepOwnWindowBounds("notes")
      keepOwnWindowBounds("notes")

      expect(written).not.toHaveBeenCalled()
    })

    it("keeps where it moved to, once", () => {
      const view = otherWindow({ left: 200, top: 80, width: 380, height: 640 })
      opensAs(view)
      openOwnWindow("notes")
      place(view, { left: 900, top: 120, width: 380, height: 640 })
      const written = vi.spyOn(Storage.prototype, "setItem")

      keepOwnWindowBounds("notes")
      keepOwnWindowBounds("notes")

      expect(written).toHaveBeenCalledTimes(1)
      expect(readOwnWindowBounds("notes")).toEqual({
        left: 900,
        top: 120,
        width: 380,
        height: 640,
      })
    })

    it("keeps nothing while minimized, as Windows puts it far off every screen", () => {
      const view = otherWindow({ width: 380, height: 640 })
      opensAs(view)
      openOwnWindow("notes")
      place(view, { left: -32000, top: -32000, width: 160, height: 28 })
      Object.defineProperty(view.document, "visibilityState", { value: "hidden" })

      keepOwnWindowBounds("notes")

      expect(readOwnWindowBounds("notes")).toEqual({ width: 380, height: 640 })
    })
  })

  context("as it closes", () => {
    it("keeps where it was for the next, and gives the page focus back", () => {
      const view = otherWindow({ width: 380, height: 640 })
      opensAs(view)
      openOwnWindow("history")
      // Measured as it is first drawn, then moved and widened.
      keepOwnWindowBounds("history")
      place(view, { left: 40, top: 60, width: 500, height: 640 })
      const pageFocused = vi.spyOn(window, "focus").mockImplementation(() => {})

      closeOwnWindow("history")

      expect(view.close).toHaveBeenCalled()
      expect(pageFocused).toHaveBeenCalled()
      expect(ownWindowOf("history")).toBeUndefined()
      expect(readOwnWindowBounds("history")).toEqual({ left: 40, top: 60, width: 500, height: 640 })
    })

    it("closes every panel's at once, as the page goes", () => {
      const notes = otherWindow({ width: 380, height: 640 })
      const files = otherWindow({ width: 380, height: 640 })
      opensAs(notes)
      openOwnWindow("notes")
      opensAs(files)
      openOwnWindow("files")

      closeOwnWindows()

      expect(notes.close).toHaveBeenCalled()
      expect(files.close).toHaveBeenCalled()
      expect([ownWindowOf("notes"), ownWindowOf("files")]).toEqual([undefined, undefined])
    })
  })

  context("as it is brought to the front", () => {
    // The window holding the Notes panel, with a field in it and one outside it.
    const holding = (): { view: View; inside: HTMLElement; outside: HTMLElement } => {
      const view = otherWindow({ width: 380, height: 640 })
      opensAs(view)
      openOwnWindow("notes")
      view.document.body.innerHTML =
        '<input aria-label="Elsewhere"><section id="notes-panel"><div class="sidebar-panel-content"><input aria-label="Add a note…"><input aria-label="Find"></div></section>'
      const [outside, , inside] = view.document.querySelectorAll("input")
      return { view, inside: inside!, outside: outside! }
    }

    it("puts keyboard focus in the panel", async () => {
      const { view, outside } = holding()
      outside.focus()

      focusOwnWindow("notes")

      expect(view.focus).toHaveBeenCalled()
      await vi.waitFor(() =>
        expect(view.document.activeElement?.getAttribute("aria-label")).toBe("Add a note…"),
      )
    })

    it("leaves keyboard focus where the person is working in the panel", async () => {
      const { view, inside } = holding()
      inside.focus()

      focusOwnWindow("notes")
      await new Promise((resolve) => view.requestAnimationFrame(resolve))

      expect(view.document.activeElement).toBe(inside)
    })
  })
})
