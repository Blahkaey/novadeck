import {
  added,
  changed,
  moved,
  noteLimits,
  noteLine,
  removed,
  type Note,
  type NoteChange,
} from "@novadeck/core/notes"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { vi } from "vitest"

import { context, describe, eventually, expect, it } from "../test"
import { NotesPanel } from "./NotesPanel"

// jsdom has no ResizeObserver, which a tooltip opened by the keyboard's focus places itself with.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
})

const note = (id: string, parts: Partial<Note> = {}): Note => ({
  id,
  projectId: "storefront",
  text: `Note ${id}`,
  body: "",
  todo: true,
  doneAt: null,
  createdAt: 0,
  ...parts,
})

// The panel over notes kept as a backend keeps them: each change is applied by the core's
// rules, and the panel drawn again with what they made.
const show = (first: readonly Note[], options: { failed?: boolean } = {}) => {
  let notes = first
  let made = 0
  const calls = {
    add: vi.fn<(added: { text: string; todo: boolean }) => void>(),
    change: vi.fn<(id: string, change: NoteChange) => void>(),
    move: vi.fn<(id: string, index: number) => void>(),
    remove: vi.fn<(ids: readonly string[]) => void>(),
  }
  const props = () => ({
    projectId: "storefront",
    notes,
    failed: options.failed ?? false,
    active: true,
    onClose: () => {},
    onAdd: (adding: { text: string; todo: boolean }) => {
      calls.add(adding)
      keep(
        added(
          notes,
          note(`new-${(made += 1)}`, { text: noteLine(adding.text), todo: adding.todo }),
        ),
      )
    },
    onChange: (id: string, change: NoteChange) => {
      calls.change(id, change)
      keep(changed(notes, id, change, 500))
    },
    onMove: (id: string, index: number) => {
      calls.move(id, index)
      keep(moved(notes, id, index))
    },
    onRemove: (ids: readonly string[]) => {
      calls.remove(ids)
      keep(removed(notes, ids))
    },
  })
  const page = render(createElement(NotesPanel, props()))
  const keep = (next: readonly Note[]): void => {
    notes = next
    page.rerender(createElement(NotesPanel, props()))
  }
  const within = (label: string): HTMLElement | null =>
    page.container.querySelector<HTMLElement>(`[role=list][aria-label="${label}"]`)
  const texts = (label = "Notes") =>
    [...(within(label)?.querySelectorAll(".notes-row-text") ?? [])].map((row) => row.textContent)
  const row = (id: string) => page.container.querySelector<HTMLElement>(`[data-note="${id}"]`)!
  const button = (name: string) =>
    [...page.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
    )!
  const field = <Field extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(
    name: string,
  ) =>
    [...page.container.querySelectorAll<Field>("input:not([type=checkbox]), textarea")].find(
      (each) => each.getAttribute("aria-label") === name,
    )!
  const checkbox = (name: string) =>
    [...page.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find(
      (each) => each.getAttribute("aria-label") === name,
    )!
  const type = (into: HTMLInputElement | HTMLTextAreaElement, text: string) =>
    act(() => {
      const proto =
        into instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(into, text)
      into.dispatchEvent(new Event("input", { bubbles: true }))
    })
  const press = (on: Element, key: string, modifiers: KeyboardEventInit = {}) =>
    act(() => {
      on.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }),
      )
    })
  const click = (on: HTMLElement) => act(() => on.click())
  const said = () =>
    [...page.container.querySelectorAll("[role=status]")].map((line) => line.textContent)
  const count = () => page.container.querySelector(".sidebar-panel-count")?.textContent
  return {
    page,
    calls,
    keep,
    texts,
    row,
    button,
    field,
    checkbox,
    type,
    press,
    click,
    said,
    count,
    notes: () => notes,
  }
}

describe("The Notes panel", () => {
  it("lists the open notes in the person's order, with how many todos are left", () => {
    const { texts, count, row } = show([
      note("a"),
      note("b", { todo: false }),
      note("c", { doneAt: 90 }),
      note("d"),
    ])

    expect(texts()).toEqual(["Note a", "Note b", "Note d"])
    expect(count()).toBe("2")
    expect(row("a").dataset.kind).toBe("todo")
    expect(row("b").dataset.kind).toBe("note")
    expect(row("b").querySelector("input[type=checkbox]")).toBeNull()
  })

  it("says what it is for while the project has none, and that nothing is left once all are done", () => {
    const { said, keep, count } = show([])

    expect(said()).toEqual(["Todos and notes you write here stay with this project."])
    expect(count()).toBe("")
    keep([note("a", { doneAt: 90 })])
    expect(said()).toEqual(["Nothing left to do."])
  })

  it("says that the last change wasn't saved", () => {
    const { said } = show([note("a")], { failed: true })

    expect(said()).toEqual(["Your last change wasn’t saved. The notes are as they were."])
  })
})

describe("Adding a note", () => {
  it("adds a todo first on Enter, and empties the field for the next", async () => {
    const { field, type, texts, calls } = show([note("a")])
    const adding = field("Add a todo…")

    await type(adding, "Ship it")
    await act(() => adding.form!.requestSubmit())

    expect(calls.add).toHaveBeenCalledWith({ text: "Ship it", todo: true })
    expect(texts()).toEqual(["Ship it", "Note a"])
    expect(field("Add a todo…").value).toBe("")
  })

  it("adds a plain note once its button is switched to notes", async () => {
    const { field, type, button, click, calls, row } = show([])

    expect(button("Add as todos").getAttribute("aria-pressed")).toBe("true")
    await click(button("Add as todos"))
    expect(button("Add as todos").getAttribute("aria-pressed")).toBe("false")
    const adding = field("Add a note…")
    await type(adding, "Staging deploys from release")
    await act(() => adding.form!.requestSubmit())

    expect(calls.add).toHaveBeenCalledWith({ text: "Staging deploys from release", todo: false })
    expect(row("new-1").dataset.kind).toBe("note")
  })

  it("adds nothing that says nothing", async () => {
    const { field, type, calls } = show([])
    const adding = field("Add a todo…")

    await type(adding, "   ")
    await act(() => adding.form!.requestSubmit())

    expect(calls.add).not.toHaveBeenCalled()
  })

  context("when the project holds as many notes as it keeps", () => {
    it("takes no more, and says why", () => {
      const full = Array.from({ length: noteLimits.perProject }, (_, index) =>
        note(`n${index}`, { doneAt: 1 }),
      )
      const { field, said } = show(full)

      expect(field("Add a todo…").disabled).toBe(true)
      expect(said()[0]).toContain(`${noteLimits.perProject} notes`)
    })
  })
})

describe("Checking a todo off", () => {
  it("moves it under Done, folded until asked for, and counts one less to do", async () => {
    const { checkbox, click, texts, count, button, calls } = show([note("a"), note("b")])

    await click(checkbox("Note a"))

    expect(calls.change).toHaveBeenCalledWith("a", { done: true })
    expect(texts()).toEqual(["Note b"])
    expect(count()).toBe("1")
    const done = button("Done1")
    expect(done.getAttribute("aria-expanded")).toBe("false")
    expect(texts("Done")).toEqual([])
    await click(done)
    expect(texts("Done")).toEqual(["Note a"])
    expect(checkbox("Note a").checked).toBe(true)
  })

  it("hands the keyboard to the next todo's checkbox, so several are ticked in a row", async () => {
    const { checkbox, click } = show([note("a"), note("b")])

    checkbox("Note a").focus()
    await click(checkbox("Note a"))

    expect(document.activeElement).toBe(checkbox("Note b"))
  })

  it("opens it again once unchecked under Done", async () => {
    const { checkbox, click, button, texts, calls } = show([note("a", { doneAt: 90 })])

    await click(button("Done1"))
    await click(checkbox("Note a"))

    expect(calls.change).toHaveBeenCalledWith("a", { done: false })
    expect(texts()).toEqual(["Note a"])
  })
})

describe("Changing a note", () => {
  it("edits its line where it stands: Enter saves, and the row takes the keyboard back", async () => {
    const { button, click, field, type, press, texts, calls } = show([note("a")])

    await click(button("Edit Note a"))
    const line = field("Note text")
    expect(document.activeElement).toBe(line)
    await type(line, "Ship it today")
    await press(line, "Enter")

    expect(calls.change).toHaveBeenCalledWith("a", { text: "Ship it today" })
    expect(texts()).toEqual(["Ship it today"])
    await eventually(() => expect(document.activeElement).toBe(button("Edit Ship it today")))
  })

  it("keeps its line as it was on Escape", async () => {
    const { button, click, field, type, press, texts, calls } = show([note("a")])

    await click(button("Edit Note a"))
    await type(field("Note text"), "Something else")
    await press(field("Note text"), "Escape")

    expect(calls.change).not.toHaveBeenCalled()
    expect(texts()).toEqual(["Note a"])
  })

  it("saves its line as the field is left", async () => {
    const { button, click, field, type, calls } = show([note("a")])

    await click(button("Edit Note a"))
    await type(field("Note text"), "Left as it is")
    await act(() => field("Note text").blur())

    expect(calls.change).toHaveBeenCalledWith("a", { text: "Left as it is" })
  })

  it("opens a note with nothing under its line to write some, saved with ⌘ or Ctrl and Enter", async () => {
    const { button, click, field, type, press, row, calls } = show([note("a")])
    const details = button("Details of Note a")

    expect(details.getAttribute("aria-expanded")).toBe("false")
    await click(details)
    const body = field<HTMLTextAreaElement>("Details")
    expect(document.activeElement).toBe(body)
    await type(body, "Before **Friday**.")
    await press(body, "Enter", { ctrlKey: true })

    expect(calls.change).toHaveBeenCalledWith("a", { body: "Before **Friday**." })
    expect(row("a").querySelector(".markdown strong")?.textContent).toBe("Friday")
    expect(button("Details of Note a").dataset.filled).toBe("true")
    expect(button("Edit details")).toBeDefined()
  })

  it("shows what is under its line as Markdown, and folds it away again", async () => {
    const { button, click, row } = show([note("a", { body: "- one\n- two" })])

    expect(row("a").querySelector(".markdown")).toBeNull()
    await click(button("Details of Note a"))
    expect(row("a").querySelectorAll(".markdown li")).toHaveLength(2)
    await click(button("Details of Note a"))
    expect(row("a").querySelector(".markdown")).toBeNull()
  })

  it("takes a todo's checkbox away, and gives a plain note one", async () => {
    const { button, click, row, calls } = show([note("a", { body: "More." })])

    await click(button("Details of Note a"))
    await click(button("Make it a note"))
    expect(calls.change).toHaveBeenCalledWith("a", { todo: false })
    expect(row("a").dataset.kind).toBe("note")
    await click(button("Make it a todo"))
    expect(row("a").dataset.kind).toBe("todo")
  })
})

describe("Moving a note", () => {
  it("steps it one place with Alt and an arrow, says where it went, and keeps the keyboard on it", async () => {
    const { page, button, press, texts, calls } = show([note("a"), note("b"), note("c")])
    const line = button("Edit Note a")

    line.focus()
    await press(line, "ArrowDown", { altKey: true })

    expect(calls.move).toHaveBeenCalledWith("a", 1)
    expect(texts()).toEqual(["Note b", "Note a", "Note c"])
    expect(page.container.querySelector("[aria-live=polite]")?.textContent).toBe("Note a, 2 of 3")
    await eventually(() => expect(document.activeElement).toBe(button("Edit Note a")))
  })

  it("stops at the ends of the list, and says which arrows move a row", async () => {
    const { button, press, calls } = show([note("a"), note("b"), note("c")])

    await press(button("Edit Note a"), "ArrowUp", { altKey: true })
    await press(button("Edit Note c"), "ArrowDown", { altKey: true })

    expect(calls.move).not.toHaveBeenCalled()
    expect(button("Edit Note a").getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowDown")
    expect(button("Edit Note b").getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowUp Alt+ArrowDown",
    )
    expect(button("Edit Note c").getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp")
  })

  it("leaves the arrows to a field being typed in", async () => {
    const { button, click, field, press, calls } = show([note("a"), note("b")])

    await click(button("Edit Note a"))
    await press(field("Note text"), "ArrowDown", { altKey: true })

    expect(calls.move).not.toHaveBeenCalled()
  })
})

describe("Deleting notes", () => {
  it("deletes an open note from under its line, without asking", async () => {
    const { button, click, texts, calls } = show([note("a", { body: "More." }), note("b")])

    await click(button("Details of Note a"))
    await click(button("Delete Note a"))

    expect(calls.remove).toHaveBeenCalledWith(["a"])
    expect(texts()).toEqual(["Note b"])
  })

  it("deletes a done todo from its row", async () => {
    const { button, click, calls, notes } = show([
      note("a", { doneAt: 90 }),
      note("b", { doneAt: 80 }),
    ])

    await click(button("Done2"))
    await click(button("Delete Note a"))

    expect(calls.remove).toHaveBeenCalledWith(["a"])
    expect(notes().map(({ id }) => id)).toEqual(["b"])
  })

  it("clears every done todo once the question is confirmed, and none while it is not", async () => {
    const { page, button, click, calls, texts } = show([
      note("a", { doneAt: 90 }),
      note("b"),
      note("c", { doneAt: 80 }),
    ])
    const answer = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")].find(
        (each) => each.textContent === name,
      )!

    await click(button("Clear done todos"))
    await eventually(() =>
      expect(document.querySelector("[role=alertdialog]")?.textContent).toContain(
        "2 done todos are deleted for good.",
      ),
    )
    await click(answer("Cancel"))
    expect(calls.remove).not.toHaveBeenCalled()

    await click(button("Clear done todos"))
    await eventually(() => expect(answer("Clear done")).toBeDefined())
    await click(answer("Clear done"))

    expect(calls.remove).toHaveBeenCalledWith(["a", "c"])
    expect(texts()).toEqual(["Note b"])
    expect(page.container.querySelector(".notes-done")).toBeNull()
  })
})
