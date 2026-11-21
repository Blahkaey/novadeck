import type { RailPanel } from "@novadeck/core/types"

import type { DemoActionGroup } from "./types"

// The panels "Panels in windows" opens on the stage: every one that opens there from its header.
export const windowPanels: readonly RailPanel[] = ["notes", "todo", "history", "files"]

// The panel's group for sidebar panels in windows on the stage, which their headers' buttons open
// one at a time: here several at once, beside the session's terminals; and for a window of a
// panel's own that a browser refuses, which its window's header opens from the person's click.
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
      {
        label: "Next own window is blocked",
        hint: "The next \"Open in its own window\" a panel's window offers opens nothing, as a popup blocker would: a toast says Novadeck couldn't open a window for it, and the panel stays in its window on the stage",
        run: ({ refuseNextWindow, note }) => {
          refuseNextWindow()
          note("The next window of a panel's own is refused.")
        },
      },
    ],
  },
]
