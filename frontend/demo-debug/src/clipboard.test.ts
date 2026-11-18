import { afterEach } from "vitest"

import { refuseClipboard, restoreClipboard } from "./clipboard"
import { describe, expect, it } from "./test"

// The page's own clipboard, as a test gives it: what it was asked to copy.
const ownClipboard = (): string[] => {
  const copied: string[] = []
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (text: string) => void copied.push(text) },
    configurable: true,
  })
  return copied
}

afterEach(() => {
  restoreClipboard()
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("the demo's refused clipboard", () => {
  it("rejects every copy until it is given back, then is the page's own again", async () => {
    const copied = ownClipboard()
    refuseClipboard()
    await expect(navigator.clipboard.writeText("refused")).rejects.toThrow("refused")

    restoreClipboard()
    await navigator.clipboard.writeText("copied")

    expect(copied).toEqual(["copied"])
  })

  it("is given back by one restore however many times it was refused", async () => {
    const copied = ownClipboard()
    refuseClipboard()
    refuseClipboard()

    restoreClipboard()
    await navigator.clipboard.writeText("copied")

    expect(copied).toEqual(["copied"])
  })

  it("leaves no clipboard of its own where the page had none", () => {
    refuseClipboard()
    restoreClipboard()

    expect(Object.getOwnPropertyDescriptor(navigator, "clipboard")).toBeUndefined()
  })
})
