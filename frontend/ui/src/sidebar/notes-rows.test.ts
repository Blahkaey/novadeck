import { noteLimits } from "@novadeck/core/notes"

import { describe, expect, it } from "../test"
import { addWords, clearDoneWords, doneCount, kindWords, movedWords, notesFull } from "./notes-rows"

describe("The Notes panel's words", () => {
  it("name what the add field adds, and what its button changes that to", () => {
    expect(addWords("todo")).toBe("Add a todo…")
    expect(addWords("note")).toBe("Add a note…")
    expect(kindWords("todo")).toBe("Adding todos · switch to plain notes")
    expect(kindWords("note")).toBe("Adding plain notes · switch to todos")
  })

  it("count the done todos, one or many", () => {
    expect(doneCount(1)).toBe("1 done todo")
    expect(doneCount(3)).toBe("3 done todos")
  })

  it("say what clearing the done todos does before it is confirmed", () => {
    expect(clearDoneWords(1)).toBe("1 done todo is deleted for good. You can’t bring it back.")
    expect(clearDoneWords(2)).toBe("2 done todos are deleted for good. You can’t bring them back.")
  })

  it("say where a moved note went", () => {
    expect(movedWords("Ship it", 0, 3)).toBe("Ship it, 1 of 3")
  })

  it("call a project full at its limit", () => {
    expect(notesFull(noteLimits.perProject - 1)).toBe(false)
    expect(notesFull(noteLimits.perProject)).toBe(true)
  })
})
