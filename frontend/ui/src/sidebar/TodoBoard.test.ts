import {
  added,
  changed,
  noteLimits,
  noteLine,
  placed,
  removed,
  type BoardColumn,
  type Note,
  type NoteChange,
} from "@novadeck/core/notes"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { afterEach, vi } from "vitest"

import { context, describe, eventually, expect, it } from "../test"
import { TodoBoard } from "./TodoBoard"

// The width every board measures, which ResizeObserver reports as it starts to observe one:
// jsdom lays nothing out, and has no ResizeObserver of its own.
let measured = 0
Object.assign(globalThis, {
  ResizeObserver: class {
    constructor(private readonly report: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.report(
        [{ target, contentRect: { width: measured } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  },
})
afterEach(() => {
  measured = 0
})

const card = (id: string, parts: Partial<Note> = {}): Note => ({
  id,
  projectId: "storefront",
  text: `Card ${id}`,
  body: "",
  todo: true,
  doneAt: null,
  createdAt: 0,
  ...parts,
})

// The board over notes kept as a backend keeps them: each change is applied by the core's
// rules, and the board drawn again with what they made. A backend that can't place a card
// (`placing` false) is one from before the board.
const show = (
  first: readonly Note[],
  options: { failed?: boolean; width?: number; now?: number; placing?: boolean } = {},
) => {
  measured = options.width ?? 0
  let notes = first
  let now = options.now ?? Date.now()
  let made = 0
  const calls = {
    add: vi.fn<(text: string) => void>(),
    change: vi.fn<(id: string, change: NoteChange) => void>(),
    place: vi.fn<(id: string, column: BoardColumn, before: string | null) => void>(),
    remove: vi.fn<(ids: readonly string[]) => void>(),
  }
  const props = () => ({
    projectId: "storefront",
    notes,
    failed: options.failed ?? false,
    now,
    onAdd: (text: string) => {
      calls.add(text)
      keep(added(notes, card(`new-${(made += 1)}`, { text: noteLine(text) })))
    },
    onChange: (id: string, change: NoteChange) => {
      calls.change(id, change)
      keep(changed(notes, id, change, 500))
    },
    onPlace:
      options.placing === false
        ? undefined
        : (id: string, column: BoardColumn, before: string | null) => {
            calls.place(id, column, before)
            keep(placed(notes, id, column, before, 500))
          },
    onRemove: (ids: readonly string[]) => {
      calls.remove(ids)
      keep(removed(notes, ids))
    },
  })
  const page = render(createElement(TodoBoard, props()))
  const keep = (next: readonly Note[]): void => {
    notes = next
    page.rerender(createElement(TodoBoard, props()))
  }
  // The board told another time, as its panel tells it.
  const at = (time: number): void => {
    now = time
    page.rerender(createElement(TodoBoard, props()))
  }
  const list = (label: string): HTMLElement | null =>
    page.container.querySelector<HTMLElement>(`[role=list][aria-label="${label}"]`)
  // A column's cards' lines, top to bottom, where it shows.
  const texts = (label: string) =>
    [...(list(label)?.querySelectorAll(".notes-row-text") ?? [])].map((row) => row.textContent)
  const row = (id: string) => page.container.querySelector<HTMLElement>(`[data-note="${id}"]`)!
  const named = (each: Element) => each.getAttribute("aria-label") ?? each.textContent
  const button = (name: string) =>
    [...page.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => named(each) === name,
    )!
  const tab = (name: string) =>
    [...page.container.querySelectorAll<HTMLElement>("[role=tab]")].find((each) =>
      each.textContent?.startsWith(name),
    )!
  const field = (name: string) =>
    [...page.container.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])")].find(
      (each) => each.getAttribute("aria-label") === name,
    )!
  const checkbox = (name: string) =>
    [...page.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find(
      (each) => each.getAttribute("aria-label") === name,
    )!
  const type = (into: HTMLInputElement, text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(into, text)
      into.dispatchEvent(new Event("input", { bubbles: true }))
    })
  const press = (on: Element, key: string, modifiers: KeyboardEventInit = {}) =>
    act(() => {
      on.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }),
      )
    })
  const click = (on: HTMLElement) => act(() => on.click())
  // The lines the board says, apart from where its cards went.
  const said = () =>
    [...page.container.querySelectorAll("p.notes-empty")].map((line) => line.textContent)
  const announced = () =>
    page.container.querySelector('[role=status][aria-label="Board moves"]')?.textContent
  return {
    page,
    calls,
    texts,
    row,
    button,
    tab,
    field,
    checkbox,
    type,
    press,
    click,
    said,
    announced,
    at,
    notes: () => notes,
  }
}

const storefront = [
  card("a"),
  card("p", { todo: false, text: "A plain note" }),
  card("b", { doing: true }),
  card("c"),
  card("d", { doneAt: 90 }),
]

describe("The Todo board", () => {
  context("where it is narrow, as in the sidebar", () => {
    it("shows one column at a time, To do first, with a tab for each that counts its cards", async () => {
      const { texts, tab, click, page } = show(storefront)

      expect(page.container.querySelector(".todo-board")?.getAttribute("data-layout")).toBe(
        "narrow",
      )
      expect(
        [...page.container.querySelectorAll("[role=tab]")].map((each) => each.textContent),
      ).toEqual(["To do2", "In progress1", "Done1"])
      expect(texts("To do")).toEqual(["Card a", "Card c"])
      expect(texts("In progress")).toEqual([])

      await click(tab("In progress"))
      expect(texts("In progress")).toEqual(["Card b"])
      expect(texts("To do")).toEqual([])
    })
  })

  context("where it is wide", () => {
    it("shows the three columns side by side, each under a heading that counts its cards", () => {
      const { texts, page } = show(storefront, { width: 800 })

      expect(page.container.querySelector(".todo-board")?.getAttribute("data-layout")).toBe("wide")
      expect(page.container.querySelector("[role=tab]")).toBeNull()
      expect([...page.container.querySelectorAll("h3")].map((each) => each.textContent)).toEqual([
        "To do2",
        "In progress1",
        "Done1",
      ])
      expect(texts("To do")).toEqual(["Card a", "Card c"])
      expect(texts("In progress")).toEqual(["Card b"])
      expect(texts("Done")).toEqual(["Card d"])
    })
  })

  it("leaves the plain notes to the Notes panel", () => {
    const { page } = show(storefront, { width: 800 })

    expect(page.container.textContent).not.toContain("A plain note")
  })

  it("says what it is for while the project has no todos", () => {
    const { said } = show([card("p", { todo: false })])

    expect(said()).toEqual(["Todos you add here stay with this project."])
  })

  it("says that the last change wasn't saved", () => {
    const { said } = show([card("a")], { failed: true })

    expect(said()).toEqual(["Your last change wasn’t saved. The board is as it was."])
  })

  it("marks a card an agent added with its agent's icon", () => {
    const { row } = show([card("a", { by: { agent: "claude", handle: "wren" } })])

    expect(row("a").querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Added by Claude Code · @wren",
    )
  })
})

describe("Adding a card", () => {
  it("adds a todo first in To do on Enter, and empties the field for the next", async () => {
    const { field, type, texts, calls } = show([card("a")])
    const adding = field("Add a todo…")

    await type(adding, "Ship it")
    await act(() => adding.form!.requestSubmit())

    expect(calls.add).toHaveBeenCalledWith("Ship it")
    expect(texts("To do")).toEqual(["Ship it", "Card a"])
    expect(field("Add a todo…").value).toBe("")
  })

  it("takes no more where the project is full, and says why", () => {
    const full = Array.from({ length: noteLimits.perProject }, (_, index) => card(`n${index}`))
    const { field, said } = show(full)

    expect(field("Add a todo…").disabled).toBe(true)
    expect(said()[0]).toContain(`${noteLimits.perProject} notes`)
  })
})

describe("Checking a card off", () => {
  it("puts it first in Done, says so, and opens it again first in To do", async () => {
    const { checkbox, click, texts, calls, announced } = show(storefront, { width: 800 })

    await click(checkbox("Card c"))
    expect(calls.change).toHaveBeenCalledWith("c", { done: true })
    expect(texts("Done")).toEqual(["Card c", "Card d"])
    expect(announced()).toBe("Card c: Done, 1 of 2")

    await click(checkbox("Card d"))
    expect(calls.change).toHaveBeenLastCalledWith("d", { done: false })
    expect(texts("To do")).toEqual(["Card d", "Card a"])
  })

  it("shows when a done card was checked off", () => {
    const { row } = show([card("d", { doneAt: Date.now() })], { width: 800 })

    expect(row("d").querySelector(".todo-card-date")?.textContent).toMatch(/^Done \d/)
  })

  it("says it against the time it is told, a date once that is another day", () => {
    const doneAt = new Date(2026, 10, 19, 9, 5).getTime()
    const { row, at } = show([card("d", { doneAt })], {
      width: 800,
      now: new Date(2026, 10, 19, 15, 0).getTime(),
    })
    const date = () => row("d").querySelector(".todo-card-date")?.textContent

    expect(date()).toMatch(/^Done .*9.05/)
    at(new Date(2026, 10, 20, 8, 0).getTime())
    expect(date()).toMatch(/^Done .*\b19\b/)
    expect(date()).not.toMatch(/05/)
  })
})

describe("Moving a card", () => {
  it("offers each card a Move menu, which the keyboard reaches", () => {
    const { button } = show(storefront)

    // Ark's menu doesn't open in jsdom: the browser specs choose its items.
    expect(button("Move Card a").getAttribute("aria-haspopup")).toBe("menu")
    expect(button("Move Card a").getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowDown Alt+ArrowRight",
    )
  })

  it("moves it to the column beside with Alt and the left or right arrow, keeping the keyboard on it", async () => {
    const { button, press, calls, texts, tab, announced } = show(storefront)

    button("Edit Card a").focus()
    await press(button("Edit Card a"), "ArrowRight", { altKey: true })

    expect(calls.place).toHaveBeenCalledWith("a", "doing", "b")
    expect(tab("In progress").getAttribute("aria-selected")).toBe("true")
    expect(texts("In progress")).toEqual(["Card a", "Card b"])
    expect(announced()).toBe("Card a: In progress, 1 of 2")
    await eventually(() => expect(document.activeElement).toBe(button("Edit Card a")))

    await press(button("Edit Card a"), "ArrowRight", { altKey: true })
    expect(calls.place).toHaveBeenLastCalledWith("a", "done", "d")
    expect(texts("Done")).toEqual(["Card a", "Card d"])

    await press(button("Edit Card a"), "ArrowRight", { altKey: true })
    expect(calls.place).toHaveBeenCalledTimes(2)
  })

  it("moves it up and down its column with Alt and an arrow, last past its last card", async () => {
    const { button, press, calls, texts, announced } = show(storefront)

    await press(button("Edit Card a"), "ArrowDown", { altKey: true })
    expect(calls.place).toHaveBeenCalledWith("a", "todo", null)
    expect(texts("To do")).toEqual(["Card c", "Card a"])
    expect(announced()).toBe("Card a: To do, 2 of 2")

    await press(button("Edit Card a"), "ArrowDown", { altKey: true })
    expect(calls.place).toHaveBeenCalledTimes(1)

    await press(button("Edit Card a"), "ArrowUp", { altKey: true })
    expect(calls.place).toHaveBeenLastCalledWith("a", "todo", "c")
  })

  it("keeps a done card's date as it moves within Done", async () => {
    const { button, press, texts, row, tab, click } = show([
      card("d", { doneAt: Date.now() - 1000 }),
      card("e", { doneAt: Date.now() }),
    ])

    await click(tab("Done"))
    await press(button("Edit Card d"), "ArrowDown", { altKey: true })

    expect(texts("Done")).toEqual(["Card e", "Card d"])
    expect(row("d").querySelector(".todo-card-date")?.textContent).toMatch(/^Done \d/)
  })

  it("names the keys that move it where they can", () => {
    const { button } = show(storefront)

    expect(button("Edit Card a").getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowDown Alt+ArrowRight",
    )
    expect(button("Edit Card c").getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowUp Alt+ArrowRight",
    )
  })
})

describe("A board whose backend can't place cards, as a runner from before it", () => {
  it("offers no Move menu, names no keys, and says moving cards needs the runner updated", () => {
    const { page, button, said } = show(storefront, { placing: false })

    expect(page.container.querySelector(".todo-card-move")).toBeNull()
    expect(button("Edit Card a").hasAttribute("aria-keyshortcuts")).toBe(false)
    expect(said()).toEqual(["Moving cards needs the runner updated to this version of Novadeck."])
  })

  it("moves nothing with Alt and the arrows", async () => {
    const { button, press, texts, tab } = show(storefront, { placing: false })

    await press(button("Edit Card a"), "ArrowRight", { altKey: true })
    await press(button("Edit Card a"), "ArrowDown", { altKey: true })

    expect(tab("To do").getAttribute("aria-selected")).toBe("true")
    expect(texts("To do")).toEqual(["Card a", "Card c"])
  })

  it("still checks a card off to Done and opens it again in To do", async () => {
    const { checkbox, click, texts, calls } = show(storefront, { width: 800, placing: false })

    await click(checkbox("Card c"))
    expect(calls.change).toHaveBeenCalledWith("c", { done: true })
    expect(texts("Done")).toEqual(["Card c", "Card d"])

    await click(checkbox("Card c"))
    expect(texts("To do")).toEqual(["Card c", "Card a"])
  })
})

describe("Changing a card", () => {
  it("edits its line where it stands", async () => {
    const { button, click, field, type, press, calls, texts } = show([card("a")])

    await click(button("Edit Card a"))
    await type(field("Note text"), "Ship it today")
    await press(field("Note text"), "Enter")

    expect(calls.change).toHaveBeenCalledWith("a", { text: "Ship it today" })
    expect(texts("To do")).toEqual(["Ship it today"])
  })

  it("makes it a plain note, which leaves the board for the Notes panel", async () => {
    const { button, click, calls, texts, notes } = show([card("a", { body: "More." }), card("b")])

    await click(button("Details of Card a"))
    await click(button("Make it a note"))

    expect(calls.change).toHaveBeenCalledWith("a", { todo: false })
    expect(texts("To do")).toEqual(["Card b"])
    expect(notes().find(({ id }) => id === "a")?.todo).toBe(false)
  })

  it("deletes it from under its line, without asking", async () => {
    const { button, click, calls, texts } = show([card("a", { body: "More." }), card("b")])

    await click(button("Details of Card a"))
    await click(button("Delete Card a"))

    expect(calls.remove).toHaveBeenCalledWith(["a"])
    expect(texts("To do")).toEqual(["Card b"])
  })
})

describe("Clearing Done", () => {
  it("deletes every done card once the question is confirmed, and none while it is not", async () => {
    const { button, click, calls, texts, tab } = show([
      card("a", { doneAt: 90 }),
      card("b"),
      card("c", { doneAt: 80 }),
    ])
    const answer = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")].find(
        (each) => each.textContent === name,
      )!

    await click(tab("Done"))
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
    expect(texts("Done")).toEqual([])
    await click(tab("To do"))
    expect(texts("To do")).toEqual(["Card b"])
  })
})
