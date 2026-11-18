import { describe, expect, it } from "../test.js"
import { copyName } from "./copy.js"

// Each name a copy tries in turn after `name`, as many as `count`.
const names = (name: string, folder: boolean, count: number): string[] =>
  Array.from({ length: count }).reduce<string[]>(
    (tried) => [...tried, copyName(tried.at(-1) ?? name, folder)],
    [],
  )

describe("the name a copy takes", () => {
  it("puts copy before a file's extension, then counts from 2", () => {
    expect(names("useCart.ts", false, 4)).toEqual([
      "useCart copy.ts",
      "useCart copy 2.ts",
      "useCart copy 3.ts",
      "useCart copy 4.ts",
    ])
  })

  it("takes the extension after the last dot only", () => {
    expect(copyName("release.tar.gz", false)).toBe("release.tar copy.gz")
  })

  it("puts copy at the end of a name whose only dot leads it, and of one with no dot", () => {
    expect(names(".env", false, 2)).toEqual([".env copy", ".env copy 2"])
    expect(copyName("Makefile", false)).toBe("Makefile copy")
    expect(copyName(".eslintrc.json", false)).toBe(".eslintrc copy.json")
  })

  it("puts copy at the end of a folder's whole name, dots and all", () => {
    expect(names("src", true, 2)).toEqual(["src copy", "src copy 2"])
    expect(copyName("v1.2", true)).toBe("v1.2 copy")
  })

  it("counts on from a copy's own name, as a copy of a copy", () => {
    expect(copyName("useCart copy.ts", false)).toBe("useCart copy 2.ts")
    expect(copyName("useCart copy 9.ts", false)).toBe("useCart copy 10.ts")
    expect(copyName("src copy 2", true)).toBe("src copy 3")
  })

  it("takes copy that is only part of a word as the name it is", () => {
    expect(copyName("photocopy.ts", false)).toBe("photocopy copy.ts")
    expect(copyName("copy.ts", false)).toBe("copy copy.ts")
  })
})
