import { context, describe, expect, it } from "../test"
import { createPanelNodes } from "./panel-nodes"

const host = (): HTMLElement => document.body.appendChild(document.createElement("section"))

// A list in the panel's element that forgets how far it was scrolled as the element leaves its
// host, as a browser's does (jsdom's keeps it).
const forgetfulList = (panel: HTMLElement): HTMLElement => {
  const list = panel.appendChild(document.createElement("ul"))
  const holder = (): Element | null => panel.parentElement
  let scrolled = { top: 0, in: holder() }
  Object.defineProperty(list, "scrollTop", {
    get: () => (scrolled.in === holder() ? scrolled.top : 0),
    set: (top: number) => {
      scrolled = { top, in: holder() }
    },
  })
  return list
}

describe("panel nodes", () => {
  it("makes one element per panel, whoever asks", () => {
    const nodes = createPanelNodes()
    expect(nodes.node("notes")).toBe(nodes.node("notes"))
    expect(nodes.node("notes")).not.toBe(nodes.node("todo"))
  })

  it("makes one element per panel for its count in a window, apart from the panel's own", () => {
    const nodes = createPanelNodes()
    expect(nodes.count("notes")).toBe(nodes.count("notes"))
    expect(nodes.count("notes")).not.toBe(nodes.count("todo"))
    expect(nodes.count("notes")).not.toBe(nodes.node("notes"))
  })

  it("makes one element per panel for what its title has beside it, apart from its count", () => {
    const nodes = createPanelNodes()
    expect(nodes.extra("inbox")).toBe(nodes.extra("inbox"))
    expect(nodes.extra("inbox")).not.toBe(nodes.extra("terminals"))
    expect(nodes.extra("inbox")).not.toBe(nodes.count("inbox"))
  })

  context("when a host holds a panel", () => {
    it("puts the panel's element in it, and parks it in no document once let go", () => {
      const nodes = createPanelNodes()
      const sidebar = host()
      const release = nodes.hold("notes", sidebar)
      expect(nodes.node("notes").parentElement).toBe(sidebar)

      release()

      expect(nodes.node("notes").isConnected).toBe(false)
    })

    it("scrolls its lists back to where they were as it was parked", () => {
      const nodes = createPanelNodes()
      const list = forgetfulList(nodes.node("history"))
      const release = nodes.hold("history", host())
      list.scrollTop = 120
      release()
      expect(list.scrollTop).toBe(0)

      nodes.hold("history", host())

      expect(list.scrollTop).toBe(120)
    })
  })

  context("when a second host takes a panel another holds", () => {
    it("moves the panel's element to it, scrolled as it was", () => {
      const nodes = createPanelNodes()
      const list = forgetfulList(nodes.node("notes"))
      nodes.hold("notes", host())
      list.scrollTop = 80
      const tile = host()

      nodes.hold("notes", tile)

      expect(nodes.node("notes").parentElement).toBe(tile)
      expect(list.scrollTop).toBe(80)
    })

    it("leaves it there as the first host lets go", () => {
      const nodes = createPanelNodes()
      const releaseSidebar = nodes.hold("notes", host())
      const tile = host()
      nodes.hold("notes", tile)

      releaseSidebar()

      expect(nodes.node("notes").parentElement).toBe(tile)
    })
  })
})
