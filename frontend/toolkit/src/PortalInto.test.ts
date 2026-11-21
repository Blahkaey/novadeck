import { render } from "@novadeck/test-kit/render"
import { createElement, type ComponentProps, type ReactNode } from "react"

import { Portal } from "./Portal"
import { PortalInto } from "./PortalInto"
import { context, describe, expect, it } from "./test"

// What opens above the page from inside the node, as a menu does: its words.
const opened = (words: string): ReactNode => createElement(Portal, null, words)

const into = (node: Element, children: ReactNode) => {
  const props: ComponentProps<typeof PortalInto> = { node, children }
  return createElement(PortalInto, props)
}

describe("PortalInto", () => {
  it("renders its children into the node, not where it is drawn", () => {
    const node = document.createElement("div")
    const view = render(into(node, "Notes"))

    expect(node.textContent).toBe("Notes")
    expect(view.container.textContent).toBe("")
  })

  context("when the node is in no document", () => {
    it("opens what opens inside it on the page's own document", () => {
      const node = document.createElement("div")
      render(into(node, opened("Rename")))

      expect(document.body.textContent).toContain("Rename")
    })
  })

  context("when the node is in another document", () => {
    it("opens what opens inside it there", () => {
      const other = document.implementation.createHTMLDocument("Notes")
      const node = document.createElement("div")
      const view = render(into(node, opened("Rename")))
      other.body.append(node)

      view.rerender(into(node, opened("Delete")))

      expect(other.body.textContent).toContain("Delete")
      expect(document.body.textContent).not.toContain("Delete")
    })
  })
})
