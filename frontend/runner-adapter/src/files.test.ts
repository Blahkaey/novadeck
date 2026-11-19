import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ChangeUnanswered, filesExcludeLimits as coreLimits } from "@novadeck/core/files"
import { filesExcludeLimits } from "@novadeck/protocol"
import type { Runner } from "@novadeck/runner-client"
import { WireError } from "@novadeck/wire"

import { createRunnerFiles } from "./files"
import { context, describe, expect, it } from "./test"
import { startTestRunner } from "./testing/runner"

type Projects = Pick<
  Runner["projects"],
  | "folder"
  | "checkout"
  | "updateCheckout"
  | "filesExclude"
  | "setFilesExclude"
  | "createEntry"
  | "moveEntry"
  | "copyEntry"
  | "removeEntry"
>

const unused = async (): Promise<never> => {
  throw new Error("unused")
}

// A runner, connected unless the test says otherwise, whose project calls the files reach each
// refuse unless a test gives them.
const projects = (
  given: Partial<Projects>,
  state: Runner["status"]["state"] = "connected",
): { readonly projects: Projects; readonly status: { readonly state: typeof state } } => ({
  projects: {
    folder: unused,
    checkout: unused,
    updateCheckout: unused,
    filesExclude: unused,
    setFilesExclude: unused,
    createEntry: unused,
    moveEntry: unused,
    copyEntry: unused,
    removeEntry: unused,
    ...given,
  },
  status: { state },
})

// A runner that is there all along.
const there = async (): Promise<void> => {}

describe("the runner's files", () => {
  it("has no changes to tell of", () => {
    const files = createRunnerFiles(
      projects({ folder: async () => ({ entries: [], truncated: false }) }),
      there,
    )
    expect(files.state.getSnapshot()).toEqual({ projects: {} })
  })

  it("lists a folder as the runner does", async () => {
    const asked: unknown[] = []
    const listing = { entries: [{ name: "src", folder: true, ignored: false }], truncated: true }
    const files = createRunnerFiles(
      projects({
        folder: async (input) => {
          asked.push(input)
          return listing
        },
      }),
      there,
    )
    await expect(files.list("p", "a/b")).resolves.toEqual(listing)
    expect(asked).toEqual([{ projectId: "p", folder: "a/b" }])
  })

  it("rejects with the runner's error", async () => {
    const files = createRunnerFiles(
      projects({
        folder: async () => {
          throw new Error("gone")
        },
      }),
      there,
    )
    await expect(files.list("p", "")).rejects.toThrow("gone")
  })

  it("holds a project's patterns to the runner's own limits", () => {
    expect(coreLimits).toEqual(filesExcludeLimits)
  })

  it("copies an entry into a folder, and answers where the copy is", async () => {
    const asked: unknown[] = []
    const files = createRunnerFiles(
      projects({
        copyEntry: async (input) => {
          asked.push(input)
          return { path: "docs/README copy.md" }
        },
      }),
      there,
    )
    await expect(files.copy!("p", "README.md", "docs")).resolves.toBe("docs/README copy.md")
    expect(asked).toEqual([{ projectId: "p", from: "README.md", into: "docs" }])
  })

  context("when the connection drops before the runner answers a move, a copy or a delete", () => {
    const lost = async (): Promise<never> => {
      throw new WireError("DISCONNECTED", "The connection was lost.")
    }
    // A runner the test brings back, and calls that each lose their connection.
    const dropping = () => {
      let back = (): void => {}
      const connected = new Promise<void>((resolve) => (back = resolve))
      const files = createRunnerFiles(
        projects({ moveEntry: lost, copyEntry: lost, removeEntry: lost }),
        () => connected,
      )
      return { files, back }
    }
    // Whether the promise has settled once what is queued has run.
    const settled = async (promise: Promise<unknown>): Promise<boolean> => {
      let done = false
      promise.then(
        () => (done = true),
        () => (done = true),
      )
      for (let round = 0; round < 10; round++)
        // eslint-disable-next-line no-await-in-loop -- One turn of the queue after another.
        await Promise.resolve()
      return done
    }

    it("fails only once the runner is back, as a change that may have been done or still be under way", async () => {
      const { files, back } = dropping()
      const changes = [
        files.copy!("p", "src", ""),
        files.move!("p", "README.md", "docs/README.md"),
        files.remove!("p", "dist"),
      ]
      for (const change of changes)
        // eslint-disable-next-line no-await-in-loop -- One change after the other.
        expect(await settled(change)).toBe(false)

      back()

      for (const change of changes)
        // eslint-disable-next-line no-await-in-loop -- One change after the other.
        await expect(change).rejects.toBeInstanceOf(ChangeUnanswered)
    })

    it("says nothing was done, at once, where it asked while the runner wasn't connected", async () => {
      const files = createRunnerFiles(
        projects({ moveEntry: lost }, "reconnecting"),
        () => new Promise<void>(() => {}),
      )
      await expect(files.move!("p", "README.md", "docs/README.md")).rejects.toThrow(
        "Novadeck isn't connected to the runner, so nothing was done.",
      )
    })

    it("fails at once for any other reason, waiting on nothing", async () => {
      const files = createRunnerFiles(
        projects({
          copyEntry: async () => {
            throw new WireError("CONFLICT", "There are too many copies of a.ts in src already.")
          },
        }),
        () => new Promise<void>(() => {}),
      )
      await expect(files.copy!("p", "src/a.ts", "src")).rejects.toMatchObject({
        code: "CONFLICT",
      })
    })
  })

  it("asks how the checkout stands and updates it, by project", async () => {
    const asked: string[] = []
    const files = createRunnerFiles(
      projects({
        checkout: async (input) => {
          asked.push(`checkout ${input.projectId}`)
          return {
            behind: { branch: "main", remote: "origin/main", count: 3 },
            moved: 1,
            head: "abc",
          }
        },
        updateCheckout: async (input) => {
          asked.push(`update ${input.projectId}`)
          return { ok: false, said: "Your local changes would be overwritten." }
        },
      }),
      there,
    )
    await expect(files.checkout?.("p")).resolves.toMatchObject({ behind: { count: 3 } })
    await expect(files.update?.("p")).resolves.toEqual({
      ok: false,
      said: "Your local changes would be overwritten.",
    })
    expect(asked).toEqual(["checkout p", "update p"])
  })

  context("on a real runner", () => {
    it("reads the project's folders as they are, and refuses what leads out", async () => {
      const runner = await startTestRunner()
      try {
        const directory = await mkdtemp(join(tmpdir(), "novadeck-files-"))
        await mkdir(join(directory, "src"))
        await writeFile(join(directory, "src", "index.ts"), "")
        const project = await runner.client.projects.create({
          id: crypto.randomUUID(),
          name: "Storefront",
          cwd: directory,
        })
        const files = createRunnerFiles(runner.client, there)
        await expect(files.list(project.id, "")).resolves.toEqual({
          entries: [{ name: "src", folder: true, ignored: false }],
          truncated: false,
        })
        await expect(files.list(project.id, "src")).resolves.toMatchObject({
          entries: [{ name: "index.ts", folder: false }],
        })
        await expect(files.list(project.id, "..")).rejects.toMatchObject({
          code: "INVALID_DIRECTORY",
        })
        await expect(files.checkout?.(project.id)).resolves.toEqual({
          behind: null,
          moved: 0,
          head: null,
        })
      } finally {
        await runner.close()
      }
    })

    it("makes, renames and deletes the project's files, and says why the runner refused", async () => {
      const runner = await startTestRunner()
      try {
        const directory = await mkdtemp(join(tmpdir(), "novadeck-files-"))
        await writeFile(join(directory, "README.md"), "# Shop\n")
        const project = await runner.client.projects.create({
          id: crypto.randomUUID(),
          name: "Storefront",
          cwd: directory,
        })
        const files = createRunnerFiles(runner.client, there)

        await expect(files.create!(project.id, "src/cart/total.ts", false)).resolves.toBe(
          "src/cart/total.ts",
        )
        await expect(files.create!(project.id, "docs", true)).resolves.toBe("docs")
        await expect(files.move!(project.id, "README.md", "docs/README.md")).resolves.toBe(
          "docs/README.md",
        )
        await files.remove!(project.id, "src")

        expect(await readdir(directory)).toEqual(["docs"])
        await expect(readFile(join(directory, "docs", "README.md"), "utf8")).resolves.toBe(
          "# Shop\n",
        )
        await expect(files.create!(project.id, "docs/README.md", false)).rejects.toMatchObject({
          code: "CONFLICT",
          message: "There's already something named README.md in docs.",
        })
        await expect(files.remove!(project.id, "../outside")).rejects.toMatchObject({
          code: "INVALID_DIRECTORY",
        })
        await expect(files.move!(crypto.randomUUID(), "docs", "doc")).rejects.toMatchObject({
          code: "NOT_FOUND",
        })
      } finally {
        await runner.close()
      }
    })

    it("copies the project's files under a name that is free, and refuses a folder into itself", async () => {
      const runner = await startTestRunner()
      try {
        const directory = await mkdtemp(join(tmpdir(), "novadeck-files-"))
        await writeFile(join(directory, "README.md"), "# Shop\n")
        await mkdir(join(directory, "src", "cart"), { recursive: true })
        await writeFile(join(directory, "src", "cart", "useCart.ts"), "export {}\n")
        const project = await runner.client.projects.create({
          id: crypto.randomUUID(),
          name: "Storefront",
          cwd: directory,
        })
        const files = createRunnerFiles(runner.client, there)

        await expect(files.copy!(project.id, "README.md", "")).resolves.toBe("README copy.md")
        await expect(files.copy!(project.id, "README.md", "")).resolves.toBe("README copy 2.md")
        await expect(files.copy!(project.id, "src/cart", "")).resolves.toBe("cart")
        await expect(files.move!(project.id, "README copy.md", "src/README.md")).resolves.toBe(
          "src/README.md",
        )

        expect((await readdir(directory)).toSorted()).toEqual([
          "README copy 2.md",
          "README.md",
          "cart",
          "src",
        ])
        await expect(readFile(join(directory, "cart", "useCart.ts"), "utf8")).resolves.toBe(
          "export {}\n",
        )
        await expect(files.copy!(project.id, "src", "src/cart")).rejects.toMatchObject({
          code: "INVALID_DIRECTORY",
          message: "A folder can't be copied into itself.",
        })
      } finally {
        await runner.close()
      }
    })

    it("keeps a project's patterns for hiding files, for another window to read", async () => {
      const runner = await startTestRunner()
      try {
        const directory = await mkdtemp(join(tmpdir(), "novadeck-files-"))
        const project = await runner.client.projects.create({
          id: crypto.randomUUID(),
          name: "Storefront",
          cwd: directory,
        })
        const files = createRunnerFiles(runner.client, there)
        const other = createRunnerFiles(await runner.another(), there)
        await expect(files.exclude!.read(project.id)).resolves.toEqual({})

        await files.exclude!.save(project.id, { "**/dist": true, "**/.DS_Store": false })

        await expect(other.exclude!.read(project.id)).resolves.toEqual({
          "**/dist": true,
          "**/.DS_Store": false,
        })
        const tooMany = Object.fromEntries(
          Array.from({ length: filesExcludeLimits.patterns + 1 }, (_, at) => [`${at}.log`, true]),
        )
        await expect(files.exclude!.save(project.id, tooMany)).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining(`at most ${filesExcludeLimits.patterns} patterns`),
        })
        await expect(files.exclude!.read(crypto.randomUUID())).rejects.toMatchObject({
          code: "NOT_FOUND",
        })
      } finally {
        await runner.close()
      }
    })
  })
})
