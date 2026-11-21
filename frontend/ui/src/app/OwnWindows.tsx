import { activeProject } from "@novadeck/core/state"
import { panelLabels, type RailPanel } from "@novadeck/core/types"
import { memo, useEffect, useEffectEvent, useLayoutEffect } from "react"

import { dressOwnWindow, nameOwnWindow } from "../shell/own-window-document"
import {
  closeOwnWindows,
  forgetOwnWindow,
  keepOwnWindowBounds,
  ownWindowOf,
} from "../shell/own-windows"
import { usePanelNodes } from "../shell/panel-nodes"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { watchOwnWindowFocus } from "./page-focus"

// How often a window of its own is asked where it is, as moving a window tells its page nothing.
const boundsEvery = 1000

// One panel's window of its own, which the page fills: named for the panel and the open project,
// dressed as the page is, and holding the panel's element, which the app draws (PanelInstances).
// The window closing by itself, by its own close button, returns the panel to the sidebar; its
// element is taken out first, as the window's document goes with it.
const OwnWindowHost = ({
  panel,
  view,
}: {
  readonly panel: RailPanel
  readonly view: Window
}): null => {
  const nodes = usePanelNodes()
  const { commands, ui } = useWorkspaceServices()
  const { returnPanel } = commands
  const project = useWorkspaceState((workspace) => activeProject(workspace)?.name)
  // Named first, so its title is in its head before the sheets' copies come after it.
  useLayoutEffect(
    () =>
      nameOwnWindow(
        view.document,
        project ? `${panelLabels[panel]} · ${project}` : panelLabels[panel],
      ),
    [view, panel, project],
  )
  useLayoutEffect(() => dressOwnWindow(document, view.document), [view])
  useEffect(() => watchOwnWindowFocus(ui, panel, view), [ui, panel, view])
  useLayoutEffect(() => {
    const page = view.document
    const holder = page.createElement("div")
    holder.className = "panel-own-window"
    page.body.append(holder)
    const release = nodes.hold(panel, holder)
    const closed = (): void => {
      release()
      // Closed by the page, which already let it go, or by the person.
      if (ownWindowOf(panel) !== view) return
      forgetOwnWindow(panel)
      returnPanel(panel)
      // Reloaded, as a browser lets the person do, it would stay open and empty.
      if (!view.closed) view.close()
    }
    const resized = (): void => keepOwnWindowBounds(panel)
    view.addEventListener("pagehide", closed)
    view.addEventListener("resize", resized)
    // Measured once drawn, before the person can resize it, which tells which size its host
    // read the one asked for as.
    const drawn = view.requestAnimationFrame(resized)
    // The page's own clock: the window's stops as it closes, which this also hears, should the
    // window close without saying so.
    const asked = window.setInterval(() => {
      if (view.closed) closed()
      else keepOwnWindowBounds(panel)
    }, boundsEvery)
    return () => {
      view.cancelAnimationFrame(drawn)
      window.clearInterval(asked)
      view.removeEventListener("pagehide", closed)
      view.removeEventListener("resize", resized)
      release()
      holder.remove()
    }
  }, [view, panel, nodes, returnPanel])
  return null
}

// Every panel's window of its own, each filled by the page; the page going closes them all, and
// the app around them going puts each panel back where the session has it too, as the app's
// state may outlive it (a visitor's narrow window covering the workspace).
export const OwnWindows = memo((): React.JSX.Element => {
  const panels = useUiState((state) => state.ownWindows)
  const forget = useEffectEvent(useWorkspaceServices().commands.forgetOwnWindows)
  useEffect(() => {
    window.addEventListener("pagehide", closeOwnWindows)
    return () => {
      window.removeEventListener("pagehide", closeOwnWindows)
      forget()
    }
  }, [])
  return (
    <>
      {panels.map((panel) => {
        const view = ownWindowOf(panel)
        return view && <OwnWindowHost key={panel} panel={panel} view={view} />
      })}
    </>
  )
})
