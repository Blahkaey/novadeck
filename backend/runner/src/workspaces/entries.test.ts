import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { describe, expect, it } from "../test.js"
import { createEntry, moveEntry, removeEntry, windowsRefusal } from "./entries.js"

type Resources = { defer: (undo: () => void) => void }

const folder = (resources: Resources, prefix = "novadeck-entries-"): string => {
  const root = mkdtempSync(join(tmpdir(), prefix))
  resources.defer(() => rmSync(root, { recursive: true, force: true }))
  return root
}

// A project with a few files and folders, and a folder outside it holding a file.
const project = (resources: Resources) => {
  const root = folder(resources)
  mkdirSync(join(root, "src", "cart"), { recursive: true })
  mkdirSync(join(root, "docs"))
  writeFileSync(join(root, "README.md"), "# Shop\n")
  writeFileSync(join(root, "src", "cart", "useCart.ts"), "export {}\n")
  const outside = folder(resources, "novadeck-outside-")
  writeFileSync(join(outside, "secret.txt"), "keep\n")
  return { root, outside }
}

// What the project's folder holds, every path from its root, folders ending in `/`.
const tree = (root: string, folderPath = ""): string[] =>
  readdirSync(join(root, folderPath), { withFileTypes: true })
    .toSorted((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const path = folderPath === "" ? entry.name : `${folderPath}/${entry.name}`
      return entry.isDirectory() ? [`${path}/`, ...tree(root, path)] : [path]
    })

// Whether the folder's filesystem takes a name in other letters' case for the same entry.
const caseBlind = (root: string): boolean => {
  writeFileSync(join(root, "probe"), "")
  const blind = existsSync(join(root, "PROBE"))
  rmSync(join(root, "probe"))
  return blind
}

// Whether the system holds this process to a folder's permissions; root is never refused.
const permissionsHold = process.platform !== "win32" && process.getuid?.() !== 0

describe("making a file or folder in a project", () => {
  it("makes an empty file, and answers its path", async ({ resources }) => {
    const { root } = project(resources)

    await expect(createEntry(root, "src/cart/total.ts", false)).resolves.toEqual({
      path: "src/cart/total.ts",
    })

    expect(readFileSync(join(root, "src", "cart", "total.ts"), "utf8")).toBe("")
  })

  it("makes an empty folder", async ({ resources }) => {
    const { root } = project(resources)

    await createEntry(root, "assets", true)

    expect(lstatSync(join(root, "assets")).isDirectory()).toBe(true)
    expect(readdirSync(join(root, "assets"))).toEqual([])
  })

  it("makes the folders on the way that are missing, beside those that are there", async ({
    resources,
  }) => {
    const { root } = project(resources)

    await createEntry(root, "src/api/v2/orders.ts", false)
    await createEntry(root, "docs/guides/setup", true)

    expect(tree(root)).toEqual([
      "README.md",
      "docs/",
      "docs/guides/",
      "docs/guides/setup/",
      "src/",
      "src/api/",
      "src/api/v2/",
      "src/api/v2/orders.ts",
      "src/cart/",
      "src/cart/useCart.ts",
    ])
  })

  it("makes it through a link to a folder inside the project", async ({ resources }) => {
    const { root } = project(resources)
    symlinkSync(join(root, "src"), join(root, "code"))

    await createEntry(root, "code/main.ts", false)

    expect(existsSync(join(root, "src", "main.ts"))).toBe(true)
  })

  it("refuses a name that is taken, a file's, a folder's or a link's that leads nowhere, and overwrites nothing", async ({
    resources,
  }) => {
    const { root } = project(resources)
    symlinkSync(join(root, "nowhere"), join(root, "dangling"))

    for (const [path, isFolder] of [
      ["README.md", false],
      ["README.md", true],
      ["docs", false],
      ["src/cart", true],
      ["dangling", false],
    ] as const)
      // eslint-disable-next-line no-await-in-loop -- One refusal after another.
      await expect(createEntry(root, path, isFolder)).rejects.toMatchObject({ code: "CONFLICT" })

    await expect(createEntry(root, "src/cart/useCart.ts", false)).rejects.toThrow(
      "There's already something named useCart.ts in src/cart.",
    )
    await expect(createEntry(root, "README.md", false)).rejects.toThrow(
      "There's already something named README.md in the project's folder.",
    )
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Shop\n")
    expect(lstatSync(join(root, "dangling")).isSymbolicLink()).toBe(true)
  })

  it("refuses a way through a link that leads nowhere, and makes nothing where it leads", async ({
    resources,
  }) => {
    const { root, outside } = project(resources)
    symlinkSync(join(outside, "missing"), join(root, "gone"))

    await expect(createEntry(root, "gone/x.ts", false)).rejects.toMatchObject({
      code: "CONFLICT",
    })

    expect(readdirSync(outside)).toEqual(["secret.txt"])
    expect(lstatSync(join(root, "gone")).isSymbolicLink()).toBe(true)
  })

  it("refuses a path through a file", async ({ resources }) => {
    const { root } = project(resources)

    await expect(createEntry(root, "README.md/notes.md", false)).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })
  })

  it("refuses a way through a link that leads outside the project, and makes nothing there", async ({
    resources,
  }) => {
    const { root, outside } = project(resources)
    symlinkSync(outside, join(root, "out"))

    await expect(createEntry(root, "out/planted.ts", false)).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "out leads outside the project.",
    })
    await expect(createEntry(root, "out/new/planted.ts", false)).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })

    expect(readdirSync(outside)).toEqual(["secret.txt"])
  })

  // Windows may report a name past its limit as an invalid one, not as one too long.
  it.skipIf(process.platform === "win32")(
    "takes away the folders it made when what they were for can't be made",
    async ({ resources }) => {
      const { root } = project(resources)

      await expect(
        createEntry(root, `new/deeper/${"x".repeat(300)}.ts`, false),
      ).rejects.toMatchObject({
        code: "WRITE_REFUSED",
        message: "The name is too long for the system.",
      })

      expect(existsSync(join(root, "new"))).toBe(false)
    },
  )

  it.runIf(process.platform === "win32")(
    "says Windows refuses a name it keeps for a device",
    async ({ resources }) => {
      const { root } = project(resources)

      await expect(createEntry(root, "con.txt", false)).rejects.toMatchObject({
        code: "WRITE_REFUSED",
        message: "Windows keeps the name con.txt for a device.",
      })

      expect(existsSync(join(root, "con.txt"))).toBe(false)
    },
  )

  it("says the system refuses it in a folder that can only be read", async ({
    resources,
    skip,
  }) => {
    skip(!permissionsHold, "Root, and Windows, are never refused by a folder's permissions.")
    const { root } = project(resources)
    chmodSync(join(root, "docs"), 0o555)
    resources.defer(() => chmodSync(join(root, "docs"), 0o755))

    await expect(createEntry(root, "docs/guide.md", false)).rejects.toMatchObject({
      code: "WRITE_REFUSED",
      message: "The system doesn't allow it: permission denied.",
    })
    await expect(createEntry(root, "docs/guides/install.md", false)).rejects.toMatchObject({
      code: "WRITE_REFUSED",
    })
  })
})

describe("renaming or moving a file or folder in a project", () => {
  it("renames a file in its folder, and answers the new path", async ({ resources }) => {
    const { root } = project(resources)

    await expect(moveEntry(root, "src/cart/useCart.ts", "src/cart/cart.ts")).resolves.toEqual({
      path: "src/cart/cart.ts",
    })

    expect(readFileSync(join(root, "src", "cart", "cart.ts"), "utf8")).toBe("export {}\n")
    expect(existsSync(join(root, "src", "cart", "useCart.ts"))).toBe(false)
  })

  it("moves a file, and a folder with everything in it, into another folder", async ({
    resources,
  }) => {
    const { root } = project(resources)

    await moveEntry(root, "README.md", "docs/README.md")
    await moveEntry(root, "src/cart", "docs/cart")

    expect(tree(root)).toEqual([
      "docs/",
      "docs/README.md",
      "docs/cart/",
      "docs/cart/useCart.ts",
      "src/",
    ])
  })

  it("moves a link as a link, leaving what it leads to", async ({ resources }) => {
    const { root, outside } = project(resources)
    symlinkSync(outside, join(root, "out"))

    await moveEntry(root, "out", "docs/out")

    expect(lstatSync(join(root, "docs", "out")).isSymbolicLink()).toBe(true)
    expect(readdirSync(outside)).toEqual(["secret.txt"])
  })

  it("renames a file to its own name in other letters' case on a filesystem blind to it", async ({
    resources,
    skip,
  }) => {
    const { root } = project(resources)
    skip(
      !caseBlind(root),
      "This filesystem tells letters' case apart: README.md and readme.md are two names.",
    )

    await moveEntry(root, "README.md", "readme.md")

    expect(readdirSync(root)).toContain("readme.md")
    expect(readdirSync(root)).not.toContain("README.md")
  })

  it("refuses a name taken by another file, and overwrites nothing", async ({ resources }) => {
    const { root } = project(resources)
    writeFileSync(join(root, "docs", "README.md"), "# Docs\n")

    await expect(moveEntry(root, "README.md", "docs/README.md")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "There's already something named README.md in docs.",
    })
    await expect(moveEntry(root, "docs", "src")).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(moveEntry(root, "README.md", "README.md")).rejects.toMatchObject({
      code: "CONFLICT",
    })

    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Shop\n")
    expect(readFileSync(join(root, "docs", "README.md"), "utf8")).toBe("# Docs\n")
  })

  it("refuses to move a folder onto an empty folder, which the system would replace", async ({
    resources,
  }) => {
    const { root } = project(resources)

    await expect(moveEntry(root, "src/cart", "docs")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "There's already something named docs in the project's folder.",
    })

    expect(tree(root)).toEqual(["README.md", "docs/", "src/", "src/cart/", "src/cart/useCart.ts"])
  })

  it("refuses a name another link to the same file holds, though it is the same file", async ({
    resources,
  }) => {
    const { root } = project(resources)
    linkSync(join(root, "README.md"), join(root, "docs", "index.md"))

    await expect(moveEntry(root, "README.md", "docs/index.md")).rejects.toMatchObject({
      code: "CONFLICT",
    })

    expect(existsSync(join(root, "README.md"))).toBe(true)
  })

  it("refuses to move a folder into itself or below it", async ({ resources }) => {
    const { root } = project(resources)

    for (const to of ["src/cart/inner", "src/cart/inner/deeper"]) {
      mkdirSync(join(root, "src", "cart", "inner"), { recursive: true })
      // eslint-disable-next-line no-await-in-loop -- One refusal after another.
      await expect(moveEntry(root, "src/cart", to)).rejects.toMatchObject({
        code: "INVALID_DIRECTORY",
        message: "A folder can't move into itself.",
      })
    }
    await expect(moveEntry(root, "src", "src/cart/src")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })
  })

  it("refuses a folder named in other letters' case into itself, which the check by path misses", async ({
    resources,
    skip,
  }) => {
    const { root } = project(resources)
    skip(
      !caseBlind(root),
      "This filesystem tells letters' case apart: src/CART isn't src/cart, so it isn't there.",
    )
    mkdirSync(join(root, "src", "cart", "inner"))

    await expect(moveEntry(root, "src/CART", "src/cart/inner/cart")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "A folder can't move into itself.",
    })

    expect(existsSync(join(root, "src", "cart", "useCart.ts"))).toBe(true)
  })

  it("refuses what is missing: the entry, or the folder it would go into", async ({
    resources,
  }) => {
    const { root } = project(resources)

    await expect(moveEntry(root, "src/gone.ts", "src/here.ts")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "src/gone.ts isn't there any more.",
    })
    await expect(moveEntry(root, "README.md", "missing/README.md")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })
  })

  it("refuses to move into, or out of, a folder a link leads outside the project", async ({
    resources,
  }) => {
    const { root, outside } = project(resources)
    symlinkSync(outside, join(root, "out"))

    await expect(moveEntry(root, "README.md", "out/README.md")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })
    await expect(moveEntry(root, "out/secret.txt", "secret.txt")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })

    expect(readdirSync(outside)).toEqual(["secret.txt"])
    expect(existsSync(join(root, "README.md"))).toBe(true)
  })
})

describe("deleting a file or folder in a project", () => {
  it("deletes a file", async ({ resources }) => {
    const { root } = project(resources)

    await removeEntry(root, "README.md")

    expect(existsSync(join(root, "README.md"))).toBe(false)
  })

  it("deletes a folder with everything in it", async ({ resources }) => {
    const { root } = project(resources)

    await removeEntry(root, "src")

    expect(tree(root)).toEqual(["README.md", "docs/"])
  })

  it("deletes a link, never what it leads to, inside a deleted folder too", async ({
    resources,
  }) => {
    const { root, outside } = project(resources)
    symlinkSync(outside, join(root, "out"))
    symlinkSync(join(outside, "secret.txt"), join(root, "docs", "secret.txt"))

    await removeEntry(root, "out")
    await removeEntry(root, "docs")

    expect(existsSync(join(root, "out"))).toBe(false)
    expect(existsSync(join(root, "docs"))).toBe(false)
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("keep\n")
  })

  it("refuses what is missing, and what a link leads to outside the project", async ({
    resources,
  }) => {
    const { root, outside } = project(resources)
    symlinkSync(outside, join(root, "out"))

    await expect(removeEntry(root, "docs/gone.md")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "docs/gone.md isn't there any more.",
    })
    await expect(removeEntry(root, "out/secret.txt")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    })

    expect(readdirSync(outside)).toEqual(["secret.txt"])
  })
})

describe("paths a project's entries refuse", () => {
  // Each of the three changes, at `path`, from it or to it, made when it is called.
  const changes = (root: string, path: string): (() => Promise<unknown>)[] => [
    () => createEntry(root, path, false),
    () => createEntry(root, path, true),
    () => moveEntry(root, path, "moved"),
    () => moveEntry(root, "README.md", path),
    () => removeEntry(root, path),
  ]

  it("refuses the project's folder itself", async ({ resources }) => {
    const { root } = project(resources)

    for (const change of changes(root, ""))
      // eslint-disable-next-line no-await-in-loop -- One refusal after another.
      await expect(change()).rejects.toMatchObject({
        code: "INVALID_DIRECTORY",
        message: "Novadeck doesn't change the project's folder itself.",
      })
    expect(tree(root)).toEqual(["README.md", "docs/", "src/", "src/cart/", "src/cart/useCart.ts"])
  })

  it("refuses a path that leads out of the root or isn't one", async ({ resources }) => {
    const { root, outside } = project(resources)

    for (const path of [
      "..",
      `../${basename(outside)}/secret.txt`,
      "src/../README.md",
      "./README.md",
      join(outside, "secret.txt"),
      "/README.md",
      "src\\cart",
      "src/cart\0.ts",
      "src//cart",
      "src/",
    ])
      for (const change of changes(root, path))
        // eslint-disable-next-line no-await-in-loop -- One refusal after another.
        await expect(change()).rejects.toMatchObject({ code: "INVALID_DIRECTORY" })

    expect(tree(root)).toEqual(["README.md", "docs/", "src/", "src/cart/", "src/cart/useCart.ts"])
    expect(readdirSync(outside)).toEqual(["secret.txt"])
  })

  it("refuses Git's own .git, in any segment and any letters' case", async ({ resources }) => {
    const { root } = project(resources)
    mkdirSync(join(root, ".git"))
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
    mkdirSync(join(root, "vendor", ".GIT"), { recursive: true })

    for (const path of [".git", ".git/HEAD", ".git/hooks/pre-commit", "vendor/.GIT", ".Git/x"])
      for (const change of changes(root, path))
        // eslint-disable-next-line no-await-in-loop -- One refusal after another.
        await expect(change()).rejects.toMatchObject({
          code: "INVALID_DIRECTORY",
          message: "Novadeck doesn't change Git's own .git.",
        })

    expect(readFileSync(join(root, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n")
    expect(existsSync(join(root, "vendor", ".GIT"))).toBe(true)
  })

  it("refuses Git's own .git through a link to it, inside and as the folder of either end", async ({
    resources,
  }) => {
    const { root } = project(resources)
    mkdirSync(join(root, ".git"))
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
    symlinkSync(join(root, ".git"), join(root, "gitlink"))
    const refusal = {
      code: "INVALID_DIRECTORY",
      message: "Novadeck doesn't change Git's own .git.",
    }

    await expect(createEntry(root, "gitlink/planted", false)).rejects.toMatchObject(refusal)
    await expect(createEntry(root, "gitlink/hooks/pre-commit", false)).rejects.toMatchObject(
      refusal,
    )
    await expect(moveEntry(root, "gitlink/HEAD", "HEAD")).rejects.toMatchObject(refusal)
    await expect(moveEntry(root, "README.md", "gitlink/README.md")).rejects.toMatchObject(refusal)
    await expect(removeEntry(root, "gitlink/HEAD")).rejects.toMatchObject(refusal)

    expect(readdirSync(join(root, ".git"))).toEqual(["HEAD"])
    expect(readFileSync(join(root, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n")
    expect(existsSync(join(root, "README.md"))).toBe(true)
  })

  it("deletes a link to .git as a link, leaving .git", async ({ resources }) => {
    const { root } = project(resources)
    mkdirSync(join(root, ".git"))
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
    symlinkSync(join(root, ".git"), join(root, "gitlink"))

    await removeEntry(root, "gitlink")

    expect(existsSync(join(root, "gitlink"))).toBe(false)
    expect(readdirSync(join(root, ".git"))).toEqual(["HEAD"])
  })

  // Windows names `.git` `GIT~1` too, where its volume keeps short names.
  it.runIf(process.platform === "win32")(
    "refuses Git's own .git by its short name",
    async ({ resources, skip }) => {
      const { root } = project(resources)
      mkdirSync(join(root, ".git"))
      writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
      skip(!existsSync(join(root, "GIT~1")), "This volume keeps no short names.")
      const refusal = {
        code: "INVALID_DIRECTORY",
        message: "Novadeck doesn't change Git's own .git.",
      }

      await expect(createEntry(root, "GIT~1/index.lock", false)).rejects.toMatchObject(refusal)
      await expect(removeEntry(root, "GIT~1")).rejects.toMatchObject(refusal)
      await expect(moveEntry(root, "GIT~1", "git")).rejects.toMatchObject(refusal)

      expect(readdirSync(join(root, ".git"))).toEqual(["HEAD"])
    },
  )

  it("refuses the project's folder once it is gone", async ({ resources }) => {
    const { root } = project(resources)
    rmSync(root, { recursive: true })

    await expect(createEntry(root, "a.ts", false)).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      message: "The project's folder is gone.",
    })
  })
})

describe("names Windows refuses", () => {
  it("refuses a device's name, with an extension or a space after it, in any case", () => {
    for (const name of ["CON", "con.txt", "Nul", "aux.tar.gz", "COM1", "lpt9.log", "PRN "])
      expect(windowsRefusal(name)).toBe(`Windows keeps the name ${name} for a device.`)
  })

  it("refuses a character Windows keeps for itself, and a name ending in a space or a dot", () => {
    expect(windowsRefusal("notes:draft.md")).toBe("Windows doesn't allow : in a name.")
    expect(windowsRefusal("what?.md")).toBe("Windows doesn't allow ? in a name.")
    expect(windowsRefusal("tab\there")).toBe("Windows doesn't allow a control character in a name.")
    expect(windowsRefusal("notes.")).toBe(
      "Windows doesn't allow a name to end with a space or a dot.",
    )
    expect(windowsRefusal("notes ")).toBe(
      "Windows doesn't allow a name to end with a space or a dot.",
    )
  })

  it("keeps the names that only look like them", () => {
    for (const name of ["console.ts", "com10", "nullable.ts", "README.md", ".env", "a b.md"])
      expect(windowsRefusal(name)).toBeUndefined()
  })
})
