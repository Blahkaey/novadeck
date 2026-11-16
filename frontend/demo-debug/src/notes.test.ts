import { doneNotes, noteLimits, openNotes, todosLeft } from "@novadeck/core/notes"
import type { Workspace } from "@novadeck/core/types"
import { createDemoNotes } from "@novadeck/demo/notes"

import { doneOnly, fullNotes, longNotes, notesGroups } from "./notes"
import { describe, expect, it } from "./test"
import type { DemoActionContext } from "./types"

const context = (activeProjectId?: string): DemoActionContext => ({
  target: "selected",
  harness: "claude",
  selected: () => undefined,
  select: () => {},
  addTerminal: () => {
    throw new Error("unused")
  },
  addInBackground: () => {
    throw new Error("unused")
  },
  startFresh: () => undefined,
  dispatch: undefined,
  workspace: () => (activeProjectId ? ({ activeProjectId } as Workspace) : undefined),
  note: () => undefined,
  crash: () => undefined,
})

const setup = () => {
  const notes = createDemoNotes(0)
  const [group] = notesGroups(notes)
  const run = (label: string, projectId?: string) =>
    void group!.actions.find((action) => action.label === label)!.run(context(projectId))
  return { notes, group: group!, run, state: () => notes.state.getSnapshot() }
}

describe("the debug panel's Notes group", () => {
  it("offers nothing where the backend's notes aren't the demo's", () => {
    const { state, add, change, move, remove } = createDemoNotes(0)

    expect(notesGroups(undefined)).toEqual([])
    expect(notesGroups({ state, add, change, move, remove })).toEqual([])
  })

  it("makes the next change fail, once, with the notes kept", () => {
    const { notes, run, state } = setup()
    const before = state().notes

    run("Next notes change fails")
    notes.add("storefront", { text: "Lost", todo: true })
    expect(state()).toEqual({ notes: before, failed: true })
    notes.add("storefront", { text: "Kept", todo: true })
    expect(state().failed).toBe(false)
    expect(state().notes).toHaveLength(before.length + 1)
  })

  it("changes the notes of the project on screen, and leaves the others'", () => {
    const { run, state } = setup()
    const storefront = state().notes

    run("Project full of notes", "infra")
    expect(openNotes(state().notes, "infra")).toHaveLength(noteLimits.perProject)
    expect(state().notes.filter((note) => note.projectId === "storefront")).toEqual(storefront)
    run("No notes", "infra")
    expect(state().notes).toEqual(storefront)
    run("Sample notes", "infra")
    expect(todosLeft(state().notes, "infra")).toBe(todosLeft(storefront, "storefront"))
    expect(new Set(state().notes.map(({ id }) => id)).size).toBe(state().notes.length)
  })

  it("acts on the storefront before a workspace is committed", () => {
    const { run, state } = setup()

    run("No notes")
    expect(state().notes).toEqual([])
  })

  it("leaves nothing to do, over todos that are all checked off", () => {
    const { run, state } = setup()

    run("Every todo done", "storefront")
    expect(openNotes(state().notes, "storefront")).toEqual([])
    expect(doneNotes(state().notes, "storefront")).toHaveLength(6)
  })

  it("shows a note at its longest, with details", () => {
    const { run, state } = setup()

    run("A long note", "storefront")
    const [long] = openNotes(state().notes, "storefront")
    expect(long!.text).toHaveLength(noteLimits.text)
    expect(long!.body).toContain("```ts")
  })
})

describe("the debug panel's notes", () => {
  it("fill a project to what it keeps, under ids of their own", () => {
    const notes = fullNotes("p", 0)

    expect(notes).toHaveLength(noteLimits.perProject)
    expect(new Set(notes.map(({ id }) => id)).size).toBe(notes.length)
  })

  it("stay within a note's limits", () => {
    for (const note of [...fullNotes("p", 0), ...doneOnly("p", 0), ...longNotes("p", 0)]) {
      expect(note.text.length).toBeLessThanOrEqual(noteLimits.text)
      expect(note.body.length).toBeLessThanOrEqual(noteLimits.body)
      expect(note.text).toBe(note.text.trim())
    }
  })
})
