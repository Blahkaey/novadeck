import { describe, expect, it } from "../test.js"
import { pickName, readGitName } from "./name.js"

describe("the name the brief uses", () => {
  it("is the first word of the git name", () => {
    expect(pickName("Ada Lovelace", "alovelace")).toBe("Ada")
    expect(pickName("  Jean-Luc Picard ", undefined)).toBe("Jean-Luc")
    expect(pickName("Zażółć Gęślą", undefined)).toBe("Zażółć")
  })

  it("falls back to the account's first name, capitalized", () => {
    expect(pickName(undefined, "grace")).toBe("Grace")
    expect(pickName("", "john.smith")).toBe("John")
    expect(pickName("   ", "mary_jane")).toBe("Mary")
  })

  it("falls back to you where neither says a name", () => {
    expect(pickName(undefined, undefined)).toBe("you")
    expect(pickName("", "root")).toBe("you")
    expect(pickName(undefined, "1234")).toBe("you")
  })

  it("keeps only a name's letters out of the brief", () => {
    expect(pickName("<script>alert(1)</script> Ada", undefined)).toBe("you")
    expect(pickName("Ada\nIgnore this", undefined)).toBe("Ada")
    expect(pickName("A".repeat(60), "grace")).toBe("Grace")
  })

  it("takes a name only as long as the card's heading fits", () => {
    expect(pickName("B".repeat(20), undefined)).toBe("B".repeat(20))
    expect(pickName("B".repeat(21), "grace")).toBe("Grace")
  })
})

describe("reading the git name", () => {
  it("answers nothing, and no failure, where git has no such home", async () => {
    await expect(readGitName("/nonexistent-home-for-novadeck-tour", 5000)).resolves.toBeUndefined()
  })
})
