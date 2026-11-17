import {
  added,
  changed,
  moved,
  noNotes,
  noteLine,
  removed,
  type Note,
  type NoteChange,
  type Notes,
  type NotesState,
} from "@novadeck/core/notes"
import { createStore } from "@novadeck/core/store"
import type { Runner } from "@novadeck/runner-client"

import { consume } from "./streams"

// The runner's notes: every project's as `notes.watch` reports them, and the person's changes
// shown at once, over what the runner last said, until it answers each. Its answer is the
// project's notes as the change left them, so a change that took never shows twice; one that
// didn't leaves the notes as the runner has them, and the state says so.

export type RunnerNotes = {
  readonly notes: Notes
  // Follows the notes; once started it goes on across reconnections.
  readonly follow: () => void
  readonly stop: () => void
}

// Keeps a project's notes as the runner gave them; a project with none is not kept at all.
const keep = (
  into: Map<string, readonly Note[]>,
  projectId: string,
  notes: readonly Note[],
): void => {
  if (notes.length === 0) into.delete(projectId)
  else into.set(projectId, notes)
}

// A change on its way: what it makes of the notes, applied over the runner's until it answers.
type Pending = (notes: readonly Note[]) => readonly Note[]

export const createRunnerNotes = (
  calls: Runner["notes"],
  {
    // Keeps a call the backend waits for before it stops, as its other calls are.
    track = (work) => work,
    newId = () => crypto.randomUUID(),
    now = Date.now,
  }: {
    track?: <T>(work: Promise<T>) => Promise<T>
    newId?: () => string
    now?: () => number
  } = {},
): RunnerNotes => {
  const state = createStore<NotesState>(noNotes)
  // Each project's notes as the runner last gave them.
  let held = new Map<string, readonly Note[]>()
  // The projects of a sequence the runner has yet to finish with `synced`; until then `held`
  // stays.
  let incoming: Map<string, readonly Note[]> | undefined
  let pending: readonly Pending[] = []
  let failed = false
  let stream: AsyncIterableIterator<unknown, undefined> | undefined

  const publish = (): void => {
    const notes = pending.reduce<readonly Note[]>(
      (current, apply) => apply(current),
      [...held.values()].flat(),
    )
    state.update(() => ({ notes, failed }))
  }

  // Shows the change at once, and asks the runner for it: its answer is the project's notes.
  const send = (projectId: string, apply: Pending, call: () => Promise<readonly Note[]>): void => {
    pending = [...pending, apply]
    publish()
    track(Promise.resolve().then(call)).then(
      (notes) => {
        keep(held, projectId, notes)
        // A sequence under way is older than this answer.
        if (incoming) keep(incoming, projectId, notes)
        pending = pending.filter((each) => each !== apply)
        failed = false
        publish()
      },
      () => {
        pending = pending.filter((each) => each !== apply)
        failed = true
        publish()
      },
    )
  }

  const follow = (): void => {
    if (stream) return
    const changes = calls.watch()
    stream = changes
    void consume(changes, (change) => {
      if (stream !== changes) return
      switch (change.type) {
        case "reset": {
          incoming = new Map()
          break
        }
        case "changed": {
          if (incoming) keep(incoming, change.projectId, change.notes)
          else {
            keep(held, change.projectId, change.notes)
            publish()
          }
          break
        }
        case "synced": {
          // A project the runner didn't report this time has no notes.
          if (incoming) {
            held = incoming
            incoming = undefined
          }
          publish()
          break
        }
      }
    })
  }

  const stop = (): void => {
    const done = stream
    stream = undefined
    incoming = undefined
    void done?.return?.()?.catch?.(() => {})
  }

  const shown = (): readonly Note[] => state.getSnapshot().notes

  const notes: Notes = {
    state,
    add: (projectId, { text, todo }) => {
      const note: Note = {
        id: newId(),
        projectId,
        text: noteLine(text),
        body: "",
        todo,
        doneAt: null,
        createdAt: now(),
      }
      // Nothing to say, or a full project: nothing is added, here or there.
      if (added(shown(), note) === shown()) return
      send(
        projectId,
        (current) => added(current, note),
        () => calls.add({ id: note.id, projectId, text: note.text, todo }),
      )
    },
    change: (id, change) => {
      const before = shown().find((note) => note.id === id)
      const at = now()
      const after = changed(shown(), id, change, at).find((note) => note.id === id)
      if (!before || !after || after === before) return
      // Only what the change makes different is asked for, as the notes then say it.
      const asked: NoteChange = {
        ...(after.text !== before.text && { text: after.text }),
        ...(after.body !== before.body && { body: after.body }),
        ...(after.todo !== before.todo && { todo: after.todo }),
        ...((after.doneAt === null) !== (before.doneAt === null) && {
          done: after.doneAt !== null,
        }),
      }
      send(
        before.projectId,
        (current) => changed(current, id, asked, at),
        () => calls.update({ projectId: before.projectId, id, ...asked }),
      )
    },
    move: (id, index) => {
      const note = shown().find((each) => each.id === id)
      if (!note || moved(shown(), id, index) === shown()) return
      send(
        note.projectId,
        (current) => moved(current, id, index),
        () => calls.move({ projectId: note.projectId, id, index }),
      )
    },
    remove: (ids) => {
      const gone = shown().filter((note) => ids.includes(note.id))
      for (const projectId of new Set(gone.map((note) => note.projectId))) {
        const mine = gone.filter((note) => note.projectId === projectId).map((note) => note.id)
        send(
          projectId,
          (current) => removed(current, mine),
          () => calls.remove({ projectId, ids: mine }),
        )
      }
    },
  }
  return { notes, follow, stop }
}
