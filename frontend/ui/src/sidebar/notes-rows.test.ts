import { noteLimits } from "@novadeck/core/notes"

import { describe, expect, it } from "../test"
import { addedByWords, clearDoneWords, doneCount, movedWords, notesFull } from "./notes-rows"

describe("The Notes panel's and the Todo board's words", () => {
  it("count the done todos, one or many", () => {
    expect(doneCount(1)).toBe("1 done todo")
    expect(doneCount(3)).toBe("3 done todos")
  })

  it("say what clearing the done todos does before it is confirmed", () => {
    expect(clearDoneWords(1)).toBe("1 done todo is deleted for good. You can’t bring it back.")
    expect(clearDoneWords(2)).toBe("2 done todos are deleted for good. You can’t bring them back.")
  })

  it("name the agent that added a note by its harness and its terminal's handle", () => {
    expect(addedByWords({ agent: "claude", handle: "wren" })).toBe("Added by Claude Code · @wren")
    expect(addedByWords({ agent: "codex", handle: "pike" })).toBe("Added by Codex · @pike")
    expect(addedByWords({ agent: "agy", handle: "reed" })).toBe("Added by Antigravity · @reed")
  })

  it("say where a moved note went", () => {
    expect(movedWords("Ship it", 0, 3)).toBe("Ship it, 1 of 3")
  })

  it("call a project full at its limit", () => {
    expect(notesFull(noteLimits.perProject - 1)).toBe(false)
    expect(notesFull(noteLimits.perProject)).toBe(true)
  })
})
