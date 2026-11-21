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

// Where a panel's window shows the panel's count, beside its title, in the sidebar heading's
// voice: the element the panel draws its count into while it is in a window (panel-nodes.ts).
// The panel's heading says the count to assistive technology, so this one is only seen.
export const PanelCountSlot = ({ panel }: { readonly panel: RailPanel }): React.JSX.Element => {
  const nodes = usePanelNodes()
  const hold = useCallback(
    (slot: HTMLSpanElement) => {
      const count = nodes.count(panel)
      slot.append(count)
      // A window still animating away may let go after the next one took it.
      return () => {
        if (count.parentElement === slot) count.remove()
      }
    },
    [nodes, panel],
  )
  return (
    <span ref={hold} aria-hidden="true" className="panel-window-count text-label font-medium" />
  )
}
