import type { RailPanel } from "@novadeck/core/types"

import type { DemoActionGroup } from "./types"

// The panels "Panels in windows" opens on the stage: every one of the rail, Files last, which keeps
// the keyboard and stays selected.
export const windowPanels: readonly RailPanel[] = [
  "terminals",
  "inbox",
  "worktrees",
  "notes",
  "todo",
  "history",
  "files",
]

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
        hint: "Every panel of the rail (Terminals, the Inbox, Worktrees where it shows, Notes, Todo, History and Files) opens as a window beside the session's terminals, Files selected, each listed in the Terminals window with its own icon, the Terminals window too; their rail toggles stay in place with a small window mark, and with none left in it the sidebar hides",
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
