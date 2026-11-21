import { nextFrame, render } from "@novadeck/test-kit/render"
import { act, createElement, type ComponentProps } from "react"
import { afterEach } from "vitest"

import { Sheet } from "./Sheet"
import { context, describe, expect, it } from "./test"

// jsdom has no layout: an open sheet's positioning observes no resizes.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
})

const mounted: (() => void)[] = []
afterEach(() => {
  for (const undo of mounted.splice(0)) undo()
})

// A row of a list, standing where a test puts it; jsdom lays nothing out itself.
const row = (left: number, top: number): HTMLElement => {
  const element = document.createElement("div")
  mounted.push(() => element.remove())
  element.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: left, y: top, width: 200, height: 24 })
  document.body.append(element)
  return element
}

const sheet = (
  placement: Pick<ComponentProps<typeof Sheet>, "anchor" | "anchorKey" | "placeKey"> &
    Partial<Pick<ComponentProps<typeof Sheet>, "overlap" | "boundary">>,
  page: Document = document,
) => {
  const props: ComponentProps<typeof Sheet> = {
    label: "Details",
    open: true,
    page,
    boundary: () => page.body,
    overlap: false,
    onInteractOutside: () => {},
    onDismiss: () => {},
    children: "Body",
    ...placement,
  }
  return createElement(Sheet, props)
}

// Where the sheet stands: what its placement wrote on the positioner.
const mount = (element: ReturnType<typeof sheet>) => {
  const view = render(element)
  mounted.unshift(view.unmount)
  return view
}

const placed = (): string => {
  const style = document.querySelector<HTMLElement>(
    '[data-scope="popover"][data-part="positioner"]',
  )?.style
  return style ? `${style.getPropertyValue("--x")} ${style.getPropertyValue("--y")}` : ""
}

const settle = async () => {
  for (let frame = 0; frame < 4; frame += 1)
    // eslint-disable-next-line no-await-in-loop -- Each frame comes after the one before.
    await nextFrame()
  await act(async () => {})
}

describe("a sheet", () => {
  context("whose row leaves the page", () => {
    it("stays where the row last was as it places itself again", async () => {
      const first = row(300, 400)
      const view = mount(sheet({ anchor: () => first, anchorKey: "a" }))
      await settle()
      expect(placed()).toBe("508px 400px")
      view.rerender(sheet({ anchor: () => null, anchorKey: "a", placeKey: "1" }))
      await settle()
      expect(placed()).toBe("508px 400px")
    })
  })

  context("anchored anew to another row", () => {
    it("stands beside that row", async () => {
      const rows: Record<string, HTMLElement> = { a: row(300, 400), b: row(300, 100) }
      const view = mount(sheet({ anchor: () => rows.a!, anchorKey: "a" }))
      await settle()
      expect(placed()).toBe("508px 400px")
      view.rerender(sheet({ anchor: () => rows.b!, anchorKey: "b" }))
      await settle()
      expect(placed()).toBe("508px 100px")
    })
  })

  context("anchored to a row in another window of the page", () => {
    it("opens in that window's document, not the page's", async () => {
      const frame = document.createElement("iframe")
      document.body.append(frame)
      mounted.push(() => frame.remove())
      const page = frame.contentDocument!
      const anchor = page.body.appendChild(page.createElement("div"))
      mount(sheet({ anchor: () => anchor, anchorKey: "a" }, page))
      await settle()
      expect(page.querySelector(".sheet")?.textContent).toBe("Body")
      expect(document.querySelector(".sheet")).toBeNull()
    })
  })

  context("anchored anew to a row that isn't on the page yet", () => {
    it("doesn't stand beside the last row", async () => {
      const first = row(300, 400)
      const view = mount(sheet({ anchor: () => first, anchorKey: "a" }))
      await settle()
      const besideFirst = placed()
      expect(besideFirst).toBe("508px 400px")
      view.rerender(sheet({ anchor: () => null, anchorKey: "b" }))
      await settle()
      expect(placed()).not.toBe(besideFirst)
    })
  })

  context("beside a row with no room left beside it", () => {
    // A page 1000 by 800 px, all of it the boundary, and a sheet 400 by 300 px: jsdom lays out
    // nothing, so each is given its size.
    const sized = () => {
      const boundary = document.createElement("div")
      document.body.append(boundary)
      mounted.push(() => boundary.remove())
      boundary.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 800 })
      const size = (element: Element, name: "clientWidth" | "clientHeight", value: number) => {
        Object.defineProperty(element, name, { configurable: true, value })
        mounted.push(() => void delete (element as unknown as Record<string, unknown>)[name])
      }
      for (const element of [boundary, document.documentElement]) {
        size(element, "clientWidth", 1000)
        size(element, "clientHeight", 800)
      }
      const offset = (name: "offsetWidth" | "offsetHeight", value: number) => {
        const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)!
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return this.dataset["part"] === "positioner" ? value : was.get!.call(this)
          },
        })
        mounted.push(() => Object.defineProperty(HTMLElement.prototype, name, was))
      }
      offset("offsetWidth", 400)
      offset("offsetHeight", 300)
      return boundary
    }
    const left = (): number => Number.parseFloat(placed().split(" ")[0]!)

    it("slides back over the row to stay within the boundary, where it may", async () => {
      const boundary = sized()
      const anchor = row(780, 100)
      mount(
        sheet({ anchor: () => anchor, anchorKey: "a", boundary: () => boundary, overlap: true }),
      )
      await settle()
      expect(left()).toBeLessThan(780 + 200)
      expect(left() + 400).toBeLessThanOrEqual(1000)
    })

    it("stays beside the row where it may not", async () => {
      const boundary = sized()
      const anchor = row(780, 100)
      mount(sheet({ anchor: () => anchor, anchorKey: "a", boundary: () => boundary }))
      await settle()
      expect(left()).toBe(780 + 200 + 8)
    })
  })
})
