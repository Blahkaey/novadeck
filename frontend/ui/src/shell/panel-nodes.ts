import type { RailPanel } from "@novadeck/core/types"
import { createContext, useContext } from "react"

// Where each panel of the rail is drawn: an element made once per panel, which the app renders
// the panel into once (PanelInstances.tsx) and a host shows by holding it (PanelSlot.tsx). The
// panel never mounts anew as it moves between hosts, so what the person had in it, a draft or
// an open folder, stays. One host holds a panel at a time, the one that took it last; with none,
// it is parked, in no document.
export type PanelNodes = {
  // The panel's element, made the first time it is asked for.
  readonly node: (panel: RailPanel) => HTMLElement
  // Puts the panel's element into `holder`, its scrolled lists where they were, and returns what
  // parks it again. A host takes the panel from another that holds it, as one host's slot can
  // stay mounted a moment after the next one's mounts (the phone drawer's closing animation);
  // the other's park then leaves it where it is.
  readonly hold: (panel: RailPanel, holder: HTMLElement) => () => void
  // The element a panel in a window draws its count and scope into, made the first time it is
  // asked for, which the window's header shows beside its title (PanelCountSlot in PanelSlot.tsx).
  readonly count: (panel: RailPanel) => HTMLElement
  // The element it draws what its title has beside it into, as the Inbox's pill of rows waiting
  // to join, which the header shows after the count (PanelExtraSlot).
  readonly extra: (panel: RailPanel) => HTMLElement
}

// An element scrolled away from its start, and how far.
type Scrolled = { readonly element: Element; readonly top: number; readonly left: number }

// What leaving the document forgets of the panel: how far its lists were scrolled.
const scrolledIn = (node: HTMLElement): readonly Scrolled[] =>
  [...node.querySelectorAll("*")].flatMap((element) =>
    element.scrollTop === 0 && element.scrollLeft === 0
      ? []
      : [{ element, top: element.scrollTop, left: element.scrollLeft }],
  )

const scrollBack = (scrolled: readonly Scrolled[]): void => {
  for (const { element, top, left } of scrolled) {
    element.scrollTop = top
    element.scrollLeft = left
  }
}

// An element of a panel's window's header, made once per panel in `made`, which lays out as part
// of the header.
const headerPart =
  (made: Map<RailPanel, HTMLElement>) =>
  (panel: RailPanel): HTMLElement => {
    const kept = made.get(panel)
    if (kept) return kept
    const fresh = document.createElement("span")
    fresh.style.display = "contents"
    made.set(panel, fresh)
    return fresh
  }

export const createPanelNodes = (): PanelNodes => {
  const nodes = new Map<RailPanel, HTMLElement>()
  const counts = new Map<RailPanel, HTMLElement>()
  const extras = new Map<RailPanel, HTMLElement>()
  const parked = new Map<RailPanel, readonly Scrolled[]>()
  const node = (panel: RailPanel): HTMLElement => {
    const made = nodes.get(panel)
    if (made) return made
    const fresh = document.createElement("div")
    // It lays out as its panel: the host's container places the panel itself.
    fresh.style.display = "contents"
    nodes.set(panel, fresh)
    return fresh
  }
  const hold = (panel: RailPanel, holder: HTMLElement): (() => void) => {
    const element = node(panel)
    // Taken from another host, it moves as it is, which forgets its scroll as parking does.
    const scrolled = element.parentElement ? scrolledIn(element) : (parked.get(panel) ?? [])
    holder.append(element)
    scrollBack(scrolled)
    parked.delete(panel)
    return () => {
      if (element.parentElement !== holder) return
      parked.set(panel, scrolledIn(element))
      element.remove()
    }
  }
  return { node, hold, count: headerPart(counts), extra: headerPart(extras) }
}

// The workspace's panel elements, which the app makes once.
export const PanelNodesContext = createContext<PanelNodes | undefined>(undefined)

export const usePanelNodes = (): PanelNodes => {
  const nodes = useContext(PanelNodesContext)
  if (!nodes) throw new Error("usePanelNodes must be used inside a PanelNodesContext")
  return nodes
}
