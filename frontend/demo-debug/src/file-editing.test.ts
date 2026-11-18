import { itemIdOf, type ItemContent } from "@novadeck/core/items"
import type { Workspace } from "@novadeck/core/types"
import { createFileEdits, rewritten } from "@novadeck/demo/file-edits"

import { fileEditingGroups } from "./file-editing"
import { describe, expect, it } from "./test"
import type { DemoActionContext } from "./types"

const directory = "~/projects/storefront"
const at = `${directory}/src/App.tsx`

// A workspace on storefront's session, whose project window shows the file at `path`, if any.
const workspace = (path?: string): Workspace =>
  ({
    activeProjectId: "storefront",
    projects: [
      {
        id: "storefront",
        directory,
        activeSessionId: "initial",
        history: [
          {
            id: "initial",
            state: {
              roster: {
                terminals: [],
                windows:
                  path === undefined ? [] : [{ id: "w", home: "project", itemId: "project-1" }],
              },
              items: path === undefined ? [] : [{ id: "project-1", path }],
            },
          },
        ],
      },
    ],
  }) as unknown as Workspace

const standIn: ItemContent = {
  state: "ready",
  stamp: "1",
  content: {
    kind: "file",
    path: "src/App.tsx",
    firstLine: 1,
    lines: ["a", "b"],
    from: 1,
    to: 2,
    total: 2,
    truncated: false,
    clamped: false,
  },
}

// The demo's edits with the project window having read `src/App.tsx` whole, and what it heard.
const reading = () => {
  const edits = createFileEdits(() => true)
  const heard: ItemContent[] = []
  edits.follow(
    { projectId: "storefront", path: "src/App.tsx", at, itemId: itemIdOf("project-1") },
    (on) => {
      on(standIn)
      return () => {}
    },
    (content) => heard.push(content),
  )
  return { edits, last: () => heard.at(-1)! }
}

// Runs the group's action `label` over the demo's edits, none where they haven't loaded, on
// `shown`: what it noted.
const run = (
  edits: ReturnType<typeof createFileEdits> | undefined,
  label: string,
  shown: Workspace = workspace(at),
): string[] => {
  const notes: string[] = []
  const context = {
    workspace: () => shown,
    note: (text: string) => notes.push(text),
  } as unknown as DemoActionContext
  void fileEditingGroups({ edits: () => edits })[0]!
    .actions.find((action) => action.label === label)!
    .run(context)
  return notes
}

describe("the debug panel's File editing group", () => {
  it("is absent where the demo has no files", () => {
    expect(fileEditingGroups(undefined)).toEqual([])
  })

  it("sits with the agents, and hints what each action shows", () => {
    const [group] = fileEditingGroups({ edits: () => undefined })
    expect(group!.section).toBe("Agents")
    expect(group!.actions.every((action) => action.hint.length > 0)).toBe(true)
    const labels = group!.actions.map((action) => action.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("puts the project window's file in a fault, and back to normal", () => {
    const { edits, last } = reading()
    expect(run(edits, "Too large to edit")).toEqual([])
    expect(last()).toMatchObject({ content: { kind: "file", uneditable: "too-large" } })
    run(edits, "An agent's copy")
    expect(last()).toMatchObject({ content: { kind: "text", writable: false, reason: "outside" } })
    run(edits, "File deleted")
    expect(last()).toMatchObject({ state: "unavailable", reason: "missing" })
    run(edits, "File editing back to normal")
    expect(last()).toMatchObject({ content: { kind: "text", writable: true } })
  })

  it("refuses the project window's next save of its file, once", async () => {
    const { edits, last } = reading()
    run(edits, "Next save refused: file moved")
    const file = { projectId: "storefront", path: "src/App.tsx", at, itemId: itemIdOf("p") }
    const stamp = (last() as { readonly stamp: string }).stamp
    await expect(edits.save(file, "x\n", stamp, at)).rejects.toMatchObject({ reason: "moved" })
    await expect(edits.save(file, "x\n", stamp, at)).resolves.toMatchObject({ saved: true })
  })

  it("has an agent rewrite the project window's file", () => {
    const { edits, last } = reading()
    expect(run(edits, "An agent rewrites the open file")).toEqual([])
    expect(last()).toMatchObject({ content: { kind: "text", text: rewritten("a\nb\n", 1) } })
  })

  it("asks for a text file in the project window first", () => {
    const first = ["Open a text file from Files in the project window first (double-click it)."]
    expect(run(reading().edits, "Binary file", workspace())).toEqual(first)
    // The window has read nothing whole yet, so the demo keeps no edits.
    expect(run(undefined, "Binary file")).toEqual(first)
    expect(run(undefined, "File editing back to normal")).toEqual([])
    expect(run(reading().edits, "An agent rewrites the open file", workspace())).toEqual(first)
    // A file the window hasn't read whole, as one behind its secrets gate.
    expect(run(reading().edits, "Binary file", workspace(`${directory}/.env.local`))).toEqual(first)
  })

  it("has copying refused until file editing is back to normal, with or without a file", async () => {
    const copied: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
      configurable: true,
    })
    try {
      const { edits } = reading()
      expect(run(edits, "Copying edits fails", workspace())).toEqual([])
      await expect(navigator.clipboard.writeText("edits")).rejects.toThrow("refused")
      run(edits, "File editing back to normal", workspace())
      await navigator.clipboard.writeText("edits")
      expect(copied).toEqual(["edits"])
    } finally {
      Reflect.deleteProperty(navigator, "clipboard")
    }
  })
})
