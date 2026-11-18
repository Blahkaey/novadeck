import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { afterEach, vi } from "vitest"

import { CopyFirstDialog } from "./CopyFirstDialog"
import { context, describe, expect, it } from "./test"

type Asked = { readonly name: string; readonly waiting?: true }
const asked: Asked = { name: "notes.md" }

const mounted: (() => void)[] = []
afterEach(() => mounted.splice(0).forEach((unmount) => unmount()))

// jsdom has no clipboard: the one the page has here, until the test ends.
const clipboard = (writeText?: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText && { writeText },
    configurable: true,
  })
  mounted.push(() => Reflect.deleteProperty(navigator, "clipboard"))
}

// The dialog asking about `subject`, copying what `text` gives: the answers it gave, and a way
// to ask about another.
const asking = (text: () => string | undefined = () => "Mine.", subject = asked) => {
  const answers: string[] = []
  const props = (shown: Asked) => ({
    subject: shown,
    bar: () => null,
    title: ({ name, waiting }: Asked) => (waiting ? `Saving ${name}…` : `Close ${name}?`),
    description: ({ waiting }: Asked) =>
      waiting ? "Closing goes on once they're saved." : "Closing loses your edits.",
    uncopied: () => "Your edits couldn't be copied, so nothing was done.",
    confirmLabel: () => "Copy my edits and close",
    discardLabel: () => "Close without my edits",
    cancelLabel: "Cancel",
    text,
    waiting: ({ waiting }: Asked) => waiting === true,
    onGo: ({ name }: Asked) => void answers.push(`go ${name}`),
    onStay: ({ name }: Asked) => void answers.push(`stay ${name}`),
    widthClassName: "",
  })
  const { unmount, rerender } = render(createElement(CopyFirstDialog<Asked>, props(subject)))
  mounted.push(unmount)
  const ask = (shown: Asked) =>
    act(() => rerender(createElement(CopyFirstDialog<Asked>, props(shown))))
  return { answers, ask }
}
const dialog = () => document.querySelector<HTMLElement>("[role='alertdialog']")
const buttons = () => [...dialog()!.querySelectorAll("button")].map((each) => each.textContent)
const answer = async (label: string) => {
  const button = [...dialog()!.querySelectorAll("button")].find(
    (each) => each.textContent === label,
  )!
  await act(async () => button.click())
}

describe("a question whose answer copies first", () => {
  it("copies, then goes on", async () => {
    const copied: string[] = []
    clipboard(async (text) => void copied.push(text))
    const { answers } = asking()
    expect(buttons()).toEqual(["Cancel", "Copy my edits and close"])
    // Its words are read with the dialog; nothing else is said aloud.
    expect(dialog()!.querySelector("[aria-live]")).toBeNull()
    await answer("Copy my edits and close")
    expect(copied).toEqual(["Mine."])
    expect(answers).toEqual(["go notes.md"])
  })

  it("goes on at once where nothing is left to copy", async () => {
    const { answers } = asking(() => undefined)
    await answer("Copy my edits and close")
    expect(answers).toEqual(["go notes.md"])
  })

  it("stays on Cancel", async () => {
    const { answers } = asking()
    await answer("Cancel")
    expect(answers).toEqual(["stay notes.md"])
  })

  context("when the copy fails", () => {
    const failing = async () => {
      clipboard(() => Promise.reject(new Error("denied")))
      const { answers } = asking()
      await answer("Copy my edits and close")
      await vi.waitFor(() => expect(dialog()?.textContent).toContain("couldn't be copied"))
      return answers
    }

    it("does nothing, says so, and offers going on without the copy", async () => {
      const answers = await failing()
      expect(answers).toEqual([])
      expect(buttons()).toEqual(["Cancel", "Close without my edits", "Copy my edits and close"])
      await answer("Close without my edits")
      expect(answers).toEqual(["go notes.md"])
    })

    it("stays on Escape", async () => {
      const answers = await failing()
      await act(async () => {
        dialog()!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        )
      })
      await vi.waitFor(() => expect(answers).toEqual(["stay notes.md"]))
    })
  })

  context("while going on waits on something else", () => {
    const waiting: Asked = { name: "notes.md", waiting: true }

    it("offers only Cancel, which stays", async () => {
      const { answers } = asking(undefined, waiting)
      expect(dialog()?.textContent).toContain("Saving notes.md…")
      expect(buttons()).toEqual(["Cancel"])
      await answer("Cancel")
      expect(answers).toEqual(["stay notes.md"])
    })

    it("turns in place into the question that follows it, telling a screen reader", async () => {
      const { ask } = asking(undefined, waiting)
      const shown = dialog()
      const live = shown!.querySelector("[aria-live='polite']")
      expect(live?.textContent).toBe("Closing goes on once they're saved.")
      await ask(asked)
      expect(dialog()).toBe(shown)
      expect(dialog()?.textContent).toContain("Close notes.md?")
      expect(buttons()).toEqual(["Cancel", "Copy my edits and close"])
      expect(dialog()!.querySelector("[aria-live='polite']")).toBe(live)
      expect(live?.textContent).toBe("Closing loses your edits.")
    })
  })

  it("lets go of a copy's answer once the person cancelled meanwhile", async () => {
    let finish: () => void = () => {}
    clipboard(() => new Promise<void>((resolve) => (finish = resolve)))
    const { answers } = asking()
    await answer("Copy my edits and close")
    await answer("Cancel")
    await act(async () => finish())
    expect(answers).toEqual(["stay notes.md"])
  })
})
