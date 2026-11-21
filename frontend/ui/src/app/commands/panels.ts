import { hasPanel, panelTile } from "@novadeck/core/roster"
import { railPanelOf, type RailPanel, type SidebarPanel } from "@novadeck/core/types"

import { bumpNavigation, hideSidebar, sidebarVisible } from "../../shell/shell-state"
import { currentState, currentTarget, panelPlace, panelsAway } from "../selectors"
import { updateShell } from "../ui-store"
import type { CommandContext } from "./context"

// A panel of the rail as a window on the stage of the session on screen, or in a window of its
// own, and back.
export type PanelCommands = {
  // Opens the panel as a window on the session's stage, selected, with keyboard focus in it
  // unless `focus` is false, as the demo's gallery opens windows beside the terminal it shows.
  // The sidebar, where it showed the panel, moves to the first panel the person's rail order
  // still has in the sidebar, or hides where none is left; a phone's drawer closes, so the window
  // shows.
  readonly detachPanel: (panel: RailPanel, options?: { readonly focus?: boolean }) => void
  // Opens the panel in a window of its own, in front, with keyboard focus in it: from its window
  // on the stage, which closes, as the person's click asks, since a browser opens a window from
  // nothing else. It stays there whatever the session until that window closes. Where the
  // browser or the desktop app refuses the window, the panel stays where it was and a toast
  // says so (`windowRefused`).
  readonly openOwnWindow: (panel: RailPanel) => void
  // Closes the panel's window, on the stage or of its own, and opens the sidebar on the panel,
  // the Terminals panel on the view it showed there, with keyboard focus in it. A window of its
  // own closing by itself comes back the same way.
  readonly returnPanel: (panel: RailPanel) => void
  // Brings the panel's window into view: on the stage, selected, shown again in Grid and Canvas
  // where the person hid it, with keyboard focus in it; of its own, in front.
  readonly revealPanel: (panel: RailPanel) => void
  // Closes the panel's window of its own and shows the panel in its window on the stage of the
  // session on screen, which said where the panel was meanwhile.
  readonly bringPanelHere: (panel: RailPanel) => void
  // Closes the panel's window, on the stage of the session on screen or of its own, leaving the
  // sidebar as it is: for a panel the app no longer shows, as Worktrees once agent worktrees are
  // turned off, which has no place in the sidebar to come back to.
  readonly dropPanel: (panel: RailPanel) => void
  // Closes every panel's window of its own as the workspace around them goes while the app's
  // state stays, as a narrow window covers the workspace for a visitor: each panel is back
  // where the session has it, in the sidebar or on the stage, so it never stays in a window
  // the page no longer fills.
  readonly forgetOwnWindows: () => void
}

// Whether the panel the route or a key names is out of the sidebar, in a window on the stage of
// the session on screen or of its own; the Terminals panel's views share its window.
export const inWindow = (
  { workspace, ui }: Pick<CommandContext, "workspace" | "ui">,
  panel: SidebarPanel,
): boolean =>
  panelPlace(ui.getSnapshot(), workspace.getSnapshot(), railPanelOf(panel)) !== "sidebar"

// The panel as it shows: the Terminals panel as the view the person last chose, the rest as
// themselves.
const shownAs = ({ ui }: Pick<CommandContext, "ui">, panel: RailPanel): SidebarPanel =>
  panel === "terminals" ? ui.getSnapshot().shell.terminalsView : panel

// Brings the panel's window into view, as `revealPanel` says.
export const panelRevealer =
  (ctx: CommandContext) =>
  (panel: RailPanel): void => {
    const { workspace, ui, navigation, effects } = ctx
    if (ui.getSnapshot().ownWindows.includes(panel))
      return effects.focusOwnWindow(shownAs(ctx, panel))
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
    effects.afterFrame(() => effects.focusPanel(shownAs(ctx, panel)))
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
  // Takes the panel's window off the stage of the session on screen, where it has one, leaving a
  // dialog open over the workspace open: Preferences, where turning agent worktrees off takes
  // Worktrees' window. True where it was the window selected outside Canvas, so the view has
  // another to settle on.
  const removeTile = (panel: RailPanel): boolean => {
    const snapshot = workspace.getSnapshot()
    const { view, selected, roster } = currentState(snapshot)
    const { id } = panelTile(panel)
    if (!hasPanel(roster, id)) return false
    const { dialog, section } = ui.getSnapshot().location.route
    navigation.navigateWorkspace(
      [{ type: "panel/close", target: currentTarget(snapshot), panel }],
      { dialog, section },
      true,
    )
    return selected === id && view !== "canvas"
  }
  // Closes the panel's window on the stage, the view settling on what is selected next, with the
  // keyboard, as it does when the person closes a window.
  const closeTile = (panel: RailPanel): void => {
    if (removeTile(panel)) updateShell(ui, (shell) => bumpNavigation(shell))
  }
  // Closes the panel's window of its own, where it has one.
  const closeOwn = (panel: RailPanel): void => {
    if (!ui.getSnapshot().ownWindows.includes(panel)) return
    effects.closeOwnWindow(panel)
    ui.update((state) => ({
      ...state,
      ownWindows: state.ownWindows.filter((each) => each !== panel),
    }))
  }
  return {
    detachPanel: (panel, { focus = true } = {}) => {
      const snapshot = workspace.getSnapshot()
      const { location, shell } = ui.getSnapshot()
      const desktop = effects.desktop()
      const showing = railPanelOf(location.route.panel) === panel && sidebarVisible(shell, desktop)
      const away = panelsAway(ui.getSnapshot(), snapshot)
      const next = effects
        .railOrder()
        .find((each) => each !== panel && !away.includes(each) && (panelShown?.(each) ?? true))
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
      if (focus) effects.afterFrame(() => effects.focusPanel(shownAs(ctx, panel)))
    },
    openOwnWindow: (panel) => {
      if (!effects.openOwnWindow(panel)) {
        ui.update((state) => ({ ...state, windowRefused: { id: effects.newId(), panel } }))
        return
      }
      // In its window of its own before its window on the stage closes, so it never shows in the
      // sidebar between them.
      ui.update((state) => ({
        ...state,
        ownWindows: [...state.ownWindows.filter((each) => each !== panel), panel],
      }))
      closeTile(panel)
      // Once the window holds it.
      effects.afterFrame(() => effects.focusOwnWindow(shownAs(ctx, panel)))
    },
    returnPanel: (panel) => {
      // The Terminals panel comes back on the view it showed in its window, read before the
      // sidebar holds it again and notes the route's.
      const shown = shownAs(ctx, panel)
      closeOwn(panel)
      closeTile(panel)
      show(shown)
      effects.afterFrame(() => effects.focusPanel(shown))
    },
    revealPanel: reveal,
    bringPanelHere: (panel) => {
      closeOwn(panel)
      reveal(panel)
    },
    // Nothing the person did here closes it, so the keyboard stays where they are: in
    // Preferences, where agent worktrees turn off.
    dropPanel: (panel) => {
      closeOwn(panel)
      removeTile(panel)
    },
    forgetOwnWindows: () => {
      for (const panel of ui.getSnapshot().ownWindows) closeOwn(panel)
    },
  }
}
