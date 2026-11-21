import { panelLabels, type RailPanel, type SidebarPanel as PanelId } from "@novadeck/core/types"

import { PanelSlot } from "./PanelSlot"

// The sidebar: the panels it holds, stacked in one place, where the open one slides in over the
// rest (sidebar.css). Each panel is drawn once by the app and shown here through its slot, so
// it stays as the person left it while another panel or none shows.
export const WorkspaceSidebar = ({
  panels,
  sidebarPanel,
  sidebarVisible,
}: {
  // The panels the sidebar holds, in the order they stack.
  panels: readonly RailPanel[]
  sidebarPanel: PanelId
  sidebarVisible: boolean
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
  </aside>
)
