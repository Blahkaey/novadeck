import type { RailPanel } from "@novadeck/core/types"
import { render } from "@novadeck/test-kit/render"
import { act } from "react"
import { afterEach, vi } from "vitest"

import { closeOwnWindow, closeOwnWindows, openOwnWindow, ownWindowOf } from "../shell/own-windows"
import { createPanelNodes, PanelNodesContext } from "../shell/panel-nodes"
import { context, describe, expect, it } from "../test"
import { openCommands } from "../test/commands"
import { WorkspaceServicesContext, type WorkspaceServices } from "./controller/context"
import { OwnWindows } from "./OwnWindows"

type View = Window & typeof globalThis

afterEach(() => {
  closeOwnWindows()
  document.body.replaceChildren()
})

// The app with Notes in a window of its own: a frame's window, as the browser opens one, which
// the page fills. `returnPanel` is counted as the window hands the panel back.
const holding = () => {
  const app = openCommands({ notes: true })
  const frame = document.createElement("iframe")
  document.body.append(frame)
  const view = frame.contentWindow as View
  vi.spyOn(view, "close").mockImplementation(() => {})
  vi.spyOn(window, "open").mockReturnValue(view)
  openOwnWindow("notes")
  app.ui.update((state) => ({ ...state, ownWindows: ["notes"] }))
  const returned = vi.fn<(panel: RailPanel) => void>(app.commands.returnPanel)
  const services = {
    workspace: app.workspace,
    ui: app.ui,
    commands: { ...app.commands, returnPanel: returned },
  } as unknown as WorkspaceServices
  const nodes = createPanelNodes()
  nodes.node("notes").textContent = "Check the refund flow"
  const page = render(
    <WorkspaceServicesContext value={services}>
      <PanelNodesContext value={nodes}>
        <OwnWindows />
      </PanelNodesContext>
    </WorkspaceServicesContext>,
  )
  // The window going, as its page hides.
  const hide = (): void => act(() => void view.dispatchEvent(new view.Event("pagehide")))
  return { app, view, nodes, returned, page, hide }
}

describe("a panel's window of its own, as the page fills it", () => {
  it("holds the panel, named for it", () => {
    const { view, nodes } = holding()
    expect(view.document.querySelector(".panel-own-window")?.firstChild).toBe(nodes.node("notes"))
    expect(view.document.title).toMatch(/^Notes/)
  })

  context("as the person closes it", () => {
    it("hands the panel back to the sidebar once, its element out of the window", () => {
      const { app, view, nodes, returned, hide } = holding()

      hide()

      expect(returned).toHaveBeenCalledTimes(1)
      expect(returned).toHaveBeenCalledWith("notes")
      expect(app.ui.getSnapshot().ownWindows).toEqual([])
      expect(nodes.node("notes").isConnected).toBe(false)
      expect(view.document.querySelector(".panel-own-window")).toBeNull()
    })

    it("closes it too, where it was reloaded and would stay open, empty", () => {
      const { view, hide } = holding()
      hide()
      expect(view.close).toHaveBeenCalled()
    })
  })

  context("as the page closes it", () => {
    it("hands nothing back, the page having let it go", () => {
      const { returned, hide } = holding()
      vi.spyOn(window, "focus").mockImplementation(() => {})

      closeOwnWindow("notes")
      hide()

      expect(returned).not.toHaveBeenCalled()
    })
  })

  context("as the page goes", () => {
    it("closes it", () => {
      const { view } = holding()

      window.dispatchEvent(new Event("pagehide"))

      expect(view.close).toHaveBeenCalled()
      expect(ownWindowOf("notes")).toBeUndefined()
    })
  })

  context("as the app around it goes while its state stays", () => {
    it("puts the panel back where the session has it", () => {
      const { app, page } = holding()

      page.unmount()

      expect(app.ui.getSnapshot().ownWindows).toEqual([])
      expect(app.effects).toContain("close notes window")
    })
  })
})
