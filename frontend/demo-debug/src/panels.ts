import type { RailPanel } from "@novadeck/core/types"

import type { DemoActionGroup } from "./types"

// The panels "Panels in windows" opens on the stage: every one that opens there from its header.
export const windowPanels: readonly RailPanel[] = ["notes", "todo", "history", "files"]

// The panel's group for sidebar panels in windows on the stage, which their headers' buttons open
// one at a time: here several at once, beside the session's terminals.
export const panelGroups: readonly DemoActionGroup[] = [
  {
    section: "Terminals",
    title: "Panel windows",
    actions: [
      {
        label: "Panels in windows",
        hint: "Notes, Todo, History and Files open as windows beside the session's terminals, Files selected, each listed in the Terminals panel with its own icon; their rail toggles stay in place with a small window mark, and the sidebar moves to the first panel left in it",
        run: ({ openPanels }) => openPanels(windowPanels),
      },
    ],
  },
]
