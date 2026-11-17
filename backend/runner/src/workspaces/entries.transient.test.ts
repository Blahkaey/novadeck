import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
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
// deleted, which the system answers with ENOTEMPTY once the deletion is through; a folder on
// another filesystem, which a rename can't reach (EXDEV); a disk that fills as a copy goes;
// another program making a name, or writing a file, between two steps of a change; and a
// filesystem that takes no modes or holds no links.
const removal = vi.hoisted(() => ({
  /** The code the next deletion fails with, after it is asked with these options. */
  failure: undefined as string | undefined,
  asked: [] as unknown[],
}))
const renaming = vi.hoisted(() => ({
  /** The code the next rename fails with. */
  failure: undefined as string | undefined,
  /** Made at the next rename's destination, as another program would, before it fails. */
  planted: undefined as string | undefined,
}))
const copying = vi.hoisted(() => ({
  /** The code a file's copy fails with, once as many copies as `after` have gone through. */
  failure: undefined as string | undefined,
  after: 0,
  /** The next file's copy finds its name made first, by another program. */
  planted: false,
  /** What another program does as the next file is copied, given its path. */
  meanwhile: undefined as ((source: string) => void) | undefined,
  /** How each file was asked to be copied. */
  modes: [] as unknown[],
}))
const deleting = vi.hoisted(() => ({
  /** The code the next file's deletion fails with. */
  failure: undefined as string | undefined,
}))
const moding = vi.hoisted(() => ({
  /** The code each change of a folder's mode fails with. */
  failure: undefined as string | undefined,
  asked: [] as unknown[],
}))
const linking = vi.hoisted(() => ({
  /** The code the next link made fails with. */
  failure: undefined as string | undefined,
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
    rename: async (...args: Parameters<typeof actual.rename>) => {
      const code = renaming.failure
      renaming.failure = undefined
      if (!code) return actual.rename(...args)
      if (renaming.planted !== undefined) await actual.writeFile(args[1], renaming.planted)
      renaming.planted = undefined
      throw Object.assign(new Error(code), { code, errno: -18 })
    },
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      copying.modes.push(args[2])
      const meanwhile = copying.meanwhile
      copying.meanwhile = undefined
      meanwhile?.(String(args[0]))
      if (copying.planted) {
        copying.planted = false
        await actual.writeFile(args[1], "planted")
      }
      if (copying.failure !== undefined && copying.after-- === 0) {
        const code = copying.failure
        copying.failure = undefined
        throw Object.assign(new Error(code), { code, errno: -28 })
      }
      return actual.copyFile(...args)
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      const code = deleting.failure
      deleting.failure = undefined
      if (code) throw Object.assign(new Error(code), { code, errno: -13 })
      return actual.unlink(...args)
    },
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      moding.asked.push([String(args[0]), args[1]])
      const code = moding.failure
      if (code) throw Object.assign(new Error(code), { code, errno: -1 })
      return actual.chmod(...args)
    },
    symlink: async (...args: Parameters<typeof actual.symlink>) => {
      const code = linking.failure
      linking.failure = undefined
      if (code) throw Object.assign(new Error(code), { code, errno: -1 })
      return actual.symlink(...args)
    },
  }
})

const { copyEntry, moveEntry, removeEntry } = await import("./entries.js")

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

describe("moving to another filesystem", () => {
  it("copies a file, and a folder with its links as links, there, then deletes it", async ({
    root,
  }) => {
    writeFileSync(join(root, "dist", "main.js"), "run()\n")
    symlinkSync(join("..", "README.md"), join(root, "dist", "readme"))
    mkdirSync(join(root, "mnt"))
    writeFileSync(join(root, "notes.md"), "# Notes\n")

    renaming.failure = "EXDEV"
    await expect(moveEntry(root, "notes.md", "mnt/notes.md")).resolves.toEqual({
      path: "mnt/notes.md",
    })
    renaming.failure = "EXDEV"
    await expect(moveEntry(root, "dist", "mnt/dist")).resolves.toEqual({ path: "mnt/dist" })

    expect(readdirSync(root).toSorted()).toEqual(["mnt"])
    expect(readFileSync(join(root, "mnt", "notes.md"), "utf8")).toBe("# Notes\n")
    expect(readFileSync(join(root, "mnt", "dist", "main.js"), "utf8")).toBe("run()\n")
    expect(readlinkSync(join(root, "mnt", "dist", "readme"))).toBe(join("..", "README.md"))
  })

  it("refuses a name another program took there meanwhile, overwriting nothing and moving nothing", async ({
    root,
  }) => {
    mkdirSync(join(root, "mnt"))
    renaming.failure = "EXDEV"
    renaming.planted = "theirs"

    await expect(moveEntry(root, "dist/main.js", "mnt/main.js")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "There's already something named main.js in mnt.",
    })

    expect(readFileSync(join(root, "mnt", "main.js"), "utf8")).toBe("theirs")
    expect(existsSync(join(root, "dist", "main.js"))).toBe(true)
  })

  it("keeps what it can't delete after, with its copy made, and says what is left stays", async ({
    root,
  }) => {
    writeFileSync(join(root, "dist", "main.js.map"), "{}")
    mkdirSync(join(root, "mnt"))
    renaming.failure = "EXDEV"
    deleting.failure = "EACCES"

    await expect(moveEntry(root, "dist", "mnt/dist")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message:
        "It was copied to mnt/dist, but what is left of it stays at dist. The system doesn't allow it: permission denied.",
    })

    expect(readdirSync(join(root, "dist")).toSorted()).toEqual(["main.js", "main.js.map"])
    expect(readdirSync(join(root, "mnt", "dist")).toSorted()).toEqual(["main.js", "main.js.map"])
  })

  it("leaves what was added to the folder as it was copied, deleting only what it copied", async ({
    root,
  }) => {
    writeFileSync(join(root, "dist", "main.js"), "run()\n")
    mkdirSync(join(root, "mnt"))
    renaming.failure = "EXDEV"
    // A build writes its next file in, once the folder was listed for the copy.
    copying.meanwhile = () => writeFileSync(join(root, "dist", "chunk.js"), "more()\n")

    await expect(moveEntry(root, "dist", "mnt/dist")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message:
        "It was copied to mnt/dist, but what was added to or changed in dist while it was being copied stays there.",
    })

    expect(readdirSync(join(root, "dist"))).toEqual(["chunk.js"])
    expect(readdirSync(join(root, "mnt", "dist"))).toEqual(["main.js"])
  })

  it("leaves a file written to as it was copied, which the copy may not have", async ({ root }) => {
    writeFileSync(join(root, "dist", "main.js"), "run()\n")
    mkdirSync(join(root, "mnt"))
    renaming.failure = "EXDEV"
    copying.meanwhile = (source) => writeFileSync(source, "run(2)\n")

    await expect(moveEntry(root, "dist/main.js", "mnt/main.js")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message:
        "It was copied to mnt/main.js, but what was added to or changed in dist/main.js while it was being copied stays there.",
    })

    expect(readFileSync(join(root, "dist", "main.js"), "utf8")).toBe("run(2)\n")
    expect(existsSync(join(root, "mnt", "main.js"))).toBe(true)
  })

  // Only a filesystem blind to letters' case leads to the folder by a name that isn't its own.
  it("refuses a folder into itself by a name in other letters' case, which no rename refuses first", async ({
    root,
    skip,
  }) => {
    mkdirSync(join(root, "dist", "inner"))
    writeFileSync(join(root, "probe"), "")
    skip(!existsSync(join(root, "PROBE")), "This filesystem tells letters' case apart.")
    renaming.failure = "EXDEV"

    await expect(moveEntry(root, "DIST", "dist/inner/DIST")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "A folder can't move into itself.",
    })

    renaming.failure = undefined
    expect(readdirSync(join(root, "dist")).toSorted()).toEqual(["inner", "main.js"])
  })

  it("removes a copy that fails part way, and keeps the entry where it was", async ({ root }) => {
    writeFileSync(join(root, "dist", "main.js.map"), "{}")
    mkdirSync(join(root, "mnt"))
    renaming.failure = "EXDEV"
    copying.failure = "ENOSPC"
    copying.after = 1

    await expect(moveEntry(root, "dist", "mnt/dist")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message: "The disk is full.",
    })

    expect(readdirSync(join(root, "mnt"))).toEqual([])
    expect(readdirSync(join(root, "dist")).toSorted()).toEqual(["main.js", "main.js.map"])
  })
})

describe("copying where other programs write", () => {
  it("clones a file where the filesystem can, never over one there", async ({ root }) => {
    copying.modes.length = 0

    await copyEntry(root, "dist/main.js", "dist")

    expect(copying.modes).toEqual([constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE])
  })

  it("takes the next name where another program made the one it was making, overwriting nothing", async ({
    root,
  }) => {
    copying.planted = true

    await expect(copyEntry(root, "dist/main.js", "dist")).resolves.toEqual({
      path: "dist/main copy 2.js",
    })

    expect(readFileSync(join(root, "dist", "main copy.js"), "utf8")).toBe("planted")
    expect(lstatSync(join(root, "dist", "main copy 2.js")).isFile()).toBe(true)
  })

  it("says what of a copy that failed part way stays, where it can't be removed", async ({
    root,
  }) => {
    writeFileSync(join(root, "dist", "main.js.map"), "{}")
    copying.failure = "ENOSPC"
    copying.after = 1
    removal.failure = "EBUSY"

    await expect(copyEntry(root, "dist", "")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message: "The disk is full. What was copied of it stays at dist copy.",
    })

    expect(existsSync(join(root, "dist copy"))).toBe(true)
  })

  it("removes what it copied of a folder something deletes from as it goes, and says so", async ({
    root,
  }) => {
    copying.failure = "ENOENT"
    copying.after = 0

    await expect(copyEntry(root, "dist", "")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "Something in dist went while it was being copied.",
    })

    expect(readdirSync(root)).toEqual(["dist"])
  })
})

describe("copying onto a filesystem that keeps less", () => {
  it("gives a folder copied its mode only where the system made it with another", async ({
    root,
  }) => {
    mkdirSync(join(root, "private"), { mode: 0o700 })
    moding.asked.length = 0

    await copyEntry(root, "dist", "")
    await copyEntry(root, "private", "")

    expect(moding.asked).toEqual([[join(root, "private copy"), 0o700]])
  })

  it("keeps the mode a folder was made with where the system refuses another, as a share's", async ({
    root,
  }) => {
    mkdirSync(join(root, "private"), { mode: 0o700 })
    writeFileSync(join(root, "private", "key"), "")
    moding.failure = "EPERM"

    try {
      await expect(copyEntry(root, "private", "")).resolves.toEqual({ path: "private copy" })
    } finally {
      moding.failure = undefined
    }

    expect(readdirSync(join(root, "private copy"))).toEqual(["key"])
  })

  it("says a link can't be copied where the system makes none, and removes what it copied", async ({
    root,
  }) => {
    symlinkSync("main.js", join(root, "dist", "start"))
    linking.failure = "EPERM"

    await expect(copyEntry(root, "dist", "")).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message:
        process.platform === "win32"
          ? "dist/start is a link, and Windows makes links only for an administrator or with Developer Mode on."
          : "dist/start is a link, and the disk it would be copied to holds no links.",
    })

    expect(readdirSync(root)).toEqual(["dist"])
  })
})
