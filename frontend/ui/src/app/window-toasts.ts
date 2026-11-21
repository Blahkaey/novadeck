import { panelLabels, type RailPanel } from "@novadeck/core/types"

import type { RefusedBoard } from "../inbox/InboxToasts"
import type { UiStore } from "./ui-store"

// What the toast says of a panel's window of its own that couldn't open: a browser's popup
// blocker refuses one more often than anything else does.
export const refusedWords = (panel: RailPanel): string =>
  `Novadeck couldn't open a window for ${panelLabels[panel]} — your browser may have blocked it.`

// Tells each window of a panel's own that couldn't open on the board, as the person asks for it:
// a newer one replaces the toast of the last. Returns the stop.
export const watchRefusedWindows = (ui: UiStore, board: RefusedBoard): (() => void) => {
  let told = ui.getSnapshot().windowRefused
  return ui.subscribe(() => {
    const { windowRefused } = ui.getSnapshot()
    if (windowRefused === told) return
    told = windowRefused
    if (windowRefused)
      board.show({ id: windowRefused.id, words: refusedWords(windowRefused.panel) })
  })
}
