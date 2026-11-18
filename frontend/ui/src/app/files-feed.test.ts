import type { Work, WorkFile } from "@novadeck/core/works"

import { context, describe, expect, it } from "../test"
import { copyOf, keptEdits, previewFiles, savingFirst } from "./files-feed"

const file = (path: string, extra: Partial<WorkFile> = {}): WorkFile => ({
  path,
  status: "modified",
  changedAt: 1,
  added: 1,
  removed: 0,
  unreadAdded: 0,
  unreadRemoved: 0,
  conflict: false,
  ...extra,
})
const work = (name: string, files: WorkFile[], extra: Partial<Work> = {}): Work => ({
  root: `/w/${name}`,
  terminalId: null,
  projectId: "p",
  working: false,
  branch: name,
  base: "main",
  firstSeenAt: 1,
  merged: false,
  added: 0,
  removed: 0,
  unreadAdded: 0,
  unreadRemoved: 0,
  files,
  truncated: false,
  folder: { repo: "", project: "" },
  conflicts: [],
  ...extra,
})

describe("the files a preview is made of", () => {
  const renamer = work("renamer", [file("b.ts", { status: "renamed", from: "a.ts" })])
  const editor = work("editor", [file("a.ts")])
  const other = work("other", [file("c.ts")])

  it("are those at the path, those renamed away from it, and, for the new path, changes to the old one", () => {
    const roots = (path: string) =>
      previewFiles([renamer, editor, other], "p", path).map(({ work: each }) => each.root)
    expect(roots("a.ts")).toEqual(["/w/renamer", "/w/editor"])
    expect(roots("b.ts")).toEqual(["/w/renamer", "/w/editor"])
    expect(roots("c.ts")).toEqual(["/w/other"])
    expect(roots("d.ts")).toEqual([])
  })

  it("leave out another project's works", () => {
    expect(previewFiles([{ ...editor, projectId: "q" }], "p", "a.ts")).toEqual([])
  })
})

describe("where a file main lacks opens", () => {
  it("is the last writer's copy in its worktree", () => {
    const first = work("first", [file("n.ts", { status: "added", changedAt: 5 })])
    const second = work("second", [file("n.ts", { status: "added", changedAt: 9 })])
    expect(copyOf([first, second], "p", "n.ts")).toBe("/w/second/n.ts")
    expect(copyOf([first, second], "p", "x.ts")).toBeUndefined()
  })
})

describe("the Files panel's moves and deletes", () => {
  // The panel's changes over a backend that records them, saving first as `go` answers, with
  // what each asked to save before.
  const changes = (go: boolean) => {
    const made: string[] = []
    const asked: string[] = []
    const { move, remove } = savingFirst(
      {
        move: async (from, to) => {
          made.push(`move ${from} ${to}`)
          return to
        },
        remove: async (path) => void made.push(`delete ${path}`),
      },
      async (path, action) => {
        asked.push(`${action} ${path}`)
        return go
      },
    )
    return { move: move!, remove: remove!, made, asked }
  }

  it("saves first what a rename in its folder leaves, then renames", async () => {
    const { move, made, asked } = changes(true)
    await expect(move("src/cart.ts", "src/basket.ts")).resolves.toBe("src/basket.ts")
    expect(asked).toEqual(["rename src/cart.ts"])
    expect(made).toEqual(["move src/cart.ts src/basket.ts"])
  })

  it("saves first what a move to another folder leaves, as a move", async () => {
    const { move, asked } = changes(true)
    await move("src/cart.ts", "lib/cart.ts")
    expect(asked).toEqual(["move src/cart.ts"])
  })

  it("saves first what a delete leaves, then deletes", async () => {
    const { remove, made, asked } = changes(true)
    await remove("src")
    expect(asked).toEqual(["delete src"])
    expect(made).toEqual(["delete src"])
  })

  context("when the person stays with edits that can't be saved", () => {
    it("makes neither, saying why", async () => {
      const { move, remove, made } = changes(false)
      await expect(move("src/cart.ts", "src/basket.ts")).rejects.toThrow(keptEdits)
      await expect(remove("src/cart.ts")).rejects.toThrow(keptEdits)
      expect(made).toEqual([])
    })
  })

  it("offers neither where the backend can't make it", () => {
    expect(savingFirst({}, async () => true)).toEqual({})
  })
})
