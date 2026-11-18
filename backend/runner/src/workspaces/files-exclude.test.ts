import { filesExcludeLimits } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { describe, expect, it } from "../test.js"
import { filesExcludeOf, saveFilesExclude, type FilesExcludeRecords } from "./files-exclude.js"

const p = "00000000-0000-4000-8000-00000000000a"

// Rows in memory for project `p` alone, as the store keeps them: the text each holds.
const records = (saved?: string) => {
  const rows = new Map<string, string>(saved === undefined ? [] : [[p, saved]])
  const known = (projectId: string): void => {
    if (projectId !== p) throw new DomainError("NOT_FOUND", "Project not found")
  }
  const kept: FilesExcludeRecords = {
    savedFilesExcludeOf: (projectId) => rows.get(projectId),
    saveFilesExclude: (projectId, patterns) => {
      known(projectId)
      if (patterns === null) rows.delete(projectId)
      else rows.set(projectId, patterns)
    },
    project: known,
  }
  return { kept, rows }
}

describe("a project's patterns for hiding files", () => {
  it("are none where the project has kept none", () => {
    expect(filesExcludeOf(records().kept, p)).toEqual({})
  })

  it("read back as they were saved, each with its switch", () => {
    const { kept } = records()
    saveFilesExclude(kept, p, { "**/dist": true, "src/app/\\[id\\]": true, "*.log": false })

    expect(filesExcludeOf(kept, p)).toEqual({
      "**/dist": true,
      "src/app/\\[id\\]": true,
      "*.log": false,
    })
  })

  it("forget the row when none are saved", () => {
    const { kept, rows } = records('{"dist":true}')
    saveFilesExclude(kept, p, {})

    expect(rows.has(p)).toBe(false)
    expect(filesExcludeOf(kept, p)).toEqual({})
  })

  it("read as none from a row that isn't a map of patterns", () => {
    for (const saved of ["{not json", '["dist"]', "null", '"dist"'])
      expect(filesExcludeOf(records(saved).kept, p)).toEqual({})
  })

  it("keep what this build can hold of a row, and leave out the rest", () => {
    const saved = JSON.stringify({
      "**/dist": true,
      "*.log": { when: "$(basename).ts" },
      "*.tmp": "true",
      "": true,
      ["x".repeat(filesExcludeLimits.pattern + 1)]: true,
    })

    expect(filesExcludeOf(records(saved).kept, p)).toEqual({ "**/dist": true })
  })

  it("hold at most as many patterns as a project keeps, and keep what was there when refused", () => {
    const { kept } = records('{"dist":true}')
    const many = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, at) => [`${at}.log`, true]))
    saveFilesExclude(kept, p, many(filesExcludeLimits.patterns))

    expect(() => saveFilesExclude(kept, p, many(filesExcludeLimits.patterns + 1))).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        message: expect.stringContaining(`at most ${filesExcludeLimits.patterns} patterns`),
      }),
    )
    expect(Object.keys(filesExcludeOf(kept, p))).toHaveLength(filesExcludeLimits.patterns)
  })

  it("are refused for a project the runner doesn't have", () => {
    const { kept } = records()
    const other = "00000000-0000-4000-8000-00000000000b"

    expect(() => filesExcludeOf(kept, other)).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    )
    expect(() => saveFilesExclude(kept, other, {})).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    )
  })
})
