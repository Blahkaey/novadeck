import { railPanelOf } from "@novadeck/core/types"
import { memo, useMemo } from "react"

import { useDesktop } from "../shell/desktop"
import { sidebarVisible } from "../shell/shell-state"
import { WorkspaceSidebar, type ElsewherePanel } from "../shell/WorkspaceSidebar"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { usePanelsShown } from "./panels-shown"
import { panelsOnStage, sameItems } from "./selectors"

// The sidebar wired to the workspace: it holds every panel the app shows (PanelInstances.tsx)
// but those in a window on the stage of the session on screen, open on the one the route names.
export const SidebarSection = memo((): React.JSX.Element => {
  const desktop = useDesktop()
  const { commands } = useWorkspaceServices()
  const panels = usePanelsShown()
  const staged = useWorkspaceState(panelsOnStage, sameItems)
  const docked = useMemo(() => panels.filter((panel) => !staged.includes(panel)), [panels, staged])
  const sidebarPanel = useUiState((state) => state.location.route.panel)
  const visible = useUiState((state) => sidebarVisible(state.shell, desktop))
  const open = railPanelOf(sidebarPanel)
  const { revealPanel, returnPanel, hideSidebar } = commands
  const elsewhere = useMemo(
    (): ElsewherePanel | undefined =>
      staged.includes(open)
        ? {
            panel: open,
            onShow: () => revealPanel(open),
            onReturn: () => returnPanel(open),
            onHide: hideSidebar,
          }
        : undefined,
    [staged, open, revealPanel, returnPanel, hideSidebar],
  )
  return (
    <WorkspaceSidebar
      panels={docked}
      sidebarPanel={sidebarPanel}
      sidebarVisible={visible}
      elsewhere={elsewhere}
    />
  )
})
