import type { RailPanel } from "@novadeck/core/types"
import { useCallback, useMemo, useSyncExternalStore } from "react"

import { useDesktop } from "../shell/desktop"
import { useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { filesShown, historyShown, notesShown } from "./routing"
import { panelPlace, panelShowing, type PanelPlace } from "./selectors"
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

// Whether the panel is in sight (`panelShowing`), which both stores decide: the sidebar's state
// is the UI store's, and the window's the session's.
export const usePanelShowing = (panel: RailPanel): boolean => {
  const desktop = useDesktop()
  const { ui, workspace } = useWorkspaceServices()
  const subscribe = useCallback(
    (notify: () => void) => {
      const stopUi = ui.subscribe(notify)
      const stopWorkspace = workspace.subscribe(notify)
      return () => {
        stopUi()
        stopWorkspace()
      }
    },
    [ui, workspace],
  )
  const read = useCallback(
    () => panelShowing(ui.getSnapshot(), workspace.getSnapshot(), panel, () => desktop),
    [ui, workspace, panel, desktop],
  )
  return useSyncExternalStore(subscribe, read)
}

// Where the panel is in the session on screen (`panelPlace`).
export const usePanelPlace = (panel: RailPanel): PanelPlace =>
  useWorkspaceState((workspace) => panelPlace(workspace, panel))
