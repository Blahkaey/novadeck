import type { RailPanel, Workspace } from "@novadeck/core/types"
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react"

import { useDesktop } from "../shell/desktop"
import { useWorkspaceServices } from "./controller/context"
import { filesShown, historyShown, notesShown } from "./routing"
import { panelPlace, panelsAway, panelShowing, sameItems, type PanelPlace } from "./selectors"
import type { UiState } from "./ui-store"
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

// The panels that open in a window, on the stage and from there in a window of their own.
export const detachablePanels: ReadonlySet<RailPanel> = new Set([
  "notes",
  "todo",
  "history",
  "files",
])

// A value both stores decide, as where a panel is: a window of its own is the UI store's, a
// window on the stage the session's. `read` returns a value `Object.is` can compare.
const useBothStores = <T>(read: (ui: UiState, workspace: Workspace) => T): T => {
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
  const snapshot = useCallback(
    () => read(ui.getSnapshot(), workspace.getSnapshot()),
    [ui, workspace, read],
  )
  return useSyncExternalStore(subscribe, snapshot)
}

// Whether the panel is in sight (`panelShowing`), which both stores decide: the sidebar's state
// is the UI store's, and the window's the session's.
export const usePanelShowing = (panel: RailPanel): boolean => {
  const desktop = useDesktop()
  return useBothStores(
    useCallback(
      (ui: UiState, workspace: Workspace) => panelShowing(ui, workspace, panel, () => desktop),
      [panel, desktop],
    ),
  )
}

// Where the panel is in the session on screen (`panelPlace`).
export const usePanelPlace = (panel: RailPanel): PanelPlace =>
  useBothStores(
    useCallback((ui: UiState, workspace: Workspace) => panelPlace(ui, workspace, panel), [panel]),
  )

// The panels out of the sidebar (`panelsAway`), the same list while they stay the same.
export const usePanelsAway = (): readonly RailPanel[] => {
  const last = useRef<readonly RailPanel[]>([])
  return useBothStores(
    useCallback((ui: UiState, workspace: Workspace) => {
      const away = panelsAway(ui, workspace)
      if (!sameItems(away, last.current)) last.current = away
      return last.current
    }, []),
  )
}
