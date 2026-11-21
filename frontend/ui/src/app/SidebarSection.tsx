import { railPanelOf } from "@novadeck/core/types"
import { memo, useMemo } from "react"

import { useDesktop } from "../shell/desktop"
import { sidebarVisible } from "../shell/shell-state"
import { WorkspaceSidebar, type ElsewherePanel } from "../shell/WorkspaceSidebar"
import { useUiState, useWorkspaceServices } from "./controller/context"
import { usePanelsAway, usePanelsShown } from "./panels-shown"

// The sidebar wired to the workspace: it holds every panel the app shows (PanelInstances.tsx)
// but those in a window, on the stage of the session on screen or of their own, open on the one
// the route names.
export const SidebarSection = memo((): React.JSX.Element => {
  const desktop = useDesktop()
  const { commands } = useWorkspaceServices()
  const panels = usePanelsShown()
  const away = usePanelsAway()
  const ownWindows = useUiState((state) => state.ownWindows)
  const docked = useMemo(() => panels.filter((panel) => !away.includes(panel)), [panels, away])
  const sidebarPanel = useUiState((state) => state.location.route.panel)
  const visible = useUiState((state) => sidebarVisible(state.shell, desktop))
  const open = railPanelOf(sidebarPanel)
  const { revealPanel, returnPanel, hideSidebar } = commands
  const elsewhere = useMemo(
    (): ElsewherePanel | undefined =>
      away.includes(open)
        ? {
            panel: open,
            own: ownWindows.includes(open),
            onShow: () => revealPanel(open),
            onReturn: () => returnPanel(open),
            onHide: hideSidebar,
          }
        : undefined,
    [away, ownWindows, open, revealPanel, returnPanel, hideSidebar],
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
