import { changed, noteColumn, placed, type BoardColumn, type Note } from "@novadeck/core/notes"
import { afterAll, vi } from "vitest"

import { placesNotes } from "./notes"
import { describe, expect, it } from "./test"
import { startTestRunner } from "./testing/runner"

// The adapter shows each change to the notes by the core's rules before the runner answers by
// its own, so the two must agree: each case here is made on a real runner, and the core's
// notes after it must be the runner's answer, note for note and column for column.

vi.setConfig({ testTimeout: 10_000 })

const runner = await startTestRunner()
afterAll(() => runner.close())

// A note a case starts with: a todo in its column, or a plain note (null).
type Kept = readonly [text: string, column: BoardColumn | null]

const start: readonly Kept[] = [
  ["a", "todo"],
  ["p1", null],
  ["b", "doing"],
  ["c", "todo"],
  ["d", "done"],
  ["p2", null],
  ["e", "done"],
  ["f", "doing"],
]

// A project on the runner holding `start`, made by the runner's own calls, and its notes as the
// runner then lists them, which both sides start from.
const project = async () => {
  const projectId = crypto.randomUUID()
  await runner.client.projects.create({ id: projectId, name: "Notes", cwd: process.cwd() })
  const ids = new Map(start.map(([text]) => [text, crypto.randomUUID()]))
  const id = (text: string) => ids.get(text)!
  // Each goes first, so the last is added first.
  for (const [text, column] of start.toReversed())
    // eslint-disable-next-line no-await-in-loop -- Each goes first in turn.
    await runner.client.notes.add({ id: id(text), projectId, text, todo: column !== null })
  // Into its column in turn: each after the last there, the first where it stands.
  for (const [text, column] of start)
    if (column !== null && column !== "todo")
      // eslint-disable-next-line no-await-in-loop -- Each after the one before.
      await runner.client.notes.place({ projectId, id: id(text), column })
  const notes = await runner.client.notes.list({ projectId })
  return { projectId, id, notes }
}

// The notes as the board and the Notes panel show them: in order, each in its column.
const shown = (notes: readonly Note[]) => notes.map((note) => [note.text, noteColumn(note)])

type Place = readonly [text: string, column: BoardColumn | null, before: string | null]

const places: readonly Place[] = [
  ["c", "doing", "b"],
  ["c", "doing", null],
  ["b", "todo", "a"],
  ["a", "done", "d"],
  ["d", "done", null],
  ["e", "todo", null],
  ["f", "doing", "b"],
  ["p2", null, "p1"],
  ["p1", null, null],
  ["c", "todo", "c"],
]

type Change = readonly [text: string, change: { readonly done?: boolean; readonly todo?: boolean }]

const changes: readonly Change[] = [
  ["c", { done: true }],
  ["e", { done: false }],
  ["b", { done: true }],
  ["b", { todo: false }],
  ["d", { todo: false }],
  ["p2", { todo: true }],
  ["a", { done: false }],
]

describe("The core's rules and the runner's", () => {
  it.each(places)("place %s in %s before %s alike", async (text, column, before) => {
    const { projectId, id, notes } = await project()
    const answer = await runner.client.notes.place({
      projectId,
      id: id(text),
      ...(column !== null && { column }),
      ...(before !== null && { before: id(before) }),
    })
    const core = placed(notes, id(text), column, before === null ? null : id(before), Date.now())
    expect(shown(core)).toEqual(shown(answer))
  })

  it.each(changes)("change %s by %o alike", async (text, change) => {
    const { projectId, id, notes } = await project()
    const answer = await runner.client.notes.update({ projectId, id: id(text), ...change })
    expect(shown(changed(notes, id(text), change, Date.now()))).toEqual(shown(answer))
  })
})

describe("Whether this runner places notes", () => {
  it("says it does, and asking changes none of them", async () => {
    const { projectId, notes } = await project()
    expect(await placesNotes(runner.client.notes)).toBe(true)
    expect(await runner.client.notes.list({ projectId })).toEqual(notes)
  })
})
