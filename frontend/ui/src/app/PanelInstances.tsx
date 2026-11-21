import type { Backend } from "@novadeck/core/port"
import type { RailPanel } from "@novadeck/core/types"
import { PortalInto } from "@novadeck/toolkit/PortalInto"
import { memo, useMemo } from "react"

import { usePanelNodes } from "../shell/panel-nodes"
import { PanelHostContext, type PanelHost } from "../sidebar/panel-host"
import { useWorkspaceServices } from "./controller/context"
import { FilesSection } from "./FilesSection"
import { HistorySection } from "./HistorySection"
import { InboxSection } from "./InboxSection"
import { NotesSection, TodoSection } from "./NotesSection"
import { usePanelPlace, usePanelsShown } from "./panels-shown"
import { TerminalsSection } from "./TerminalsSection"
import { WorktreesSection } from "./WorktreesSection"

// A panel wired to the part of the backend it lists, which `usePanelsShown` has it shown for.
const bodyOf = (panel: RailPanel, backend: Backend): React.JSX.Element | undefined => {
  switch (panel) {
    case "files":
      return backend.files && <FilesSection files={backend.files} />
    case "notes":
      return backend.notes && <NotesSection notes={backend.notes} />
    case "todo":
      return backend.notes && <TodoSection notes={backend.notes} />
    case "history":
      return backend.history && <HistorySection history={backend.history} />
    case "worktrees":
      return backend.works && <WorktreesSection works={backend.works} />
    case "terminals":
      return <TerminalsSection />
    case "inbox":
      return <InboxSection />
  }
}

// The panels that open in a window on the stage from their header.
const detachable: ReadonlySet<RailPanel> = new Set(["notes", "todo", "history", "files"])

// One panel, drawn into its element, told where it is: in the sidebar, or in a window on the
// stage of the session on screen, whose header shows the element it draws its count into.
const PanelInstance = memo(
  ({
    panel,
    node,
    count,
  }: {
    readonly panel: RailPanel
    readonly node: Element
    readonly count: Element
  }): React.JSX.Element => {
    const { backend, commands } = useWorkspaceServices()
    const place = usePanelPlace(panel)
    const { detachPanel } = commands
    const host = useMemo(
      (): PanelHost =>
        place === "stage"
          ? { place, count }
          : { place, detach: detachable.has(panel) ? () => detachPanel(panel) : undefined },
      [place, panel, count, detachPanel],
    )
    return (
      <PortalInto node={node}>
        <PanelHostContext value={host}>{bodyOf(panel, backend)}</PanelHostContext>
      </PortalInto>
    )
  },
)

// Every panel of the rail the app shows, each drawn once, into its own element, which a host
// such as the sidebar shows (shell/PanelSlot.tsx). Drawn here, a panel has the app's context
// wherever it shows, and moving it between hosts never mounts it anew. It reads only which
// panels there are, so nothing else the app around it changes draws them again.
export const PanelInstances = memo((): React.JSX.Element => {
  const nodes = usePanelNodes()
  const panels = usePanelsShown()
  return (
    <>
      {panels.map((panel) => (
        <PanelInstance
          key={panel}
          panel={panel}
          node={nodes.node(panel)}
          count={nodes.count(panel)}
        />
      ))}
    </>
  )
})
