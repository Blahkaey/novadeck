import { boardCards, doneNotes, openNotes, plainNotes, todosLeft } from "@novadeck/core/notes"
import type { Backend } from "@novadeck/core/port"

import { createDemoNotes, demoNotes, isDemoNotes, withNotes } from "./notes"
import { describe, expect, it } from "./test"

const now = 1_700_000_000_000

const setup = (withSamples = true) => {
  let clock = now
  const notes = createDemoNotes(now, withSamples, () => (clock += 1_000))
  const texts = (projectId = "storefront") =>
    openNotes(notes.state.getSnapshot().notes, projectId).map(({ text }) => text)
  return { notes, texts, state: () => notes.state.getSnapshot() }
}

describe("The demo's notes", () => {
  it("start with the storefront's: todos, one an agent added, a plain note, one with a body, and some done", () => {
    const notes = demoNotes(now)

    expect(todosLeft(notes, "storefront")).toBe(4)
    expect(openNotes(notes, "storefront").filter((note) => !note.todo)).toHaveLength(1)
    expect(openNotes(notes, "storefront").some((note) => note.body !== "")).toBe(true)
    // Codex added it as @pike, the storefront's Tax rounding agent in History.
    expect(notes.filter((note) => note.by).map(({ text, by }) => [text, by])).toEqual([
      ["Move the price formatter into the shared package", { agent: "codex", handle: "pike" }],
    ])
    expect(doneNotes(notes, "storefront").map(({ text }) => text)).toEqual([
      "Rename the checkout route",
      "Update the screenshots in the README",
    ])
    expect(new Set(notes.map(({ id }) => id)).size).toBe(notes.length)
  })

  it("fill every column of the storefront's Todo board, and its plain notes", () => {
    const notes = demoNotes(now)
    const texts = (column: "todo" | "doing" | "done") =>
      boardCards(notes, "storefront", column).map(({ text }) => text)

    expect(texts("todo")).toEqual([
      "Ask @wren to cover expired coupon codes",
      "Reply to the design review about the empty cart",
      "Move the price formatter into the shared package",
    ])
    expect(texts("doing")).toEqual(["Check the cart total on a slow connection"])
    expect(texts("done")).toEqual([
      "Rename the checkout route",
      "Update the screenshots in the README",
    ])
    expect(plainNotes(notes, "storefront").map(({ text }) => text)).toEqual([
      "Staging deploys from the release branch",
    ])
  })

  it("place a card where the person drops it, and a plain note among the plain notes", () => {
    const { notes, state } = setup()
    const [first, , second] = boardCards(state().notes, "storefront", "todo")
    const [doing] = boardCards(state().notes, "storefront", "doing")

    notes.place(first!.id, "doing", doing!.id)
    expect(boardCards(state().notes, "storefront", "doing").map(({ id }) => id)).toEqual([
      first!.id,
      doing!.id,
    ])
    notes.place(second!.id, "done", null)
    expect(boardCards(state().notes, "storefront", "done").at(-1)).toMatchObject({
      id: second!.id,
      // The demo's clock moves a second with each change.
      doneAt: now + 2_000,
    })
    // A plain note goes in no column.
    const before = state().notes
    notes.place(plainNotes(before, "storefront")[0]!.id, "todo", null)
    expect(state().notes).toBe(before)
  })

  it("keep what the person adds, changes, moves and removes", () => {
    const { notes, texts, state } = setup(false)
    notes.add("storefront", { text: " Ship it\n", todo: true })
    notes.add("storefront", { text: "Remember the flag", todo: false })
    notes.add("infra", { text: "Elsewhere", todo: true })
    expect(texts()).toEqual(["Remember the flag", "Ship it"])
    expect(texts("infra")).toEqual(["Elsewhere"])

    const [flag, ship] = openNotes(state().notes, "storefront")
    notes.move(ship!.id, 0)
    expect(texts()).toEqual(["Ship it", "Remember the flag"])
    notes.change(ship!.id, { done: true })
    expect(texts()).toEqual(["Remember the flag"])
    expect(doneNotes(state().notes, "storefront")[0]).toMatchObject({
      text: "Ship it",
      doneAt: now + 4_000,
    })
    notes.remove([flag!.id, ship!.id])
    expect(state().notes.map(({ text }) => text)).toEqual(["Elsewhere"])
  })

  it("keep the agent that added a note through the person's changes, and name none on theirs", () => {
    const { notes, state } = setup()
    const theirs = () => state().notes.find((note) => note.by)!
    const { id } = theirs()

    notes.change(id, { text: "Move the formatter", done: true })
    notes.change(id, { done: false })
    notes.move(id, 0)
    notes.remove([openNotes(state().notes, "storefront")[1]!.id])
    notes.add("storefront", { text: "Mine", todo: true })

    expect(theirs()).toMatchObject({
      id,
      text: "Move the formatter",
      by: { agent: "codex", handle: "pike" },
    })
    expect(openNotes(state().notes, "storefront")[0]).toMatchObject({ text: "Mine" })
    expect(openNotes(state().notes, "storefront")[0]).not.toHaveProperty("by")
  })

  it("fail one change where the panel asks, and say so until the next one takes", () => {
    const { notes, texts, state } = setup(false)
    notes.add("storefront", { text: "First", todo: true })
    notes.failNext()
    // A change that changes nothing isn't the one that fails.
    notes.add("storefront", { text: "  ", todo: true })
    expect(state().failed).toBe(false)
    notes.add("storefront", { text: "Lost", todo: true })
    expect(state().failed).toBe(true)
    expect(texts()).toEqual(["First"])
    notes.add("storefront", { text: "Second", todo: true })
    expect(state()).toMatchObject({ failed: false })
    expect(texts()).toEqual(["Second", "First"])
  })

  it("are replaced whole by the panel", () => {
    const { notes, state } = setup()
    notes.set([])
    expect(state()).toEqual({ notes: [], failed: false })
  })

  it("join a backend as its notes, which the panel can tell are the demo's", () => {
    const backend = withNotes({} as Backend, createDemoNotes(now))

    expect(isDemoNotes(backend.notes)).toBe(true)
    expect(isDemoNotes(undefined)).toBe(false)
  })
})
