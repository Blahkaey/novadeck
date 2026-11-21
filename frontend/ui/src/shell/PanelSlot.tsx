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
