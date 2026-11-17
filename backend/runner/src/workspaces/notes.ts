import {
  note,
  noteAuthor,
  noteLimits,
  type Note,
  type NoteAuthor,
  type NotesChange,
} from "@novadeck/protocol"
import { KeyedChanges } from "@novadeck/wire/server"
import { z } from "zod"

import { DomainError } from "../errors.js"
import { logs } from "../log.js"

const log = logs.for("notes")

// The person's own notes on each project: todos, which they check off, and plain notes, in
// their order. A project's notes are kept whole, as one text, and read afresh for each call,
// so nothing here holds them: a removed project's go with its row.

/** What `Notes` keeps a project's notes with. */
export type NoteRecords = {
  /** Each project's notes as `saveNotes` kept them, by project id. */
  savedNotes(): ReadonlyMap<string, string>
  /** A project's notes as `saveNotes` kept them; undefined where it has none. */
  savedNotesOf(projectId: string): string | undefined
  /** Keeps a project's notes, or none for null; NOT_FOUND for a project it doesn't have. */
  saveNotes(projectId: string, notes: string | null): void
  /** NOT_FOUND for a project it doesn't have. */
  project(projectId: string): unknown
}

/** Records in memory, of the projects given, for tests. */
export const memoryNotes = (projects: readonly string[]): NoteRecords => {
  const kept = new Map<string, string>()
  const known = (projectId: string): void => {
    if (!projects.includes(projectId)) throw new DomainError("NOT_FOUND", "Project not found")
  }
  return {
    savedNotes: () => kept,
    savedNotesOf: (projectId) => kept.get(projectId),
    saveNotes: (projectId, notes) => {
      known(projectId)
      if (notes === null) kept.delete(projectId)
      else kept.set(projectId, notes)
    },
    project: known,
  }
}

// A project's notes as they are kept: in the person's order, each without its project's id,
// which the row it is kept in names. A field this build doesn't know, as a later one writes,
// is dropped rather than leave the row unreadable, so the person's notes stay; so is a `by`
// it can't read, as one naming a harness it doesn't know, the note kept without its mark.
const kept = z.array(
  z.object({
    ...note.omit({ projectId: true, by: true }).shape,
    by: z.object(noteAuthor.shape).optional().catch(undefined),
  }),
)

/** A note to add: its id, its line, whether it is a todo, and more under it (none if omitted). */
export type NewNote = {
  readonly id: string
  readonly text: string
  readonly todo: boolean
  readonly body?: string | undefined
}

/** What a change gives of a note; what is left out stays as it is. */
export type NoteUpdate = {
  readonly projectId: string
  readonly id: string
  readonly text?: string | undefined
  readonly body?: string | undefined
  readonly todo?: boolean | undefined
  readonly done?: boolean | undefined
}

export class Notes {
  private readonly watchers = new Set<KeyedChanges<string, NotesChange>>()
  private closed = false

  constructor(
    private readonly records: NoteRecords,
    private readonly now: () => number = Date.now,
  ) {}

  /** A project's notes, in the person's order; NOT_FOUND for a project the runner doesn't have. */
  list(projectId: string): Note[] {
    this.records.project(projectId)
    return this.read(projectId, this.records.savedNotesOf(projectId))
  }

  /**
   * Each project's notes, for every project that has any, then `synced`, then a project's
   * notes whole each time they change, until `signal` aborts or the runner closes.
   */
  async *watch(signal?: AbortSignal): AsyncGenerator<NotesChange> {
    if (this.closed) throw new DomainError("CLOSING")
    const current = [...this.records.savedNotes()].flatMap(([projectId, saved]) => {
      const notes = this.read(projectId, saved)
      return notes.length > 0 ? [[projectId, changeOf(projectId, notes)] as const] : []
    })
    const watcher = new KeyedChanges<string, NotesChange>(current, { type: "synced" })
    this.watchers.add(watcher)
    const abort = () => watcher.finish()
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) watcher.finish()
    try {
      while (true) {
        // eslint-disable-next-line no-await-in-loop -- Changes are delivered in order.
        const change = await watcher.next()
        if (change === undefined) return
        yield change
      }
    } finally {
      signal?.removeEventListener("abort", abort)
      watcher.finish()
      this.watchers.delete(watcher)
    }
  }

  /**
   * Adds notes first in their project's list, in the order given, open; a body keeps no
   * white space at its end. `by` names the agent that added them, as the person asked it to;
   * the person's own have none. An id the project already has, or gets twice, and more notes
   * than a project keeps, is a CONFLICT, and adds none of them.
   */
  add(input: {
    readonly projectId: string
    readonly notes: readonly NewNote[]
    readonly by?: NoteAuthor | undefined
  }): Note[] {
    const { projectId, by } = input
    const notes = this.list(projectId)
    const ids = new Set(notes.map(({ id }) => id))
    for (const { id } of input.notes) {
      if (ids.has(id))
        throw new DomainError("CONFLICT", "This project already has a note with that id.")
      ids.add(id)
    }
    if (notes.length + input.notes.length > noteLimits.perProject)
      throw new DomainError(
        "CONFLICT",
        `A project keeps at most ${noteLimits.perProject} notes. Delete some to add more.`,
      )
    const createdAt = this.now()
    const added = input.notes.map(({ id, text, todo, body = "" }): Note => ({
      id,
      projectId,
      text,
      body: body.trimEnd(),
      todo,
      doneAt: null,
      createdAt,
      ...(by && { by }),
    }))
    return this.write(projectId, [...added, ...notes])
  }

  /**
   * Changes what is given of a note. A todo checked off is done from now, unless it already
   * was; a plain note is never done, so taking the checkbox away opens it again. A body
   * keeps no white space at its end.
   */
  update({ projectId, id, ...change }: NoteUpdate): Note[] {
    const notes = this.list(projectId)
    const before = found(notes, id)
    const todo = change.todo ?? before.todo
    const done = change.done ?? before.doneAt !== null
    const after: Note = {
      ...before,
      text: change.text ?? before.text,
      body: change.body === undefined ? before.body : change.body.trimEnd(),
      todo,
      doneAt: todo && done ? (before.doneAt ?? this.now()) : null,
    }
    return this.write(
      projectId,
      notes.map((each) => (each === before ? after : each)),
    )
  }

  /**
   * Moves an open note to `index` among its project's open notes, within their ends; the
   * done ones keep their places. One that is checked off is a CONFLICT.
   */
  move(input: { readonly projectId: string; readonly id: string; readonly index: number }): Note[] {
    const notes = this.list(input.projectId)
    const moving = found(notes, input.id)
    if (moving.doneAt !== null)
      throw new DomainError("CONFLICT", "A note that is checked off has no place to move to.")
    const open = notes.filter((each) => each.doneAt === null)
    const order = open.filter((each) => each !== moving)
    order.splice(Math.max(0, Math.min(order.length, input.index)), 0, moving)
    let next = 0
    return this.write(
      input.projectId,
      notes.map((each) => (each.doneAt === null ? order[next++]! : each)),
    )
  }

  /** Deletes notes for good; an id the project doesn't have is skipped. */
  remove(input: { readonly projectId: string; readonly ids: readonly string[] }): Note[] {
    const notes = this.list(input.projectId)
    const gone = new Set(input.ids)
    return this.write(
      input.projectId,
      notes.filter(({ id }) => !gone.has(id)),
    )
  }

  /**
   * A project was removed, and its notes with it: watchers are told it has none. Nothing
   * is written, as the store took them with the project.
   */
  projectRemoved(projectId: string): void {
    for (const watcher of this.watchers) watcher.changed(projectId, changeOf(projectId, []))
  }

  /** Ends every watcher; nothing is read or written after. */
  close(): void {
    this.closed = true
    for (const watcher of this.watchers) watcher.finish()
  }

  // A project's notes as they were kept. Ones that can't be read are logged and count as none,
  // so the rest of the runner goes on; the next change of that project's notes replaces them.
  private read(projectId: string, saved: string | undefined): Note[] {
    if (saved === undefined) return []
    try {
      return kept.parse(JSON.parse(saved)).map((each) => ({ ...each, projectId }))
    } catch (error) {
      log.error("notes.read-failed", "Novadeck could not read a project's notes", {
        data: { projectId },
        err: error,
      })
      return []
    }
  }

  // Keeps the project's notes as they now are, and tells every watcher. The same notes as
  // before are neither saved nor told.
  private write(projectId: string, notes: Note[]): Note[] {
    if (this.closed) throw new DomainError("CLOSING")
    const text = notes.length === 0 ? null : JSON.stringify(notes.map(keptOf))
    if (text === (this.records.savedNotesOf(projectId) ?? null)) return notes
    this.records.saveNotes(projectId, text)
    for (const watcher of this.watchers) watcher.changed(projectId, changeOf(projectId, notes))
    return notes
  }
}

// A note as it is kept, its fields always in this order, so the same notes are the same text;
// `by` only where an agent added it, so the person's own notes keep the text they had.
const keptOf = ({
  id,
  text,
  body,
  todo,
  doneAt,
  createdAt,
  by,
}: Note): z.infer<typeof kept>[number] => ({
  id,
  text,
  body,
  todo,
  doneAt,
  createdAt,
  ...(by && { by: { agent: by.agent, handle: by.handle } }),
})

const changeOf = (projectId: string, notes: Note[]): NotesChange => ({
  type: "changed",
  projectId,
  notes,
})

const found = (notes: readonly Note[], id: string): Note => {
  const match = notes.find((each) => each.id === id)
  if (!match) throw new DomainError("NOT_FOUND", "Note not found")
  return match
}
