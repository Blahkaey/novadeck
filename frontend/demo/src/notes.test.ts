import { doneNotes, openNotes, todosLeft } from "@novadeck/core/notes"
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
  it("start with the storefront's: todos, a plain note, one with a body, and some done", () => {
    const notes = demoNotes(now)

    expect(todosLeft(notes, "storefront")).toBe(4)
    expect(openNotes(notes, "storefront").filter((note) => !note.todo)).toHaveLength(1)
    expect(openNotes(notes, "storefront").some((note) => note.body !== "")).toBe(true)
    expect(doneNotes(notes, "storefront").map(({ text }) => text)).toEqual([
      "Rename the checkout route",
      "Update the screenshots in the README",
    ])
    expect(new Set(notes.map(({ id }) => id)).size).toBe(notes.length)
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
