import { isAgentName } from "@novadeck/core/harnesses"
import { added, noteLimits, type Note, type NoteAuthor } from "@novadeck/core/notes"
import type { Backend } from "@novadeck/core/port"
import type { Workspace } from "@novadeck/core/types"
import { demoNotes, isDemoNotes } from "@novadeck/demo/notes"

import type { DemoActionGroup } from "./types"

// The panel's group for the Notes panel's states that adding and checking off by hand reach
// slowly or not at all: a change the backend doesn't save, a project that is full, one with
// nothing left to do, a note long enough to wrap and scroll, and a todo an agent adds as the
// person asked it to. Each acts on the project on screen and leaves the others' notes alone.

const todo = (projectId: string, id: string, text: string, now: number): Note => ({
  id: `demo-note-${projectId}-${id}`,
  projectId,
  text,
  body: "",
  todo: true,
  doneAt: null,
  createdAt: now,
})

/** As many todos as a project keeps, so the add field takes no more. */
export const fullNotes = (projectId: string, now: number): Note[] =>
  Array.from({ length: noteLimits.perProject }, (_, index) =>
    todo(projectId, `full-${index + 1}`, `Todo ${index + 1}`, now - index * 60_000),
  )

/** Only todos that are checked off, the one checked last first; none of them in progress. */
export const doneOnly = (projectId: string, now: number): Note[] =>
  demoNotes(now)
    .filter((note) => note.todo)
    .map((sample, index) => {
      const { doing: _, ...note } = sample
      return {
        ...note,
        id: `demo-note-${projectId}-done-${index + 1}`,
        projectId,
        doneAt: note.doneAt ?? now - (index + 1) * 60 * 60_000,
      }
    })

/** One todo with a line at its longest and details that scroll, over a short one. */
export const longNotes = (projectId: string, now: number): Note[] => [
  {
    ...todo(
      projectId,
      "long",
      "Rework the checkout summary so the totals, discounts and shipping estimate stay readable on a narrow screen "
        .repeat(8)
        .trim()
        .slice(0, noteLimits.text),
      now,
    ),
    body: [
      "## Why",
      "",
      "The summary wraps badly under 360px, and the **total** drops below the fold.",
      "",
      "1. Measure the summary at 320, 360 and 414px.",
      "2. Move the discount line under the subtotal.",
      "3. Keep `CartSummary` and `OrderSummary` on one layout.",
      "",
      "```ts",
      "const total = subtotal - discount + shipping",
      "```",
      "",
      "See https://example.com/design/checkout-summary for the mock-ups.",
      "",
      ...Array.from({ length: 12 }, (_, index) => `- Step ${index + 1} of the roll-out`),
    ].join("\n"),
  },
  todo(projectId, "short", "Ship it", now - 60_000),
]

// Who adds the panel's agent todo where no agent runs on screen: Claude Code as @wren, the
// storefront's Coupon codes agent in History.
const historyAgent: NoteAuthor = { agent: "claude", handle: "wren" }

/** The first agent running in the session on screen, by its terminal's handle; else @wren. */
export const agentOnScreen = (workspace: Workspace | undefined): NoteAuthor => {
  const project = workspace?.projects.find(({ id }) => id === workspace.activeProjectId)
  const session = project?.history.find(({ id }) => id === project.activeSessionId)
  const [running] = (session?.state.roster.terminals ?? []).flatMap((terminal) =>
    terminal.state === "running" && terminal.handle && isAgentName(terminal.process)
      ? [{ agent: terminal.process, handle: terminal.handle }]
      : [],
  )
  return running ?? historyAgent
}

/** A todo `by` added, as the person asked it to. */
export const agentTodo = (projectId: string, by: NoteAuthor, id: string, now: number): Note => ({
  ...todo(projectId, id, "Revisit the retry logic before the release", now),
  by,
})

// The project on screen; the storefront before a workspace is committed.
const here = (workspace: () => { readonly activeProjectId: string } | undefined): string =>
  workspace()?.activeProjectId ?? "storefront"

export const notesGroups = (notes: Backend["notes"]): readonly DemoActionGroup[] => {
  if (!isDemoNotes(notes)) return []
  // The open project's notes become `mine`; every other project's stay.
  const set = (projectId: string, mine: readonly Note[]): void =>
    notes.set([
      ...notes.state.getSnapshot().notes.filter((note) => note.projectId !== projectId),
      ...mine,
    ])
  // The agents' todos added so far, each under an id of its own.
  let made = 0
  return [
    {
      section: "App",
      title: "Notes",
      actions: [
        {
          label: "Next notes change fails",
          hint: "Add, check off, edit, move or delete a note in the Notes panel: it stays as it was, and a line above the list says the change wasn't saved, until the next change takes",
          run: () => notes.failNext(),
        },
        {
          label: "Sample notes",
          hint: "The open project's Notes panel holds the storefront's samples: four todos, one with details that is in progress and one with Codex's mark (added by @pike), a plain note, and two under Done",
          run: ({ workspace }) => {
            const projectId = here(workspace)
            set(
              projectId,
              demoNotes(Date.now()).map((note, index) => ({
                ...note,
                id: `demo-note-${projectId}-${index + 1}`,
                projectId,
              })),
            )
          },
        },
        {
          label: "No notes",
          hint: "The open project's Notes panel is empty and says what it is for; its rail toggle's tooltip counts nothing to do",
          run: ({ workspace }) => set(here(workspace), []),
        },
        {
          label: "Every todo done",
          hint: "The Notes panel says nothing is left to do, over a Done group of six with its Clear button",
          run: ({ workspace }) => set(here(workspace), doneOnly(here(workspace), Date.now())),
        },
        {
          label: "Project full of notes",
          hint: `The Notes panel lists ${noteLimits.perProject} todos, its add field takes no more, and a line under it says why`,
          run: ({ workspace }) => set(here(workspace), fullNotes(here(workspace), Date.now())),
        },
        {
          label: "A long note",
          hint: "A todo whose line is as long as one can be wraps in its row; open its details for a heading, a list, code and a link that scroll with the panel",
          run: ({ workspace }) => set(here(workspace), longNotes(here(workspace), Date.now())),
        },
        {
          label: "An agent adds a todo",
          hint: "A todo stands first in the open project's Notes panel with its agent's icon at the end of its line, whose tooltip names the agent: the first running in the session on screen, or Claude Code's @wren where none runs",
          run: ({ workspace }) => {
            const by = agentOnScreen(workspace())
            const theirs = agentTodo(here(workspace), by, `agent-${(made += 1)}`, Date.now())
            notes.set(added(notes.state.getSnapshot().notes, theirs))
          },
        },
      ],
    },
  ]
}
