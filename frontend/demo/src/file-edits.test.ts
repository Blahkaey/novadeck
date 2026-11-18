import {
  itemIdOf,
  PlanUnwritableError,
  type ItemContent,
  type PlanSaved,
} from "@novadeck/core/items"

import { createFileEdits, rewritten, type FileFault } from "./file-edits"
import { context, describe, expect, it } from "./test"
import type { WindowFile } from "./workspace"

// The demo's stand-in for a file, as its showcase shows one that no agent showed.
const standIn = (lines: readonly string[]): ItemContent => ({
  state: "ready",
  stamp: "1",
  content: {
    kind: "file",
    path: "src/App.tsx",
    firstLine: 1,
    lines,
    from: 1,
    to: lines.length,
    total: lines.length,
    truncated: false,
    clamped: false,
  },
})

const app = standIn(["// src/App.tsx", "", "export const App = () => {", "  // Nothing yet.", "}"])
const appText = "// src/App.tsx\n\nexport const App = () => {\n  // Nothing yet.\n}\n"

const shown = (path: string, at = `~/projects/storefront/${path}`): WindowFile => ({
  projectId: "storefront",
  path,
  at,
  itemId: itemIdOf("project-1"),
})

// The project's own files: those its tree holds.
const tree = new Set(["src/App.tsx", "README.md", "src/cart/useCart.ts"])

// The demo's edits over that tree, and a window following `file`, its stand-in `stand`: what it
// heard, and how to stop.
const following = (
  file = shown("src/App.tsx"),
  stand: ItemContent = app,
  edits = createFileEdits(({ path }) => tree.has(path)),
) => {
  const heard: ItemContent[] = []
  const stop = edits.follow(
    file,
    (on) => {
      on(stand)
      return () => {}
    },
    (content) => heard.push(content),
  )
  return { edits, heard, stop, last: () => heard.at(-1)! }
}

const stampOf = (content: ItemContent): string =>
  content.state === "ready" ? content.stamp : "none"

const textOf = (content: ItemContent): string | undefined =>
  content.state === "ready" && content.content.kind === "text" ? content.content.text : undefined

const refusal = (saving: Promise<PlanSaved>) =>
  saving.then(
    () => undefined,
    (error: unknown) => (error instanceof PlanUnwritableError ? error.reason : "failed"),
  )

describe("a file the project window edits", () => {
  it("reads whole from the demo's stand-in, ending with a line break, and can be written", () => {
    const { last } = following()
    expect(last()).toEqual({
      state: "ready",
      stamp: expect.any(String),
      content: {
        kind: "text",
        path: "~/projects/storefront/src/App.tsx",
        text: appText,
        writable: true,
      },
    })
  })

  it("saves the person's edit, which every later read has, with the stamp the save answered", async () => {
    const { edits, last } = following()
    const file = shown("src/App.tsx")
    const answer = await edits.save(file, "edited\n", stampOf(last()), file.at)
    expect(answer).toEqual({ saved: true, stamp: expect.any(String) })
    const saved = answer as { readonly stamp: string }
    // Whoever follows the file hears the save, as the runner's poll would.
    expect(last()).toMatchObject({ stamp: saved.stamp, content: { text: "edited\n" } })
    expect(following(file, app, edits).last()).toMatchObject({
      stamp: saved.stamp,
      content: { text: "edited\n" },
    })
  })

  it("tells its text: none before the window reads it whole, then as read, then as saved", async () => {
    const edits = createFileEdits(({ path }) => tree.has(path))
    const at = { projectId: "storefront", path: "src/App.tsx" }
    expect(edits.text(at)).toBeUndefined()
    const { last } = following(shown("src/App.tsx"), app, edits)
    expect(edits.text(at)).toBe(appText)
    await edits.save(shown("src/App.tsx"), "edited\n", stampOf(last()), shown("src/App.tsx").at)
    expect(edits.text(at)).toBe("edited\n")
  })

  it("answers the text as it stands to an edit made on an earlier version, writing nothing", async () => {
    const { edits, last } = following()
    const file = shown("src/App.tsx")
    const first = stampOf(last())
    await edits.save(file, "one\n", first, file.at)
    const now = last()
    expect(await edits.save(file, "two\n", first, file.at)).toEqual({
      saved: false,
      current: {
        stamp: stampOf(now),
        plan: { kind: "plan", text: "one\n", truncated: false, writable: true, skill: false },
      },
    })
    expect(textOf(last())).toBe("one\n")
  })

  it("refuses an edit made on another file than the window shows now as moved", async () => {
    const { edits, last } = following()
    expect(
      await refusal(edits.save(shown("src/App.tsx"), "x", stampOf(last()), "~/elsewhere.ts")),
    ).toBe("moved")
    expect(await refusal(edits.save(shown("src/App.tsx"), "x", stampOf(last()), undefined))).toBe(
      "moved",
    )
  })

  it("reads a file its project lacks, as an agent's copy, read-only", () => {
    const copy = "~/.novadeck/worktrees/storefront/moth/storefront/src/checkout/OrderSummary.tsx"
    for (const file of [shown(copy, copy), shown("src/checkout/OrderSummary.tsx")])
      expect(following(file).last()).toMatchObject({
        content: { kind: "text", writable: false, reason: "outside" },
      })
  })

  it("passes on what can't be read whole: a file behind its secrets gate", () => {
    const secret: ItemContent = { state: "unavailable", reason: "secret", size: null }
    expect(following(shown("src/App.tsx"), secret).last()).toBe(secret)
  })

  it("hears nothing more once it stops following", async () => {
    const { edits, heard, stop, last } = following()
    stop()
    const file = shown("src/App.tsx")
    await edits.save(file, "edited\n", stampOf(last()), file.at)
    expect(heard).toHaveLength(1)
  })
})

describe("the person's changes in Files", () => {
  // The text the window would read at `path` now.
  const readAt = (edits: ReturnType<typeof createFileEdits>, path: string) =>
    textOf(following(shown(path), app, edits).last())

  // Edits whose `path` the window read, then saved as `text`.
  const savedAt = async (path: string, text: string) => {
    const { edits, last } = following(shown(path))
    await edits.save(shown(path), text, stampOf(last()), shown(path).at)
    return edits
  }

  it("makes a file empty, telling a window that still shows it", () => {
    const { edits, last } = following()
    edits.made("storefront", "src/App.tsx")
    expect(textOf(last())).toBe("")
  })

  it("takes a file's text along when it is renamed, and a folder's files' when it moves", async () => {
    const edits = await savedAt("src/cart/useCart.ts", "kept\n")
    edits.moved("storefront", "src/cart/useCart.ts", "src/cart/useBasket.ts")
    expect(readAt(edits, "src/cart/useBasket.ts")).toBe("kept\n")
    edits.moved("storefront", "src/cart", "src/basket")
    expect(readAt(edits, "src/basket/useBasket.ts")).toBe("kept\n")
  })

  it("copies a file's text to the copy, and none of its faults", async () => {
    const edits = await savedAt("README.md", "notes\n")
    edits.fault({ projectId: "storefront", path: "README.md" }, "too-large")
    edits.copied("storefront", "README.md", "README copy.md")
    const copy = following(shown("README copy.md"), app, edits).last()
    expect(copy).toMatchObject({ content: { kind: "text", text: "notes\n" } })
  })

  it("drops a deleted file's text, so a file made there anew reads from its stand-in", async () => {
    const edits = await savedAt("src/cart/useCart.ts", "kept\n")
    edits.removed("storefront", "src/cart")
    expect(readAt(edits, "src/cart/useCart.ts")).toBe(appText)
  })

  it("keeps each project's files to itself", async () => {
    const edits = await savedAt("README.md", "storefront's\n")
    const other = { ...shown("README.md"), projectId: "docs-site" }
    expect(textOf(following(other, app, edits).last())).toBe(appText)
  })
})

describe("a file's faults", () => {
  const faulted = (fault: FileFault) => {
    const followed = following()
    expect(followed.edits.fault({ projectId: "storefront", path: "src/App.tsx" }, fault)).toBe(true)
    return followed
  }

  context("on a read", () => {
    it("lists the file as it is, saying it can't be edited whole, when too large or not UTF-8", () => {
      for (const fault of ["too-large", "not-text"] as const)
        expect(faulted(fault).last()).toMatchObject({
          state: "ready",
          content: {
            kind: "file",
            lines: ["// src/App.tsx", "", "export const App = () => {", "  // Nothing yet.", "}"],
            from: 1,
            to: 5,
            uneditable: fault,
          },
        })
    })

    it("says a binary file isn't text, a deleted one isn't there, and one it can't read so", () => {
      expect(faulted("binary").last()).toEqual({
        state: "unavailable",
        reason: "binary",
        size: null,
      })
      expect(faulted("gone").last()).toEqual({
        state: "unavailable",
        reason: "missing",
        size: null,
      })
      expect(faulted("unreadable").last()).toEqual({
        state: "unavailable",
        reason: "unreadable",
        size: null,
      })
    })

    it("reads the file whole and read-only, saying why, as an agent's copy, in a folder it can't write or as no file it edits", () => {
      for (const fault of ["outside", "folder", "not-a-plan"] as const)
        expect(faulted(fault).last()).toMatchObject({
          content: { kind: "text", text: appText, writable: false, reason: fault },
        })
    })

    it("leaves a refusal of the next save, or failing saves, to the save", () => {
      for (const fault of ["refuse-folder", "failing"] as const)
        expect(faulted(fault).last()).toMatchObject({
          content: { kind: "text", writable: true },
        })
    })
  })

  context("on a save", () => {
    const saving = (edits: ReturnType<typeof createFileEdits>, last: () => ItemContent) =>
      edits.save(shown("src/App.tsx"), "edited\n", stampOf(last()), shown("src/App.tsx").at)

    // Each fault that refuses saves, and the reason the runner would give.
    const refusing = [
      ["too-large", "too-large"],
      ["not-text", "not-text"],
      ["binary", "not-text"],
      ["outside", "outside"],
      ["folder", "folder"],
      ["not-a-plan", "not-a-plan"],
      ["gone", "gone"],
    ] as const
    for (const [fault, reason] of refusing)
      it(`refuses it while the file is ${fault}, saying ${reason}, until the fault is lifted`, async () => {
        const { edits, last } = faulted(fault)
        expect(await refusal(saving(edits, last))).toBe(reason)
        expect(await refusal(saving(edits, last))).toBe(reason)
      })

    for (const fault of ["failing", "unreadable"] as const)
      it(`fails it without saying why, every time, while the file is ${fault}`, async () => {
        const { edits, last } = faulted(fault)
        expect(await refusal(saving(edits, last))).toBe("failed")
        expect(await refusal(saving(edits, last))).toBe("failed")
      })

    const refusingOnce = [
      ["refuse-folder", "folder"],
      ["refuse-too-large", "too-large"],
      ["refuse-not-text", "not-text"],
      ["refuse-moved", "moved"],
    ] as const
    for (const [fault, reason] of refusingOnce)
      it(`refuses only the next one at ${fault}, saying ${reason}, and saves the one after`, async () => {
        const { edits, last } = faulted(fault)
        expect(await refusal(saving(edits, last))).toBe(reason)
        expect(await saving(edits, last)).toMatchObject({ saved: true })
      })
  })

  it("puts nothing in a fault before the window has read the file whole", () => {
    const edits = createFileEdits(() => true)
    expect(edits.fault({ projectId: "storefront", path: "src/App.tsx" }, "binary")).toBe(false)
    following(shown("src/App.tsx"), app, edits)
    expect(edits.fault({ projectId: "storefront", path: "src/App.tsx" }, "binary")).toBe(true)
  })

  it("puts the first file the window reads whole in the fault asked for first, and no other", () => {
    const edits = createFileEdits(({ path }) => tree.has(path))
    edits.faultFirst("too-large")
    expect(following(shown("README.md"), app, edits).last()).toMatchObject({
      content: { uneditable: "too-large" },
    })
    expect(following(shown("src/App.tsx"), app, edits).last()).toMatchObject({
      content: { kind: "text" },
    })
  })

  it("puts no file in a fault for a name no fault has", () => {
    const edits = createFileEdits(({ path }) => tree.has(path))
    edits.faultFirst("sideways")
    expect(following(shown("README.md"), app, edits).last()).toMatchObject({
      content: { kind: "text", writable: true },
    })
  })

  it("takes a fault along with a file that moves, and drops it with one deleted", () => {
    const { edits } = faulted("binary")
    edits.moved("storefront", "src", "source")
    expect(following(shown("source/App.tsx"), app, edits).last()).toMatchObject({
      reason: "binary",
    })
    edits.removed("storefront", "source")
    expect(following(shown("source/App.tsx"), app, edits).last()).toMatchObject({
      state: "ready",
    })
  })

  it("lifts every fault back to normal, telling whoever follows", () => {
    const { edits, last } = faulted("gone")
    edits.faultFirst("binary")
    edits.normal()
    expect(last()).toMatchObject({ content: { kind: "text", writable: true } })
    expect(following(shown("README.md"), app, edits).last()).toMatchObject({
      content: { kind: "text" },
    })
  })
})

describe("an agent's rewrite of the file", () => {
  it("adds two lines after its middle line, indented as the line after them", () => {
    expect(rewritten(appText, 1).split("\n")).toEqual([
      "// src/App.tsx",
      "",
      "export const App = () => {",
      "  // An agent's change 1: it rewrote this part,",
      "  // leaving the lines around it as they were.",
      "  // Nothing yet.",
      "}",
      "",
    ])
  })

  it("adds them after the only line of a one-line file", () => {
    expect(rewritten("API_URL=http://localhost:3000\n", 2)).toBe(
      "API_URL=http://localhost:3000\n// An agent's change 2: it rewrote this part,\n// leaving the lines around it as they were.\n",
    )
  })

  it("is a new version of the file, which whoever follows it hears", () => {
    const { edits, last } = following()
    const before = stampOf(last())
    expect(edits.rewrite({ projectId: "storefront", path: "src/App.tsx" })).toBe(true)
    expect(stampOf(last())).not.toBe(before)
    expect(textOf(last())).toBe(rewritten(appText, 1))
  })

  it("isn't made on a file the window hasn't read whole", () => {
    const edits = createFileEdits(() => true)
    expect(edits.rewrite({ projectId: "storefront", path: "src/App.tsx" })).toBe(false)
  })
})
