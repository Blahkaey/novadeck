import { hasPanel, panelTile } from "@novadeck/core/roster"
import { railPanelOf, type RailPanel, type SidebarPanel } from "@novadeck/core/types"

import { bumpNavigation, hideSidebar, sidebarVisible } from "../../shell/shell-state"
import { currentState, currentTarget, panelPlace, panelsOnStage } from "../selectors"
import { updateShell } from "../ui-store"
import type { CommandContext } from "./context"

// A panel of the rail as a window on the stage of the session on screen, and back.
export type PanelCommands = {
  // Opens the panel as a window on the session's stage, selected, with keyboard focus in it
  // unless `focus` is false, as the demo's gallery opens windows beside the terminal it shows.
  // The sidebar, where it showed the panel, moves to the first panel the person's rail order
  // still has in the sidebar, or hides where none is left (once Terminals, which is always there
  // now, can open in a window too); a phone's drawer closes, so the window shows.
  readonly detachPanel: (panel: RailPanel, options?: { readonly focus?: boolean }) => void
  // Closes the panel's window and opens the sidebar on the panel, with keyboard focus in it.
  readonly returnPanel: (panel: RailPanel) => void
  // Brings the panel's window into view: selected, shown again in Grid and Canvas where the
  // person hid it, with keyboard focus in it.
  readonly revealPanel: (panel: RailPanel) => void
}

// Whether the panel the route or a key names is in a window on the stage of the session on
// screen; the Terminals panel's views share its window.
export const inWindow = (
  { workspace }: Pick<CommandContext, "workspace">,
  panel: SidebarPanel,
): boolean => panelPlace(workspace.getSnapshot(), railPanelOf(panel)) === "stage"

// Brings the panel's window into view, as `revealPanel` says.
export const panelRevealer =
  ({ workspace, ui, navigation, effects }: CommandContext) =>
  (panel: RailPanel): void => {
    const snapshot = workspace.getSnapshot()
    const { id } = panelTile(panel)
    const { roster, view, layout } = currentState(snapshot)
    if (!hasPanel(roster, id)) return
    if (view !== "focus" && layout.hidden[id])
      workspace.dispatch({
        type: "terminal/visibility",
        target: currentTarget(snapshot),
        terminalId: id,
        hidden: false,
      })
    navigation.go({ terminal: id })
    // In view, and on a phone out from under the drawer.
    updateShell(ui, (shell) => ({ ...bumpNavigation(shell), sidebar: false }))
    effects.afterFrame(() => effects.focusPanel(panel))
  }

export const createPanelCommands = (
  ctx: CommandContext,
  {
    show,
    reveal,
  }: {
    // Opens the sidebar on a panel, as its rail toggle does.
    readonly show: (panel: SidebarPanel) => void
    readonly reveal: (panel: RailPanel) => void
  },
): PanelCommands => {
  const { workspace, ui, navigation, effects, panelShown } = ctx
  return {
    detachPanel: (panel, { focus = true } = {}) => {
      const snapshot = workspace.getSnapshot()
      const { location, shell } = ui.getSnapshot()
      const desktop = effects.desktop()
      const showing = railPanelOf(location.route.panel) === panel && sidebarVisible(shell, desktop)
      const staged = panelsOnStage(snapshot)
      const next = effects
        .railOrder()
        .find((each) => each !== panel && !staged.includes(each) && (panelShown?.(each) ?? true))
      // The Terminals toggle opens the view the person saw last.
      const nextRoute = next === "terminals" ? shell.terminalsView : next
      navigation.navigateWorkspace(
        [{ type: "panel/open", target: currentTarget(snapshot), panel }],
        showing && nextRoute ? { panel: nextRoute } : {},
      )
      updateShell(ui, (edited) =>
        bumpNavigation(
          !showing
            ? edited
            : !desktop || !nextRoute
              ? hideSidebar(edited)
              : { ...edited, sidebarBack: null },
        ),
      )
      if (focus) effects.afterFrame(() => effects.focusPanel(panel))
    },
    returnPanel: (panel) => {
      const snapshot = workspace.getSnapshot()
      const { view, selected } = currentState(snapshot)
      const { id } = panelTile(panel)
      navigation.navigateWorkspace(
        [{ type: "panel/close", target: currentTarget(snapshot), panel }],
        {},
        true,
      )
      // The view settles on what is selected next, as it does when a window closes.
      if (selected === id && view !== "canvas") updateShell(ui, (shell) => bumpNavigation(shell))
      show(panel)
      effects.afterFrame(() => effects.focusPanel(panel))
    },
    revealPanel: reveal,
  }
}
