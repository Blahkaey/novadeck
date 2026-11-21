import type { RailPanel } from "@novadeck/core/types"
import { useMemo } from "react"

import { useDesktop } from "../shell/desktop"
import { useUiState, useWorkspaceServices } from "./controller/context"
import { filesShown, historyShown, notesShown } from "./routing"
import { panelShowing } from "./selectors"
import { useWorktreesShown } from "./use-worktrees-shown"

// The panels of the rail the app shows with this backend and these settings, in the order the
// sidebar stacks them: Terminals and the Inbox always, the rest where the backend has what they
// list (see `filesShown` and the rest).
export const usePanelsShown = (): readonly RailPanel[] => {
  const { backend } = useWorkspaceServices()
  const files = filesShown(backend)
  const notes = notesShown(backend)
  const history = historyShown(backend)
  const worktrees = useWorktreesShown()
  return useMemo(
    () => [
      ...(files ? (["files"] as const) : []),
      ...(notes ? (["notes", "todo"] as const) : []),
      ...(history ? (["history"] as const) : []),
      "terminals" as const,
      ...(worktrees ? (["worktrees"] as const) : []),
      "inbox" as const,
    ],
    [files, notes, history, worktrees],
  )
}

// Whether the panel is in sight (`panelShowing`).
export const usePanelShowing = (panel: RailPanel): boolean => {
  const desktop = useDesktop()
  return useUiState((state) => panelShowing(state, panel, () => desktop))
}
