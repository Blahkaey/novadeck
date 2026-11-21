import { panelLabels, type RailPanel, type SidebarPanel as PanelId } from "@novadeck/core/types"

import { PanelElsewhere } from "../sidebar/PanelElsewhere"
import { PanelSlot } from "./PanelSlot"

// The panel the sidebar is open on while it is in a window, on the stage or of its own (`own`),
// and what its note offers.
export type ElsewherePanel = {
  readonly panel: RailPanel
  readonly own: boolean
  readonly onShow: () => void
  readonly onReturn: () => void
  readonly onHide: () => void
}

// The sidebar: the panels it holds, stacked in one place, where the open one slides in over the
// rest (sidebar.css). Each panel is drawn once by the app and shown here through its slot, so
// it stays as the person left it while another panel or none shows. A panel in a window is
// held there instead; open on one, the sidebar says where it is (`elsewhere`).
export const WorkspaceSidebar = ({
  panels,
  sidebarPanel,
  sidebarVisible,
  elsewhere,
}: {
  // The panels the sidebar holds, in the order they stack.
  panels: readonly RailPanel[]
  sidebarPanel: PanelId
  sidebarVisible: boolean
  elsewhere?: ElsewherePanel | undefined
}): React.JSX.Element => (
  <aside
    id="terminal-sidebar"
    className="sidebar relative flex shrink-0 flex-col overflow-hidden"
    aria-label={panelLabels[sidebarPanel]}
    aria-hidden={!sidebarVisible}
    inert={!sidebarVisible}
  >
    {panels.map((panel) => (
      <PanelSlot key={panel} panel={panel} />
    ))}
    {elsewhere && (
      <PanelElsewhere
        key={elsewhere.panel}
        id={`${elsewhere.panel}-elsewhere`}
        title={panelLabels[elsewhere.panel]}
        own={elsewhere.own}
        onShow={elsewhere.onShow}
        onReturn={elsewhere.onReturn}
        onHide={elsewhere.onHide}
      />
    )}
  </aside>
)
