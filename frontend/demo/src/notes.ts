import {
  added,
  changed,
  moved,
  noteLine,
  placed,
  removed,
  type Note,
  type NoteAuthor,
  type Notes,
  type NotesState,
} from "@novadeck/core/notes"
import type { Backend } from "@novadeck/core/port"
import { createStore } from "@novadeck/core/store"

// The demo's notes: a list the storefront project starts with, one of each kind a note can be,
// and what the person makes of it here. It stands in for the runner, which keeps the notes
// and applies the same rules to each change (core's `notes`).

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

type Sample = {
  readonly text: string
  readonly body?: string
  // A plain note where false: it has no checkbox.
  readonly todo?: boolean
  // An open todo the person has in progress, on the board's In progress column.
  readonly doing?: boolean
  // How long ago it was written and, for one checked off, how long ago that was.
  readonly ago: number
  readonly doneAgo?: number
  // The agent that added it, as the person asked it to.
  readonly by?: NoteAuthor
}

// The storefront's notes, in the person's order: todos still to do, one with more under its
// line that is in progress and one that Codex added as @pike (History's Tax rounding, closed
// since), two plain notes, and two checked off, so each column of the Todo board has cards and
// the Notes panel has notes to put in order.
const storefront: readonly Sample[] = [
  { text: "Ask @wren to cover expired coupon codes", ago: 25 * minute },
  {
    text: "Check the cart total on a slow connection",
    body: [
      "It flickered between two totals on the train.",
      "",
      "- throttle to **Slow 4G** and add three items",
      "- watch `CartSummary` while the prices load",
    ].join("\n"),
    doing: true,
    ago: 3 * hour,
  },
  { text: "Reply to the design review about the empty cart", ago: 5 * hour },
  {
    text: "Staging deploys from the release branch",
    body: "Pushing to `release` deploys in about four minutes. `main` goes nowhere by itself.",
    todo: false,
    ago: 2 * day,
  },
  {
    text: "Move the price formatter into the shared package",
    ago: 2 * hour,
    by: { agent: "codex", handle: "pike" },
  },
  { text: "Coupon codes reset on the demo store every night", todo: false, ago: 4 * day },
  { text: "Rename the checkout route", ago: day, doneAgo: 2 * hour },
  { text: "Update the screenshots in the README", ago: 3 * day, doneAgo: day },
]

const notesOf = (projectId: string, samples: readonly Sample[], now: number): Note[] =>
  samples.map((sample, index) => ({
    id: `demo-note-${projectId}-${index + 1}`,
    projectId,
    text: sample.text,
    body: sample.body ?? "",
    todo: sample.todo ?? true,
    ...(sample.doing && { doing: true }),
    doneAt: sample.doneAgo === undefined ? null : now - sample.doneAgo,
    createdAt: now - sample.ago,
    ...(sample.by && { by: sample.by }),
  }))

/** The notes the storefront project starts with. */
export const demoNotes = (now: number): Note[] => notesOf("storefront", storefront, now)

export type DemoNotesControl = {
  // Replaces every project's notes with these, as the runner would report them.
  readonly set: (notes: readonly Note[]) => void
  // Makes the next change fail, as a runner that couldn't save it: the notes stay as they
  // are, and the state says the change didn't take.
  readonly failNext: () => void
}

// Whether a backend's notes are the demo's, which the debug panel changes.
export const isDemoNotes = (notes: Backend["notes"]): notes is Notes & DemoNotesControl =>
  notes !== undefined && "failNext" in notes

export const createDemoNotes = (
  now: number,
  withSamples = true,
  clock: () => number = Date.now,
): Notes & DemoNotesControl => {
  const state = createStore<NotesState>({
    notes: withSamples ? demoNotes(now) : [],
    failed: false,
  })
  let made = 0
  let fails = false
  // Applies a change, or fails it once where the panel asked for that. A change that changes
  // nothing is no change: it neither fails nor clears a failure.
  const change = (next: (notes: readonly Note[]) => readonly Note[]): void => {
    const before = state.getSnapshot()
    const notes = next(before.notes)
    if (notes === before.notes) return
    if (fails) {
      fails = false
      state.update((current) => ({ ...current, failed: true }))
      return
    }
    state.update(() => ({ notes, failed: false }))
  }
  return {
    state,
    add: (projectId, { text, todo }) =>
      change((notes) =>
        added(notes, {
          id: `demo-note-new-${(made += 1)}`,
          projectId,
          text: noteLine(text),
          body: "",
          todo,
          doneAt: null,
          createdAt: clock(),
        }),
      ),
    change: (id, what) => change((notes) => changed(notes, id, what, clock())),
    move: (id, index) => change((notes) => moved(notes, id, index)),
    place: (id, column, before) => change((notes) => placed(notes, id, column, before, clock())),
    remove: (ids) => change((notes) => removed(notes, ids)),
    set: (notes) => state.update(() => ({ notes, failed: false })),
    failNext: () => {
      fails = true
    },
  }
}

// A backend that keeps the person's notes, with the demo's samples.
export const withNotes = (
  backend: Backend,
  notes: Notes = createDemoNotes(Date.now()),
): Backend => ({
  ...backend,
  notes,
})
