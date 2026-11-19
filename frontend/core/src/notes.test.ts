import {
  added,
  boardCards,
  boardColumns,
  changed,
  doneNotes,
  moved,
  noteColumn,
  noteLimits,
  noteLine,
  openNotes,
  placed,
  plainNotes,
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

  it("counts a todo in progress as still to do", () => {
    expect(todosLeft([...notes, note("e", { doing: true })], "p")).toBe(2)
  })
})

describe("A project's Todo board", () => {
  const notes = [
    note("d", { doneAt: 30 }),
    note("a"),
    note("plain", { todo: false }),
    note("b", { doing: true }),
    note("other", { projectId: "q" }),
    note("c"),
    note("e", { doneAt: 90 }),
  ]

  it("shows its columns in order: To do, In progress, Done", () => {
    expect(boardColumns).toEqual(["todo", "doing", "done"])
  })

  it("puts each todo in the column of its state, and a plain note in none", () => {
    expect(notes.map((each) => [each.id, noteColumn(each)])).toEqual([
      ["d", "done"],
      ["a", "todo"],
      ["plain", null],
      ["b", "doing"],
      ["other", "todo"],
      ["c", "todo"],
      ["e", "done"],
    ])
  })

  it("lists each column's cards in the person's order, Done's too, and no other project's", () => {
    expect(ids(boardCards(notes, "p", "todo"))).toEqual(["a", "c"])
    expect(ids(boardCards(notes, "p", "doing"))).toEqual(["b"])
    expect(ids(boardCards(notes, "p", "done"))).toEqual(["d", "e"])
    expect(ids(boardCards(notes, "q", "todo"))).toEqual(["other"])
  })

  it("lists the plain notes apart, in the person's order", () => {
    const more = [...notes, note("later", { todo: false })]
    expect(ids(plainNotes(more, "p"))).toEqual(["plain", "later"])
    expect(plainNotes(more, "q")).toEqual([])
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

    it("goes first in Done, out of In progress", () => {
      const board = [
        note("x", { doneAt: 10 }),
        note("y", { projectId: "q", doneAt: 5 }),
        note("a"),
        note("b", { doing: true }),
      ]
      const checked = changed(board, "b", { done: true }, 50)

      expect(ids(checked)).toEqual(["b", "x", "y", "a"])
      expect(checked[0]).toEqual(note("b", { doneAt: 50 }))
    })

    it("stays where it was where its project has nothing done yet", () => {
      const board = [note("a"), note("x", { projectId: "q", doneAt: 5 }), note("b")]

      expect(ids(changed(board, "b", { done: true }, 50))).toEqual(["a", "x", "b"])
    })
  })

  context("when opened again", () => {
    it("goes first in To do, out of Done", () => {
      const board = [
        note("plain", { todo: false }),
        note("busy", { doing: true }),
        note("a"),
        note("b", { doneAt: 10 }),
      ]
      const opened = changed(board, "b", { done: false }, 50)

      expect(ids(opened)).toEqual(["plain", "busy", "b", "a"])
      expect(opened[2]).toEqual(note("b"))
    })
  })

  context("when in progress", () => {
    const board = [note("a"), note("b", { doing: true }), note("c")]

    it("keeps its place and its column through a change of its words", () => {
      const edited = changed(board, "b", { text: "Busy", body: "More." }, 50)
      expect(ids(edited)).toEqual(["a", "b", "c"])
      expect(edited[1]).toEqual(note("b", { text: "Busy", body: "More.", doing: true }))
      // Not checked off, it is not opened again either.
      expect(changed(board, "b", { done: false }, 50)).toBe(board)
    })

    it("is a plain note where it was once its checkbox is taken away, in progress no more", () => {
      const plain = changed(board, "b", { todo: false }, 50)
      expect(ids(plain)).toEqual(["a", "b", "c"])
      expect(plain[1]).toEqual(note("b", { todo: false }))
    })
  })

  context("when its checkbox is taken away", () => {
    it("is a plain note where it stood, which is never done", () => {
      const board = [note("a"), note("b", { doneAt: 10 }), note("c", { doneAt: 20 })]
      expect(ids(changed(board, "c", { todo: false }, 60))).toEqual(["a", "b", "c"])
    })

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

describe("Placing a note", () => {
  const notes = [
    note("a"),
    note("plain1", { todo: false }),
    note("busy", { doing: true }),
    note("x", { projectId: "q" }),
    note("b"),
    note("done1", { doneAt: 10 }),
    note("plain2", { todo: false }),
    note("done2", { doneAt: 20 }),
    note("c"),
  ]
  const place = (id: string, column: Parameters<typeof placed>[2], before: string | null) =>
    placed(notes, id, column, before, 500)

  it("moves a todo into another column, before the card it is dropped on", () => {
    const after = place("c", "doing", "busy")
    expect(ids(after)).toEqual(["a", "plain1", "c", "busy", "x", "b", "done1", "plain2", "done2"])
    expect(after[2]).toEqual(note("c", { doing: true }))
  })

  it("moves a todo within its column, the other notes keeping their places", () => {
    expect(ids(place("c", "todo", "a"))).toEqual([
      "c",
      "a",
      "plain1",
      "busy",
      "x",
      "b",
      "done1",
      "plain2",
      "done2",
    ])
  })

  it("puts it after the column's last card where it is dropped on none, or on another column's", () => {
    const last = ["plain1", "busy", "x", "b", "done1", "plain2", "done2", "c", "a"]
    expect(ids(place("a", "todo", null))).toEqual(last)
    expect(ids(place("a", "todo", "busy"))).toEqual(last)
    expect(ids(place("a", "todo", "x"))).toEqual(last)
    expect(ids(place("a", "todo", "nope"))).toEqual(last)
  })

  it("leaves it where it was in a column that has no other card", () => {
    const empty = [note("a"), note("b"), note("c")]
    expect(placed(empty, "b", "doing", "c", 500)).toEqual([
      note("a"),
      note("b", { doing: true }),
      note("c"),
    ])
  })

  it("has it done from then on entering Done, and keeps that time as it moves within Done", () => {
    const entered = place("a", "done", "done1")
    expect(ids(entered).slice(4, 7)).toEqual(["a", "done1", "plain2"])
    expect(entered.find((each) => each.id === "a")).toEqual(note("a", { doneAt: 500 }))

    const within = place("done2", "done", "done1")
    expect(within.find((each) => each.id === "done2")).toEqual(note("done2", { doneAt: 20 }))
    expect(ids(within)).toEqual(["a", "plain1", "busy", "x", "b", "done2", "done1", "plain2", "c"])
  })

  it("opens a done card dropped in To do or In progress, in progress only there", () => {
    expect(place("done1", "todo", null).find((each) => each.id === "done1")).toEqual(note("done1"))
    expect(place("done1", "doing", null).find((each) => each.id === "done1")).toEqual(
      note("done1", { doing: true }),
    )
    expect(place("busy", "todo", "a").find((each) => each.id === "busy")).toEqual(note("busy"))
  })

  it("reorders a plain note among the plain notes, with no column", () => {
    expect(ids(place("plain2", null, "plain1"))).toEqual([
      "a",
      "plain2",
      "plain1",
      "busy",
      "x",
      "b",
      "done1",
      "done2",
      "c",
    ])
    expect(ids(place("plain1", null, "a"))).toEqual([
      "a",
      "busy",
      "x",
      "b",
      "done1",
      "plain2",
      "plain1",
      "done2",
      "c",
    ])
  })

  it("changes nothing for a column given a plain note, none given a todo, or an unknown note", () => {
    expect(place("plain1", "todo", null)).toBe(notes)
    expect(place("a", null, null)).toBe(notes)
    expect(place("nope", "todo", null)).toBe(notes)
  })

  it("changes nothing for a note already in its place", () => {
    const still = [note("a"), note("b"), note("plain", { todo: false }), note("d", { doneAt: 5 })]
    expect(placed(still, "a", "todo", "b", 500)).toBe(still)
    expect(placed(still, "b", "todo", null, 500)).toBe(still)
    expect(placed(still, "plain", null, null, 500)).toBe(still)
    expect(placed(still, "d", "done", null, 500)).toBe(still)
  })
})

describe("Removing notes", () => {
  it("takes the named ones away, and leaves the notes as they are where none is named", () => {
    const notes = [note("a"), note("b"), note("c")]

    expect(ids(removed(notes, ["a", "c", "nope"]))).toEqual(["b"])
    expect(removed(notes, ["nope"])).toBe(notes)
  })
})
