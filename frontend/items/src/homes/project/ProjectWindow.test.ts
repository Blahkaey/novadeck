import {
  PlanUnwritableError,
  type Companions,
  type ItemContent,
  type TextContent,
} from "@novadeck/core/items"
import { workspaceReducer } from "@novadeck/core/state"
import { createWorkspaceStore } from "@novadeck/core/store"
import { itemFixture, workspaceFixture } from "@novadeck/core/testing"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { afterAll, afterEach, beforeAll, vi } from "vitest"

import { fileKey } from "../../kinds/file/file-doc"
import { createItemStore } from "../../store/item-store"
import { context, describe, expect, it } from "../../test"
import { ProjectWindow } from "./ProjectWindow"

// CodeMirror, as the editors load it: lazily, so it stays out of the app's first chunk.
const { EditorSelection } = await import("@codemirror/state")
const { EditorView } = await import("@codemirror/view")

const unmounts: (() => void)[] = []
afterEach(() => unmounts.splice(0).forEach((unmount) => unmount()))

// jsdom lays nothing out, and its ranges have no rects, which the code editor measures a line's
// text with a frame after it mounts: none, here, until the file's tests end.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterAll(() => {
  Reflect.deleteProperty(Range.prototype, "getClientRects")
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect")
})

const target = { projectId: "project", workspaceSessionId: "initial" }

// What the window asked to follow, and the saves it sent: by the path each names, and their
// text.
type Seen = {
  follows: { edit: boolean | undefined }[]
  saves: (string | undefined)[]
  sent: string[]
}

// The window over a file the backend reports as `load`, which no terminal shows. Its saves
// answer as `save` does, never by default. `emit` reports what the item holds next, and
// `point` points the window at another file, as opening one from Files does.
const opened = async (
  item: ReturnType<typeof itemFixture>,
  load: ItemContent,
  save: Companions["save"] = () => new Promise(() => {}),
) => {
  const seen: Seen = { follows: [], saves: [], sent: [] }
  let report: (content: ItemContent) => void = () => {}
  const companions: Companions = {
    follow: (_target, _id, { edit }, on) => {
      seen.follows.push({ edit })
      report = on
      on(load)
      return () => {}
    },
    save: (...args) => {
      seen.saves.push(args[4])
      seen.sent.push(args[2])
      return save(...args)
    },
    trouble: () => {},
  }
  const workspace = createWorkspaceStore(
    workspaceReducer(workspaceFixture(), { type: "item/upsert", target, item }),
  )
  const itemStore = createItemStore({ companions, workspace })
  unmounts.push(itemStore.connect())
  const rendered = render(createElement(ProjectWindow, { itemStore, target, item }))
  unmounts.push(rendered.unmount)
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  const settle = () =>
    act(async () => {
      await vi.dynamicImportSettled()
    })
  return {
    ...rendered,
    ...seen,
    itemStore,
    emit: async (content: ItemContent) => {
      act(() => report(content))
      await settle()
    },
    point: async (path: string) => {
      const next = { ...item, path, name: path.slice(path.lastIndexOf("/") + 1) }
      act(() => void workspace.dispatch({ type: "item/upsert", target, item: next }))
      rendered.rerender(createElement(ProjectWindow, { itemStore, target, item: next }))
      await settle()
    },
    // The window drawn anew, as when the person comes back to it.
    again: async () => {
      rendered.unmount()
      const next = render(createElement(ProjectWindow, { itemStore, target, item }))
      unmounts.push(next.unmount)
      await settle()
      return next.container
    },
  }
}

const source = itemFixture("source", "01", { kind: "file", name: "cart.ts", path: "/p/cart.ts" })
const ready = (content: TextContent): ItemContent => ({ state: "ready", stamp: "1", content })
const whole = (text: string): ItemContent =>
  ready({ kind: "text", path: "/p/cart.ts", text, writable: true })
// The file's editor, once it has loaded.
const editorIn = (container: HTMLElement) =>
  EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
// The person types at the end of the file.
const type = (container: HTMLElement, text: string) =>
  act(() => {
    const view = editorIn(container)
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
  })
const press = (on: Element, key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    on.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    )
  })
const notice = (container: HTMLElement) => container.querySelector(".pane-notice")?.textContent

describe("the project window", () => {
  context("a Markdown file", () => {
    it("reads as a document labelled by the file's name, in no frame of a plan's", async () => {
      const item = itemFixture("readme", "01", {
        kind: "file",
        name: "README.md",
        path: "README.md",
      })
      const { container } = await opened(item, {
        state: "ready",
        stamp: "1",
        content: {
          kind: "file",
          path: "README.md",
          firstLine: 1,
          lines: ["# Hello"],
          from: 1,
          to: 1,
          total: 1,
          clamped: false,
          truncated: false,
        },
      })
      expect(container.querySelector("section.pane-reader[data-workspace-companion]")).toBeNull()
      expect(container.querySelector(".cm-content")?.getAttribute("aria-label")).toBe("README.md")
    })
  })

  context("a file that may hold secrets", () => {
    it("offers to show it and to copy its path", async () => {
      const item = itemFixture("env", "01", { kind: "file", name: ".env", secret: true })
      const { container } = await opened(item, {
        state: "unavailable",
        reason: "secret",
        size: null,
      })
      expect(
        [...container.querySelectorAll("div.artifact-window button")].map(
          (each) => each.textContent,
        ),
      ).toEqual(["Show it", "Copy path"])
    })
  })

  context("a file it has whole to edit", () => {
    it("follows it whole, and edits it in the code editor, which says nothing of read-only", async () => {
      const { container, follows } = await opened(source, whole("const a = 1\n"))
      expect(follows).toEqual([{ edit: true }])
      const editor = container.querySelector(".artifact-editor")
      expect(editor?.hasAttribute("data-readonly")).toBe(false)
      expect(editorIn(container).state.doc.toString()).toBe("const a = 1\n")
      expect(container.querySelector("[role=heading]")?.getAttribute("aria-description")).toContain(
        "/p/cart.ts",
      )
    })

    it("saves the person's edit at once on Ctrl+S, naming the file", async () => {
      const { container, saves } = await opened(source, whole("const a = 1\n"))
      type(container, "const b = 2\n")
      press(editorIn(container).contentDOM, "s", { ctrlKey: true })
      expect(saves).toEqual(["/p/cart.ts"])
    })

    it("saves the person's edit at once when focus leaves the window", async () => {
      const { container, saves } = await opened(source, whole("const a = 1\n"))
      type(container, "const b = 2\n")
      const outside = document.createElement("button")
      act(() => {
        editorIn(container).contentDOM.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
        )
      })
      expect(saves).toEqual(["/p/cart.ts"])
    })

    it("previews a data file and saves edits made in its source", async () => {
      const path = "/p/cart.json"
      const item = { ...source, name: "cart.json", path }
      const text = '{"total":1}'
      const { container, sent, saves } = await opened(
        item,
        ready({ kind: "text", path, text, writable: true }),
      )
      const viewed = () => container.querySelector(".artifact-file")?.getAttribute("data-view")
      expect(viewed()).toBe("preview")
      expect(container.querySelector(".artifact-editor")).toBeNull()
      const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Show source"]')!
      await act(async () => {
        toggle.click()
        await vi.dynamicImportSettled()
      })
      expect(viewed()).toBe("source")
      expect(editorIn(container).state.doc.toString()).toBe(text)
      type(container, "\n")
      press(editorIn(container).contentDOM, "s", { ctrlKey: true })
      expect(saves).toEqual([path])
      expect(sent).toEqual([text + "\n"])
      act(() => toggle.click())
      expect(viewed()).toBe("preview")
    })

    it("edits a Markdown file in its document", async () => {
      const readme = { ...source, name: "README.md", path: "/p/README.md" }
      const { container } = await opened(
        readme,
        ready({ kind: "text", path: "/p/README.md", text: "# Cart\n", writable: true }),
      )
      const document = container.querySelector(".document-editor")
      expect(document?.querySelector(".cm-editor")).not.toBeNull()
      expect(document?.hasAttribute("data-readonly")).toBe(false)
    })
  })

  context("a file a save would be refused for", () => {
    it("reads in the editor, read-only, saying why", async () => {
      const { container } = await opened(
        source,
        ready({
          kind: "text",
          path: "/p/cart.ts",
          text: "const a = 1\n",
          writable: false,
          reason: "outside",
        }),
      )
      expect(container.querySelector(".artifact-editor")?.hasAttribute("data-readonly")).toBe(true)
      expect(editorIn(container).state.readOnly).toBe(true)
      expect(notice(container)).toContain(
        "Read-only: it's not one of the project's own files, but outside its folder, in Git's own folder or an agent's copy.",
      )
    })
  })

  context("a file it can't have whole", () => {
    it("lists it read-only, saying why", async () => {
      const { container } = await opened(source, {
        state: "ready",
        stamp: "1",
        content: {
          kind: "file",
          path: "/p/cart.ts",
          firstLine: 1,
          lines: ["const a = 1"],
          from: 1,
          to: 1,
          total: null,
          clamped: false,
          truncated: true,
          uneditable: "too-large",
        },
      })
      expect(container.querySelector(".artifact-editor")).toBeNull()
      expect(container.querySelector(".code-viewer")).not.toBeNull()
      expect(notice(container)).toContain("Read-only")
      expect(notice(container)).toContain("It's too large to edit here.")
    })
  })

  context("a Markdown file whose lines break otherwise than with LF alone", () => {
    it("keeps a lone CR and mixed breaks as they are when the person edits it", async () => {
      const readme = { ...source, name: "README.md", path: "/p/README.md" }
      const text = "# Cart\r\nTotal.\rTax\n"
      const { container, sent } = await opened(
        readme,
        ready({ kind: "text", path: "/p/README.md", text, writable: true }),
      )
      type(container, "More.\n")
      press(editorIn(container).contentDOM, "s", { ctrlKey: true })
      expect(sent).toEqual([`${text}More.\n`])
    })
  })

  context("a Markdown file another writer changed under the person's edits", () => {
    it("keeps its marks on the lines the person's edits moved them to, drawn anew too", async () => {
      const readme = { ...source, name: "README.md", path: "/p/README.md" }
      const at = (text: string, stamp: string): ItemContent => ({
        state: "ready",
        stamp,
        content: { kind: "text", path: "/p/README.md", text, writable: true },
      })
      const { container, itemStore, emit, again } = await opened(
        readme,
        at("# Cart\n\nOne.\n", "1"),
      )
      type(container, "Mine.\n")
      await emit(at("# Cart\n\nTwo.\n", "2"))
      const doc = () => itemStore.store.getSnapshot().files[fileKey(readme.id, "/p/README.md")]!
      expect(doc().marks).toEqual([{ from: 3, to: 3 }])
      act(() => editorIn(container).dispatch({ changes: { from: 0, insert: "Intro.\n" } }))
      expect(doc().marks).toEqual([{ from: 4, to: 4 }])
      const drawn = await again()
      expect(
        [...drawn.querySelectorAll(".cm-file-changed")].map((line) => line.textContent),
      ).toEqual(["Two."])
    })
  })

  context("a file the person edited that the window can no longer have whole", () => {
    it("keeps the edits in the editor, saying why they can't be saved, with a copy", async () => {
      const { container, emit } = await opened(source, whole("const a = 1\n"))
      type(container, "const b = 2\n")
      await emit({
        state: "ready",
        stamp: "2",
        content: {
          kind: "file",
          path: "/p/cart.ts",
          firstLine: 1,
          lines: ["const a = 1"],
          from: 1,
          to: 1,
          total: null,
          clamped: false,
          truncated: true,
          uneditable: "too-large",
        },
      })
      expect(editorIn(container).state.doc.toString()).toBe("const a = 1\nconst b = 2\n")
      expect(container.querySelector(".pane-notice p")?.textContent).toBe(
        "This file is too large for Novadeck to save your edits. Your edits are kept here until you close this file.",
      )
      expect(container.querySelector(".pane-notice button")?.textContent).toBe("Copy my edits")
    })

    it("says a file that turned binary is no longer text", async () => {
      const { container, emit } = await opened(source, whole("const a = 1\n"))
      type(container, "const b = 2\n")
      await emit({ state: "unavailable", reason: "binary", size: 10 })
      expect(container.querySelector(".pane-notice p")?.textContent).toMatch(
        /^This file is no longer text Novadeck can edit/,
      )
    })

    it("shows the gate, not the edits, of a file that may hold secrets", async () => {
      const { container, emit } = await opened(source, whole("const a = 1\n"))
      type(container, "const b = 2\n")
      await emit({ state: "unavailable", reason: "secret", size: null })
      expect(container.querySelector(".cm-editor")).toBeNull()
    })
  })

  context("a file the person edited, pointed away and back", () => {
    it("shows the edits kept while it pointed at another", async () => {
      const { container, emit, point } = await opened(source, whole("const a = 1\n"))
      type(container, "const b = 2\n")
      await point("/p/total.ts")
      await emit(ready({ kind: "text", path: "/p/total.ts", text: "total\n", writable: true }))
      expect(editorIn(container).state.doc.toString()).toBe("total\n")
      await point("/p/cart.ts")
      await emit(whole("const a = 1\n"))
      expect(editorIn(container).state.doc.toString()).toBe("const a = 1\nconst b = 2\n")
    })
  })

  context("a file whose save can't go through", () => {
    it("says why, for a file, and offers to copy the edits or try again", async () => {
      const { container } = await opened(source, whole("const a = 1\n"), () =>
        Promise.reject(new PlanUnwritableError("not-text")),
      )
      type(container, "const b = 2\n")
      press(editorIn(container).contentDOM, "s", { ctrlKey: true })
      await act(async () => {
        await vi.dynamicImportSettled()
      })
      expect(container.querySelector(".pane-notice p")?.textContent).toBe(
        "This file is no longer text Novadeck can edit, so your edits can't be saved. Your edits are kept here until you close this file.",
      )
      expect(
        [...container.querySelectorAll(".pane-notice button")].map((each) => each.textContent),
      ).toEqual(["Copy my edits", "Try saving again"])
    })
  })
})

describe("Escape in a file's editor", () => {
  it("collapses a selection, and goes no further", async () => {
    const { container } = await opened(source, whole("const a = 1\n"))
    const view = editorIn(container)
    act(() => view.dispatch({ selection: EditorSelection.range(0, 5) }))
    const heard: boolean[] = []
    container.addEventListener("keydown", (event) => heard.push(event.defaultPrevented))
    press(view.contentDOM, "Escape")
    expect(view.state.selection.main.empty).toBe(true)
    expect(heard).toEqual([true])
  })
})
