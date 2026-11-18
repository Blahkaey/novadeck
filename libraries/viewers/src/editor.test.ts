import "./code.css"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"

import { mountEditor, type EditorContent, type EditorViewer } from "./editor.js"
import type { ViewerState } from "./index.js"

// A parser that can't load, as a chunk a deployed app no longer serves: Go's, which no other
// case here asks for.
vi.mock(import("./highlight/lines.js"), async (importOriginal) => {
  const lines = await importOriginal()
  return {
    ...lines,
    parserFor: (language) =>
      language === "go"
        ? Promise.reject(new Error("The chunk didn't load"))
        : lines.parserFor(language),
  }
})

const mac = navigator.platform.startsWith("Mac")
// The platform's command key held over keys, as the person presses it.
const mod = (keys: string): string =>
  mac ? `{Meta>}${keys}{/Meta}` : `{Control>}${keys}{/Control}`

const numbered = (count: number): string =>
  Array.from({ length: count }, (_, at) => `const line${at + 1} = ${at + 1}`).join("\n")

const panes: HTMLElement[] = []
const viewers: EditorViewer[] = []
afterEach(() => {
  for (const viewer of viewers.splice(0)) viewer.destroy()
  for (const pane of panes.splice(0)) pane.remove()
})

// An element to mount into, sized so a long text scrolls in the editor.
const paneIn = (): HTMLElement => {
  const pane = document.createElement("div")
  pane.style.cssText = "height: 200px; width: 500px"
  document.body.append(pane)
  panes.push(pane)
  return pane
}

const mount = (content: EditorContent, { saved }: { saved?: ViewerState } = {}) => {
  const pane = paneIn()
  const edits: string[] = []
  const saves: string[] = []
  const viewer = mountEditor(pane, {
    content,
    label: "src/app.ts",
    ...(saved === undefined ? {} : { saved }),
    onEdit: (text) => edits.push(text),
    onSave: () => saves.push("saved"),
  })
  viewers.push(viewer)
  const view = EditorView.findFromDOM(pane.querySelector<HTMLElement>(".cm-editor")!)!
  return { viewer, pane, view, edits, saves }
}

const textOf = (view: EditorView): string => view.state.doc.toString()

// The person's cursor at the end of the text, the editor focused.
const atEnd = (view: EditorView): void => {
  view.focus()
  view.dispatch({ selection: { anchor: view.state.doc.length } })
}

const markedOf = (pane: HTMLElement): (string | null)[] =>
  [...pane.querySelectorAll(".cm-editor-marked")].map((line) => line.textContent)

const frames = (): Promise<unknown> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

// The line at the top of what the editor shows.
const topLine = (view: EditorView): string =>
  view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).text

describe("the editor", () => {
  it("shows the text with its lines numbered, under its name", () => {
    const { pane } = mount({ text: "one\ntwo", path: "notes.txt" })
    expect(pane.querySelector(".cm-content")!.getAttribute("aria-label")).toBe("src/app.ts")
    expect([...pane.querySelectorAll(".cm-line")].map((line) => line.textContent)).toEqual([
      "one",
      "two",
    ])
    // But the gutter's spacer, which only sizes it.
    const numbers = [...pane.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")]
      .filter((number) => number.style.visibility !== "hidden")
      .map((number) => number.textContent)
    expect(numbers).toEqual(["1", "2"])
  })

  it("draws the cursor's line number, the bracket matching the cursor's, and characters that don't show", () => {
    const { view, pane } = mount({ text: "one\nf(x)\n\u0007", path: "notes.txt" })
    view.focus()
    view.dispatch({ selection: { anchor: "one\nf".length } })
    expect(pane.querySelector(".cm-activeLineGutter")?.textContent).toBe("2")
    expect([...pane.querySelectorAll(".cm-matchingBracket")].map((at) => at.textContent)).toEqual([
      "(",
      ")",
    ])
    expect(pane.querySelector(".cm-specialChar")).not.toBeNull()
  })

  it("tells the app the whole text as the person types", async () => {
    const { view, edits } = mount({ text: "one\n", path: "notes.txt" })
    atEnd(view)
    await userEvent.keyboard("two")
    expect(textOf(view)).toBe("one\ntwo")
    expect(edits.at(-1)).toBe("one\ntwo")
  })

  it("takes an outside change as a minimal one: the cursor kept, the app not told, the person's undo theirs", async () => {
    const { viewer, view, edits } = mount({ text: "one\ntwo\nfour", path: "notes.txt" })
    view.focus()
    view.dispatch({ selection: { anchor: "one\ntwo".length } })
    await userEvent.keyboard("!")
    const told = edits.length
    // Another writer adds a line above and changes one below.
    viewer.update({ text: "zero\none\ntwo!\nfour, five", path: "notes.txt" })
    expect(textOf(view)).toBe("zero\none\ntwo!\nfour, five")
    // Still right after what they typed.
    expect(view.state.selection.main.head).toBe("zero\none\ntwo!".length)
    expect(edits).toHaveLength(told)
    // The outside change isn't theirs to undo; their typing is.
    await userEvent.keyboard(mod("z"))
    expect(textOf(view)).toBe("zero\none\ntwo\nfour, five")
  })

  it("keeps the lines in view when an outside change adds lines above them", async () => {
    const text = numbered(300)
    const { viewer, view } = mount({ text, path: "a.ts" })
    view.scrollDOM.scrollTop = 2000
    await frames()
    const before = topLine(view)
    viewer.update({ text: `// one\n// two\n${text}`, path: "a.ts" })
    await frames()
    expect(topLine(view)).toBe(before)
  })

  it("keeps a lone carriage return as text, shown, and writes it back as it was", async () => {
    const text = "one\rtwo\nthree"
    const { viewer, view, pane, edits } = mount({ text, path: "notes.txt" })
    expect(view.state.doc.lines).toBe(2)
    expect(pane.querySelector(".cm-specialChar")).not.toBeNull()
    atEnd(view)
    await userEvent.keyboard("!")
    expect(edits).toEqual([`${text}!`])
    // The app passing the edit back changes nothing.
    const before = view.state
    viewer.update({ text: `${text}!`, path: "notes.txt" })
    expect(view.state).toBe(before)
    // An outside change bringing another lands as it is.
    viewer.update({ text: `zero\r\n${text}!`, path: "notes.txt" })
    expect(textOf(view)).toBe(`zero\r\n${text}!`)
    // So does one the person pastes.
    view.dispatch({ selection: { anchor: 0 } })
    const clipboard = new DataTransfer()
    clipboard.setData("text/plain", "a\rb")
    view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    )
    expect(edits.at(-1)).toBe(`a\rbzero\r\n${text}!`)
  })

  it("breaks the lines of text pasted with CRLF as it breaks its own", () => {
    const { view, edits } = mount({ text: "one\n", path: "notes.txt" })
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    const clipboard = new DataTransfer()
    clipboard.setData("text/plain", "two\r\nthree\r\n")
    view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    )
    expect(edits.at(-1)).toBe("one\ntwo\nthree\n")
  })

  it("undoes and redoes the person's edits", async () => {
    const { view, edits } = mount({ text: "one", path: "notes.txt" })
    atEnd(view)
    await userEvent.keyboard(" two")
    await userEvent.keyboard(mod("z"))
    expect(textOf(view)).toBe("one")
    expect(edits.at(-1)).toBe("one")
    await userEvent.keyboard(mac ? "{Meta>}{Shift>}z{/Shift}{/Meta}" : mod("y"))
    expect(textOf(view)).toBe("one two")
    expect(edits.at(-1)).toBe("one two")
  })

  it("starts another file afresh: its text, no undo history, at its top", async () => {
    const { viewer, view, edits } = mount({ text: numbered(300), path: "a.ts" })
    atEnd(view)
    await userEvent.keyboard("x")
    view.scrollDOM.scrollTop = 2000
    await frames()
    const told = edits.length
    const other = numbered(400)
    viewer.update({ text: other, path: "b.ts" })
    expect(textOf(view)).toBe(other)
    expect(edits).toHaveLength(told)
    await frames()
    expect(view.scrollDOM.scrollTop).toBe(0)
    view.focus()
    await userEvent.keyboard(mod("z"))
    expect(textOf(view)).toBe(other)
  })

  it("takes no edits while read-only, until an update lifts it", async () => {
    const { viewer, view, pane, edits } = mount({ text: "one", path: "notes.txt", readOnly: true })
    expect(pane.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("true")
    atEnd(view)
    await userEvent.keyboard("x{Enter}")
    expect(textOf(view)).toBe("one")
    expect(edits).toEqual([])
    // The outside's changes still land.
    viewer.update({ text: "two", path: "notes.txt", readOnly: true })
    expect(textOf(view)).toBe("two")

    viewer.update({ text: "two", path: "notes.txt" })
    atEnd(view)
    await userEvent.keyboard("x")
    expect(textOf(view)).toBe("twox")
    expect(edits).toEqual(["twox"])
  })

  it("saves on Ctrl/⌘+S, which the browser's own save never sees", async () => {
    const { view, saves } = mount({ text: "one", path: "notes.txt" })
    const prevented: boolean[] = []
    const seen = (event: KeyboardEvent): void => {
      if (event.key === "s") prevented.push(event.defaultPrevented)
    }
    window.addEventListener("keydown", seen)
    try {
      view.focus()
      await userEvent.keyboard(mod("s"))
    } finally {
      window.removeEventListener("keydown", seen)
    }
    expect(saves).toEqual(["saved"])
    expect(prevented).toEqual([true])
    expect(textOf(view)).toBe("one")
  })

  it("saves on Ctrl/⌘+S while read-only too, the app deciding what that does", async () => {
    const { view, saves } = mount({ text: "one", path: "notes.txt", readOnly: true })
    view.focus()
    await userEvent.keyboard(mod("s"))
    expect(saves).toEqual(["saved"])
  })

  it("indents with Tab, and lets a keyboard user leave with Escape, then Tab", async () => {
    const { view } = mount({ text: "one", path: "notes.txt" })
    const next = document.createElement("button")
    next.textContent = "Next"
    document.body.append(next)
    panes.push(next)
    atEnd(view)
    await userEvent.keyboard("{Tab}")
    expect(textOf(view)).toBe("  one")
    expect(view.hasFocus).toBe(true)
    await userEvent.keyboard("{Escape}{Tab}")
    expect(document.activeElement).toBe(next)
    expect(textOf(view)).toBe("  one")
  })

  it("indents a tab-indented file with tabs, on Enter and Tab", async () => {
    const { view } = mount({ text: "func main() {\n\tif ok {\n\t\trun()", path: "main.go" })
    atEnd(view)
    await userEvent.keyboard("{Enter}x{Tab}")
    expect(textOf(view)).toBe("func main() {\n\tif ok {\n\t\trun()\n\t\t\tx")
  })

  it("indents a Makefile's recipes with tabs, an empty Makefile's too", async () => {
    const recipe = mount({ text: "build:\n\tgo build ./...", path: "Makefile" })
    atEnd(recipe.view)
    await userEvent.keyboard("{Enter}go vet ./...")
    expect(textOf(recipe.view)).toBe("build:\n\tgo build ./...\n\tgo vet ./...")

    const empty = mount({ text: "", path: "rules.mk" })
    atEnd(empty.view)
    await userEvent.keyboard("{Tab}")
    expect(textOf(empty.view)).toBe("\t")
  })

  it("indents a file by the step of spaces it goes in by", async () => {
    const { view } = mount({ text: "def run():\n    if ok:\n        go()\nx", path: "run.py" })
    atEnd(view)
    await userEvent.keyboard("{Tab}")
    expect(textOf(view)).toBe("def run():\n    if ok:\n        go()\n    x")
  })

  it("keeps a line's indentation on Enter, in a language without braces too", async () => {
    const { view, pane } = mount({ text: "def run():\n    x = 1", path: "run.py" })
    await expect.poll(() => pane.querySelector(".tok-keyword")?.textContent).toBe("def")
    atEnd(view)
    await userEvent.keyboard("{Enter}y")
    expect(textOf(view)).toBe("def run():\n    x = 1\n    y")
    // At the start of an indented line, the line moves down as it was.
    view.dispatch({ selection: { anchor: "def run():\n".length } })
    await userEvent.keyboard("{Enter}")
    expect(textOf(view)).toBe("def run():\n\n    x = 1\n    y")
  })

  it("marks the lines another writer changed, moving them with the person's edits", async () => {
    const text = "one\ntwo\nthree\nfour\nfive"
    const { viewer, view, pane, edits } = mount({
      text,
      path: "notes.txt",
      marks: [{ from: 2, to: 3 }],
    })
    expect(markedOf(pane)).toEqual(["two", "three"])
    viewer.update({ text, path: "notes.txt", marks: [{ from: 5, to: 5 }] })
    expect(markedOf(pane)).toEqual(["five"])

    // The person adds a line above. The app passing that edit back, with the marks it gave,
    // leaves the mark on the line it moved to.
    view.focus()
    view.dispatch({ selection: { anchor: 0 } })
    await userEvent.keyboard("zero{Enter}")
    expect(markedOf(pane)).toEqual(["five"])
    viewer.update({ text: edits.at(-1)!, path: "notes.txt", marks: [{ from: 5, to: 5 }] })
    expect(markedOf(pane)).toEqual(["five"])

    // Marks the app takes away go; a change of text brings its own.
    viewer.update({ text: edits.at(-1)!, path: "notes.txt" })
    expect(markedOf(pane)).toEqual([])
    viewer.update({ text: `${edits.at(-1)!}\nsix`, path: "notes.txt", marks: [{ from: 7, to: 9 }] })
    expect(markedOf(pane)).toEqual(["six"])
  })

  it("keeps a mark on the agent's line when the person breaks a line at its start", async () => {
    const { view, pane } = mount({
      text: "one\ntwo\nthree\n  four",
      path: "notes.txt",
      marks: [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ],
    })
    view.focus()
    view.dispatch({ selection: { anchor: "one\n".length } })
    await userEvent.keyboard("{Enter}")
    expect(textOf(view)).toBe("one\n\ntwo\nthree\n  four")
    expect(markedOf(pane)).toEqual(["two", "  four"])
    // An indented line, at its start and after its indentation.
    view.dispatch({ selection: { anchor: textOf(view).indexOf("  four") } })
    await userEvent.keyboard("{Enter}")
    expect(markedOf(pane)).toEqual(["two", "  four"])
    view.dispatch({ selection: { anchor: textOf(view).indexOf("four") } })
    await userEvent.keyboard("{Enter}")
    expect(markedOf(pane)).toEqual(["two", "  four"])
  })

  it("drops a mark with its line, and keeps it while any of the line is left", () => {
    const { view, pane } = mount({
      text: "one\ntwo\nthree\nfour",
      path: "notes.txt",
      marks: [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ],
    })
    // Its first character goes: the rest is still the agent's line.
    view.dispatch({ changes: { from: "one\n".length, to: "one\nt".length } })
    expect(markedOf(pane)).toEqual(["wo", "four"])
    // The whole line goes, with its break: no other line takes the mark.
    view.dispatch({ changes: { from: "one\n".length, to: "one\nwo\n".length } })
    expect(textOf(view)).toBe("one\nthree\nfour")
    expect(markedOf(pane)).toEqual(["four"])
  })

  it("shows plain text at once, highlighted once its language's parser loads", async () => {
    const { pane } = mount({ text: "fn main() {}", path: "src/main.rs" })
    expect(pane.querySelector("[class*='tok-']")).toBeNull()
    await expect.poll(() => pane.querySelector(".tok-keyword")?.textContent).toBe("fn")
  })

  it("changes its language with the file", async () => {
    const { viewer, pane } = mount({ text: "let x = 1", path: "a.ts" })
    await expect.poll(() => pane.querySelector(".tok-keyword")?.textContent).toBe("let")
    viewer.update({ text: '{ "slug": "harbour-press" }', path: "projects.json" })
    await expect.poll(() => pane.querySelector(".tok-propertyName")?.textContent).toBe('"slug"')
    expect(pane.querySelector(".tok-keyword")).toBeNull()
  })

  it("stays plain text in a file of no language it knows", async () => {
    const plain = mount({ text: "let x = 1", path: "notes.txt" })
    const known = mount({ text: "let y = 2", path: "other.ts" })
    await expect.poll(() => known.pane.querySelector(".tok-keyword")).not.toBeNull()
    expect(plain.pane.querySelector("[class*='tok-']")).toBeNull()
  })

  it("keeps to the language of the file it shows now, though an earlier file's parser loads after", async () => {
    const { viewer, pane } = mount({ text: "class A {}", path: "A.java" })
    viewer.update({ text: "class A {}", path: "A.txt" })
    const known = mount({ text: "class B {}", path: "B.java" })
    await expect.poll(() => known.pane.querySelector(".tok-keyword")).not.toBeNull()
    await frames()
    expect(pane.querySelector("[class*='tok-']")).toBeNull()
  })

  it("stays plain text when its language's parser can't load", async () => {
    const failed = mount({ text: "package main", path: "main.go" })
    const known = mount({ text: "let y = 2", path: "other.ts" })
    await expect.poll(() => known.pane.querySelector(".tok-keyword")).not.toBeNull()
    await frames()
    expect(failed.pane.querySelector("[class*='tok-']")).toBeNull()
    expect(textOf(failed.view)).toBe("package main")
  })

  it("picks up the same file where an earlier editor left it: text, cursor, history and place", async () => {
    const text = numbered(300)
    const first = mount({ text, path: "a.ts" })
    first.view.focus()
    first.view.dispatch({ selection: { anchor: 0 } })
    await userEvent.keyboard("mine ")
    first.view.dispatch({ selection: { anchor: 40 } })
    first.view.scrollDOM.scrollTop = 2000
    await frames()
    const before = topLine(first.view)
    const saved = first.viewer.state()
    first.viewer.destroy()
    viewers.splice(viewers.indexOf(first.viewer), 1)
    expect(first.pane.children).toHaveLength(0)

    const second = mount({ text: first.edits.at(-1)!, path: "a.ts" }, { saved })
    expect(textOf(second.view)).toBe(`mine ${text}`)
    expect(second.view.state.selection.main.head).toBe(40)
    await expect.poll(() => topLine(second.view)).toBe(before)
    expect(second.edits).toEqual([])
    second.view.focus()
    await userEvent.keyboard(mod("z"))
    expect(textOf(second.view)).toBe(text)
    expect(second.edits).toEqual([text])
  })

  it("puts its saved place back once it has a size, when it opens out of sight", async () => {
    const text = numbered(300)
    const first = mount({ text, path: "a.ts" })
    first.view.scrollDOM.scrollTop = 2000
    await frames()
    const before = topLine(first.view)
    const saved = first.viewer.state()

    const pane = paneIn()
    pane.style.display = "none"
    const viewer = mountEditor(pane, {
      content: { text, path: "a.ts" },
      label: "a.ts",
      saved,
      onEdit: () => {},
      onSave: () => {},
    })
    viewers.push(viewer)
    await frames()
    // Lines added above meanwhile: the place moves along with them.
    viewer.update({ text: `// one\n// two\n${text}`, path: "a.ts" })
    pane.style.display = "block"
    const view = EditorView.findFromDOM(pane.querySelector<HTMLElement>(".cm-editor")!)!
    await expect.poll(() => topLine(view)).toBe(before)
  })

  it("keeps a saved place it hasn't put back yet, when it's let go first", async () => {
    const text = numbered(300)
    const first = mount({ text, path: "a.ts" })
    first.view.scrollDOM.scrollTop = 2000
    await frames()
    const before = topLine(first.view)

    // Out of sight the whole time, it never had a size to put it back with.
    const hidden = paneIn()
    hidden.style.display = "none"
    const parked = mountEditor(hidden, {
      content: { text, path: "a.ts" },
      label: "a.ts",
      saved: first.viewer.state(),
      onEdit: () => {},
      onSave: () => {},
    })
    await frames()
    const fromParked = parked.state()
    parked.destroy()
    const reopened = mount({ text, path: "a.ts" }, { saved: fromParked })
    await expect.poll(() => topLine(reopened.view)).toBe(before)

    // Let go at once, before its first frame, as a component mounted twice in a row is.
    const quick = mount({ text, path: "a.ts" }, { saved: first.viewer.state() })
    const fromQuick = quick.viewer.state()
    const again = mount({ text, path: "a.ts" }, { saved: fromQuick })
    await expect.poll(() => topLine(again.view)).toBe(before)
  })

  it("applies what changed outside while it was away, and the marks as they stood", () => {
    const first = mount({ text: "one\ntwo\nthree", path: "a.txt", marks: [{ from: 2, to: 2 }] })
    first.view.dispatch({ changes: { from: 0, insert: "zero\n" }, userEvent: "input.type" })
    const saved = first.viewer.state()

    // The app still gives the marks it gave, and the person's edit: they stay where it moved them.
    const same = mount(
      { text: first.edits.at(-1)!, path: "a.txt", marks: [{ from: 2, to: 2 }] },
      { saved },
    )
    expect(markedOf(same.pane)).toEqual(["two"])

    // The text changed outside meanwhile: it lands, outside the history, with no word to the app.
    const moved = mount({ text: "zero\none\ntwo\nthree\nfour", path: "a.txt" }, { saved })
    expect(textOf(moved.view)).toBe("zero\none\ntwo\nthree\nfour")
    expect(moved.edits).toEqual([])
    expect(markedOf(moved.pane)).toEqual([])
  })

  it("takes nothing from another file's state, nor another viewer's", () => {
    const first = mount({ text: "one", path: "a.ts" })
    first.view.dispatch({ changes: { from: 3, insert: "!" }, selection: { anchor: 4 } })
    const saved = first.viewer.state()

    const other = mount({ text: "two", path: "b.ts" }, { saved })
    expect(textOf(other.view)).toBe("two")
    expect(other.view.state.selection.main.head).toBe(0)
    // Nor through restore() on a live editor.
    other.viewer.restore(saved)
    expect(textOf(other.view)).toBe("two")

    const code = { code: { top: 40, left: 0, path: "a.ts" } } as unknown as ViewerState
    const same = mount({ text: "one!", path: "a.ts" }, { saved: code })
    expect(textOf(same.view)).toBe("one!")
  })

  it("jumps to a line or an offset, the cursor with it", async () => {
    const text = numbered(300)
    const { viewer, view } = mount({ text, path: "a.ts" })
    const showing = (line: number): boolean => {
      const block = view.lineBlockAt(view.state.doc.line(line).from)
      const { scrollTop, clientHeight } = view.scrollDOM
      return block.top >= scrollTop && block.bottom <= scrollTop + clientHeight
    }
    viewer.jumpTo({ line: 250 })
    await expect.poll(() => showing(250)).toBe(true)
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(250)
    viewer.jumpTo({ offset: 0 })
    await expect.poll(() => view.scrollDOM.scrollTop).toBe(0)
    // Past the end, it goes to the end.
    viewer.jumpTo({ line: 1000 })
    await expect.poll(() => showing(300)).toBe(true)
  })

  it("goes nowhere, without throwing, to a line or offset that is no number", () => {
    const { viewer, view } = mount({ text: numbered(300), path: "a.ts" })
    view.dispatch({ selection: { anchor: 40 } })
    for (const target of [{ line: Number.NaN }, { offset: Number.NaN }])
      expect(() => viewer.jumpTo(target)).not.toThrow()
    expect(view.state.selection.main.head).toBe(40)
  })

  it("takes focus", () => {
    const { viewer, view } = mount({ text: "one", path: "notes.txt" })
    viewer.focus()
    expect(view.hasFocus).toBe(true)
  })

  it("opens a 256 KiB file at once, drawing only the lines in view, and takes typing at once", () => {
    const line = "export const value = 'a line long enough to fill a file quickly';\n"
    const text = line.repeat(Math.ceil((256 * 1024) / line.length))
    const opening = performance.now()
    const { viewer, view, pane, edits } = mount({ text, path: "big.ts" })
    expect(performance.now() - opening).toBeLessThan(1000)
    expect(pane.querySelectorAll(".cm-line").length).toBeLessThan(200)
    atEnd(view)
    const typing = performance.now()
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "x" },
      userEvent: "input.type",
    })
    // The app passes the edit back, as it does.
    viewer.update({ text: edits.at(-1)!, path: "big.ts" })
    expect(performance.now() - typing).toBeLessThan(100)
    expect(textOf(view)).toBe(`${text}x`)
  })

  it("takes everything it added out of its element", () => {
    const { viewer, pane } = mount({ text: "one", path: "notes.txt" })
    viewer.destroy()
    viewers.pop()
    expect(pane.children).toHaveLength(0)
  })
})
