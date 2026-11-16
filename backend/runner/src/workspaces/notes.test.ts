import { noteLimits, type Note, type NotesChange } from "@novadeck/protocol"

import { describe, expect, it } from "../test.js"
import { memoryNotes, Notes } from "./notes.js"

const p = "00000000-0000-4000-8000-00000000000a"
const q = "00000000-0000-4000-8000-00000000000b"
const idOf = (number: number): string =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`

// Notes over records of two projects, on a clock that moves a step with each reading.
const setup = (records = memoryNotes([p, q])) => {
  let clock = 1000
  const notes = new Notes(records, () => (clock += 10))
  // Adds todos named by number to `p`, the last first.
  const fill = (...numbers: number[]): void => {
    for (const number of numbers)
      notes.add({ id: idOf(number), projectId: p, text: `Note ${number}`, todo: true })
  }
  return { notes, records, fill }
}

const texts = (notes: readonly Note[]): string[] => notes.map(({ text }) => text)

// What a watcher has been told so far, once the stream has had a moment to deliver it.
const follow = (notes: Notes) => {
  const heard: NotesChange[] = []
  const control = new AbortController()
  const done = (async () => {
    for await (const change of notes.watch(control.signal)) heard.push(change)
  })()
  const settle = async (): Promise<NotesChange[]> => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return heard
  }
  return { settle, stop: () => (control.abort(), done) }
}

describe("a project's notes", () => {
  it("adds each first, open and with no body, and keeps other projects' apart", () => {
    const { notes } = setup()
    notes.add({ id: idOf(1), projectId: p, text: "Ship it", todo: true })
    const after = notes.add({ id: idOf(2), projectId: p, text: "Remember the flag", todo: false })
    notes.add({ id: idOf(3), projectId: q, text: "Elsewhere", todo: true })

    expect(after).toEqual([
      {
        id: idOf(2),
        projectId: p,
        text: "Remember the flag",
        body: "",
        todo: false,
        doneAt: null,
        createdAt: 1020,
      },
      {
        id: idOf(1),
        projectId: p,
        text: "Ship it",
        body: "",
        todo: true,
        doneAt: null,
        createdAt: 1010,
      },
    ])
    expect(texts(notes.list(q))).toEqual(["Elsewhere"])
  })

  it("refuses a project it doesn't have, an id the project has, and one note too many", () => {
    const { notes, fill } = setup()
    const add = (number: number, projectId = p) =>
      notes.add({ id: idOf(number), projectId, text: "x", todo: true })
    expect(() => add(1, idOf(999))).toThrow(expect.objectContaining({ code: "NOT_FOUND" }))
    expect(() => notes.list(idOf(999))).toThrow(expect.objectContaining({ code: "NOT_FOUND" }))
    fill(1)
    expect(() => add(1)).toThrow(expect.objectContaining({ code: "CONFLICT" }))
    for (let number = 2; number <= noteLimits.perProject; number += 1) add(number)
    expect(() => add(noteLimits.perProject + 1)).toThrow(
      expect.objectContaining({ code: "CONFLICT", message: expect.stringContaining("at most") }),
    )
    // Another project's notes don't fill this one.
    expect(add(1, q)).toHaveLength(1)
  })

  it("changes only what is given, and trims the end of a body", () => {
    const { notes, fill } = setup()
    fill(1)
    notes.update({ projectId: p, id: idOf(1), body: "More.\n\n" })
    const [after] = notes.update({ projectId: p, id: idOf(1), text: "Ship it today" })

    expect(after).toMatchObject({ text: "Ship it today", body: "More.", todo: true, doneAt: null })
    expect(() => notes.update({ projectId: p, id: idOf(9), text: "x" })).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    )
  })

  it("checks a todo off from then, keeps when it was done, and opens it again", () => {
    const { notes, fill } = setup()
    fill(1)
    const [checked] = notes.update({ projectId: p, id: idOf(1), done: true })
    expect(checked!.doneAt).toBe(1020)
    expect(notes.update({ projectId: p, id: idOf(1), done: true })[0]!.doneAt).toBe(1020)
    expect(notes.update({ projectId: p, id: idOf(1), done: false })[0]!.doneAt).toBeNull()
  })

  it("never has a plain note done: without its checkbox a done todo is open again", () => {
    const { notes, fill } = setup()
    fill(1)
    notes.update({ projectId: p, id: idOf(1), done: true })
    expect(notes.update({ projectId: p, id: idOf(1), todo: false })[0]).toMatchObject({
      todo: false,
      doneAt: null,
    })
    expect(notes.update({ projectId: p, id: idOf(1), done: true })[0]!.doneAt).toBeNull()
  })

  it("moves an open note among the open ones, within their ends, the done ones staying", () => {
    const { notes, fill } = setup()
    fill(4, 3, 2, 1)
    notes.update({ projectId: p, id: idOf(2), done: true })
    // Open: 1, 3, 4, with 2 done between 1 and 3.
    expect(texts(notes.move({ projectId: p, id: idOf(4), index: 0 }))).toEqual([
      "Note 4",
      "Note 2",
      "Note 1",
      "Note 3",
    ])
    expect(texts(notes.move({ projectId: p, id: idOf(4), index: 99 }))).toEqual([
      "Note 1",
      "Note 2",
      "Note 3",
      "Note 4",
    ])
    expect(() => notes.move({ projectId: p, id: idOf(2), index: 0 })).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    )
    expect(() => notes.move({ projectId: p, id: idOf(9), index: 0 })).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    )
  })

  it("deletes the named notes, skipping ids it doesn't have, and keeps no row for none", () => {
    const { notes, records, fill } = setup()
    fill(3, 2, 1)
    expect(texts(notes.remove({ projectId: p, ids: [idOf(1), idOf(3), idOf(9)] }))).toEqual([
      "Note 2",
    ])
    expect(notes.remove({ projectId: p, ids: [idOf(2)] })).toEqual([])
    expect(records.savedNotesOf(p)).toBeUndefined()
  })

  it("comes back from what it kept, and reads as none what it can't read", () => {
    const { notes, records, fill } = setup()
    fill(2, 1)
    expect(texts(new Notes(records).list(p))).toEqual(["Note 1", "Note 2"])
    records.saveNotes(q, '[{"id":"not a note"}]')
    records.saveNotes(p, "{")
    expect(notes.list(q)).toEqual([])
    expect(notes.list(p)).toEqual([])
    // The next change replaces what couldn't be read.
    fill(3)
    expect(texts(notes.list(p))).toEqual(["Note 3"])
  })
})

describe("following the notes", () => {
  it("tells of each project that has any, then synced, then each change whole", async () => {
    const { notes, fill } = setup()
    fill(1)
    const watcher = follow(notes)
    expect(await watcher.settle()).toMatchObject([
      { type: "changed", projectId: p, notes: [{ text: "Note 1" }] },
      { type: "synced" },
    ])
    notes.add({ id: idOf(5), projectId: q, text: "Elsewhere", todo: false })
    notes.remove({ projectId: p, ids: [idOf(1)] })
    expect((await watcher.settle()).slice(2)).toMatchObject([
      { type: "changed", projectId: q, notes: [{ text: "Elsewhere" }] },
      { type: "changed", projectId: p, notes: [] },
    ])
    await watcher.stop()
  })

  it("tells nothing for a change that changes nothing", async () => {
    const { notes, fill } = setup()
    fill(1)
    const watcher = follow(notes)
    await watcher.settle()
    notes.update({ projectId: p, id: idOf(1), text: "Note 1", done: false })
    notes.move({ projectId: p, id: idOf(1), index: 0 })
    expect(await watcher.settle()).toHaveLength(2)
    await watcher.stop()
  })

  it("tells that a removed project has none", async () => {
    const { notes, fill } = setup()
    fill(1)
    const watcher = follow(notes)
    await watcher.settle()
    notes.projectRemoved(p)
    expect((await watcher.settle()).slice(2)).toEqual([
      { type: "changed", projectId: p, notes: [] },
    ])
    await watcher.stop()
  })

  it("ends every watcher as it closes, and takes no change after", async () => {
    const { notes, fill } = setup()
    const watcher = follow(notes)
    await watcher.settle()
    notes.close()
    await watcher.stop()
    expect(() => fill(1)).toThrow(expect.objectContaining({ code: "CLOSING" }))
    await expect(notes.watch().next()).rejects.toMatchObject({ code: "CLOSING" })
  })
})
