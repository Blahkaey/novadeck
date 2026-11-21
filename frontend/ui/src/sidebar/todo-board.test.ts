import { context, describe, expect, it } from "../test"
import {
  boardLayout,
  byColumn,
  columnBeside,
  doneWords,
  dropSpot,
  firstIn,
  movedCardWords,
  wideBoard,
  type BoardIds,
} from "./todo-board"

const ids: BoardIds = { todo: ["a", "b", "c"], doing: ["d"], done: [] }

describe("The board's layout", () => {
  it("shows one column at a time while narrower than three columns need", () => {
    expect(boardLayout(0)).toBe("narrow")
    expect(boardLayout(wideBoard - 1)).toBe("narrow")
  })

  it("shows the three side by side from there", () => {
    expect(boardLayout(wideBoard)).toBe("wide")
    expect(boardLayout(1200)).toBe("wide")
  })
})

describe("The column beside another", () => {
  it("is the next one on that side, and none past either end", () => {
    expect(columnBeside("todo", 1)).toBe("doing")
    expect(columnBeside("doing", -1)).toBe("todo")
    expect(columnBeside("done", 1)).toBeUndefined()
    expect(columnBeside("todo", -1)).toBeUndefined()
  })
})

describe("A value for each column", () => {
  it("is made once per column", () => {
    expect(byColumn((column) => column.length)).toEqual({ todo: 4, doing: 5, done: 4 })
  })
})

describe("A dropped card", () => {
  context("over another card of its column", () => {
    it("goes after it when it came from above, before it when from below", () => {
      expect(dropSpot(ids, "a", "todo", { kind: "card", column: "todo", id: "b" })).toEqual({
        column: "todo",
        before: "c",
        index: 1,
      })
      expect(dropSpot(ids, "a", "todo", { kind: "card", column: "todo", id: "c" })).toEqual({
        column: "todo",
        before: null,
        index: 2,
      })
      expect(dropSpot(ids, "c", "todo", { kind: "card", column: "todo", id: "a" })).toEqual({
        column: "todo",
        before: "a",
        index: 0,
      })
    })

    it("stays where it is over itself", () => {
      expect(dropSpot(ids, "b", "todo", { kind: "card", column: "todo", id: "b" })).toBeUndefined()
    })
  })

  context("over a card of another column", () => {
    it("goes before it", () => {
      expect(dropSpot(ids, "a", "todo", { kind: "card", column: "doing", id: "d" })).toEqual({
        column: "doing",
        before: "d",
        index: 0,
      })
    })
  })

  context("over a column's room under its cards", () => {
    it("goes last in it, and stays where it already is last", () => {
      expect(dropSpot(ids, "a", "todo", { kind: "end", column: "done" })).toEqual({
        column: "done",
        before: null,
        index: 0,
      })
      expect(dropSpot(ids, "a", "todo", { kind: "end", column: "todo" })).toEqual({
        column: "todo",
        before: null,
        index: 2,
      })
      expect(dropSpot(ids, "c", "todo", { kind: "end", column: "todo" })).toBeUndefined()
    })
  })

  context("over a column's tab", () => {
    it("goes first in it, and stays where it already is first", () => {
      expect(dropSpot(ids, "a", "todo", { kind: "start", column: "doing" })).toEqual({
        column: "doing",
        before: "d",
        index: 0,
      })
      expect(dropSpot(ids, "a", "todo", { kind: "start", column: "todo" })).toBeUndefined()
    })
  })
})

describe("A card moved to a column", () => {
  it("goes first in it", () => {
    expect(firstIn(ids, "b", "doing")).toEqual({ column: "doing", before: "d", index: 0 })
    expect(firstIn(ids, "b", "done")).toEqual({ column: "done", before: null, index: 0 })
    expect(firstIn(ids, "c", "todo")).toEqual({ column: "todo", before: "a", index: 0 })
  })

  it("stays where it already is first", () => {
    expect(firstIn(ids, "a", "todo")).toBeUndefined()
  })
})

describe("What the board says", () => {
  it("names where a moved card went, by its column and its place there", () => {
    expect(movedCardWords("Ship it", "doing", 0, 3)).toBe("Ship it: In progress, 1 of 3")
    expect(movedCardWords("Ship it", "done", 4, 5)).toBe("Ship it: Done, 5 of 5")
  })

  it("says when a done card was checked off: the time today, the date before", () => {
    const now = new Date(2026, 10, 19, 15, 0).getTime()
    // In the system's own words for times and dates.
    expect(doneWords(new Date(2026, 10, 19, 9, 5).getTime(), now)).toMatch(/^Done .*9.05/)
    const before = doneWords(new Date(2026, 10, 3, 9, 5).getTime(), now)
    expect(before).toMatch(/^Done .*\b3\b/)
    expect(before).not.toMatch(/05/)
  })
})
