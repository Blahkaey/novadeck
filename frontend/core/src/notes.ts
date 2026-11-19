import { asLine } from "@novadeck/protocol/text"

import type { AgentName } from "./harnesses"
import type { Store } from "./store"

// Notes: a project's own list of what the person means to do and wants to remember, kept by
// the backend with the project. Each is one line of text with an optional longer body in
// Markdown. A todo has a checkbox, and is open until the person checks it off; a plain note
// has none, and is never done. The todos are the cards of the project's Todo board: To do,
// In progress (an open todo the person is doing now) and Done, each column's cards in the
// order the notes stand. A backend that keeps them reports every project's (`state`) and
// takes each change at once, so the list shows it before the backend has saved it. An agent
// adds one only when the person asks it to, and the note then names it (`by`).

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
  // True on an open todo the person has in progress; absent on every other note.
  readonly doing?: boolean | undefined
  // When the person checked it off, in milliseconds since the epoch; null while it is open,
  // and always on a plain note.
  readonly doneAt: number | null
  readonly createdAt: number
  // The agent that added it; none on a note the person wrote. No change of theirs alters it.
  readonly by?: NoteAuthor | undefined
}

// The columns of a project's Todo board, in the order it shows them.
export const boardColumns = ["todo", "doing", "done"] as const

export type BoardColumn = (typeof boardColumns)[number]

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
  // Moves an open note to `index` among its project's open notes, as `openNotes` lists them:
  // how a plain note is put in order where the backend can't `place` one.
  readonly move: (id: string, index: number) => void
  // Puts a note in its place, as `placed` does: a todo into `column` of the board, a plain
  // note (column null) among the plain notes, before the note `before` or, for null, last.
  // Absent where the backend can't, as a runner from before the Todo board: its cards then
  // change column only as they are checked off or opened again.
  readonly place?:
    | ((id: string, column: BoardColumn | null, before: string | null) => void)
    | undefined
  // Deletes notes for good.
  readonly remove: (ids: readonly string[]) => void
}

const done = (note: Note): boolean => note.doneAt !== null

// A project's notes that are not checked off, in the person's order.
export const openNotes = (notes: readonly Note[], projectId: string): Note[] =>
  notes.filter((note) => note.projectId === projectId && !done(note))

// The board column a note stands in; null for a plain note, which is on no board.
export const noteColumn = (note: Note): BoardColumn | null => {
  if (!note.todo) return null
  if (done(note)) return "done"
  return note.doing ? "doing" : "todo"
}

// Whether `note` is one of the project's in `column`, or a plain note of it for null.
const isIn =
  (projectId: string, column: BoardColumn | null) =>
  (note: Note): boolean =>
    note.projectId === projectId && noteColumn(note) === column

// A project's cards in a column of its Todo board, in the person's order.
export const boardCards = (
  notes: readonly Note[],
  projectId: string,
  column: BoardColumn,
): Note[] => notes.filter(isIn(projectId, column))

// A project's plain notes, in the person's order.
export const plainNotes = (notes: readonly Note[], projectId: string): Note[] =>
  notes.filter(isIn(projectId, null))

// How many of a project's todos are still to do, those in progress among them: what its
// panel and its rail toggle count. A plain note is nothing to do.
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

// `note` done at `doneAt` (null while open) and in progress where `doing`, which is written
// only where true. The same note where that is what it was.
const withState = (note: Note, doneAt: number | null, doing: boolean): Note => {
  if (doneAt === note.doneAt && doing === (note.doing === true)) return note
  const { doing: _, ...rest } = note
  return { ...rest, doneAt, ...(doing && { doing }) }
}

// The column a change put a note first in: Done once it is checked off, To do once it is
// opened again; none for any other change.
const enteredColumn = (from: BoardColumn | null, to: BoardColumn | null): BoardColumn | null =>
  from !== to && (to === "done" || (from === "done" && to === "todo")) ? to : null

// With `note` just before the first other note of its project in `column`; where it has none,
// where it was.
const firstIn = (notes: readonly Note[], note: Note, column: BoardColumn): readonly Note[] => {
  const rest = notes.filter((each) => each !== note)
  const first = rest.findIndex(isIn(note.projectId, column))
  return first === -1 ? notes : rest.toSpliced(first, 0, note)
}

// With the note `id` changed, checked off or opened at `now`. Checked off, a todo goes first
// in Done; opened again, first in To do; either, or taking its checkbox away, takes it out of
// In progress. Any other change leaves it where it stands. Words that would leave its line
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
  const state = withState(before, doneAt, todo && doneAt === null && before.doing === true)
  if (text === before.text && body === before.body && todo === before.todo && state === before)
    return notes
  const after: Note = { ...state, text, body, todo }
  const replaced = notes.map((note) => (note === before ? after : note))
  const entered = enteredColumn(noteColumn(before), noteColumn(after))
  return entered ? firstIn(replaced, after, entered) : replaced
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

// With the note `id` in its place, as of `now`. A todo goes into `column` and takes its state:
// Done from `now` unless it already was, In progress only in `doing`; a plain note takes no
// column (null), and a column given a plain note, or none a todo, changes nothing. It stands
// just before `before` where that is another note of its project in the same column (or
// another plain note), else after the last of them, or where it was when there is none; no
// other note moves. An unknown note, or one already in its place, leaves the notes as they are.
export const placed = (
  notes: readonly Note[],
  id: string,
  column: BoardColumn | null,
  before: string | null,
  now: number,
): readonly Note[] => {
  const note = notes.find((each) => each.id === id)
  if (!note || note.todo !== (column !== null)) return notes
  const after =
    column === null
      ? note
      : withState(note, column === "done" ? (note.doneAt ?? now) : null, column === "doing")
  const rest = notes.filter((each) => each !== note)
  const ofPlace = isIn(note.projectId, column)
  const anchor = rest.findIndex((each) => each.id === before && ofPlace(each))
  const last = rest.findLastIndex(ofPlace)
  const at = anchor !== -1 ? anchor : last !== -1 ? last + 1 : notes.indexOf(note)
  const next = rest.toSpliced(at, 0, after)
  return next.every((each, index) => each === notes[index]) ? notes : next
}

// The index among the open notes of `projectId`, as `move` takes it, that puts its plain note
// `id` where `placed` would: just before the plain note `before`, or after the last plain note
// for null.
export const plainIndex = (
  notes: readonly Note[],
  projectId: string,
  id: string,
  before: string | null,
): number => {
  const rest = openNotes(notes, projectId).filter((each) => each.id !== id)
  const anchor = rest.findIndex((each) => each.id === before && !each.todo)
  return anchor !== -1 ? anchor : rest.findLastIndex((each) => !each.todo) + 1
}

// Without the notes `ids`.
export const removed = (notes: readonly Note[], ids: readonly string[]): readonly Note[] => {
  const gone = new Set(ids)
  return notes.some((note) => gone.has(note.id))
    ? notes.filter((note) => !gone.has(note.id))
    : notes
}
