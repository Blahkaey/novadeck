import {
  boardCards,
  boardColumns,
  doneNotes,
  noteLimits,
  openNotes,
  plainNotes,
  todosLeft,
} from "@novadeck/core/notes"
import type { TerminalMetadata, Workspace } from "@novadeck/core/types"
import { createDemoNotes } from "@novadeck/demo/notes"

import { agentTodo, doneOnly, fullNotes, longNotes, notesGroups } from "./notes"
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

// A workspace on `projectId`, whose session on screen has these terminals.
const onScreen = (projectId: string, terminals: Partial<TerminalMetadata>[]): Workspace =>
  ({
    activeProjectId: projectId,
    projects: [
      {
        id: projectId,
        activeSessionId: "initial",
        history: [{ id: "initial", state: { roster: { terminals } } }],
      },
    ],
  }) as unknown as Workspace

const setup = () => {
  const notes = createDemoNotes(0)
  const [group] = notesGroups(notes)
  const action = (label: string) => group!.actions.find((each) => each.label === label)!
  const run = (label: string, projectId?: string) => void action(label).run(context(projectId))
  // Runs it with this workspace on screen.
  const runOn = (label: string, workspace: Workspace) =>
    void action(label).run({ ...context(), workspace: () => workspace })
  return { notes, group: group!, run, runOn, state: () => notes.state.getSnapshot() }
}

describe("the debug panel's Notes and Todo group", () => {
  it("offers nothing where the backend's notes aren't the demo's", () => {
    const { state, add, change, move, place, remove } = createDemoNotes(0)

    expect(notesGroups(undefined)).toEqual([])
    expect(notesGroups({ state, add, change, move, place, remove })).toEqual([])
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
    expect(state().notes.filter((note) => note.projectId === "infra")).toHaveLength(
      noteLimits.perProject,
    )
    expect(state().notes.filter((note) => note.projectId === "storefront")).toEqual(storefront)
    run("No notes", "infra")
    expect(state().notes).toEqual(storefront)
    run("Sample notes", "infra")
    expect(todosLeft(state().notes, "infra")).toBe(todosLeft(storefront, "storefront"))
    expect(new Set(state().notes.map(({ id }) => id)).size).toBe(state().notes.length)
  })

  it("empties the board and keeps the plain notes", () => {
    const { run, state } = setup()
    const plain = plainNotes(state().notes, "storefront")

    run("No todos", "storefront")
    for (const column of boardColumns)
      expect(boardCards(state().notes, "storefront", column)).toEqual([])
    expect(plainNotes(state().notes, "storefront")).toEqual(plain)
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
    // A todo checked off is in progress no more.
    expect(state().notes.filter((note) => "doing" in note)).toEqual([])
  })

  it("shows a note at its longest, with details", () => {
    const { run, state } = setup()

    run("A long note", "storefront")
    const [long] = openNotes(state().notes, "storefront")
    expect(long!.text).toHaveLength(noteLimits.text)
    expect(long!.body).toContain("```ts")
  })

  it("has the first agent running on screen add a todo, first in the project's list", () => {
    const { runOn, state } = setup()
    const samples = openNotes(state().notes, "storefront")
    const storefront = onScreen("storefront", [
      { id: "01", state: "running", process: "zsh", handle: "moth" },
      { id: "02", state: "exited", exitCode: 0, signal: null, process: "claude", handle: "fox" },
      { id: "04", state: "running", process: "codex", handle: "crow" },
    ])

    runOn("An agent adds a todo", storefront)
    runOn("An agent adds a todo", storefront)

    const [second, first, ...rest] = openNotes(state().notes, "storefront")
    expect(rest).toEqual(samples)
    expect(second).toMatchObject({ todo: true, by: { agent: "codex", handle: "crow" } })
    expect(first).toMatchObject({ todo: true, by: { agent: "codex", handle: "crow" } })
    expect(second!.id).not.toBe(first!.id)
  })

  it("has Claude Code's @wren add it where no agent runs on screen", () => {
    const { runOn, state } = setup()
    const storefront = state().notes

    runOn(
      "An agent adds a todo",
      onScreen("infra", [{ id: "01", state: "running", process: "zsh" }]),
    )

    expect(openNotes(state().notes, "infra")).toEqual([
      expect.objectContaining({ by: { agent: "claude", handle: "wren" } }),
    ])
    expect(state().notes.filter((note) => note.projectId === "storefront")).toEqual(storefront)
  })
})

describe("the debug panel's notes", () => {
  it("fill a project to what it keeps, under ids of their own", () => {
    const notes = fullNotes("p", 0)

    expect(notes).toHaveLength(noteLimits.perProject)
    expect(new Set(notes.map(({ id }) => id)).size).toBe(notes.length)
  })

  it("fill a project with plain notes and cards in every column of the board", () => {
    const notes = fullNotes("p", 0)

    expect(plainNotes(notes, "p")).toHaveLength(noteLimits.perProject / 4)
    for (const column of boardColumns)
      expect(boardCards(notes, "p", column)).toHaveLength(noteLimits.perProject / 4)
  })

  it("stay within a note's limits", () => {
    const agents = [agentTodo("p", { agent: "claude", handle: "wren" }, "agent-1", 0)]
    for (const note of [
      ...fullNotes("p", 0),
      ...doneOnly("p", 0),
      ...longNotes("p", 0),
      ...agents,
    ]) {
      expect(note.text.length).toBeLessThanOrEqual(noteLimits.text)
      expect(note.body.length).toBeLessThanOrEqual(noteLimits.body)
      expect(note.text).toBe(note.text.trim())
    }
  })
})
