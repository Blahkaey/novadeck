import type { TerminalMetadata, Workspace } from "@novadeck/core/types"
import { createDemoFiles, demoPaths } from "@novadeck/demo/files"
import { vi } from "vitest"

import { restoreClipboard } from "./clipboard"
import { filesGroups } from "./files"
import { describe, expect, it } from "./test"
import type { DemoActionContext } from "./types"

const context = (selected?: DemoActionContext["selected"]): DemoActionContext => ({
  target: "selected",
  harness: "claude",
  selected: selected ?? (() => undefined),
  select: () => {},
  addTerminal: () => {
    throw new Error("unused")
  },
  addInBackground: () => {
    throw new Error("unused")
  },
  startFresh: () => undefined,
  dispatch: undefined,
  workspace: () => undefined,
  note: () => undefined,
  crash: () => undefined,
})

// The launch's file operations, which an action that boots again turns on or off.
const offering = () => {
  const offered: boolean[] = []
  return {
    offered,
    launch: { setFileOperations: (next: boolean) => void offered.push(next) },
  }
}

const run = (
  files: ReturnType<typeof createDemoFiles>,
  label: string,
  selected?: DemoActionContext["selected"],
  workspace?: Workspace,
  launch = offering().launch,
) => {
  const [group] = filesGroups(files, launch)
  void group!.actions
    .find((action) => action.label === label)!
    .run({ ...context(selected), workspace: () => workspace })
}

// A workspace whose storefront has the terminals given, in its initial session.
const storefront = (terminals: Partial<TerminalMetadata>[]): Workspace =>
  ({
    projects: [
      {
        id: "storefront",
        history: [{ id: "initial", state: { roster: { terminals } } }],
      },
    ],
  }) as unknown as Workspace

const key = (terminalId: string) => ({
  projectId: "storefront",
  workspaceSessionId: "initial",
  terminalId,
})

const project = (files: ReturnType<typeof createDemoFiles>) =>
  files.state.getSnapshot().projects.storefront!

describe("the debug panel's Files group", () => {
  it("is absent where the demo has no files", () => {
    expect(filesGroups(undefined, offering().launch)).toEqual([])
  })

  it("hints what each action shows", () => {
    const [group] = filesGroups(createDemoFiles(1), offering().launch)
    expect(group!.actions.every((action) => action.hint.length > 0)).toBe(true)
  })

  it("has Crow write a file now", () => {
    const files = createDemoFiles(1)
    run(files, "Agent writes a file")
    expect(Object.values(project(files).changes).some((each) => each.touched.crow! > 1)).toBe(true)
  })

  it("stops Crow's cursor and keeps its changes, as a Files-only fixture", () => {
    const files = createDemoFiles(1)
    const [group] = filesGroups(files, offering().launch)
    expect(group!.actions.some((action) => action.label === "Agent ends its turn")).toBe(false)
    run(files, "Agent stops writing (Files only)")
    expect(project(files).writing.crow).toBeUndefined()
    expect(project(files).changes[demoPaths.checkoutTest]).toBeDefined()
  })

  const workspace = storefront([
    { id: "t1", handle: "moth", state: "running", process: "claude" },
    { id: "t2", handle: "fox", state: "running", process: "pnpm" },
  ])

  it("writes as the selected terminal's agent", () => {
    const files = createDemoFiles(1)
    run(files, "Agent writes a file", () => key("t1"), workspace)
    expect(project(files).writing.moth).toBeDefined()
  })

  it("writes as Crow where the selected terminal is no agent", () => {
    const files = createDemoFiles(1)
    run(files, "Agent writes a file", () => key("t2"), workspace)
    expect(project(files).writing.fox).toBeUndefined()
    expect(Object.values(project(files).changes).some((each) => each.touched.crow! > 1)).toBe(true)
  })

  it("has a third agent change Checkout.tsx, so it has three", () => {
    const files = createDemoFiles(1)
    run(files, "Third agent edits Checkout.tsx")
    const touched = project(files).changes[demoPaths.checkout]!.touched
    expect(Object.keys(touched)).toHaveLength(3)
    expect(touched.owl).toBeDefined()
    expect(touched.fox).toBeUndefined()
    expect(project(files).writing.owl).toBeUndefined()
  })

  it("has an agent create a file in a folder the project lacks a change in", () => {
    const files = createDemoFiles(1)
    run(files, "Agent creates a file in a folder")
    expect(project(files).changes[demoPaths.payments]?.kind).toBe("added")
  })

  it("has a folder fail, list only part, and the root fail, until the files reads normally again", async () => {
    const files = createDemoFiles(1)
    run(files, "A folder can't be read")
    run(files, "A folder lists only part")
    await expect(files.list("storefront", "src/cart")).rejects.toThrow()
    expect((await files.list("storefront", "src/components")).truncated).toBe(true)
    run(files, "The project's files can't be read")
    await expect(files.list("storefront", "")).rejects.toThrow()
    run(files, "The project's folder is empty")
    expect((await files.list("storefront", "")).entries).toEqual([])
    run(files, "The project lists only part")
    expect((await files.list("storefront", "")).truncated).toBe(true)
    run(files, "Files read normally again")
    expect((await files.list("storefront", "src/cart")).entries.length).toBeGreaterThan(0)
    expect((await files.list("storefront", "src/components")).truncated).toBe(false)
    expect((await files.list("storefront", "")).entries.length).toBeGreaterThan(0)
  })

  it("has copying a path refused until the files read normally again", async () => {
    const copied: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
      configurable: true,
    })
    try {
      const files = createDemoFiles(1)
      run(files, "Copying a path fails")
      await expect(navigator.clipboard.writeText("src/cart")).rejects.toThrow("refused")

      run(files, "Files read normally again")
      await navigator.clipboard.writeText("src/cart")

      expect(copied).toEqual(["src/cart"])
    } finally {
      restoreClipboard()
      Reflect.deleteProperty(navigator, "clipboard")
    }
  })

  it("has the next save of a project's hidden files fail, until the files read normally again", async () => {
    const files = createDemoFiles(1)
    run(files, "Next hide-list save fails")
    await expect(files.exclude.save("storefront", { dist: true })).rejects.toThrow()
    await files.exclude.save("storefront", { dist: true })

    run(files, "Next hide-list save fails")
    run(files, "Files read normally again")

    await files.exclude.save("storefront", {})
    await expect(files.exclude.read("storefront")).resolves.toEqual({})
  })

  it("has every read of a project's hidden files fail, until the files read normally again", async () => {
    const files = createDemoFiles(1)
    run(files, "Hidden files can't be read")
    await expect(files.exclude.read("storefront")).rejects.toThrow()
    await expect(files.exclude.read("infra")).rejects.toThrow()

    run(files, "Files read normally again")

    await expect(files.exclude.read("storefront")).resolves.toEqual({})
  })

  it("has the next paste fail, once, until the files read normally again", async () => {
    const files = createDemoFiles(1)
    run(files, "Next paste fails")
    await expect(files.copy("storefront", "README.md", "public")).rejects.toThrow()
    await expect(files.copy("storefront", "README.md", "public")).resolves.toBe("public/README.md")

    run(files, "Next paste fails")
    run(files, "Files read normally again")

    await expect(files.copy("storefront", "README.md", "")).resolves.toBe("README copy.md")
  })

  it("has the next change made answer as lost, until the files read normally again", async () => {
    const files = createDemoFiles(1)
    run(files, "Next change's answer is lost")
    await expect(files.move("storefront", "README.md", "README.txt")).rejects.toThrow(
      "it may have been done",
    )
    await expect(files.move("storefront", "README.txt", "README.md")).resolves.toBe("README.md")

    run(files, "Next change's answer is lost")
    run(files, "Files read normally again")

    await expect(files.remove("storefront", "README.md")).resolves.toBeUndefined()
  })

  it("has the next paste take 5 seconds, until the files read normally again", async () => {
    vi.useFakeTimers()
    try {
      const files = createDemoFiles(1)
      run(files, "Next paste takes 5 s")
      let made: string | undefined
      const copying = files.copy("storefront", "README.md", "public").then((path) => (made = path))
      await vi.advanceTimersByTimeAsync(4999)
      expect(made).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      await copying
      expect(made).toBe("public/README.md")

      run(files, "Next paste takes 5 s")
      run(files, "Files read normally again")

      await expect(files.copy("storefront", "README.md", "")).resolves.toBe("README copy.md")
    } finally {
      vi.useRealTimers()
    }
  })

  it("has the next file made, renamed or deleted fail, until the files read normally again", async () => {
    const files = createDemoFiles(1)
    run(files, "Next file operation fails")
    await expect(files.create("storefront", "notes.md", false)).rejects.toThrow()
    await expect(files.create("storefront", "notes.md", false)).resolves.toBe("notes.md")

    run(files, "Next file operation fails")
    run(files, "Files read normally again")

    await expect(files.remove("storefront", "notes.md")).resolves.toBeUndefined()
  })

  it("boots again with the backend making, renaming and deleting files, or not", () => {
    const { offered, launch } = offering()
    const files = createDemoFiles(1)
    const [group] = filesGroups(files, launch)
    const action = (label: string) => group!.actions.find((each) => each.label === label)!
    expect([action("File operations not offered"), action("File operations offered")]).toEqual([
      expect.objectContaining({ reboots: true }),
      expect.objectContaining({ reboots: true }),
    ])

    run(files, "File operations not offered", undefined, undefined, launch)
    run(files, "File operations offered", undefined, undefined, launch)

    expect(offered).toEqual([false, true])
  })

  it("puts the copy failure before the way back to normal", () => {
    const labels = filesGroups(createDemoFiles(1), offering().launch)[0]!.actions.map(
      (action) => action.label,
    )
    expect(labels.indexOf("Copying a path fails")).toBe(
      labels.indexOf("Files read normally again") - 1,
    )
  })

  it("has the checkout behind main, refuse an update, and main move it", async () => {
    const files = createDemoFiles(1)
    expect((await files.checkout!("storefront")).behind).toBeNull()
    run(files, "Checkout is behind main")
    expect((await files.checkout!("storefront")).behind).toMatchObject({ count: 3 })
    run(files, "Checkout can't update")
    expect(await files.update!("storefront")).toMatchObject({ ok: false })
    expect((await files.checkout!("storefront")).behind).not.toBeNull()
    run(files, "Checkout is behind main")
    expect(await files.update!("storefront")).toEqual({ ok: true })
    expect(await files.checkout!("storefront")).toEqual({ behind: null, moved: 1, head: "demo-1" })
    run(files, "Main moves the checkout")
    expect((await files.checkout!("storefront")).moved).toBe(2)
    const names = (await files.list("storefront", "src/checkout")).entries.map(({ name }) => name)
    expect(names).toContain("Receipt.tsx")
    await expect(
      files.move("storefront", "src/checkout/Receipt.tsx", "src/checkout/Invoice.tsx"),
    ).resolves.toBe("src/checkout/Invoice.tsx")
    const renamed = (await files.list("storefront", "src/checkout")).entries.map(({ name }) => name)
    expect(renamed).toContain("Invoice.tsx")
    expect(renamed).not.toContain("Receipt.tsx")
    const components = await files.list("storefront", "src/components")
    expect(components.entries.map(({ name }) => name)).not.toContain("Price.tsx")
    run(files, "Checkout is up to date")
    expect((await files.checkout!("storefront")).behind).toBeNull()
  })
})
