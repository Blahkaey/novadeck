import { railPanelOf, type RailPanel, type SidebarPanel } from "@novadeck/core/types"

import { focusPanel } from "../interaction/dom"
import {
  measuredBounds,
  ownWindowFeatures,
  sameBounds,
  sizeBasis,
  type OwnWindowBounds,
  type SizeBasis,
} from "./own-window-bounds"
import { readOwnWindowBounds, writeOwnWindowBounds } from "./shell-storage"

// The windows of their own that panels of the rail are in, by panel: blank windows of the page,
// which the page fills with the panel it draws (app/OwnWindows.tsx), so the panel stays the
// page's. Which panels are in one is the UI store's (`ownWindows`); the windows are kept here,
// as what a panel is drawn into rather than state to draw from.

type Opened = {
  readonly view: Window
  // The bounds it was opened at, and the size its host read them as, once it is drawn.
  readonly asked: OwnWindowBounds
  basis: SizeBasis | undefined
  // What was last kept of it, so an unmoved window writes nothing.
  kept: OwnWindowBounds
}

const opened = new Map<RailPanel, Opened>()
// Whether the next window asked for is refused, as a browser's popup blocker would, which the
// demo's debug panel arms.
let refuseNext = false

// The name a panel's window has: the one name the desktop app opens it by, which a second
// `window.open` of the same name would reach rather than open another.
export const ownWindowName = (panel: RailPanel): string => `novadeck-panel-${panel}`

// Opens a window of the panel's own, where it was last or at the first's size, in front: called
// in the person's click, from which alone a browser opens one. False where it didn't open.
export const openOwnWindow = (panel: RailPanel): boolean => {
  if (refuseNext) {
    refuseNext = false
    return false
  }
  const asked = readOwnWindowBounds(panel)
  const view = window.open("", ownWindowName(panel), ownWindowFeatures(asked))
  if (!view) return false
  opened.set(panel, { view, asked, basis: undefined, kept: asked })
  return true
}

// The panel's window of its own, while it has one open.
export const ownWindowOf = (panel: RailPanel): Window | undefined => opened.get(panel)?.view

// The document the panel is drawn in: its window's of its own, while it has one, or the page's.
export const panelPage = (panel: RailPanel): Document => ownWindowOf(panel)?.document ?? document

// Keeps where the panel's window of its own is and how big, where that changed, for the next:
// not before it is laid out, nor while it is minimized, when Windows says it is a strip far off
// every screen.
export const keepOwnWindowBounds = (panel: RailPanel): void => {
  const entry = opened.get(panel)
  if (!entry || entry.view.closed || entry.view.innerWidth === 0) return
  if (entry.view.document.visibilityState === "hidden") return
  entry.basis ??= sizeBasis(entry.view, entry.asked)
  const now = measuredBounds(entry.view, entry.basis)
  if (sameBounds(now, entry.kept)) return
  entry.kept = now
  writeOwnWindowBounds(panel, now)
}

// Lets go of the panel's window of its own, which closed by itself, its bounds kept.
export const forgetOwnWindow = (panel: RailPanel): void => {
  keepOwnWindowBounds(panel)
  opened.delete(panel)
}

// Brings the panel's window of its own to the front, keyboard focus in the panel there, on the
// view of the Terminals panel it names, where it was somewhere else in the window: the person
// working in the panel keeps their place.
export const focusOwnWindow = (panel: SidebarPanel): void => {
  const view = ownWindowOf(railPanelOf(panel))
  if (!view) return
  view.focus()
  const page = view.document
  if (page.getElementById(`${panel}-panel`)?.contains(page.activeElement)) return
  focusPanel(panel, page)
}

// Closes the panel's window of its own, its bounds kept; the page takes the focus back.
export const closeOwnWindow = (panel: RailPanel): void => {
  const view = ownWindowOf(panel)
  if (!view) return
  forgetOwnWindow(panel)
  view.close()
  window.focus()
}

// Closes every panel's window of its own, as the page goes.
export const closeOwnWindows = (): void => {
  for (const [panel, { view }] of opened) {
    forgetOwnWindow(panel)
    view.close()
  }
}

// Has the next window asked for refused, as a browser's popup blocker would.
export const refuseNextOwnWindow = (): void => {
  refuseNext = true
}
