import { orderedIds } from "@novadeck/core/roster"
import { activeProject } from "@novadeck/core/state"
import { panelLabels } from "@novadeck/core/types"
import { Plus } from "lucide-react"

import { shortcutBindings } from "../interaction/shortcuts"
import { PanelPointerSensor } from "../sidebar/panel-drag"
import { usePanelView } from "../sidebar/panel-host"
import { SidebarPanel, sidebarCreateClasses } from "../sidebar/SidebarPanel"
import { TerminalTabs } from "../terminals/TerminalTabs"
import { useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { usePanelOpen } from "./panels-shown"
import { historyShown } from "./routing"
import { currentState, currentTarget, sameItems, sameTarget } from "./selectors"
import { SessionsSection } from "./SessionsSection"
import { useReorderTiles } from "./team-fold"
import { terminalsViewSwitch } from "./TerminalsViewSection"
import { renderTab } from "./WorkspaceTab"

// The Terminals panel's two views, wired to the workspace: the open session's terminals, and
// the project's sessions. They share its rail toggle and its window, and a switch beside each
// view's title goes between them.
export const TerminalsSection = (): React.JSX.Element => {
  const { commands, backend } = useWorkspaceServices()
  const { hideSidebar, add } = commands
  const reorderTiles = useReorderTiles()
  const projectId = useWorkspaceState((workspace) => workspace.activeProjectId)
  // Only what the panel shows of the sessions itself: how many, and the open one's name once
  // there are others. Their rows read the rest (SessionsSection), and the tabs their own tiles,
  // so an agent's news wakes neither the panel nor the others.
  const sessionCount = useWorkspaceState((workspace) => activeProject(workspace)!.history.length)
  const sessionName = useWorkspaceState((workspace) => {
    const { history, activeSessionId } = activeProject(workspace)!
    return history.length > 1
      ? history.find((session) => session.id === activeSessionId)?.name
      : undefined
  })
  const { workspaceSessionId } = useWorkspaceState(currentTarget, sameTarget)
  // The tiles' ids in sidebar order: each tab reads its own tile.
  const ids = useWorkspaceState(
    (workspace) => orderedIds(currentState(workspace).roster),
    sameItems,
  )
  // Which view its place shows: the one the sidebar is open on, if either, or the one chosen in
  // its window.
  const sessionsOpen = usePanelOpen("sessions")
  const terminalsOpen = usePanelOpen("terminals")
  // The window the list is drawn in, whose observers follow its tabs.
  const view = usePanelView()
  return (
    <>
      <SidebarPanel
        id="sessions-panel"
        title={panelLabels.sessions}
        titleLead={terminalsViewSwitch}
        count={sessionCount}
        active={sessionsOpen}
        onClose={hideSidebar}
      >
        <SessionsSection
          key={projectId}
          workspaceSessionId={workspaceSessionId}
          historyKept={historyShown(backend)}
        />
      </SidebarPanel>
      <SidebarPanel
        id="terminals-panel"
        title={panelLabels.terminals}
        titleHint={`Recent · ${shortcutBindings().recent.display.join(" ")}`}
        count={ids.length}
        // Which session's terminals these are, once the project has others to tell it from.
        scope={sessionName}
        titleLead={terminalsViewSwitch}
        active={terminalsOpen}
        onClose={hideSidebar}
      >
        <button
          className={sidebarCreateClasses}
          aria-label="New terminal"
          data-terminals-create
          onClick={() => add()}
        >
          <Plus size={14} className="shrink-0" />
          <span className="min-w-0 truncate">Terminal</span>
          <kbd className="hint mb-[-2px] ml-auto shrink-0 whitespace-nowrap">
            {shortcutBindings().newTerminal.display.join(" ")}
          </kbd>
        </button>
        <TerminalTabs
          key={`${projectId}/${workspaceSessionId}`}
          ids={ids}
          renderTab={renderTab}
          onReorder={reorderTiles}
          sensor={PanelPointerSensor}
          view={view}
        />
      </SidebarPanel>
    </>
  )
}
