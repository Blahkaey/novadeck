import { itemIdOf } from "@novadeck/core/items"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { afterEach, vi } from "vitest"

import { context, describe, expect, it } from "../test"
import type { LeaveAsk } from "./leave-edits"
import { LeaveEditsDialog } from "./LeaveEditsDialog"

const unmounts: (() => void)[] = []
afterEach(() => unmounts.splice(0).forEach((unmount) => unmount()))

const closing: LeaveAsk = {
  itemId: itemIdOf("shown"),
  path: "~/project/src/cart.ts",
  name: "cart.ts",
  action: "close",
  waiting: false,
}

// jsdom has no clipboard: the one the page has here, until the test ends.
const clipboard = (writeText?: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText && { writeText },
    configurable: true,
  })
  unmounts.push(() => Reflect.deleteProperty(navigator, "clipboard"))
}

// The dialog asking `question`, with the answers it gave, each to the question it was put.
const asking = (question: LeaveAsk) => {
  const answers: boolean[] = []
  const { unmount } = render(
    createElement(LeaveEditsDialog, {
      question,
      edits: (ask) => (ask === question ? "a\r\nb\r\n" : undefined),
      onAnswer: (ask, go) => void answers.push(ask === question && go),
    }),
  )
  unmounts.push(unmount)
  return answers
}
const dialog = () => document.querySelector<HTMLElement>("[role='alertdialog']")
const buttons = () => [...dialog()!.querySelectorAll("button")].map((each) => each.textContent)
const answer = async (label: string) => {
  const button = [...dialog()!.querySelectorAll("button")].find(
    (each) => each.textContent === label,
  )!
  await act(async () => button.click())
}

describe("the question about leaving edits that can't be saved", () => {
  it("says what going on loses, naming the file", () => {
    asking(closing)
    expect(dialog()?.textContent).toContain("Close cart.ts?")
    expect(dialog()?.textContent).toContain(
      "Your edits to cart.ts couldn't be saved, and closing it loses them. Copy them first to keep them.",
    )
  })

  it("copies the edits as the file holds them, then goes on", async () => {
    const copied: string[] = []
    clipboard(async (text) => void copied.push(text))
    const answers = asking(closing)
    await answer("Copy my edits and close")
    expect(copied).toEqual(["a\r\nb\r\n"])
    expect(answers).toEqual([true])
  })

  context("when the edits couldn't be copied", () => {
    const failing = async () => {
      clipboard(() => Promise.reject(new Error("denied")))
      const answers = asking(closing)
      await answer("Copy my edits and close")
      await vi.waitFor(() => expect(dialog()?.textContent).toContain("couldn't be copied"))
      return answers
    }

    it("stays, says so, and offers closing without them", async () => {
      const answers = await failing()
      expect(dialog()?.textContent).toContain(
        "Your edits couldn't be copied, so nothing was done. Try again, copy them from the editor yourself, or close without them.",
      )
      expect(answers).toEqual([])
      expect(buttons()).toEqual(["Cancel", "Close without my edits", "Copy my edits and close"])
    })

    it("goes on without them once the person says so", async () => {
      const answers = await failing()
      await answer("Close without my edits")
      expect(answers).toEqual([true])
    })

    it("stays with the file on Escape", async () => {
      const answers = await failing()
      await act(async () => {
        dialog()!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        )
      })
      await vi.waitFor(() => expect(answers).toEqual([false]))
    })
  })

  it("lets a copy's answer go once the person cancelled meanwhile", async () => {
    let finish: () => void = () => {}
    clipboard(() => new Promise<void>((resolve) => (finish = resolve)))
    const answers = asking(closing)
    await answer("Copy my edits and close")
    await answer("Cancel")
    await act(async () => finish())
    expect(answers).toEqual([false])
  })

  it("stays with the file on Cancel", async () => {
    const answers = asking(closing)
    await answer("Cancel")
    expect(answers).toEqual([false])
  })

  context("while the edits are still being saved", () => {
    const saving: LeaveAsk = { ...closing, waiting: true }

    it("says so, with Cancel alone, which stays with the file", async () => {
      const answers = asking(saving)
      expect(dialog()?.textContent).toContain("Saving your edits to cart.ts…")
      expect(dialog()?.textContent).toContain("Closing it goes on once they're saved.")
      expect(buttons()).toEqual(["Cancel"])
      await answer("Cancel")
      expect(answers).toEqual([false])
    })
  })

  context("for each thing the person asked for", () => {
    it.each([
      ["switch", "Copy my edits and switch", "Switch without my edits"],
      ["rename", "Copy my edits and rename", "Rename without my edits"],
      ["move", "Copy my edits and move", "Move without my edits"],
      ["delete", "Copy my edits and delete", "Delete without my edits"],
    ] as const)("answers %s with %s, and %s once a copy failed", async (action, label, discard) => {
      clipboard(() => Promise.reject(new Error("denied")))
      asking({ ...closing, action })
      expect(buttons()).toContain(label)
      await answer(label)
      await vi.waitFor(() => expect(buttons()).toContain(discard))
    })
  })
})
