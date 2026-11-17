import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { vi } from "vitest"

import { describe, expect, it as base } from "../test.js"

const it = base.extend<{ root: string }>({
  root: async ({ resources }, use) => {
    const root = mkdtempSync(join(tmpdir(), "novadeck-entries-"))
    resources.defer(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "dist"))
    writeFileSync(join(root, "dist", "main.js"), "")
    await use(root)
  },
})

// What a real folder can't be made to give on cue: a file added inside a folder while it is
// deleted, which the system answers with ENOTEMPTY once the deletion is through.
const removal = vi.hoisted(() => ({
  /** The code the next deletion fails with, after it is asked with these options. */
  failure: undefined as string | undefined,
  asked: [] as unknown[],
}))

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>()
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      removal.asked.push(args[1])
      const code = removal.failure
      removal.failure = undefined
      if (code) throw Object.assign(new Error(code), { code, errno: -39 })
      return actual.rm(...args)
    },
  }
})

const { removeEntry } = await import("./entries.js")

describe("deleting a folder that something writes into", () => {
  it("says something was added inside it, and keeps what is left, rather than a name taken", async ({
    root,
  }) => {
    removal.failure = "ENOTEMPTY"

    await expect(removeEntry(root, "dist")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message: "Something was added inside it while it was being deleted; what is left stays.",
    })

    expect(existsSync(join(root, "dist", "main.js"))).toBe(true)
  })

  it("tries the deletion twice more before the system's refusal stands", async ({ root }) => {
    removal.asked.length = 0

    await removeEntry(root, "dist")

    expect(removal.asked).toEqual([{ recursive: true, maxRetries: 2 }])
    expect(existsSync(join(root, "dist"))).toBe(false)
  })
})
