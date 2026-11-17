import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { vi } from "vitest"

import { describe, expect, it as base } from "../test.js"

const it = base.extend<{ directory: string }>({
  directory: async ({ resources }, use) => {
    const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "novadeck-replace-")))
    resources.defer(() => rmSync(directory, { recursive: true, force: true }))
    await use(directory)
  },
})

// A rename the system keeps refusing, as an ACL on Windows does, which a real folder here
// can't be made to give.
const refusal = vi.hoisted(() => ({ code: undefined as string | undefined, tried: 0 }))

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      refusal.tried++
      if (refusal.code) throw Object.assign(new Error(refusal.code), { code: refusal.code })
      return actual.rename(...args)
    },
  }
})

const { replaceFile, unwritable } = await import("./replace.js")
const { stampOf } = await import("./stamps.js")

const words = { gone: "It is gone.", folder: "It can't be written.", unread: "It can't be read." }
const reading = async (path: string) => ({ stamp: stampOf(statSync(path)) })

describe("replacing a file", () => {
  for (const code of ["EACCES", "EPERM"])
    it(`names a rename the file still refuses with ${code} after its tries as one it may not write`, async ({
      directory,
    }) => {
      const path = join(directory, "a.ts")
      writeFileSync(path, "a\n")
      refusal.code = code
      refusal.tried = 0
      try {
        await expect(
          replaceFile(path, "b\n", (await reading(path)).stamp, reading, words),
        ).rejects.toMatchObject({ code: "PLAN_UNWRITABLE", data: { reason: "folder" } })
      } finally {
        refusal.code = undefined
      }
      expect(refusal.tried).toBe(3)
      expect(readdirSync(directory)).toEqual(["a.ts"])
      expect(readFileSync(path, "utf8")).toBe("a\n")
    })

  it("raises what reading the file again refuses as it is, and leaves no temporary file", async ({
    directory,
  }) => {
    const path = join(directory, "a.ts")
    writeFileSync(path, "a\n")
    const refused = unwritable("not-text", "No longer text.")
    const stamp = (await reading(path)).stamp
    await expect(
      replaceFile(path, "b\n", stamp, () => Promise.reject(refused), words),
    ).rejects.toBe(refused)
    expect(readdirSync(directory)).toEqual(["a.ts"])
    expect(readFileSync(path, "utf8")).toBe("a\n")
  })
})
