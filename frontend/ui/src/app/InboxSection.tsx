import { HeldPill, InboxClear, InboxCount, InboxList } from "../inbox/InboxList"
import { panelLabels } from "../sidebar/panel-labels"
import { SidebarPanel } from "../sidebar/SidebarPanel"
import { useUiState, useWorkspaceServices } from "./controller/context"

// The Inbox's panel: its list, which reads the Inbox itself (InboxHost.tsx), under a heading
// that counts what waits.
export const InboxSection = (): React.JSX.Element => {
  const { commands } = useWorkspaceServices()
  const active = useUiState((state) => state.location.route.panel === "inbox")
  return (
    <SidebarPanel
      id="inbox-panel"
      title={panelLabels.inbox}
      count={<InboxCount />}
      titleExtra={<HeldPill />}
      active={active}
      onClose={commands.hideSidebar}
      actions={<InboxClear />}
    >
      <InboxList />
    </SidebarPanel>
  )
}
