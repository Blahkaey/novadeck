import type { DemoTour } from "@novadeck/demo/tour"

import type { DemoActionGroup } from "./types"

const screens = {
  startup: { label: "folder trust", what: "its folder-trust screen" },
  "sign-in": { label: "sign-in", what: "its sign-in screen" },
  hooks: { label: "hooks", what: "its prompt with Novadeck's hooks off" },
} as const

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
      ...(["startup", "sign-in", "hooks"] as const).map((screen) => ({
        label: `Tour agent: hold at ${screens[screen].label}`,
        hint: `The next tour agent waits at ${screens[screen].what} before Novadeck reaches it: its terminal shows the held-agent mark until "Answer the startup screen"`,
        run: () => tour.holdAt(screen),
      })),
      {
        label: "Answer the startup screen",
        hint: 'The tour agent held at a startup screen goes on: it binds, works, names its terminal "Tour lead" and finishes its turn',
        run: () => tour.answer(),
      },
      {
        label: "Tour agent: quiet until nudged",
        hint: "The next tour agent binds but sits idle at its prompt, no turn begun, until the tour nudges it (the UI does after its wait); then it works and names its terminal",
        run: () => tour.goQuiet(),
      },
    ],
  },
]
