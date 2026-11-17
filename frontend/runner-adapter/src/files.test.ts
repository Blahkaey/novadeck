import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { filesExcludeLimits as coreLimits } from "@novadeck/core/files"
import { filesExcludeLimits } from "@novadeck/protocol"
import type { Runner } from "@novadeck/runner-client"

import { createRunnerFiles } from "./files"
import { context, describe, expect, it } from "./test"
import { startTestRunner } from "./testing/runner"

type Projects = Pick<Runner["projects"], "folder" | "filesExclude" | "setFilesExclude">

// The runner's project calls the files reach, each refusing unless a test gives it.
const projects = (given: Partial<Projects>): Projects => ({
  folder: async () => {
    throw new Error("unused")
  },
  filesExclude: async () => {
    throw new Error("unused")
  },
  setFilesExclude: async () => {
    throw new Error("unused")
  },
  ...given,
})

describe("the runner's files", () => {
  it("has no changes to tell of", () => {
    const files = createRunnerFiles(
      projects({ folder: async () => ({ entries: [], truncated: false }) }),
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
    )
    await expect(files.list("p", "")).rejects.toThrow("gone")
  })

  it("holds a project's patterns to the runner's own limits", () => {
    expect(coreLimits).toEqual(filesExcludeLimits)
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
        const files = createRunnerFiles(runner.client.projects)
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
        const files = createRunnerFiles(runner.client.projects)
        const other = createRunnerFiles((await runner.another()).projects)
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
