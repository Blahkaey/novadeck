import { describe, expect, it } from "../../test"
import { rangesOf } from "./ProjectFile"

describe("the lines another writer changed, in a Markdown file", () => {
  const text = "# Cart\n\nTotal.\nTax"

  it("spans each line, without its break", () => {
    expect(rangesOf(text, [{ from: 1, to: 1 }])).toEqual([
      { from: 0, to: 6, className: "cm-file-changed" },
    ])
  })

  it("spans a run of lines to the text's end", () => {
    expect(rangesOf(text, [{ from: 3, to: 4 }])).toEqual([
      { from: 8, to: text.length, className: "cm-file-changed" },
    ])
  })

  it("spans nothing for a line past the end", () => {
    expect(rangesOf(text, [{ from: 9, to: 9 }])).toEqual([])
  })
})
