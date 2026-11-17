import {
  added,
  changed,
  doneNotes,
  moved,
  noteLimits,
  noteLine,
  openNotes,
  removed,
  todosLeft,
  type Note,
} from "./notes"
import { context, describe, expect, it } from "./test"

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

const ids = (notes: readonly Note[]): string[] => notes.map(({ id }) => id)

describe("A project's notes", () => {
  const notes = [
    note("a"),
    note("b", { doneAt: 20 }),
    note("other", { projectId: "q" }),
    note("c", { todo: false }),
    note("d", { doneAt: 30 }),
  ]

  it("lists the open ones in the person's order, and no other project's", () => {
    expect(ids(openNotes(notes, "p"))).toEqual(["a", "c"])
    expect(ids(openNotes(notes, "q"))).toEqual(["other"])
  })

  it("lists the ones checked off apart, the one checked last first", () => {
    expect(ids(doneNotes(notes, "p"))).toEqual(["d", "b"])
  })

  it("counts the todos still to do, not the plain notes", () => {
    expect(todosLeft(notes, "p")).toBe(1)
    expect(todosLeft(notes, "none")).toBe(0)
  })
})

describe("A note's line", () => {
  it("is kept on one line, with no white space around it", () => {
    expect(noteLine("  Ship it \n\n  today \r\n")).toBe("Ship it today")
  })

  it("holds nothing one line may not: a tab, a control character or a mark that reorders text", () => {
    expect(noteLine("Ship\tit\u0007")).toBe("Ship it")
    expect(noteLine("to\u202Eday")).toBe("to day")
  })

  it("is cut to its limit, never through a character", () => {
    expect(noteLine("x".repeat(noteLimits.text + 10))).toHaveLength(noteLimits.text)
    expect(noteLine(`${"x".repeat(noteLimits.text - 1)}😀`)).toBe("x".repeat(noteLimits.text - 1))
  })
})

describe("Adding a note", () => {
  it("puts it first among its project's", () => {
    const notes = [note("a"), note("other", { projectId: "q" })]

    expect(ids(added(notes, note("new")))).toEqual(["new", "a", "other"])
  })

  it("adds nothing with nothing to say, under an id already there, or to a full project", () => {
    const notes = [note("a")]
    expect(added(notes, note("new", { text: "" }))).toBe(notes)
    expect(added(notes, note("a", { text: "again" }))).toBe(notes)
    const full = Array.from({ length: noteLimits.perProject }, (_, index) => note(`n${index}`))
    expect(added(full, note("new"))).toBe(full)
    // Another project's notes don't fill this one.
    expect(added(full, note("new", { projectId: "q" }))).toHaveLength(full.length + 1)
  })
})

describe("Changing a note", () => {
  const notes = [note("a", { text: "Ship it", body: "Soon." }), note("b")]
  const after = (change: Parameters<typeof changed>[2], now = 50): Note =>
    changed(notes, "a", change, now)[0]!

  it("takes new words, its line on one line and its body without trailing space", () => {
    expect(after({ text: " Ship\nit now " })).toMatchObject({ text: "Ship it now", body: "Soon." })
    expect(after({ body: "Later.\n\n" }).body).toBe("Later.")
    expect(after({ body: "" }).body).toBe("")
  })

  it("keeps its line where the new one would be empty", () => {
    expect(changed(notes, "a", { text: "   " }, 50)).toBe(notes)
  })

  context("when checked off", () => {
    it("is done from then, and open again once unchecked", () => {
      const checked = changed(notes, "a", { done: true }, 50)
      expect(checked[0]!.doneAt).toBe(50)
      // Checked again, it keeps when it was first done.
      expect(changed(checked, "a", { done: true }, 90)).toBe(checked)
      expect(changed(checked, "a", { done: false }, 90)[0]!.doneAt).toBeNull()
    })
  })

  context("when its checkbox is taken away", () => {
    it("is a plain note, which is never done", () => {
      const checked = changed(notes, "a", { done: true }, 50)
      expect(changed(checked, "a", { todo: false }, 60)[0]).toMatchObject({
        todo: false,
        doneAt: null,
      })
      expect(after({ todo: false, done: true })).toMatchObject({ todo: false, doneAt: null })
    })
  })

  it("keeps the agent that added it, whatever the person changes", () => {
    const by = { agent: "codex", handle: "pike" } as const
    const theirs = [note("a", { by })]

    expect(changed(theirs, "a", { text: "Mine now", body: "More.", done: true }, 50)[0]).toEqual(
      note("a", { text: "Mine now", body: "More.", doneAt: 50, by }),
    )
    expect(changed(theirs, "a", { todo: false }, 50)[0]!.by).toEqual(by)
  })

  it("leaves the notes as they are for a change that changes nothing, or an unknown note", () => {
    expect(changed(notes, "a", { text: "Ship it", done: false }, 50)).toBe(notes)
    expect(changed(notes, "nope", { text: "x" }, 50)).toBe(notes)
  })
})

describe("Moving a note", () => {
  const notes = [
    note("a"),
    note("x", { projectId: "q" }),
    note("b", { doneAt: 5 }),
    note("c"),
    note("d"),
  ]

  it("puts it at its new place among its project's open notes, the rest keeping theirs", () => {
    expect(ids(moved(notes, "d", 0))).toEqual(["d", "x", "b", "a", "c"])
    expect(ids(moved(notes, "a", 1))).toEqual(["c", "x", "b", "a", "d"])
  })

  it("stops at the ends of the list", () => {
    expect(ids(moved(notes, "a", 9))).toEqual(["c", "x", "b", "d", "a"])
    expect(ids(moved(notes, "c", -3))).toEqual(["c", "x", "b", "a", "d"])
  })

  it("moves nothing that is where it was, checked off, or unknown", () => {
    expect(moved(notes, "a", 0)).toBe(notes)
    expect(moved(notes, "b", 0)).toBe(notes)
    expect(moved(notes, "nope", 0)).toBe(notes)
  })
})

describe("Removing notes", () => {
  it("takes the named ones away, and leaves the notes as they are where none is named", () => {
    const notes = [note("a"), note("b"), note("c")]

    expect(ids(removed(notes, ["a", "c", "nope"]))).toEqual(["b"])
    expect(removed(notes, ["nope"])).toBe(notes)
  })
})
