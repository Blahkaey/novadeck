import {
  railPanelOf,
  type RailPanel,
  type SidebarPanel,
  type TerminalsView,
} from "@novadeck/core/types"

import {
  bumpNavigation,
  enterZen,
  exitZen,
  hideSidebar,
  showPanel,
  sidebarVisible,
  stepBack,
  type FocusPreview,
  type KeyboardFocus,
  type NavigationMove,
  type ShellState,
} from "../../shell/shell-state"
import { currentContext, currentState } from "../selectors"
import { updateShell } from "../ui-store"
import type { CommandContext } from "./context"
import { createPanelCommands, inWindow, panelRevealer, type PanelCommands } from "./panels"

export type ShellCommands = PanelCommands & {
  readonly showSessions: () => void
  readonly showTerminals: () => void
  readonly showInbox: () => void
  // Shows a panel for a moment, as a click on a toast shows the Inbox for one row, in place of
  // the page the person was on rather than as a step Back goes through. Returns what puts the
  // sidebar back as it was: the same panel, hidden, or Zen, with typing back in the selected
  // terminal. Returns nothing where the panel showed already. What it returns does nothing
  // once the panel is no longer the one that shows.
  readonly peek: (panel: SidebarPanel) => (() => void) | undefined
  readonly peekInbox: () => (() => void) | undefined
  readonly hideSidebar: () => void
  // Shows the panel, leaving Zen; when it already shows, goes back to the panel shown just
  // before it, or hides the sidebar when there is none. A panel in a window on the stage is
  // brought into view there instead (`revealPanel`).
  readonly toggleSidebar: (panel: SidebarPanel) => void
  // A rail toggle's press: as `toggleSidebar` for its panel, but the Terminals toggle opens
  // the view of the panel the person last saw, terminals or sessions, and goes back or hides
  // the sidebar from either.
  readonly toggleRail: (panel: RailPanel) => void
  // Switches the Terminals panel to a view, from the switch before its title. Chosen by the
  // keys, the switch keeps the focus; by a mouse, typing stays where the click leaves it.
  readonly switchTerminalsView: (view: TerminalsView, byKeys: boolean) => void
  readonly enterZen: () => void
  readonly exitZen: () => void
  // Frames every window the view shows, as Canvas's 0 key does; no change elsewhere.
  readonly frameAll: () => void
  // Asks Canvas to move keyboard focus to the terminal's node once it is selected.
  readonly requestCanvasFocus: (id: string) => void
  // Drops a Canvas focus request once it no longer matches what Canvas shows.
  readonly dropCanvasFocus: (request: number) => void
  readonly setKeyboardFocus: (focus: KeyboardFocus | null) => void
  readonly setFocusPreview: (preview: FocusPreview | null) => void
  readonly setNavigate: (navigate: boolean) => void
}

// Shell changes shared by the workspace commands.
type ShellEdits = {
  readonly change: (edit: (shell: ShellState) => ShellState) => void
  readonly set: <K extends keyof ShellState>(key: K, value: ShellState[K]) => void
  readonly pulse: (move?: NavigationMove) => void
}

export const shellEdits = ({ ui }: Pick<CommandContext, "ui">): ShellEdits => {
  const change = (edit: (shell: ShellState) => ShellState): void => updateShell(ui, edit)
  return {
    change,
    set: (key, value) =>
      change((shell) => (Object.is(shell[key], value) ? shell : { ...shell, [key]: value })),
    pulse: (move) => change((shell) => bumpNavigation(shell, move)),
  }
}

export const createShellCommands = (ctx: CommandContext): ShellCommands => {
  const { ui, workspace, navigation, effects } = ctx
  const { change, set, pulse } = shellEdits(ctx)
  const panel = (): SidebarPanel => ui.getSnapshot().location.route.panel
  let canvasFocusRequest = 0
  const reveal = panelRevealer(ctx)
  const hide = (): void => {
    change(hideSidebar)
    if (effects.desktop()) effects.focusSidebarToggle(panel())
  }
  const show = (next: SidebarPanel, replace = false): void => {
    if (inWindow(ctx, next)) return reveal(railPanelOf(next))
    const { shell: before } = ui.getSnapshot()
    const inZen = Boolean(before.zen)
    // Switching from an open panel remembers it, for the new panel's toggle to go back to; a
    // sidebar opening remembers none, and showing the open panel again, or another view of it
    // under the same rail toggle, keeps what it had.
    const current = panel()
    const back = !sidebarVisible(before, effects.desktop())
      ? null
      : railPanelOf(current) === railPanelOf(next)
        ? before.sidebarBack
        : { on: next, to: current }
    change((shell) => ({ ...shell, zen: null, sidebarBack: back }))
    navigation.go({ panel: next }, replace)
    change(showPanel)
    // The Zen dock the person pressed is gone; focus follows to the rail.
    if (inZen && effects.desktop())
      effects.afterFrame(() => effects.focusSidebarToggleStranded(next))
  }
  const peek = (shown: SidebarPanel): (() => void) | undefined => {
    const desktop = effects.desktop()
    const { location, shell } = ui.getSnapshot()
    if (location.route.panel === shown && sidebarVisible(shell, desktop)) return undefined
    const was = location.route.panel
    const { sidebar, sidebarCollapsed, sidebarBack, zen } = shell
    show(shown, true)
    return () => {
      const now = ui.getSnapshot()
      if (now.location.route.panel !== shown || !sidebarVisible(now.shell, effects.desktop()))
        return
      change((edited) => ({ ...edited, sidebar, sidebarCollapsed, sidebarBack, zen }))
      navigation.go({ panel: was }, true)
      if (!effects.desktop()) return
      effects.afterFrame(() => {
        const { selected } = currentState(workspace.getSnapshot())
        if (selected) effects.focusTerminalInput(selected)
      })
    }
  }
  const toggleSidebar = (next: SidebarPanel): void => {
    if (inWindow(ctx, next)) return reveal(railPanelOf(next))
    // Visibility before this command: a panel hidden by Zen shows instead of hiding.
    const { shell } = ui.getSnapshot()
    const visible = sidebarVisible(shell, effects.desktop())
    // The open panel's toggle goes back one step, to the panel the person was on before it,
    // so a look at the Inbox or History returns to where they were; back there, or with no
    // step to go back, it hides the sidebar.
    const back = stepBack(shell.sidebarBack, next)
    // A step back to a panel now in a window goes nowhere: the sidebar hides instead.
    const backTo = back && !inWindow(ctx, back) ? back : null
    if (panel() !== next || !visible) show(next)
    else if (backTo) {
      change((edited) => ({ ...edited, sidebarBack: null }))
      navigation.go({ panel: backTo })
    } else hide()
  }
  return {
    ...createPanelCommands(ctx, { show, reveal }),
    frameAll: () => pulse("fit-all"),
    showSessions: () => show("sessions"),
    showTerminals: () => show("terminals"),
    showInbox: () => show("inbox"),
    peek,
    peekInbox: () => peek("inbox"),
    hideSidebar: hide,
    toggleSidebar,
    toggleRail: (entry) => {
      const { shell } = ui.getSnapshot()
      const open = panel()
      if (sidebarVisible(shell, effects.desktop()) && railPanelOf(open) === entry)
        return toggleSidebar(open)
      show(entry === "terminals" ? shell.terminalsView : entry)
    },
    switchTerminalsView: (view, byKeys) => {
      if (panel() === view) return
      show(view)
      // The switch pressed is in the view that just hid; its twin in the one that shows takes
      // the focus, as the person's place.
      if (byKeys) effects.afterFrame(() => effects.focusTerminalsView(view))
    },
    enterZen: () => {
      if (ui.getSnapshot().shell.zen) return
      change((shell) => enterZen(shell, panel()))
      effects.afterFrame(effects.focusZenCreate)
    },
    exitZen: () => {
      const { zen } = ui.getSnapshot().shell
      if (!zen) return
      change(exitZen)
      navigation.go({ panel: zen.panel })
      effects.afterFrame(effects.focusZenEnter)
    },
    requestCanvasFocus: (id) =>
      set("canvasKeyboardFocus", {
        context: currentContext(workspace.getSnapshot()),
        id,
        request: ++canvasFocusRequest,
      }),
    dropCanvasFocus: (request) =>
      change((shell) =>
        shell.canvasKeyboardFocus?.request === request
          ? { ...shell, canvasKeyboardFocus: null }
          : shell,
      ),
    setKeyboardFocus: (focus) => set("keyboardFocus", focus),
    setFocusPreview: (preview) => set("focusPreview", preview),
    setNavigate: (navigate) => set("navigate", navigate),
  }
}
