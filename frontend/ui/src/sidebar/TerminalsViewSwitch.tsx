import type { TerminalsView } from "@novadeck/core/types"
import { SegmentGroup } from "@novadeck/toolkit/SegmentGroup"
import { Layers2, Terminal as TerminalIcon } from "lucide-react"

import { panelLabels } from "./panel-labels"

// The switch before the Terminals panel's title, between its two views: the open session's
// terminals and the project's sessions. Each view's header draws one, in the same place, so a
// pointer that pressed one choice is over the other's twin; the person's place is the one in
// the view that shows. The Sessions choice carries a dot while another session asks
// something of the person (`sessionsAsk`, in words), as the rail's Terminals toggle does; the
// toggle says it to assistive technology.
// A terminal's tab dragged over a choice, held there, opens that view (`data-terminals-view`,
// see `useTabsAway`).
export const TerminalsViewSwitch = ({
  view,
  sessionsAsk,
  onView,
}: {
  readonly view: TerminalsView
  readonly sessionsAsk?: string | undefined
  readonly onView: (view: TerminalsView) => void
}): React.JSX.Element => (
  <span className="flex shrink-0" data-terminals-view>
    <SegmentGroup
      label="Terminals panel view"
      tooltips
      className="terminals-view flex shrink-0 gap-0.5"
      itemClassName="flex size-6 items-center justify-center [&>[data-part=item-text]]:sr-only"
      items={[
        {
          value: "terminals",
          label: panelLabels.terminals,
          icon: <TerminalIcon size={13} strokeWidth={1.6} aria-hidden="true" />,
        },
        {
          value: "sessions",
          label: panelLabels.sessions,
          icon: (
            <>
              <Layers2 size={13} strokeWidth={1.6} aria-hidden="true" />
              {sessionsAsk && (
                <span className="attention-dot terminals-view-dot" aria-hidden="true" />
              )}
            </>
          ),
        },
      ]}
      value={view}
      onValueChange={(value) => onView(value === "sessions" ? "sessions" : "terminals")}
    />
  </span>
)
