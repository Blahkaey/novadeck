import { randomBytes } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "../test.js"
import { KeyFileError, loadKeyFile } from "./key-file.js"

const folder = (resources: { defer(cleanup: () => void): void }): string => {
  const path = mkdtempSync(join(tmpdir(), "novadeck-key-file-"))
  resources.defer(() => rmSync(path, { recursive: true, force: true }))
  return path
}

const posix = process.platform !== "win32"

describe("transcript key file", () => {
  it("makes a 32-byte key its owner alone can read, in a folder it makes, and leaves nothing else", async ({
    resources,
  }) => {
    const data = join(folder(resources), "data")
    const path = join(data, "transcript-key")

    const key = await loadKeyFile(path)

    expect(key).toHaveLength(32)
    expect(new Uint8Array(await readFile(path))).toEqual(key)
    expect(readdirSync(data)).toEqual(["transcript-key"])
    if (posix) {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(statSync(data).mode & 0o777).toBe(0o700)
    }
  })

  it("reads the key it made on every later start", async ({ resources }) => {
    const path = join(folder(resources), "transcript-key")
    const first = await loadKeyFile(path)

    expect(await loadKeyFile(path)).toEqual(first)
  })

  it("takes a key put there by hand", async ({ resources }) => {
    const path = join(folder(resources), "transcript-key")
    const bytes = randomBytes(32)
    writeFileSync(path, bytes, { mode: 0o600 })

    expect(await loadKeyFile(path)).toEqual(new Uint8Array(bytes))
  })

  it("gives two starts at once the same key", async ({ resources }) => {
    const path = join(folder(resources), "transcript-key")

    const [one, two] = await Promise.all([loadKeyFile(path), loadKeyFile(path)])

    expect(one).toEqual(two)
  })

  it("refuses a file that isn't 32 bytes, naming it, and leaves it as it was", async ({
    resources,
  }) => {
    const path = join(folder(resources), "transcript-key")
    for (const held of [
      Buffer.alloc(0),
      randomBytes(31),
      randomBytes(33),
      Buffer.from("x".repeat(44)),
    ]) {
      writeFileSync(path, held, { mode: 0o600 })

      // eslint-disable-next-line no-await-in-loop -- Each file in turn.
      const failure = await loadKeyFile(path).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(KeyFileError)
      expect((failure as Error).message).toContain(path)
      expect((failure as Error).message).toContain("doesn't hold a key")
      // eslint-disable-next-line no-await-in-loop -- As above.
      expect(await readFile(path)).toEqual(held)
    }
  })

  it.runIf(posix)(
    "refuses a key other accounts can read or change, without saying what it holds",
    async ({ resources }) => {
      const path = join(folder(resources), "transcript-key")
      const bytes = randomBytes(32)
      for (const mode of [0o640, 0o604, 0o620, 0o644]) {
        writeFileSync(path, bytes)
        chmodSync(path, mode)

        // eslint-disable-next-line no-await-in-loop -- Each mode in turn.
        const failure = await loadKeyFile(path).catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(KeyFileError)
        expect((failure as Error).message).toContain("other accounts")
        expect((failure as Error).message).not.toContain(bytes.toString("hex"))
        expect((failure as Error).message).not.toContain(bytes.toString("base64"))
        // eslint-disable-next-line no-await-in-loop -- As above.
        expect(await readFile(path)).toEqual(bytes)
      }
    },
  )

  it("refuses a folder in place of the file", async ({ resources }) => {
    const path = join(folder(resources), "transcript-key")
    mkdirSync(path)

    await expect(loadKeyFile(path)).rejects.toThrow(`${path} isn't a file`)
  })

  it.runIf(posix && process.getuid?.() !== 0)(
    "refuses a file it can't read, and leaves it be",
    async ({ resources }) => {
      const path = join(folder(resources), "transcript-key")
      const bytes = randomBytes(32)
      writeFileSync(path, bytes, { mode: 0o600 })
      chmodSync(path, 0o200)
      resources.defer(() => chmodSync(path, 0o600))

      await expect(loadKeyFile(path)).rejects.toThrow(`${path} can't be read`)
      chmodSync(path, 0o600)
      expect(await readFile(path)).toEqual(bytes)
    },
  )

  it("reads the mode as nothing on Windows, where it says nothing of other accounts", async ({
    resources,
  }) => {
    const path = join(folder(resources), "transcript-key")
    const bytes = randomBytes(32)
    writeFileSync(path, bytes)
    if (posix) chmodSync(path, 0o644)

    expect(await loadKeyFile(path, "win32")).toEqual(new Uint8Array(bytes))
  })
})
