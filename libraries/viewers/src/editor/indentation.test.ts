import { describe, expect, it } from "vitest"

import { indentUnitOf } from "./indentation.js"

describe("a file's indentation", () => {
  it("is a tab where tab-indented lines outnumber space-indented ones", () => {
    expect(indentUnitOf("func f() {\n\tif ok {\n\t\trun()\n\t}\n  // aligned\n}", "f.go")).toBe(
      "\t",
    )
  })

  it("is spaces where space-indented lines are as many or more", () => {
    expect(indentUnitOf("a:\n\tb\n  c\n", "a.txt")).toBe("  ")
  })

  it("is the step of spaces the file goes in by most", () => {
    expect(indentUnitOf("def f():\n    if ok:\n        go()\n    return\n", "f.py")).toBe("    ")
    expect(indentUnitOf("a:\n  b:\n    c: 1\n  d: 2\n", "a.yaml")).toBe("  ")
  })

  it("takes no step from a doc comment's lines, nor from alignment past eight", () => {
    const text =
      "/**\n * Runs it.\n */\nexport const f = () => {\n    go(\n                   x)\n}\n"
    expect(indentUnitOf(text, "f.ts")).toBe("    ")
  })

  it("takes the smaller of two steps taken as often", () => {
    expect(indentUnitOf("a\n    b\nc\n  d\n", "a.txt")).toBe("  ")
  })

  it("is two spaces where the file goes in nowhere, or is empty", () => {
    expect(indentUnitOf("one\ntwo\n", "notes.txt")).toBe("  ")
    expect(indentUnitOf("", "notes.txt")).toBe("  ")
  })

  it("is a tab in a Makefile whatever it holds, an empty one too", () => {
    expect(indentUnitOf("", "Makefile")).toBe("\t")
    expect(indentUnitOf("", "src/GNUmakefile")).toBe("\t")
    expect(indentUnitOf("", "makefile")).toBe("\t")
    expect(indentUnitOf("X = a \\\n    b\nY = c \\\n    d\n", "build/rules.mk")).toBe("\t")
  })
})
