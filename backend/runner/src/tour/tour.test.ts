import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Install, Model } from "@novadeck/harness-core/harness"
import type { AgentName, Project } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { harnesses } from "../harnesses/registry.js"
import { describe, expect, it } from "../test.js"
import { startLine } from "./brief.js"
import { tourFolder, tourMarker } from "./folder.js"
import { Tour, withinFolder, type TourHost } from "./tour.js"

// Where a harness lives, for the model lists the tour picks from: Novadeck's own lists ignore it.
const install: Install = { env: {}, home: "/home/x", platform: "linux", plugin: "/plugins" }

const conflict = (error: unknown): boolean =>
  error instanceof DomainError && error.code === "CONFLICT"

const tourIn = (
  home: string,
  options: {
    projects?: Project[]
    connected?: readonly AgentName[]
    notices?: [string, string][]
    shown?: readonly string[]
    models?: readonly Model[]
    // How each removal goes; at once by default.
    removal?: () => Promise<void>
  } = {},
) => {
  const projects = options.projects ?? []
  const removed: string[] = []
  const host: TourHost = {
    home,
    connected: (agent) => Promise.resolve((options.connected ?? ["claude"]).includes(agent)),
    models: (agent) =>
      options.models ? Promise.resolve(options.models) : harnesses[agent].launch.models(install),
    install: () => Promise.resolve(undefined),
    projects: {
      list: () => projects.filter(({ id }) => !removed.includes(id)),
      remove: (id) => {
        if (removed.includes(id)) return Promise.reject(new DomainError("NOT_FOUND"))
        removed.push(id)
        return options.removal?.() ?? Promise.resolve()
      },
    },
    notice: (terminalId, text) => {
      if (!(options.shown ?? []).includes(terminalId)) return false
      options.notices?.push([terminalId, text])
      return true
    },
  }
  return { tour: new Tour(host), removed }
}

const project = (id: string, cwd: string): Project => ({ id, name: id, cwd, pinned: false })

const scratchHome = async (resources: { defer: (cleanup: () => Promise<void>) => void }) => {
  const home = await mkdtemp(join(tmpdir(), "novadeck-tour-home-"))
  resources.defer(() => rm(home, { recursive: true, force: true }))
  return home
}

describe("readying the tour", () => {
  it("writes the brief in the folder and answers the launch line", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home)
    const prepared = await tour.prepare("claude")
    const directory = tourFolder(home)
    expect(prepared).toMatchObject({ directory, brief: "launch", model: "haiku", removed: [] })
    expect(prepared.command).toMatch(/^claude --model haiku /)
    expect((await readdir(directory)).toSorted()).toEqual(
      ["AGENTS.md", "CLAUDE.md", tourMarker].toSorted(),
    )
    expect(await readFile(join(directory, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n")
  })

  it("removes the projects open at its folder, and no other", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour, removed } = tourIn(home, {
      projects: [project("old-tour", tourFolder(home)), project("mine", join(home, "code"))],
    })
    const prepared = await tour.prepare("claude")
    expect(prepared.removed).toEqual(["old-tour"])
    expect(removed).toEqual(["old-tour"])
  })

  it("refuses an agent Novadeck isn't connected to, changing nothing", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour, removed } = tourIn(home, {
      connected: ["claude"],
      projects: [project("old-tour", tourFolder(home))],
    })
    await expect(tour.prepare("codex")).rejects.toSatisfy(conflict)
    expect(removed).toEqual([])
    await expect(readdir(tourFolder(home))).rejects.toThrow()
  })

  it("removes a project inside its folder too", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, {
      projects: [project("inside", join(tourFolder(home), "site"))],
    })
    await expect(tour.prepare("claude")).resolves.toMatchObject({ removed: ["inside"] })
  })

  it("empties its folder only once a removal under way has closed its terminals", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const directory = tourFolder(home)
    const { tour: first } = tourIn(home)
    await first.prepare("claude")
    let closed: () => void = () => {}
    const { tour } = tourIn(home, {
      projects: [project("closing", directory)],
      removal: () => new Promise<void>((resolve) => (closed = resolve)),
    })
    const prepared = tour.prepare("claude")
    // Still closing: what the earlier run left is untouched.
    await writeFile(join(directory, "index.html"), "<p>made</p>")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await readdir(directory)).toContain("index.html")
    closed()
    await prepared
    expect(await readdir(directory)).not.toContain("index.html")
  })

  it("refuses an agent whose cheapest model can't be told, changing nothing", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const { tour, removed } = tourIn(home, {
      connected: ["codex"],
      models: [],
      projects: [project("old-tour", tourFolder(home))],
    })
    await expect(tour.prepare("codex")).rejects.toSatisfy(
      (error: unknown) => error instanceof DomainError && error.code === "MODELS_UNLISTED",
    )
    expect(removed).toEqual([])
    await expect(readdir(tourFolder(home))).rejects.toThrow()
  })

  it("refuses a second run while the first is being readied", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home)
    const first = tour.prepare("claude")
    await expect(tour.prepare("claude")).rejects.toSatisfy(conflict)
    await first
    await expect(tour.prepare("claude")).resolves.toMatchObject({ brief: "launch" })
  })

  it("leaves Antigravity's start line to the doorbell", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, { connected: ["agy"] })
    await expect(tour.prepare("agy")).resolves.toMatchObject({ brief: "doorbell" })
  })
})

describe("ringing the tour's brief", () => {
  it("rings the start line to the terminal's agent", () => {
    const notices: [string, string][] = []
    const { tour } = tourIn("/nowhere", { notices, shown: ["t1"] })
    tour.brief("t1")
    expect(notices).toEqual([["t1", startLine]])
  })

  it("refuses a terminal whose agent hasn't shown yet", () => {
    const { tour } = tourIn("/nowhere")
    expect(() => tour.brief("t1")).toThrow(DomainError)
  })
})

describe("a project's folder within the tour's", () => {
  it("is the folder itself or one inside it, never one beside it", () => {
    expect(withinFolder("/h/.novadeck/tour", "/h/.novadeck/tour", "linux")).toBe(true)
    expect(withinFolder("/h/.novadeck/tour/site/", "/h/.novadeck/tour", "linux")).toBe(true)
    expect(withinFolder("/h/.novadeck/tour-old", "/h/.novadeck/tour", "linux")).toBe(false)
    expect(withinFolder("/h/.novadeck", "/h/.novadeck/tour", "linux")).toBe(false)
  })

  it("tells cases apart only where the file system does", () => {
    expect(withinFolder("/h/.Novadeck/Tour", "/h/.novadeck/tour", "linux")).toBe(false)
    expect(withinFolder("/h/.Novadeck/Tour", "/h/.novadeck/tour", "darwin")).toBe(true)
    expect(
      withinFolder("C:\\Users\\x\\.Novadeck\\TOUR", "c:/users/x/.novadeck/tour", "win32"),
    ).toBe(true)
  })
})
