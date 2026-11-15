import type { DemoTour } from "@novadeck/demo/tour"

import type { DemoActionGroup } from "./types"

// Novadeck's tour: its consent, as the welcome dialog, Preferences' About or the desktop app's
// Help menu offers it, and a start the backend refuses.
export const tourGroups = (tour: DemoTour): readonly DemoActionGroup[] => [
  {
    section: "App",
    title: "Tour",
    actions: [
      {
        label: "Offer the tour",
        hint: "Takes the hold off the tour (welcome dialog and Preferences' About offer it), then opens its consent on the first connected agent, as the macOS Help menu will",
        run: () => {
          tour.offered.update(() => true)
          tour.ask()
        },
      },
      {
        label: "Hold the tour back",
        hint: "The tour is offered nowhere again, as in every real build until its story is whole",
        run: () => tour.offered.update(() => false),
      },
      {
        label: "Fail next start",
        hint: "The next Start the tour shows why it can't start (a folder of yours at ~/.novadeck/tour); the consent stays open",
        run: () => tour.failNext(),
      },
      {
        label: "Next start: models unlisted",
        hint: "The next Start the tour says the agent hasn't listed its models yet (Codex before it signs in), with a Start button that opens it in a terminal",
        run: () => tour.failNext("unlisted"),
      },
    ],
  },
]
