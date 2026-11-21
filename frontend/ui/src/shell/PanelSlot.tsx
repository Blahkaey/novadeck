import type { RailPanel } from "@novadeck/core/types"
import { useCallback } from "react"

import { usePanelNodes } from "./panel-nodes"

// Where a host shows a panel of the rail: the panel's own element, rendered once by the app,
// is put here while the slot is mounted and parked again as it unmounts (panel-nodes.ts). The
// slot lays out as the panel does, so the panel places itself in the host.
export const PanelSlot = ({ panel }: { readonly panel: RailPanel }): React.JSX.Element => {
  const nodes = usePanelNodes()
  const hold = useCallback((slot: HTMLDivElement) => nodes.hold(panel, slot), [nodes, panel])
  return <div ref={hold} className="contents" />
}

// Holds `part`, an element of the header's a panel draws into, while mounted.
const useHeaderPart = (part: HTMLElement): ((slot: HTMLSpanElement) => () => void) =>
  useCallback(
    (slot: HTMLSpanElement) => {
      slot.append(part)
      // A window still animating away may let go after the next one took it.
      return () => {
        if (part.parentElement === slot) part.remove()
      }
    },
    [part],
  )

// Where a panel's window shows the panel's count, and its scope after it, beside its title, in
// the sidebar heading's voice: the element the panel draws them into while it is in a window
// (panel-nodes.ts). The panel's heading says them to assistive technology, so this is only seen.
export const PanelCountSlot = ({ panel }: { readonly panel: RailPanel }): React.JSX.Element => {
  const hold = useHeaderPart(usePanelNodes().count(panel))
  return (
    <span ref={hold} aria-hidden="true" className="panel-window-count text-label font-medium" />
  )
}

// Where a panel's window shows what the panel's title has beside it, after the count, as the
// Inbox's pill of rows waiting to join, which the person reads and presses as in the sidebar.
export const PanelExtraSlot = ({ panel }: { readonly panel: RailPanel }): React.JSX.Element => {
  const hold = useHeaderPart(usePanelNodes().extra(panel))
  return <span ref={hold} className="panel-window-extra flex min-w-0 items-center" />
}
