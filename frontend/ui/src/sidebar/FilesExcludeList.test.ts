import type { FilesExclude } from "@novadeck/core/files"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"

import { context, describe, expect, it } from "../test"
import { FilesExcludeList } from "./FilesExcludeList"

// The list, held as its owner holds it: each change given back to it, and kept in `changes`.
const mount = (initial: FilesExclude, editable = true) => {
  const changes: FilesExclude[] = []
  let patterns = initial
  const element = () =>
    createElement(FilesExcludeList, {
      patterns,
      label: "Patterns",
      inputId: "pattern-field",
      ...(editable && {
        onChange: (next: FilesExclude) => {
          changes.push(next)
          patterns = next
          view.rerender(element())
        },
      }),
    })
  const view = render(element())
  const container = view.container
  const field = () => container.querySelector<HTMLInputElement>("#pattern-field")
  const add = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === "Add",
    )
  const type = (text: string): void =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), text)
      field()!.dispatchEvent(new Event("input", { bubbles: true }))
    })
  const submit = (): void => act(() => field()!.form!.requestSubmit())
  // Each pattern listed, with whether it is on.
  const listed = (): [string, boolean][] =>
    [...container.querySelectorAll("ul[aria-label=Patterns] li")].flatMap((row) => {
      const box = row.querySelector<HTMLInputElement>("input[type=checkbox]")
      return box ? [[row.textContent ?? "", box.checked]] : []
    })
  return { container, changes, field, add, type, submit, listed }
}

describe("A list of patterns for hiding files", () => {
  context("that can change", () => {
    it("adds what was typed, trimmed and switched on, and clears the field", () => {
      const list = mount({ "**/dist": true })
      list.type("  *.log ")
      list.submit()

      expect(list.changes).toEqual([{ "**/dist": true, "*.log": true }])
      expect(list.listed()).toEqual([
        ["**/dist", true],
        ["*.log", true],
      ])
      expect(list.field()?.value).toBe("")
    })

    it("adds nothing until something is typed", () => {
      const list = mount({})
      expect(list.add()?.disabled).toBe(true)

      list.type("   ")

      expect(list.add()?.disabled).toBe(true)
      list.type("dist")
      expect(list.add()?.disabled).toBe(false)
    })

    it("switches a pattern that is there on again when it is added", () => {
      const list = mount({ "*.log": false })
      list.type("*.log")
      list.submit()

      expect(list.changes).toEqual([{ "*.log": true }])
    })

    it("switches a pattern off and on, and removes it, keeping the rest", () => {
      const list = mount({ dist: true, "*.log": true })
      const box = () => list.container.querySelector<HTMLInputElement>("li input[type=checkbox]")!
      act(() => box().click())
      act(() => box().click())
      act(() =>
        list.container
          .querySelector<HTMLButtonElement>("button[aria-label='Remove dist']")!
          .click(),
      )

      expect(list.changes).toEqual([
        { dist: false, "*.log": true },
        { dist: true, "*.log": true },
        { "*.log": true },
      ])
    })
  })

  context("that is only shown", () => {
    it("lists the patterns with their switches fixed, and nothing to add or remove", () => {
      const list = mount({ dist: true, "*.log": false }, false)

      expect(list.listed()).toEqual([
        ["dist", true],
        ["*.log", false],
      ])
      expect(
        [...list.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].every(
          (box) => box.disabled,
        ),
      ).toBe(true)
      expect(list.field()).toBeNull()
      expect(list.container.querySelector("button")).toBeNull()
    })
  })

  it("leaves its field's text to the owner that keeps it", () => {
    const typed: string[] = []
    const { container } = render(
      createElement(FilesExcludeList, {
        patterns: {},
        label: "Patterns",
        inputId: "pattern-field",
        onChange: () => {},
        field: { text: "dist", onText: (text: string) => typed.push(text) },
      }),
    )
    const field = container.querySelector<HTMLInputElement>("#pattern-field")!
    expect(field.value).toBe("dist")

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        "dist2",
      )
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(typed).toEqual(["dist2"])
    expect(field.value).toBe("dist")
  })

  it("says so when it has none", () => {
    const list = mount({})

    expect(list.container.querySelector("ul")?.textContent).toBe("No patterns.")
  })
})
