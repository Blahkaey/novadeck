import { asLine } from "@novadeck/protocol/text"

import type { AgentName } from "./harnesses"
import type { Store } from "./store"

// Notes: a project's own list of what the person means to do and wants to remember, kept by
// the backend with the project. Each is one line of text with an optional longer body in
// Markdown. A todo has a checkbox, and is open until the person checks it off; a plain note
// has none, and is never done. A backend that keeps them reports every project's (`state`)
// and takes each change at once, so the list shows it before the backend has saved it. An
// agent adds one only when the person asks it to, and the note then names it (`by`).

// How long a note's line and body run at most, in UTF-16 code units, and how many notes a
// project keeps: the runner's own limits (`noteLimits` in the protocol), which the fields
// hold the person to.
export const noteLimits = { text: 500, body: 8000, perProject: 200 } as const

// The agent that added a note: its harness, and its terminal's handle when it did.
export type NoteAuthor = {
  readonly agent: AgentName
  readonly handle: string
}

export type Note = {
  readonly id: string
  readonly projectId: string
  // What it says, on one line.
  readonly text: string
  // More under it, as Markdown; empty where there is none.
  readonly body: string
  // Whether it has a checkbox.
  readonly todo: boolean
  // When the person checked it off, in milliseconds since the epoch; null while it is open,
  // and always on a plain note.
  readonly doneAt: number | null
  readonly createdAt: number
  // The agent that added it; none on a note the person wrote. No change of theirs alters it.
  readonly by?: NoteAuthor | undefined
}

export type NotesState = {
  // Every project's notes, each project's in the person's order.
  readonly notes: readonly Note[]
  // Whether the person's last change didn't take, until one does. The notes are then as the
  // backend has them.
  readonly failed: boolean
}

export const noNotes: NotesState = { notes: [], failed: false }

// What the person changes of a note: its words, whether it has a checkbox, and whether it is
// checked off. A plain note is never done, so taking the checkbox away opens it again.
export type NoteChange = {
  readonly text?: string
  readonly body?: string
  readonly todo?: boolean
  readonly done?: boolean
}

export type Notes = {
  readonly state: Store<NotesState>
  // Adds a note with these words first in the project's list. Words that are only white
  // space add nothing, and neither does a project that is full (`noteLimits.perProject`).
  readonly add: (projectId: string, note: { readonly text: string; readonly todo: boolean }) => void
  // Changes a note; one the backend doesn't have is left alone.
  readonly change: (id: string, change: NoteChange) => void
  // Moves an open note to `index` among its project's open notes, as `openNotes` lists them.
  readonly move: (id: string, index: number) => void
  // Deletes notes for good.
  readonly remove: (ids: readonly string[]) => void
}

const done = (note: Note): boolean => note.doneAt !== null

// A project's notes that are not checked off, in the person's order.
export const openNotes = (notes: readonly Note[], projectId: string): Note[] =>
  notes.filter((note) => note.projectId === projectId && !done(note))

// A project's todos that are checked off, the one checked last first.
export const doneNotes = (notes: readonly Note[], projectId: string): Note[] =>
  notes
    .filter((note) => note.projectId === projectId && done(note))
    .toSorted((a, b) => b.doneAt! - a.doneAt!)

// How many of a project's todos are still to do: what its panel and its rail toggle count.
// A plain note is nothing to do.
export const todosLeft = (notes: readonly Note[], projectId: string): number =>
  openNotes(notes, projectId).filter((note) => note.todo).length

// A note's line as it is kept: on one line, without what one line may not hold (the protocol's
// `asLine`), with no white space around it, and cut to its limit, never through a character.
export const noteLine = (text: string): string =>
  asLine(text.replaceAll(/\s*[\r\n]+\s*/g, " "))
    .slice(0, noteLimits.text)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd()

// The transitions below are what a change makes of the notes, as every backend applies it:
// the demo keeps what they return, and the runner's adapter shows it until the runner, which
// applies the same rules, lists the notes again.

// With `note` first among its project's notes. One with nothing to say, an id already there,
// or a project already full changes nothing.
export const added = (notes: readonly Note[], note: Note): readonly Note[] => {
  const mine = notes.filter((each) => each.projectId === note.projectId)
  if (note.text === "" || mine.length >= noteLimits.perProject) return notes
  if (notes.some((each) => each.id === note.id)) return notes
  return [note, ...notes]
}

// With the note `id` changed, checked off or opened at `now`. Words that would leave its line
// empty are not taken: a note always says something. An agent's note still names its agent.
export const changed = (
  notes: readonly Note[],
  id: string,
  change: NoteChange,
  now: number,
): readonly Note[] => {
  const before = notes.find((note) => note.id === id)
  if (!before) return notes
  const text = change.text === undefined ? before.text : noteLine(change.text) || before.text
  const body =
    change.body === undefined ? before.body : change.body.slice(0, noteLimits.body).trimEnd()
  const todo = change.todo ?? before.todo
  const checked = change.done ?? done(before)
  const doneAt = todo && checked ? (before.doneAt ?? now) : null
  if (
    text === before.text &&
    body === before.body &&
    todo === before.todo &&
    doneAt === before.doneAt
  )
    return notes
  const after: Note = { ...before, text, body, todo, doneAt }
  return notes.map((note) => (note === before ? after : note))
}

// With the open note `id` at `index` among its project's open notes, within their ends. The
// done ones, and every other project's, keep their places.
export const moved = (notes: readonly Note[], id: string, index: number): readonly Note[] => {
  const note = notes.find((each) => each.id === id)
  if (!note || done(note)) return notes
  const open = openNotes(notes, note.projectId)
  const from = open.indexOf(note)
  const to = Math.max(0, Math.min(open.length - 1, index))
  if (from === to) return notes
  const order = open.toSpliced(from, 1).toSpliced(to, 0, note)
  let next = 0
  return notes.map((each) =>
    each.projectId === note.projectId && !done(each) ? order[next++]! : each,
  )
}

// Without the notes `ids`.
export const removed = (notes: readonly Note[], ids: readonly string[]): readonly Note[] => {
  const gone = new Set(ids)
  return notes.some((note) => gone.has(note.id))
    ? notes.filter((note) => !gone.has(note.id))
    : notes
}
