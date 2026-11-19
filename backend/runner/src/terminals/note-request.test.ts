import { noteLimits } from "@novadeck/protocol"
import { vi } from "vitest"

import { describe, expect, it } from "../test.js"
import { memoryNotes, Notes } from "../workspaces/notes.js"
import { Calls, type CallsHost } from "./calls.js"
import { noteRefusal, notesPerMinute, readNoteRequest } from "./note-request.js"

const token = "a".repeat(48)
const project = "00000000-0000-4000-8000-00000000000a"
const other = "00000000-0000-4000-8000-00000000000b"

// Calls over a runner of fakes: `wren`, a Claude Code agent in terminal t1 of session s of
// `project`, whose turn is the person's unless `turn` says otherwise, and the person's real
// notes over records in memory.
const setup = (
  options: {
    turn?: "person" | "others" | undefined
    prompt?: string
    opened?: { readonly command: string }
  } = {},
) => {
  const state = { turn: "turn" in options ? options.turn : ("person" as const), now: 1_000 }
  const notes = new Notes(memoryNotes([project, other]), () => state.now)
  const records = new Map([
    [
      "t1",
      {
        terminal: { exiting: false },
        token,
        summary: { id: "t1", handle: "wren", sessionId: "s" },
        root: { agent: "claude", sessionId: "c1" },
        work: options.opened ? { opened: true } : null,
        openerCommand: options.opened?.command ?? null,
      },
    ],
  ])
  const calls = new Calls(1000, {
    records: () => records,
    stopping: () => false,
    messaging: () => ({
      personTurn: () => state.turn,
      personPrompt: () => (state.turn === undefined ? undefined : (options.prompt ?? "a todo")),
    }),
    notes: () => notes,
    // A session of a project the runner no longer has names one it doesn't know.
    projectOf: (sessionId: string) =>
      sessionId === "s" ? project : "00000000-0000-4000-8000-0000000000ff",
  } as unknown as CallsHost)
  const note = (request: unknown, from = { terminalId: "t1", token }) =>
    calls.call({ type: "note", ...from, request: request as { [key: string]: unknown } })
  return { notes, note, state, records }
}

describe("an agent's note", () => {
  it("goes first in its project's list, in the order given, marked as the agent's", async () => {
    const { notes, note } = setup()
    notes.add({
      projectId: project,
      notes: [{ id: "00000000-0000-4000-8000-000000000001", text: "Mine", todo: true }],
    })
    const answer = await note({
      notes: [
        { text: "Revisit the retry logic", body: "Backoff caps at 30 s." },
        { text: "Staging runs with the flag off", todo: false },
        { text: "Rename the queue", todo: true },
      ],
    })

    expect(answer).toEqual({ ok: true, todos: 2, notes: 1 })
    expect(notes.list(project)).toMatchObject([
      { text: "Revisit the retry logic", body: "Backoff caps at 30 s.", todo: true },
      { text: "Staging runs with the flag off", todo: false },
      { text: "Rename the queue", todo: true },
      { text: "Mine" },
    ])
    const by = notes.list(project).map((each) => each.by)
    const wren = { agent: "claude", handle: "wren" }
    expect(by).toEqual([wren, wren, wren, undefined])
    expect(notes.list(other)).toEqual([])
  })

  it("is refused outside a turn the person's own message started, adding nothing", async () => {
    const { notes, note } = setup({ turn: undefined })
    expect(await note({ notes: [{ text: "My plan, step 1" }] })).toEqual({
      ok: false,
      reason: noteRefusal.notTheirs,
    })
    expect(notes.list(project)).toEqual([])
  })

  it("is refused once another agent's message reached the turn", async () => {
    const { notes, note } = setup({ turn: "others" })
    expect(await note({ notes: [{ text: "As the lead asked" }] })).toEqual({
      ok: false,
      reason: noteRefusal.others,
    })
    expect(notes.list(project)).toEqual([])
  })

  it("is refused in a turn the opening agent's command-line prompt started", async () => {
    const { note } = setup({
      prompt: "Add a todo to ship it",
      opened: { command: "claude 'Add a todo to ship it'" },
    })
    expect(await note({ notes: [{ text: "Ship it" }] })).toEqual({
      ok: false,
      reason: noteRefusal.notTheirs,
    })
  })

  it("is refused past the notes a terminal's agents may add a minute, whole", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 })
    try {
      const { notes, note } = setup()
      const many = (count: number) =>
        Array.from({ length: count }, (_, at) => ({ text: `Todo ${at + 1}` }))
      expect(await note({ notes: many(notesPerMinute - 1) })).toMatchObject({ ok: true })
      expect(await note({ notes: many(2) })).toEqual({ ok: false, reason: noteRefusal.spent })
      expect(notes.list(project)).toHaveLength(notesPerMinute - 1)
      expect(await note({ notes: many(1) })).toMatchObject({ ok: true })
      // A minute on, the agent may add more.
      vi.setSystemTime(1_060_000)
      expect(await note({ notes: many(notesPerMinute) })).toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it("is refused whole where the project's notes would run past what it keeps", async () => {
    const { notes, note } = setup()
    notes.add({
      projectId: project,
      notes: Array.from({ length: noteLimits.perProject - 1 }, (_, at) => ({
        id: `00000000-0000-4000-8000-${String(at).padStart(12, "0")}`,
        text: "x",
        todo: true,
      })),
    })
    expect(await note({ notes: [{ text: "One" }, { text: "Two" }] })).toEqual({
      ok: false,
      reason: noteRefusal.full,
    })
    expect(notes.list(project)).toHaveLength(noteLimits.perProject - 1)
  })

  it("adds nothing, and says it couldn't, once its project is gone", async () => {
    const { note, records } = setup()
    records.get("t1")!.summary.sessionId = "gone"
    expect(await note({ notes: [{ text: "x" }] })).toEqual({
      ok: false,
      reason: "Novadeck couldn't add to the user's Todo board or Notes.",
    })
  })

  it("learns nothing more for a call without the terminal's own token", async () => {
    const { note } = setup()
    expect(
      await note({ notes: [{ text: "x" }] }, { terminalId: "t1", token: "b".repeat(48) }),
    ).toEqual({
      ok: false,
      reason: "Novadeck couldn't add to the user's Todo board or Notes.",
    })
  })
})

describe("a note request", () => {
  it("names what is wrong with it", () => {
    const reason = (value: unknown) => {
      const read = readNoteRequest(value)
      return read.ok ? undefined : read.reason
    }
    expect(reason({})).toBe("Give `notes`: a list of 1 to 20 notes, each with its `text`.")
    expect(reason({ notes: [] })).toBe(
      "Give `notes`: a list of 1 to 20 notes, each with its `text`.",
    )
    expect(reason({ notes: [{ text: "x" }], extra: 1 })).toBe("A call takes only `notes`.")
    expect(reason({ notes: Array.from({ length: 21 }, () => ({ text: "x" })) })).toBe(
      "Add at most 20 notes in one call.",
    )
    expect(reason({ notes: [{ text: "two\nlines" }] })).toContain("one line of 1 to 500")
    expect(reason({ notes: [{ text: " " }] })).toContain("one line of 1 to 500")
    expect(reason({ notes: [{ text: "x", body: "y".repeat(8001) }] })).toContain("8,000")
    expect(reason({ notes: [{ text: "x", todo: "yes" }] })).toBe(
      "A note's `todo` is true or false.",
    )
    expect(reason({ notes: [{ text: "x", done: true }] })).toBe(
      "A note takes only `text`, `todo` and `body`.",
    )
    // Its line is trimmed, as the person's are.
    expect(readNoteRequest({ notes: [{ text: "  Ship it " }] })).toEqual({
      ok: true,
      request: { notes: [{ text: "Ship it" }] },
    })
  })
})
