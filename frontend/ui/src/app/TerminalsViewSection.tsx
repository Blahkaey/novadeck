import { activeProject } from "@novadeck/core/state"
import type { TerminalsView } from "@novadeck/core/types"
import { memo } from "react"

import { elsewhereSessionsText } from "../projects/session-marks"
import { TerminalsViewSwitch } from "../sidebar/TerminalsViewSwitch"
import { useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useSessionMarks } from "./useSessionMarks"

// The Terminals panel's view switch, wired to the workspace. It reads the sessions' marks
// itself, for the dot on its Sessions choice, so an agent's news wakes only the switch and
// not the sidebar around it.
const TerminalsViewSection = memo(({ view }: { readonly view: TerminalsView }) => {
  const { commands } = useWorkspaceServices()
  const marks = useSessionMarks()
  const openId = useWorkspaceState((workspace) => activeProject(workspace)!.activeSessionId)
  return (
    <TerminalsViewSwitch
      view={view}
      sessionsAsk={elsewhereSessionsText(marks, openId)}
      onView={commands.switchTerminalsView}
    />
  )
})

// The switch for a view's header, the same each render.
export const renderTerminalsView = (view: TerminalsView): React.JSX.Element => (
  <TerminalsViewSection view={view} />
)
