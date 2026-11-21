import { render } from "@novadeck/test-kit/render"
import { act, useState, type ReactNode } from "react"

import { context, describe, expect, it } from "../test"
import { PanelHostContext, type PanelHost } from "./panel-host"
import { SidebarPanel } from "./SidebarPanel"

// What the panel's body keeps in its own state, as the Todo board its draft: how many times
// it was pressed.
const Pressed = (): React.JSX.Element => {
  const [times, setTimes] = useState(0)
  return (
    <button type="button" data-body="" onClick={() => setTimes(times + 1)}>
      {times}
    </button>
  )
}

// What the frame has beyond its title and count: actions in its header, before its title, beside
// it and what its list is of; and whether its place shows it.
type Parts = {
  readonly actions?: ReactNode
  readonly titleLead?: ReactNode
  readonly titleExtra?: ReactNode
  readonly scope?: string
  readonly active?: boolean
}

// The Notes panel's frame where `host` draws it, with two notes and `parts`.
const frame = (host: PanelHost, { active = true, ...parts }: Parts = {}): React.JSX.Element => (
  <PanelHostContext value={host}>
    <SidebarPanel
      id="notes-panel"
      title="Notes"
      count={2}
      active={active}
      onClose={() => {}}
      {...parts}
    >
      <Pressed />
    </SidebarPanel>
  </PanelHostContext>
)

const show = (host: PanelHost, parts?: Parts) => {
  const { container, rerender } = render(frame(host, parts))
  return {
    container,
    rerender,
    button: (name: string) => container.querySelector(`button[aria-label="${name}"]`),
    heading: () => container.querySelector("h2")!,
    header: () => container.querySelector<HTMLElement>(".sidebar-panel-header")!,
  }
}

const docked: PanelHost = { place: "sidebar", detach: () => {} }
const inWindow = (): PanelHost & { readonly count: HTMLElement; readonly extra: HTMLElement } => ({
  place: "stage",
  count: document.createElement("span"),
  extra: document.createElement("span"),
})

describe("a panel's frame", () => {
  context("in the sidebar", () => {
    it("offers to open the panel in a window where it can, beside Hide, under its heading", () => {
      const page = show(docked)
      expect(page.button("Open Notes in a window")).not.toBeNull()
      expect(page.button("Hide notes")).not.toBeNull()
      expect(page.header().contains(page.heading())).toBe(true)
      expect(page.heading().textContent).toBe("Notes2")
    })

    it("offers no window where there is nothing to open, as on the note of a panel elsewhere", () => {
      const page = show({ place: "sidebar" })
      expect(page.button("Open Notes in a window")).toBeNull()
    })
  })

  context("in a window on the stage", () => {
    it("has no Hide and no window to open, as its window's header returns it", () => {
      const page = show(inWindow())
      expect(page.button("Hide notes")).toBeNull()
      expect(page.button("Open Notes in a window")).toBeNull()
    })

    it("keeps its heading and count for assistive technology, out of its row, and draws the count for the window's header", () => {
      const host = inWindow()
      const page = show(host)
      expect(page.heading().id).toBe("notes-panel-title")
      expect(page.heading().className).toBe("sr-only")
      expect(page.heading().textContent).toBe("Notes 2")
      expect(page.header().contains(page.heading())).toBe(false)
      expect(host.count.textContent).toBe("2")
    })

    it("shows its own row only for its actions and what comes before its title", () => {
      const page = show(inWindow(), {
        actions: (
          <button type="button" aria-label="Sort">
            Sort
          </button>
        ),
      })
      expect(page.header().hidden).toBe(false)
      expect(page.header().textContent).toBe("Sort")
      expect(show(inWindow()).header().hidden).toBe(true)
      const led = show(inWindow(), { titleLead: <span>Views</span> })
      expect(led.header().hidden).toBe(false)
      expect(led.header().textContent).toBe("Views")
    })

    it("draws its scope after the count, and what its title has beside it, for the window's header", () => {
      const host = inWindow()
      const page = show(host, {
        scope: "Release",
        titleExtra: (
          <button type="button" aria-label="Show waiting">
            1 new
          </button>
        ),
      })
      expect(host.count.textContent).toBe("2Release")
      expect(host.extra.querySelector('[aria-label="Show waiting"]')).not.toBeNull()
      expect(page.heading().textContent).toBe("Notes 2 Release")
    })

    it("draws nothing for the header, unseen and out of reach, where its place shows another", () => {
      const host = inWindow()
      const page = show(host, { active: false, titleExtra: <span>1 new</span> })
      const section = page.container.querySelector("section")!
      expect(section.dataset["active"]).toBe("false")
      expect(section.hasAttribute("inert")).toBe(true)
      expect(host.count.textContent).toBe("")
      expect(host.extra.textContent).toBe("")
    })
  })

  context("in a window of its own", () => {
    // The panel's own window, and whether its way back was taken.
    const own = () => {
      const returned: string[] = []
      const host: PanelHost = {
        place: "window",
        view: window,
        onReturn: () => returned.push("notes"),
      }
      return { host, returned }
    }

    it("shows its heading and count, with a way back to the sidebar in place of Hide", () => {
      const { host, returned } = own()
      const page = show(host)
      expect(page.header().contains(page.heading())).toBe(true)
      expect(page.heading().textContent).toBe("Notes2")
      expect(page.button("Hide notes")).toBeNull()
      expect(page.button("Open Notes in a window")).toBeNull()
      act(() => (page.button("Return Notes to the sidebar") as HTMLButtonElement).click())
      expect(returned).toEqual(["notes"])
    })

    it("is always in reach, as the window is the panel's", () => {
      const page = show(own().host)
      const section = page.container.querySelector("section")!
      expect(section.dataset["place"]).toBe("window")
      expect(section.hasAttribute("inert")).toBe(false)
      expect(section.getAttribute("aria-hidden")).not.toBe("true")
    })
  })

  it("keeps what the person had in its body as it moves to a window and back", () => {
    const page = show(docked)
    const body = page.container.querySelector<HTMLButtonElement>("[data-body]")!
    act(() => body.click())
    page.rerender(frame(inWindow()))
    expect(page.container.querySelector("[data-body]")).toBe(body)
    page.rerender(frame({ place: "window", view: window, onReturn: () => {} }))
    expect(page.container.querySelector("[data-body]")).toBe(body)
    page.rerender(frame(docked))
    expect(page.container.querySelector("[data-body]")).toBe(body)
    expect(body.textContent).toBe("1")
  })
})
