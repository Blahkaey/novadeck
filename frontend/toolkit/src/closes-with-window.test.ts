import { EnvironmentProvider } from "@ark-ui/react/environment"
import { render } from "@novadeck/test-kit/render"
import { createElement } from "react"
import { afterEach, vi } from "vitest"

import { useClosesWithItsWindow } from "./closes-with-window"
import { context, describe, expect, it } from "./test"

afterEach(() => {
  document.body.replaceChildren()
})

// Another window of the page, as a panel's window of its own is: a frame's.
const otherWindow = (): Window & typeof globalThis => {
  const frame = document.createElement("iframe")
  document.body.append(frame)
  return frame.contentWindow as Window & typeof globalThis
}

// Something open, or not, drawn in `view`'s document.
const drawnIn = (view: Window, open: boolean, close: () => void) => {
  const Opened = (): null => {
    useClosesWithItsWindow(open, close)
    return null
  }
  render(createElement(EnvironmentProvider, { value: () => view.document }, createElement(Opened)))
}

describe("what is open in a window", () => {
  context("in another window of the page", () => {
    it("closes as that window goes", () => {
      const view = otherWindow()
      const close = vi.fn<() => void>()
      drawnIn(view, true, close)

      view.dispatchEvent(new view.Event("pagehide"))

      expect(close).toHaveBeenCalledTimes(1)
    })

    it("is left alone there once closed", () => {
      const view = otherWindow()
      const close = vi.fn<() => void>()
      drawnIn(view, false, close)

      view.dispatchEvent(new view.Event("pagehide"))

      expect(close).not.toHaveBeenCalled()
    })
  })

  context("in the page's own window", () => {
    it("stays as it was, the page going with it", () => {
      const close = vi.fn<() => void>()
      drawnIn(window, true, close)

      window.dispatchEvent(new Event("pagehide"))

      expect(close).not.toHaveBeenCalled()
    })
  })
})
