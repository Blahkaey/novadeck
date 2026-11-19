import { activeProject } from "@novadeck/core/state"
import { memo } from "react"

import { elsewhereSessionsText } from "../projects/session-marks"
import { TerminalsViewSwitch } from "../sidebar/TerminalsViewSwitch"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useSessionMarks } from "./useSessionMarks"

// The Terminals panel's view switch, wired to the workspace. Each view's header draws one, and
// both follow the view the route shows, so the one that shows next never keeps a choice the
// person pressed on the other. It reads the sessions' marks itself, for the dot on its Sessions
// choice, so an agent's news wakes only the switch and not the sidebar around it.
const TerminalsViewSection = memo(() => {
  const { commands } = useWorkspaceServices()
  const sessions = useUiState((state) => state.location.route.panel === "sessions")
  const marks = useSessionMarks()
  const openId = useWorkspaceState((workspace) => activeProject(workspace)!.activeSessionId)
  return (
    <TerminalsViewSwitch
      view={sessions ? "sessions" : "terminals"}
      sessionsAsk={elsewhereSessionsText(marks, openId)}
      onView={commands.switchTerminalsView}
    />
  )
})

// The switch for both views' headers.
export const terminalsViewSwitch = <TerminalsViewSection />
