import { isAgentName } from "@novadeck/core/harnesses"
import { added, noteLimits, plainNotes, type Note, type NoteAuthor } from "@novadeck/core/notes"
import type { Backend } from "@novadeck/core/port"
import type { Workspace } from "@novadeck/core/types"
import { demoNotes, isDemoNotes } from "@novadeck/demo/notes"

import type { DemoActionGroup } from "./types"

// The panel's group for the states of the Notes panel and the Todo board that adding, checking
// off and moving by hand reach slowly or not at all: a change the backend doesn't save, a
// project that is full, a board with no cards, one with nothing left to do, a note long enough
// to wrap and scroll, and a todo an agent adds as the person asked it to. Each acts on the
// project on screen and leaves the others' notes alone.

const todo = (projectId: string, id: string, text: string, now: number): Note => ({
  id: `demo-note-${projectId}-${id}`,
  projectId,
  text,
  body: "",
  todo: true,
  doneAt: null,
  createdAt: now,
})

// What each of every four notes of a full project is: a plain note, then a todo in each of the
// board's columns.
const fullKinds: readonly { readonly word: string; readonly make: (note: Note) => Note }[] = [
  { word: "Note", make: (note) => ({ ...note, todo: false }) },
  { word: "Todo", make: (note) => note },
  { word: "Doing", make: (note) => ({ ...note, doing: true }) },
  { word: "Done", make: (note) => ({ ...note, doneAt: note.createdAt }) },
]

/** As many notes as a project keeps, so neither add field takes more: plain notes, and todos
 * in each column of the board. */
export const fullNotes = (projectId: string, now: number): Note[] =>
  Array.from({ length: noteLimits.perProject }, (_, index) => {
    const { word, make } = fullKinds[index % fullKinds.length]!
    return make(todo(projectId, `full-${index + 1}`, `${word} ${index + 1}`, now - index * 60_000))
  })

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
      title: "Notes and Todo",
      actions: [
        {
          label: "Next notes change fails",
          hint: "Add, check off, edit, move or delete a note in the Notes panel or a card on the Todo board: it stays where the backend has it, and a line above the list or the columns says the change wasn't saved, until the next change takes",
          run: () => notes.failNext(),
        },
        {
          label: "Sample notes",
          hint: "The open project's Notes panel holds the storefront's two plain notes, and its Todo board a card in every column: three in To do (one with Codex's mark, added by @pike), one with details In progress, and two in Done",
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
          hint: "The open project's Notes panel and Todo board are empty and say what they are for; the Todo toggle's tooltip counts nothing to do",
          run: ({ workspace }) => set(here(workspace), []),
        },
        {
          label: "No todos",
          hint: "The open project's Todo board is empty, its three columns with no cards, and says what it is for; the Notes panel keeps its plain notes",
          run: ({ workspace }) => {
            const projectId = here(workspace)
            set(projectId, plainNotes(notes.state.getSnapshot().notes, projectId))
          },
        },
        {
          label: "Every todo done",
          hint: "The Todo board's To do and In progress columns say they are empty, and Done holds six cards with its Clear button",
          run: ({ workspace }) => set(here(workspace), doneOnly(here(workspace), Date.now())),
        },
        {
          label: "Project full of notes",
          hint: `The open project holds the ${noteLimits.perProject} notes it keeps, plain notes and cards in every column of the Todo board; neither add field takes more, and a line under each says why`,
          run: ({ workspace }) => set(here(workspace), fullNotes(here(workspace), Date.now())),
        },
        {
          label: "A long note",
          hint: "A card in To do whose line is as long as one can be wraps; open its details for a heading, a list, code and a link that scroll with the board",
          run: ({ workspace }) => set(here(workspace), longNotes(here(workspace), Date.now())),
        },
        {
          label: "An agent adds a todo",
          hint: "A card stands first in To do on the open project's Todo board with its agent's icon at the end of its line, whose tooltip names the agent: the first running in the session on screen, or Claude Code's @wren where none runs",
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
