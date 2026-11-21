import { afterEach } from "vitest"

import { clipboardOf, isElement, isHTMLElement, isKeyboardEvent, viewOf } from "./realm"
import { context, describe, expect, it } from "./test"

// Another window of the page, as a panel's window of its own is: a frame's, with its own
// `Element` and `HTMLElement`.
const otherWindow = (): Window & typeof globalThis => {
  const frame = document.createElement("iframe")
  document.body.append(frame)
  return frame.contentWindow as Window & typeof globalThis
}

afterEach(() => {
  document.body.replaceChildren()
})

describe("realm checks", () => {
  context("for an element of another window", () => {
    it("recognise it where instanceof doesn't", () => {
      const other = otherWindow()
      const button = other.document.createElement("button")

      expect(button instanceof HTMLElement).toBe(false)
      expect(isElement(button)).toBe(true)
      expect(isHTMLElement(button)).toBe(true)
    })

    it("recognise a key pressed there", () => {
      const other = otherWindow()
      const key = new other.KeyboardEvent("keydown", { key: " " })

      expect(key instanceof KeyboardEvent).toBe(false)
      expect(isKeyboardEvent(key)).toBe(true)
      expect(isKeyboardEvent(new other.MouseEvent("mousedown"))).toBe(false)
      expect(isKeyboardEvent(null)).toBe(false)
    })

    it("find the window it is drawn in", () => {
      const other = otherWindow()
      const row = other.document.createElement("div")
      other.document.body.append(row)

      expect(viewOf(row)).toBe(other)
      expect(viewOf(other.document)).toBe(other)
    })

    it("write through that window's clipboard", () => {
      const other = otherWindow()
      const clipboard = { writeText: async () => {} } as unknown as Clipboard
      Object.defineProperty(other.navigator, "clipboard", { value: clipboard })
      const row = other.document.createElement("div")
      other.document.body.append(row)

      expect(clipboardOf(row)).toBe(clipboard)
    })
  })

  context("for what isn't an element", () => {
    it("say so", () => {
      expect(isElement(null)).toBe(false)
      expect(isElement(window)).toBe(false)
      expect(isElement(document.createTextNode("Notes"))).toBe(false)
      expect(isHTMLElement(document.createElementNS("http://www.w3.org/2000/svg", "svg"))).toBe(
        false,
      )
    })
  })

  it("take the page's own window for a node in no document's window", () => {
    const parked = document.implementation.createHTMLDocument("parked").createElement("div")
    expect(viewOf(parked)).toBe(window)
  })
})
