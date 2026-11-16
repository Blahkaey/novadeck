import { afterEach, describe, expect, it, vi } from "vitest"

import { readFirstUse, writeFirstUse } from "./first-use"

describe("first use", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it("is unset until written, then set, under its own key", () => {
    expect(readFirstUse("novadeck.test-a")).toBe(false)
    writeFirstUse("novadeck.test-a")
    expect(readFirstUse("novadeck.test-a")).toBe(true)
    expect(readFirstUse("novadeck.test-b")).toBe(false)
    expect(localStorage.getItem("novadeck.test-a")).toBe("1")
  })

  it("reads as unset, and writes without throwing, where storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readFirstUse("k")).toBe(false)
    expect(() => writeFirstUse("k")).not.toThrow()
  })
})
