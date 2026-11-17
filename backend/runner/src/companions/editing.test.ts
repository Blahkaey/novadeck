import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { companionLimits, type ItemContent } from "@novadeck/protocol"

import { describe, expect, it as base } from "../test.js"
import { loadText, saveText } from "./editing.js"

// Each test's project is a folder of its own, with a sibling outside it, as an agent's
// worktree is.
const it = base.extend<{ project: string; elsewhere: string }>({
  project: async ({ resources }, use) => {
    // Native, as paths are resolved: on Windows it also expands short names.
    const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "novadeck-editing-")))
    resources.defer(() => rmSync(directory, { recursive: true, force: true }))
    await use(directory)
  },
  elsewhere: async ({ resources }, use) => {
    const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "novadeck-worktree-")))
    resources.defer(() => rmSync(directory, { recursive: true, force: true }))
    await use(directory)
  },
})

const file = (path: string, secret = false) =>
  ({ kind: "file", path, lines: null, secret }) as const

const bom = "\uFEFF"
const unwritable = (reason: string) => ({ code: "PLAN_UNWRITABLE", data: { reason } })
const stampOf = (content: ItemContent): string => (content.state === "ready" ? content.stamp : "")

/**
 * Where a project window's file is saved: in `project`, outside agents' worktrees, which these
 * tests keep in it, as a project of the person's home folder holds them.
 */
const placed = (project: string) => ({ project, worktrees: join(project, "worktrees") })

/** The file's text as it loads to be edited in its project. */
const loaded = (path: string, project: string, reveal = false) =>
  loadText(file(path), reveal, placed(project))

/** Saves `text` over the file at `path` in its project, as an edit made on it at `basedOn`. */
const saved = (path: string, project: string, text: string, basedOn: string) =>
  saveText(file(path), { text, basedOn, path }, placed(project))

const permissions = process.platform === "win32" || process.getuid?.() === 0

describe("a file followed to be edited", () => {
  it("is its whole text: every line however long, its line breaks as they are, no byte-order mark", async ({
    project,
  }) => {
    const long = "x".repeat(companionLimits.lineLength * 2)
    const many = Array.from({ length: 900 }, (_, index) => `line ${index + 1}`).join("\n")
    const text = `first\r\nsecond\r\n${long}\n${many}`
    const path = join(project, "a.ts")
    writeFileSync(path, bom + text)
    await expect(loaded(path, project)).resolves.toEqual({
      state: "ready",
      stamp: expect.any(String),
      content: { kind: "text", path, text, writable: true },
    })
  })

  it("is its listing, saying why, where it can't be edited whole", async ({ project }) => {
    const latin = join(project, "latin.txt")
    writeFileSync(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
    const big = join(project, "big.txt")
    writeFileSync(big, "a\n".repeat(companionLimits.plan / 2 + 1))
    // Within the bytes, but past one save's message once JSON-escaped.
    const quoted = join(project, "quoted.txt")
    writeFileSync(quoted, '"'.repeat(companionLimits.plan - 1024))
    await expect(loaded(latin, project)).resolves.toMatchObject({
      content: { kind: "file", lines: ["caf\uFFFD"], uneditable: "not-text" },
    })
    await expect(loaded(big, project)).resolves.toMatchObject({
      content: { kind: "file", firstLine: 1, uneditable: "too-large" },
    })
    await expect(loaded(quoted, project)).resolves.toMatchObject({
      content: { kind: "file", uneditable: "too-large" },
    })
    const binary = join(project, "a.bin")
    writeFileSync(binary, Buffer.from([0x41, 0x00, 0x42]))
    await expect(loaded(binary, project)).resolves.toEqual({
      state: "unavailable",
      reason: "binary",
      size: 3,
    })
    // Past the limit, a NUL near its start still says it is binary, not too large.
    const bigBinary = join(project, "big.bin")
    writeFileSync(bigBinary, Buffer.concat([Buffer.from([0]), Buffer.alloc(companionLimits.plan)]))
    await expect(loaded(bigBinary, project)).resolves.toMatchObject({
      state: "unavailable",
      reason: "binary",
    })
    await expect(loaded(join(project, "missing.ts"), project)).resolves.toMatchObject({
      state: "unavailable",
      reason: "missing",
    })
  })

  it("holds a file that may hold secrets until it is revealed, then is editable as any", async ({
    project,
  }) => {
    const path = join(project, ".env")
    writeFileSync(path, "TOKEN=x\n")
    await expect(loaded(path, project)).resolves.toEqual({
      state: "unavailable",
      reason: "secret",
      size: 8,
    })
    await expect(loaded(path, project, true)).resolves.toMatchObject({
      content: { kind: "text", text: "TOKEN=x\n", writable: true },
    })
  })

  it("says up front why it isn't saved: no file of a project window, or outside its project", async ({
    project,
    elsewhere,
  }) => {
    const path = join(project, "a.ts")
    writeFileSync(path, "a\n")
    const copy = join(elsewhere, "a.ts")
    writeFileSync(copy, "a\n")
    await expect(loadText(file(path), false, undefined)).resolves.toMatchObject({
      content: { kind: "text", writable: false, reason: "not-a-plan" },
    })
    await expect(loaded(copy, project)).resolves.toMatchObject({
      content: { kind: "text", text: "a\n", writable: false, reason: "outside" },
    })
  })

  it("is outside its project in Git's own .git, and in agents' worktrees the project holds", async ({
    project,
  }) => {
    mkdirSync(join(project, ".git"))
    writeFileSync(join(project, ".git", "config"), "[core]\n")
    mkdirSync(join(project, "worktrees", "shop"), { recursive: true })
    writeFileSync(join(project, "worktrees", "shop", "a.ts"), "a\n")
    for (const path of [
      join(project, ".git", "config"),
      join(project, "worktrees", "shop", "a.ts"),
    ])
      // eslint-disable-next-line no-await-in-loop -- Each file after the other.
      await expect(loaded(path, project)).resolves.toMatchObject({
        content: { kind: "text", writable: false, reason: "outside" },
      })
  })

  it.skipIf(process.platform === "win32")(
    "is outside its project through a link that leads out of it, or into its .git",
    async ({ project, elsewhere }) => {
      writeFileSync(join(elsewhere, "a.ts"), "a\n")
      symlinkSync(join(elsewhere, "a.ts"), join(project, "link.ts"))
      mkdirSync(join(project, ".git"))
      writeFileSync(join(project, ".git", "config"), "[core]\n")
      symlinkSync(join(project, ".git"), join(project, "g"))
      for (const path of [join(project, "link.ts"), join(project, "g", "config")])
        // eslint-disable-next-line no-await-in-loop -- Each file after the other.
        await expect(loaded(path, project)).resolves.toMatchObject({
          content: { kind: "text", writable: false, reason: "outside" },
        })
    },
  )

  it.skipIf(permissions)(
    "says a file, or a folder, the runner may not write isn't saved",
    async ({ project }) => {
      const path = join(project, "locked.ts")
      writeFileSync(path, "a\n")
      chmodSync(path, 0o444)
      await expect(loaded(path, project)).resolves.toMatchObject({
        content: { writable: false, reason: "folder" },
      })
      const folder = join(project, "ro")
      mkdirSync(folder)
      writeFileSync(join(folder, "a.ts"), "a\n")
      chmodSync(folder, 0o555)
      try {
        await expect(loaded(join(folder, "a.ts"), project)).resolves.toMatchObject({
          content: { writable: false, reason: "folder" },
        })
      } finally {
        chmodSync(folder, 0o755)
      }
    },
  )
})

describe("saving a file", () => {
  it("writes the file whole when it is as the edit was made on, and answers the stamp it loads with", async ({
    project,
  }) => {
    const path = join(project, "a.ts")
    writeFileSync(path, "const a = 1\n")
    const answer = await saved(path, project, "const a = 2\n", stampOf(await loaded(path, project)))
    expect(answer).toEqual({ saved: true, stamp: stampOf(await loaded(path, project)) })
    expect(readFileSync(path, "utf8")).toBe("const a = 2\n")
    // No temporary file is left beside it.
    expect(readdirSync(project)).toEqual(["a.ts"])
  })

  it("keeps the file's line breaks as the text has them, and its byte-order mark", async ({
    project,
  }) => {
    const path = join(project, "a.cs")
    writeFileSync(path, `${bom}class A\r\n{\r\n}\r\n`)
    const content = await loaded(path, project)
    expect(content).toMatchObject({ content: { text: "class A\r\n{\r\n}\r\n" } })
    await saved(path, project, "class B\r\n{\r\n}", stampOf(content))
    expect(readFileSync(path, "utf8")).toBe(`${bom}class B\r\n{\r\n}`)
  })

  it("writes nothing and hands back the file's text as it stands when it changed since", async ({
    project,
  }) => {
    const path = join(project, "a.ts")
    writeFileSync(path, "mine\n")
    const stamp = stampOf(await loaded(path, project))
    writeFileSync(path, `${bom}theirs, from the agent\n`)
    await expect(saved(path, project, "edited\n", stamp)).resolves.toEqual({
      saved: false,
      current: {
        stamp: stampOf(await loaded(path, project)),
        text: "theirs, from the agent\n",
        truncated: false,
        skill: false,
      },
    })
    expect(readFileSync(path, "utf8")).toBe(`${bom}theirs, from the agent\n`)
  })

  it.skipIf(process.platform === "win32")("keeps the file's permissions", async ({ project }) => {
    const path = join(project, "shared.ts")
    writeFileSync(path, "a\n")
    chmodSync(path, 0o664)
    // A umask that clips the group's write, as the temporary file's mode would show.
    const umask = process.umask(0o022)
    try {
      await saved(path, project, "b\n", stampOf(await loaded(path, project)))
    } finally {
      process.umask(umask)
    }
    expect(statSync(path).mode & 0o777).toBe(0o664)
    expect(readFileSync(path, "utf8")).toBe("b\n")
  })

  it("saves a file that may hold secrets as any other, once the person has it", async ({
    project,
  }) => {
    const path = join(project, ".env")
    writeFileSync(path, "TOKEN=x\n")
    const stamp = stampOf(await loaded(path, project, true))
    await expect(saved(path, project, "TOKEN=y\n", stamp)).resolves.toMatchObject({ saved: true })
    expect(readFileSync(path, "utf8")).toBe("TOKEN=y\n")
  })

  it("refuses an edit made on another file than the item points at now, or on no file it names", async ({
    project,
  }) => {
    const path = join(project, "b.ts")
    writeFileSync(path, "b\n")
    const stamp = stampOf(await loaded(path, project))
    const edit = { text: "a, edited\n", basedOn: stamp }
    for (const named of [{ path: join(project, "a.ts") }, {}])
      // eslint-disable-next-line no-await-in-loop -- Each edit after the other.
      await expect(
        saveText(file(path), { ...edit, ...named }, placed(project)),
      ).rejects.toMatchObject(unwritable("moved"))
    expect(readFileSync(path, "utf8")).toBe("b\n")
    // The path it was made on is this one: it saves.
    await expect(saved(path, project, "b, edited\n", stamp)).resolves.toMatchObject({
      saved: true,
    })
  })

  it("refuses any item but a file of a project window, and a file outside its project", async ({
    project,
    elsewhere,
  }) => {
    const path = join(project, "a.ts")
    writeFileSync(path, "a\n")
    const copy = join(elsewhere, "a.ts")
    writeFileSync(copy, "a\n")
    const edit = { text: "edited\n", basedOn: stampOf(await loaded(path, project)), path }
    await expect(saveText(file(path), edit, undefined)).rejects.toMatchObject(
      unwritable("not-a-plan"),
    )
    await expect(saveText({ kind: "image", path }, edit, placed(project))).rejects.toMatchObject(
      unwritable("not-a-plan"),
    )
    await expect(
      saved(copy, project, "edited\n", stampOf(await loaded(copy, project))),
    ).rejects.toMatchObject(unwritable("outside"))
    expect(readFileSync(path, "utf8")).toBe("a\n")
    expect(readFileSync(copy, "utf8")).toBe("a\n")
  })

  it("refuses Git's own .git, and agents' worktrees the project holds", async ({ project }) => {
    mkdirSync(join(project, ".git"))
    writeFileSync(join(project, ".git", "config"), "[core]\n")
    mkdirSync(join(project, "worktrees", "shop"), { recursive: true })
    writeFileSync(join(project, "worktrees", "shop", "a.ts"), "a\n")
    for (const path of [
      join(project, ".git", "config"),
      join(project, "worktrees", "shop", "a.ts"),
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Each file after the other.
      const stamp = stampOf(await loaded(path, project))
      // eslint-disable-next-line no-await-in-loop -- As above.
      await expect(saved(path, project, "x\n", stamp)).rejects.toMatchObject(unwritable("outside"))
    }
    expect(readFileSync(join(project, ".git", "config"), "utf8")).toBe("[core]\n")
    expect(readFileSync(join(project, "worktrees", "shop", "a.ts"), "utf8")).toBe("a\n")
  })

  it("saves a project the person made of an agent's worktree like any", async ({ elsewhere }) => {
    // `elsewhere` holds agents' worktrees, and the project is one of them, or all of them.
    const shop = join(elsewhere, "shop")
    mkdirSync(shop)
    for (const [project, path] of [
      [shop, join(shop, "a.ts")],
      [elsewhere, join(elsewhere, "b.ts")],
    ] as const) {
      writeFileSync(path, "a\n")
      const folders = { project, worktrees: elsewhere }
      // eslint-disable-next-line no-await-in-loop -- Each project after the other.
      const content = await loadText(file(path), false, folders)
      expect(content).toMatchObject({ content: { kind: "text", writable: true } })
      // eslint-disable-next-line no-await-in-loop -- As above.
      await expect(
        saveText(file(path), { text: "b\n", basedOn: stampOf(content), path }, folders),
      ).resolves.toMatchObject({ saved: true })
      expect(readFileSync(path, "utf8")).toBe("b\n")
    }
  })

  it.skipIf(process.platform === "win32")(
    "writes the file a link in the project points at, and refuses one that leads out of it or into .git",
    async ({ project, elsewhere }) => {
      writeFileSync(join(project, "real.ts"), "a\n")
      symlinkSync(join(project, "real.ts"), join(project, "link.ts"))
      writeFileSync(join(elsewhere, "away.ts"), "a\n")
      symlinkSync(join(elsewhere, "away.ts"), join(project, "out.ts"))
      mkdirSync(join(project, ".git"))
      writeFileSync(join(project, ".git", "config"), "[core]\n")
      symlinkSync(join(project, ".git"), join(project, "g"))
      const link = join(project, "link.ts")
      await saved(link, project, "b\n", stampOf(await loaded(link, project)))
      expect(readFileSync(join(project, "real.ts"), "utf8")).toBe("b\n")
      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      for (const path of [join(project, "out.ts"), join(project, "g", "config")]) {
        // eslint-disable-next-line no-await-in-loop -- Each file after the other.
        const stamp = stampOf(await loaded(path, project))
        // eslint-disable-next-line no-await-in-loop -- As above.
        await expect(saved(path, project, "b\n", stamp)).rejects.toMatchObject(
          unwritable("outside"),
        )
      }
      expect(readFileSync(join(elsewhere, "away.ts"), "utf8")).toBe("a\n")
      expect(readFileSync(join(project, ".git", "config"), "utf8")).toBe("[core]\n")
    },
  )

  it("refuses what can never be saved, saying why: gone, too large, no longer text", async ({
    project,
  }) => {
    const path = join(project, "a.ts")
    writeFileSync(path, "a\n")
    const stamp = stampOf(await loaded(path, project))
    await expect(saved(join(project, "gone.ts"), project, "x", stamp)).rejects.toMatchObject(
      unwritable("gone"),
    )
    // Past the bytes one save carries, however few characters.
    await expect(
      saved(path, project, "ż".repeat(companionLimits.plan / 2 + 1), stamp),
    ).rejects.toMatchObject(unwritable("too-large"))
    writeFileSync(path, "a".repeat(companionLimits.plan + 1))
    await expect(saved(path, project, "short", stamp)).rejects.toMatchObject(
      unwritable("too-large"),
    )
    writeFileSync(path, Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    await expect(saved(path, project, "x", stamp)).rejects.toMatchObject(unwritable("not-text"))
    writeFileSync(path, Buffer.from([0x41, 0x00, 0x42]))
    await expect(saved(path, project, "x", stamp)).rejects.toMatchObject(unwritable("not-text"))
    expect(readFileSync(path)).toEqual(Buffer.from([0x41, 0x00, 0x42]))
    expect(readdirSync(project)).toEqual(["a.ts"])
  })

  it.skipIf(permissions)(
    "refuses a file, or a folder, the runner may not write",
    async ({ project }) => {
      const path = join(project, "locked.ts")
      writeFileSync(path, "a\n")
      chmodSync(path, 0o444)
      await expect(
        saved(path, project, "b\n", stampOf(await loaded(path, project))),
      ).rejects.toMatchObject(unwritable("folder"))
      expect(readFileSync(path, "utf8")).toBe("a\n")
      const folder = join(project, "ro")
      mkdirSync(folder)
      const inner = join(folder, "a.ts")
      writeFileSync(inner, "a\n")
      chmodSync(folder, 0o555)
      try {
        await expect(
          saved(inner, project, "b\n", stampOf(await loaded(inner, project))),
        ).rejects.toMatchObject(unwritable("folder"))
        expect(readdirSync(folder)).toEqual(["a.ts"])
        expect(readFileSync(inner, "utf8")).toBe("a\n")
      } finally {
        chmodSync(folder, 0o755)
      }
    },
  )
})
