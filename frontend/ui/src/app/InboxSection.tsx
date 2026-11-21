import { panelLabels } from "@novadeck/core/types"

import { HeldPill, InboxClear, InboxCount, InboxList, useInboxClear } from "../inbox/InboxList"
import { PanelPointerSensor } from "../sidebar/panel-drag"
import { SidebarPanel } from "../sidebar/SidebarPanel"
import { useWorkspaceServices } from "./controller/context"
import { usePanelOpen } from "./panels-shown"

// The Inbox's panel: its list, which reads the Inbox itself (InboxHost.tsx), under a heading
// that counts what waits. Its header has Clear only while there is something to clear, so its
// window on the stage shows no row for it otherwise.
export const InboxSection = (): React.JSX.Element => {
  const { commands } = useWorkspaceServices()
  const active = usePanelOpen("inbox")
  const clear = useInboxClear()
  return (
    <SidebarPanel
      id="inbox-panel"
      title={panelLabels.inbox}
      count={<InboxCount />}
      titleExtra={<HeldPill />}
      active={active}
      onClose={commands.hideSidebar}
      actions={clear && <InboxClear clear={clear} />}
    >
      {/* Its rows drag in whichever window it is drawn in. */}
      <InboxList sensor={PanelPointerSensor} />
    </SidebarPanel>
  )
}
