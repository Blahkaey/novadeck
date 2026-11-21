import { descendantsOf, leadChain } from "@novadeck/core/derivations"
import type { Item } from "@novadeck/core/items"
import { hasPanel, panelTile, tilesOf } from "@novadeck/core/roster"
import { activeProject, activeSession } from "@novadeck/core/state"
import {
  railPanelOf,
  type RailPanel,
  type TerminalMetadata,
  type Tile,
  type ViewMode,
  type WindowedView,
  type Workspace,
  type WorkspaceState,
  type WorkspaceTarget,
} from "@novadeck/core/types"

import { sidebarVisible, type FocusPreview } from "../shell/shell-state"
import type { FoldedTeams } from "../terminals/team-fold"
import type { UiState } from "./ui-store"

// The active session's state; the workspace always has one once seeded.
export const currentState = (workspace: Workspace): WorkspaceState =>
  activeSession(workspace)!.state

// `${projectId}/${workspaceSessionId}`; presentation state is scoped to it.
export const currentContext = (workspace: Workspace): string =>
  `${workspace.activeProjectId}/${activeProject(workspace)!.activeSessionId}`

// What a person sees change on Back/Forward: the session, its view and its selection.
export const currentPresentation = (workspace: Workspace): string => {
  const { view, selected } = currentState(workspace)
  return `${currentContext(workspace)}/${view}/${selected}`
}

// Where commands for the active session are addressed.
export const currentTarget = (workspace: Workspace): WorkspaceTarget => ({
  projectId: workspace.activeProjectId,
  workspaceSessionId: activeProject(workspace)!.activeSessionId,
})

// Where Focus hands a terminal back to: the session's windowed view if enabled,
// otherwise the first enabled view that is not Focus.
export const windowedDestination = (
  windowedView: WindowedView,
  enabledViews: readonly ViewMode[],
): ViewMode | undefined =>
  enabledViews.includes(windowedView) ? windowedView : enabledViews.find((mode) => mode !== "focus")

export const sameTarget = (a: WorkspaceTarget, b: WorkspaceTarget): boolean =>
  a.projectId === b.projectId && a.workspaceSessionId === b.workspaceSessionId

// The state of the session `target` names, while it's there.
export const stateAt = (
  workspace: Workspace,
  target: WorkspaceTarget,
): WorkspaceState | undefined =>
  workspace.projects
    .find((project) => project.id === target.projectId)
    ?.history.find((session) => session.id === target.workspaceSessionId)?.state

// A file a project window shows, by the path it points at.
export type ProjectFile = Item & { readonly path: string }

const isProjectFile = (item: Item | undefined): item is ProjectFile =>
  item !== undefined && item.path !== null

// The file the session's project window shows, while it has one.
export const projectWindowFile = (state: WorkspaceState | undefined): ProjectFile | undefined => {
  const window = state?.roster.windows.find((each) => each.home === "project")
  const item = window && state?.items.find((each) => each.id === window.itemId)
  return isProjectFile(item) ? item : undefined
}

// Equal when both hold the identical items in the same order.
export const sameItems = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => Object.is(item, b[index]))

// Equal when both have the same keys holding identical values.
export const shallowEqual = <T>(a: T, b: T): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key as keyof T], b[key as keyof T]))
  )
}

// The terminal Focus shows: the selection, a kept preview, or the first terminal.
export const activeTerminal = (
  terminals: readonly Tile[],
  selected: string,
  context: string,
  focusPreview: FocusPreview | null,
): Tile | undefined => {
  const displayed = selected || (focusPreview?.context === context ? focusPreview.id : "")
  return terminals.find((terminal) => terminal.id === displayed) ?? terminals[0]
}

// The terminal whose close waits on the person: only in the session it was asked in,
// and only while the terminal is still there.
export const closeQuestion = (
  ui: Pick<UiState, "closing">,
  workspace: Workspace,
): TerminalMetadata | undefined =>
  ui.closing?.context === currentContext(workspace)
    ? currentState(workspace).roster.terminals.find((terminal) => terminal.id === ui.closing!.id)
    : undefined

// The crash count the crash-loop dialog shows; 0 when it does not ask.
export const crashLoopQuestion = (ui: Pick<UiState, "crashLoop" | "crashLoopDismissed">): number =>
  ui.crashLoopDismissed ? 0 : ui.crashLoop

// Whether an alert dialog is on screen, which holds every shortcut back.
export const alertOpen = (ui: UiState, workspace: Workspace): boolean =>
  closeQuestion(ui, workspace) !== undefined || crashLoopQuestion(ui) > 0 || ui.leaving !== null

// Whether a modal dialog covers the page, which a doorbell waits out: Search or Preferences
// (the route's), the close confirmation, the crash-loop question, the question about leaving
// edits that can't be saved, or the terminal switcher opened by click (the held one, from
// Ctrl+Tab, takes no pointer and blocks nothing).
//
// The welcome dialog is the backend's own state, not the UI store's, and the name offer is a
// chip that blocks nothing, so neither counts. Nor can the project-removal confirmation (the
// switcher's local state), the plan-close confirmation (the companion's) or the phone sidebar
// drawer (the panels'): a toast there sits under the dialog, and its item stays in the Inbox.
export const modalOpen = (ui: UiState): boolean =>
  ui.location.route.dialog !== null ||
  ui.closing !== null ||
  crashLoopQuestion(ui) > 0 ||
  ui.leaving !== null ||
  ui.recent.switcher?.mode === "click"

// Where a panel of the rail is in the session on screen: on its stage, as a window, while its
// roster holds the panel's tile; else in the sidebar. Each session keeps its own places.
export type PanelPlace = "sidebar" | "stage"

export const panelPlace = (workspace: Workspace, panel: RailPanel): PanelPlace =>
  hasPanel(currentState(workspace).roster, panelTile(panel).id) ? "stage" : "sidebar"

// The panels in a window on the stage of the session on screen, in the order they opened; a new
// list each time, for `sameItems` to compare.
export const panelsOnStage = (workspace: Workspace): readonly RailPanel[] =>
  currentState(workspace).roster.panels.map(({ panel }) => panel)

// Whether the panel's window is in sight on the stage: in Focus, the tile Focus shows; in Grid
// and Canvas, one the person hasn't hidden, or hidden and selected, which they show for a look.
const windowInSight = (ui: UiState, workspace: Workspace, panel: RailPanel): boolean => {
  const { id } = panelTile(panel)
  const { view, roster, selected, layout } = currentState(workspace)
  if (view !== "focus") return !layout.hidden[id] || selected === id
  const context = currentContext(workspace)
  return activeTerminal(tilesOf(roster), selected, context, ui.shell.focusPreview)?.id === id
}

// Whether a panel of the rail is in sight, which is when it reads, follows and ticks, and when
// what it lists counts as seen. In the sidebar: while the sidebar shows, open on it (on either
// view of the Terminals panel for its toggle). In a window: while the window is in sight.
// `desktop` is asked only when the route names a panel in the sidebar.
export const panelShowing = (
  ui: UiState,
  workspace: Workspace,
  panel: RailPanel,
  desktop: () => boolean,
): boolean =>
  panelPlace(workspace, panel) === "stage"
    ? windowInSight(ui, workspace, panel)
    : railPanelOf(ui.location.route.panel) === panel && sidebarVisible(ui.shell, desktop())

// Whether the Inbox's panel is in sight.
export const inboxShown = (ui: UiState, workspace: Workspace, desktop: () => boolean): boolean =>
  panelShowing(ui, workspace, "inbox", desktop)

// Whether a toast may show now: the page has the person's focus, they want to hear what
// needs them, and the Inbox isn't what they look at. (The toasts also skip an item of the
// terminal they've come back to, see inbox-toasts.ts.) `desktop` is asked only when the
// sidebar matters.
export const mayToast = (ui: UiState, workspace: Workspace, desktop: () => boolean): boolean =>
  ui.pageFocused && ui.preferences.notifyNeeds && !inboxShown(ui, workspace, desktop)

// Whether a toast for the item waits behind a modal dialog: it would show but for the dialog.
// The OS ping defers the same items, so that one never rings for what no toast waits for.
export const heldForToast = (ui: UiState, workspace: Workspace, desktop: () => boolean): boolean =>
  modalOpen(ui) && mayToast(ui, workspace, desktop)

// The current session's folds, each lead with the tabs its fold hides (not the one the person is
// on, nor the leads above it, which show in place): what a drag keeps together.
export const foldsOf = (
  workspace: Workspace,
  foldedTeams: FoldedTeams,
): { readonly lead: string; readonly hidden: readonly string[] }[] => {
  const context = currentContext(workspace)
  const { selected } = currentState(workspace)
  const kept = new Set([selected, ...leadChain(workspace, selected)])
  return (foldedTeams[context] ?? []).map((lead) => ({
    lead,
    hidden: descendantsOf(workspace, lead).filter((id) => !kept.has(id)),
  }))
}
