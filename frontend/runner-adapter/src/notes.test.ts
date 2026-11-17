import { noteLimits, type Note } from "@novadeck/core/notes"
import { noteLimits as runnerLimits, type Note as RunnerNote } from "@novadeck/protocol"
import type { NotesWatchItem } from "@novadeck/runner-client"
import { expectTypeOf, vi } from "vitest"

import { createRunnerNotes } from "./notes"
import { context, describe, expect, it } from "./test"
import { channel } from "./testing/channel"

const note = (id: string, change: Partial<Note> = {}): Note => ({
  id,
  projectId: "p",
  text: id,
  body: "",
  todo: true,
  doneAt: null,
  createdAt: 0,
  ...change,
})

// A call the test answers when it chooses: with the project's notes, or by refusing it.
type Held = {
  readonly name: string
  readonly input: unknown
  readonly answer: (notes: Note[]) => void
  readonly refuse: () => void
}

const followed = () => {
  const stream = channel<NotesWatchItem>()
  const calls: Held[] = []
  const held =
    (name: string) =>
    (input: unknown): Promise<Note[]> =>
      new Promise((resolve, reject) => {
        calls.push({ name, input, answer: resolve, refuse: () => reject(new Error("refused")) })
      })
  let made = 0
  const { notes, follow, stop } = createRunnerNotes(
    {
      list: async () => [],
      watch: () => stream.iterator,
      add: held("add"),
      update: held("update"),
      move: held("move"),
      remove: held("remove"),
    },
    { newId: () => `new-${(made += 1)}`, now: () => 500 },
  )
  follow()
  const texts = () => notes.state.getSnapshot().notes.map(({ text }) => text)
  // The runner's first sequence: `p` holds these notes.
  const listed = async (...first: Note[]): Promise<void> => {
    stream.push({ type: "reset" })
    if (first.length > 0) stream.push({ type: "changed", projectId: "p", notes: first })
    stream.push({ type: "synced" })
    await vi.waitFor(() => expect(texts()).toEqual(first.map(({ text }) => text)))
  }
  // Once the calls made so far have reached the runner.
  const sent = async (count: number): Promise<Held[]> => {
    await vi.waitFor(() => expect(calls).toHaveLength(count))
    return calls
  }
  return { notes, stream, stop, texts, listed, sent, state: () => notes.state.getSnapshot() }
}

describe("The notes, as the runner reports them", () => {
  it("are the runner's own notes, field for field, within the runner's own limits", () => {
    expectTypeOf<RunnerNote>().toExtend<Note>()
    expectTypeOf<Note>().toExtend<RunnerNote>()
    // The core keeps the limits the panel holds the person to; the runner's add how many an
    // agent adds at once.
    expect(runnerLimits).toMatchObject(noteLimits)
  })

  it("shows every project's once the first sequence is synced", async () => {
    const { stream, texts } = followed()
    stream.push({ type: "reset" })
    stream.push({ type: "changed", projectId: "p", notes: [note("a"), note("b")] })
    stream.push({ type: "changed", projectId: "q", notes: [note("c", { projectId: "q" })] })
    expect(texts()).toEqual([])
    stream.push({ type: "synced" })
    await vi.waitFor(() => expect(texts()).toEqual(["a", "b", "c"]))
  })

  it("follows each project's later notes, and forgets a project a new sequence leaves out", async () => {
    const { stream, texts, listed } = followed()
    await listed(note("a"))
    stream.push({ type: "changed", projectId: "p", notes: [note("b"), note("a")] })
    await vi.waitFor(() => expect(texts()).toEqual(["b", "a"]))
    stream.push({ type: "changed", projectId: "p", notes: [] })
    await vi.waitFor(() => expect(texts()).toEqual([]))

    stream.push({ type: "changed", projectId: "p", notes: [note("a")] })
    stream.push({ type: "reset" })
    stream.push({ type: "changed", projectId: "q", notes: [note("c", { projectId: "q" })] })
    stream.push({ type: "synced" })
    await vi.waitFor(() => expect(texts()).toEqual(["c"]))
  })
})

describe("A change the person makes to the notes", () => {
  it("shows at once, and stays once the runner answers with the project's notes", async () => {
    const { notes, texts, listed, sent } = followed()
    await listed(note("a"))
    notes.add("p", { text: "  Ship it\n", todo: true })
    expect(texts()).toEqual(["Ship it", "a"])
    const [add] = await sent(1)
    expect(add).toMatchObject({
      name: "add",
      input: { id: "new-1", projectId: "p", text: "Ship it", todo: true },
    })
    add!.answer([note("new-1", { text: "Ship it", createdAt: 900 }), note("a")])
    await vi.waitFor(() =>
      expect(notes.state.getSnapshot().notes[0]).toMatchObject({ createdAt: 900 }),
    )
    expect(texts()).toEqual(["Ship it", "a"])
  })

  it("keeps showing a later change while an earlier one is answered", async () => {
    const { notes, texts, listed, sent } = followed()
    await listed(note("a"))
    notes.add("p", { text: "first", todo: true })
    notes.add("p", { text: "second", todo: false })
    const [first] = await sent(2)
    // The runner's answer to the first has yet to see the second.
    first!.answer([note("new-1", { text: "first" }), note("a")])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(texts()).toEqual(["second", "first", "a"])
  })

  it("stays over a note an agent adds meanwhile, which keeps the agent that added it", async () => {
    const { notes, stream, listed, sent, state } = followed()
    await listed(note("a"))
    notes.change("a", { done: true })
    const [update] = await sent(1)
    const theirs = note("b", { by: { agent: "codex", handle: "pike" } })

    stream.push({ type: "changed", projectId: "p", notes: [theirs, note("a")] })
    await vi.waitFor(() => expect(state().notes).toEqual([theirs, note("a", { doneAt: 500 })]))
    update!.answer([theirs, note("a", { doneAt: 500 })])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state()).toEqual({ notes: [theirs, note("a", { doneAt: 500 })], failed: false })
  })

  context("when the runner refuses it", () => {
    it("goes back to the runner's notes and says so, until a change takes", async () => {
      const { notes, texts, listed, sent, state } = followed()
      await listed(note("a"))
      notes.change("a", { done: true })
      expect(state().notes[0]!.doneAt).toBe(500)
      const [update] = await sent(1)
      update!.refuse()
      await vi.waitFor(() => expect(state().failed).toBe(true))
      expect(state().notes[0]!.doneAt).toBeNull()

      notes.remove(["a"])
      const [, remove] = await sent(2)
      remove!.answer([])
      await vi.waitFor(() => expect(state().failed).toBe(false))
      expect(texts()).toEqual([])
    })
  })

  it("asks the runner only for what it makes different, and nothing for no change", async () => {
    const { notes, listed, sent } = followed()
    await listed(note("a", { body: "More." }), note("b", { doneAt: 90 }))
    notes.change("a", { text: "a", body: "More.", done: false })
    notes.change("nope", { text: "x" })
    notes.change("a", { text: " A new line ", body: "More." })
    notes.change("b", { todo: false })
    const calls = await sent(2)
    expect(calls.map(({ input }) => input)).toEqual([
      { projectId: "p", id: "a", text: "A new line" },
      // Without its checkbox it is open again, which the runner works out the same way.
      { projectId: "p", id: "b", todo: false, done: false },
    ])
  })

  it("adds nothing that says nothing", async () => {
    const { notes, texts, listed, sent } = followed()
    await listed(note("a"))
    notes.add("p", { text: " \n ", todo: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(texts()).toEqual(["a"])
    expect(await sent(0)).toEqual([])
  })

  it("moves an open note at once, and leaves one already there where it is", async () => {
    const { notes, texts, listed, sent } = followed()
    await listed(note("a"), note("b"), note("c"))
    notes.move("a", 0)
    notes.move("c", 0)
    expect(texts()).toEqual(["c", "a", "b"])
    const calls = await sent(1)
    expect(calls[0]).toMatchObject({ name: "move", input: { projectId: "p", id: "c", index: 0 } })
  })

  it("removes the notes of each project in a call of its own", async () => {
    const { notes, stream, texts, listed, sent } = followed()
    await listed(note("a"), note("b"))
    stream.push({ type: "changed", projectId: "q", notes: [note("c", { projectId: "q" })] })
    await vi.waitFor(() => expect(texts()).toEqual(["a", "b", "c"]))
    notes.remove(["a", "c", "nope"])
    expect(texts()).toEqual(["b"])
    const calls = await sent(2)
    expect(calls.map(({ name, input }) => [name, input])).toEqual([
      ["remove", { projectId: "p", ids: ["a"] }],
      ["remove", { projectId: "q", ids: ["c"] }],
    ])
  })
})
