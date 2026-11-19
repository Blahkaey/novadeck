import { describe, expect, it } from "../test"
import { indexSpot, spotIn, stepSpot } from "./note-order"

describe("A note stepped one place", () => {
  const ids = ["a", "b", "c"]

  it("goes up before the note above it", () => {
    expect(stepSpot(ids, "b", -1)).toEqual({ before: "a", index: 0 })
  })

  it("goes down before the note two below it, or last past the end", () => {
    expect(stepSpot(ids, "a", 1)).toEqual({ before: "c", index: 1 })
    expect(stepSpot(ids, "b", 1)).toEqual({ before: null, index: 2 })
  })

  it("stays at either end, and for a note not in the list", () => {
    expect(stepSpot(ids, "a", -1)).toBeUndefined()
    expect(stepSpot(ids, "c", 1)).toBeUndefined()
    expect(stepSpot(ids, "z", 1)).toBeUndefined()
  })
})

describe("A note dragged to a place", () => {
  const ids = ["a", "b", "c"]

  it("stands before the note now at that place among the others, or last", () => {
    expect(indexSpot(ids, "c", 0)).toEqual({ before: "a", index: 0 })
    expect(indexSpot(ids, "a", 1)).toEqual({ before: "c", index: 1 })
    expect(indexSpot(ids, "a", 2)).toEqual({ before: null, index: 2 })
  })

  it("stays where it was dropped back in its place", () => {
    expect(indexSpot(ids, "b", 1)).toBeUndefined()
  })
})

describe("A note's place in a list it joins", () => {
  it("is the place of the note it goes before, or last, among one more", () => {
    expect(spotIn(["a", "b"], "b")).toEqual({ index: 1, count: 3 })
    expect(spotIn(["a", "b"], null)).toEqual({ index: 2, count: 3 })
    expect(spotIn([], null)).toEqual({ index: 0, count: 1 })
  })
})
