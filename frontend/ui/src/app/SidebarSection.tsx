import { memo } from "react"

import { useDesktop } from "../shell/desktop"
import { sidebarVisible } from "../shell/shell-state"
import { WorkspaceSidebar } from "../shell/WorkspaceSidebar"
import { useUiState } from "./controller/context"
import { usePanelsShown } from "./panels-shown"

// The sidebar wired to the workspace: it holds every panel the app shows (PanelInstances.tsx),
// open on the one the route names.
export const SidebarSection = memo((): React.JSX.Element => {
  const desktop = useDesktop()
  const panels = usePanelsShown()
  const sidebarPanel = useUiState((state) => state.location.route.panel)
  const visible = useUiState((state) => sidebarVisible(state.shell, desktop))
  return <WorkspaceSidebar panels={panels} sidebarPanel={sidebarPanel} sidebarVisible={visible} />
})
